// T13 (stored generated PDFs) and T14 (signed upload, replacement, failures, wrong tenant) against fleet_test
// with the real files API (local storage + development verifier).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { insertFile } from './crmFixtures.js';
import { newInvoice, pdfBytes, rentalChain } from './rentalFixtures.js';

let h: Harness;
let admin: Actor;
let other: Actor; // another company
let colleague: Actor; // same company, another user

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  h = await createHarness({ files: true });
  admin = await h.actor('doc-admin', 'managing-director');
  other = await h.actor('doc-other', 'managing-director');
  colleague = await h.addUser(admin, { roleCode: 'operations-manager', branchId: admin.branchId, allBranches: true });
});
afterAll(async () => {
  await h.close();
});

async function upload(a: Actor, bytes: Buffer, name = 'doc.pdf'): Promise<string> {
  const res = await h.upload(a, bytes, name);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body).toMatchObject({ storageState: 'Verified', scanStatus: 'Clean', sha256: sha(bytes) });
  return res.body.id as string;
}

async function download(a: Actor, fileId: string): Promise<Buffer> {
  const res = await h.download(a, fileId);
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

const generate = (a: Actor, body: object, key: string = randomUUID()) => h.create(a, '/documents/generate', body, key);

async function invoiceOwner() {
  const c = await rentalChain(h, admin, { phase: ['WON'] });
  const invoice = await newInvoice(h, admin, c);
  return { c, invoice };
}

const snapshotOf = (invoice: { invoiceNo: string; customerSnapshot: Record<string, unknown> }) => ({
  invoiceNo: invoice.invoiceNo, customerName: invoice.customerSnapshot.name, total: '1050.00',
});

describe('T13 a stored generated document is not changed by later master data', () => {
  it('re-download returns the stored bytes after the customer and company change; a changed source creates version 2', async () => {
    const { c, invoice } = await invoiceOwner();
    const v1Bytes = pdfBytes('version-1');
    const v1File = await upload(admin, v1Bytes, 'invoice-v1.pdf');
    const snapshot = snapshotOf(invoice);
    const first = await generate(admin, {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 'invoice-v1', snapshotSchemaVersion: 's1', dataSnapshot: snapshot, fileId: v1File,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ documentType: 'INVOICE', documentNo: invoice.invoiceNo, ownerType: 'invoice', ownerId: invoice.id, status: 'Active' });
    expect(first.body.versions).toHaveLength(1);
    const v1 = first.body.versions[0];
    expect(v1).toMatchObject({ versionNo: 1, generationStatus: 'Generated', templateVersion: 'invoice-v1', dataSnapshot: snapshot });
    expect(v1.files[0]).toMatchObject({ fileId: v1File, fileRole: 'Generated PDF', active: true });
    expect(first.body.currentVersionId).toBe(v1.id);

    const stored = await download(admin, v1File);
    expect(stored.equals(v1Bytes)).toBe(true);

    // Master data changes afterwards.
    expect((await h.change(admin, 'patch', `/customers/${c.customer.id}`, 1, { name: 'Renamed Customer Ltd', address: 'Elsewhere' })).status).toBe(200);
    await h.sql(admin, "UPDATE organizations SET name = 'Renamed Lessor', address = 'New HQ' WHERE id = $1", [admin.orgId]);

    // Re-download from another user's session: identical bytes, hash and stored snapshot.
    const again = await download(colleague, v1File);
    expect(sha(again)).toBe(sha(v1Bytes));
    const detail = (await h.call(colleague, 'get', `/documents/${first.body.id}`)).body;
    expect(detail.versions[0].dataSnapshot).toEqual(snapshot);
    expect(detail.versions[0].snapshotHash).toBe(v1.snapshotHash);
    expect((await h.call(admin, 'get', `/invoices/${invoice.id}`)).body.customerSnapshot).toEqual(invoice.customerSnapshot);

    // The same inputs again return the stored version without creating a new one.
    const replay = await generate(admin, {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 'invoice-v1', snapshotSchemaVersion: 's1',
      dataSnapshot: { total: '1050.00', customerName: snapshot.customerName, invoiceNo: snapshot.invoiceNo }, // other key order, same data
      fileId: await upload(admin, pdfBytes('would-be-new')),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.versions).toHaveLength(1);
    expect(replay.body.currentVersionId).toBe(v1.id);

    // A changed source produces version 2; version 1 and its bytes stay intact and downloadable.
    const v2Bytes = pdfBytes('version-2');
    const v2File = await upload(admin, v2Bytes, 'invoice-v2.pdf');
    const second = await generate(admin, {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 'invoice-v1', snapshotSchemaVersion: 's1',
      dataSnapshot: { ...snapshot, customerName: 'Renamed Customer Ltd' }, fileId: v2File,
    });
    expect(second.status).toBe(201);
    expect(second.body.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    expect(second.body.currentVersionId).toBe(second.body.versions[0].id);
    expect((await download(admin, v1File)).equals(v1Bytes)).toBe(true);
    expect((await download(admin, v2File)).equals(v2Bytes)).toBe(true);
    const list = await h.call(admin, 'get', `/documents?ownerType=invoice&ownerId=${invoice.id}`);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].versions).toHaveLength(2);
    // A new template version over the same data is also a new version.
    const third = await generate(admin, {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 'invoice-v2', snapshotSchemaVersion: 's1',
      dataSnapshot: { ...snapshot, customerName: 'Renamed Customer Ltd' }, fileId: await upload(admin, pdfBytes('version-3')),
    });
    expect(third.body.versions).toHaveLength(3);
  });

  it('a failed render stays visible and retryable and the previous good version is not lost', async () => {
    const { invoice } = await invoiceOwner();
    const good = await upload(admin, pdfBytes('good'));
    const snapshot = snapshotOf(invoice);
    const base = { documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 'invoice-v1', snapshotSchemaVersion: 's1' };
    const ok = await generate(admin, { ...base, dataSnapshot: snapshot, fileId: good });
    expect(ok.status).toBe(201);

    const changed = { ...snapshot, total: '2000.00' };
    const failed = await generate(admin, { ...base, dataSnapshot: changed, error: { code: 'RENDER_FAILED', message: 'Font missing' } });
    expect(failed.status).toBe(201);
    expect(failed.body.versions[0]).toMatchObject({ versionNo: 2, generationStatus: 'Failed', errorCode: 'RENDER_FAILED', errorMessage: 'Font missing' });
    expect(failed.body.currentVersionId).toBe(ok.body.versions[0].id); // the good version is still current
    expect((await download(admin, good)).length).toBeGreaterThan(0);

    const retryFile = await upload(admin, pdfBytes('retry'));
    const retried = await generate(admin, { ...base, dataSnapshot: changed, fileId: retryFile });
    expect(retried.status).toBe(201);
    expect(retried.body.versions).toHaveLength(2); // the failed version was completed, not duplicated
    expect(retried.body.versions[0]).toMatchObject({ versionNo: 2, generationStatus: 'Generated', errorCode: null });
    expect(retried.body.currentVersionId).toBe(retried.body.versions[0].id);
    expect((await generate(admin, { ...base, dataSnapshot: changed })).status).toBe(200); // good, same data: unchanged
    expect((await generate(admin, { ...base, dataSnapshot: { x: 1 } })).status).toBe(422); // neither file nor error
  });

  it('rejects an unverified file, a wrong owner/type pairing and a missing key', async () => {
    const { invoice } = await invoiceOwner();
    const base = { documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { a: 1 } };
    const pending = await insertFile(h, admin, { storage: 'Verified', scan: 'Pending' });
    const bad = await generate(admin, { ...base, fileId: pending });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('FILE_INVALID');
    expect(await h.sql(admin, 'SELECT 1 FROM documents WHERE invoice_id = $1', [invoice.id])).toHaveLength(0); // no half-created document or version
    expect((await generate(admin, { ...base, documentType: 'CN', fileId: await upload(admin, pdfBytes()) })).status).toBe(404); // not a collection note
    expect((await h.call(admin, 'post', '/documents/generate').send(base)).status).toBe(422);
  });
});

describe('T14 signed copies: upload, replace, failure, wrong tenant', () => {
  async function generated() {
    const { invoice } = await invoiceOwner();
    const bytes = pdfBytes('gen');
    const fileId = await upload(admin, bytes);
    const doc = await generate(admin, {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: snapshotOf(invoice), fileId,
    });
    expect(doc.status).toBe(201);
    return { invoice, doc: doc.body, version: doc.body.versions[0], generatedFile: fileId };
  }
  const attach = (a: Actor, docId: string, versionId: string, body: object, key: string = randomUUID()) =>
    h.create(a, `/documents/${docId}/versions/${versionId}/files`, body, key);

  it('stores a signed copy, replaces it with a reason, and keeps the old signed bytes available', async () => {
    const { doc, version } = await generated();
    const firstBytes = pdfBytes('signed-1');
    const first = await upload(admin, firstBytes, 'signed-1.pdf');
    const attached = await attach(admin, doc.id, version.id, { fileId: first, fileRole: 'Signed Copy' });
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    const files = attached.body.versions[0].files;
    expect(files.filter((f: { active: boolean }) => f.active).map((f: { fileId: string; fileRole: string }) => [f.fileRole, f.fileId])).toEqual(
      expect.arrayContaining([['Signed Copy', first], ['Generated PDF', expect.any(String)]]),
    );

    // Replacement needs a reason and a different file; the first signed file becomes inactive but stays readable.
    const second = await upload(admin, pdfBytes('signed-2'), 'signed-2.pdf');
    expect((await attach(admin, doc.id, version.id, { fileId: second, fileRole: 'Signed Copy' })).body.fieldErrors.replacementReason).toBe('required');
    expect((await attach(admin, doc.id, version.id, { fileId: first, fileRole: 'Signed Copy', replacementReason: 'same' })).body.fieldErrors.fileId).toBe('already_attached');
    const replaced = await attach(admin, doc.id, version.id, { fileId: second, fileRole: 'Signed Copy', replacementReason: 'Customer re-signed' });
    expect(replaced.status).toBe(201);
    const signed = replaced.body.versions[0].files.filter((f: { fileRole: string }) => f.fileRole === 'Signed Copy');
    expect(signed).toHaveLength(2);
    expect(signed.find((f: { fileId: string }) => f.fileId === first)).toMatchObject({ active: false, replacementReason: 'Customer re-signed', replacedAt: expect.any(String) });
    expect(signed.find((f: { fileId: string }) => f.fileId === second)).toMatchObject({ active: true, replacementReason: null });
    expect((await download(colleague, first)).equals(firstBytes)).toBe(true); // old signed bytes remain accessible to authorized users
    expect((await h.audit(admin, 'document.file_replaced')).at(-1)?.reason).toBe('Customer re-signed');
    // Another session sees the same durable state.
    expect((await h.call(colleague, 'get', `/documents/${doc.id}`)).body.versions[0].files).toHaveLength(3);
  });

  it('a failed upload or attach leaves the previous signed evidence untouched', async () => {
    const { doc, version } = await generated();
    const good = await upload(admin, pdfBytes('signed-good'));
    expect((await attach(admin, doc.id, version.id, { fileId: good, fileRole: 'Signed Copy' })).status).toBe(201);
    const activeSigned = async () =>
      (await h.sql<{ file_id: string }>(admin, "SELECT file_id FROM document_files WHERE document_version_id = $1 AND file_role = 'Signed Copy' AND active", [version.id])).map((r) => r.file_id);
    expect(await activeSigned()).toEqual([good]);

    // Upload failures at the files API: wrong signature, empty, too large, unsupported type.
    expect((await h.upload(admin, Buffer.from('not a pdf at all'), 'x.pdf')).status).toBe(422);
    expect((await h.upload(admin, pdfBytes(), 'x.pdf', 'text/plain')).status).toBe(422);
    expect((await h.upload(admin, Buffer.concat([pdfBytes(), Buffer.alloc(5000)]), 'big.pdf')).status).toBe(422);
    // Attach failures: unverified, infected, failed and unknown files.
    for (const state of [{ storage: 'Verified', scan: 'Pending' }, { storage: 'Verified', scan: 'Rejected' }, { storage: 'Failed', scan: 'Failed' }, { storage: 'Pending', scan: 'Pending' }]) {
      const file = await insertFile(h, admin, state);
      const res = await attach(admin, doc.id, version.id, { fileId: file, fileRole: 'Signed Copy', replacementReason: 'try' });
      expect(res.status, JSON.stringify(state)).toBe(422);
      expect(res.body.code).toBe('FILE_INVALID');
    }
    expect((await attach(admin, doc.id, version.id, { fileId: randomUUID(), fileRole: 'Signed Copy', replacementReason: 'try' })).status).toBe(404);
    expect((await attach(admin, doc.id, randomUUID(), { fileId: good, fileRole: 'Original' })).status).toBe(404);
    expect(await activeSigned()).toEqual([good]);
    expect((await download(admin, good)).length).toBeGreaterThan(0);
  });

  it('denies another company: document, versions, attach, files and downloads are 404 and nothing changes', async () => {
    const { doc, version, generatedFile } = await generated();
    const signed = await upload(admin, pdfBytes('signed-private'));
    expect((await attach(admin, doc.id, version.id, { fileId: signed, fileRole: 'Signed Copy' })).status).toBe(201);

    for (const path of [`/documents/${doc.id}`, `/documents?ownerType=invoice&ownerId=${doc.ownerId}`]) {
      expect((await h.call(other, 'get', path)).status, path).toBe(404);
    }
    for (const id of [signed, generatedFile]) {
      expect((await h.call(other, 'get', `/files/${id}`)).status).toBe(404);
      expect((await h.download(other, id)).status).toBe(404);
    }
    const intruder = await upload(other, pdfBytes('theirs'));
    expect((await attach(other, doc.id, version.id, { fileId: intruder, fileRole: 'Signed Copy', replacementReason: 'x' })).status).toBe(404);
    // Our company cannot attach their file either.
    expect((await attach(admin, doc.id, version.id, { fileId: intruder, fileRole: 'Signed Copy', replacementReason: 'x' })).status).toBe(404);
    const generateForeign = await generate(other, { documentType: 'INVOICE', ownerId: doc.ownerId, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: {}, fileId: intruder });
    expect(generateForeign.status).toBe(404);
    expect((await h.call(admin, 'get', `/documents/${doc.id}`)).body.versions[0].files.filter((f: { active: boolean }) => f.active)).toHaveLength(2);
  });

  it('a file attached to nothing is readable only by its uploader; users without files.read cannot download', async () => {
    const loose = await upload(admin, pdfBytes('loose'));
    expect((await h.download(admin, loose)).status).toBe(200);
    expect((await h.download(colleague, loose)).status).toBe(404);
    const driver = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
    const { generatedFile } = await generated();
    expect((await h.download(driver, generatedFile)).status).toBe(403);
    expect((await h.download(colleague, generatedFile)).status).toBe(200);
  });
});
