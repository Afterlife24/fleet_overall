// T18 for the rental resources: bookings, invoices, transport (jobs, drivers, vehicles), collection notes, documents and file
// downloads, gate passes and inspections. Company, branch and role attacks must neither read, write nor download.
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import {
  bookingBody, completePass, gateIn, gateOut, gatePassBody, initiateCollection, jobBody, newInvoice, newMachine, newPass, pdfBytes, pngBytes,
  rentalChain, startHire, type Chain,
} from './rentalFixtures.js';

let h: Harness;
let admin: Actor; // managing-director, all branches (main branch)
let other: Actor; // another company
let branchUser: Actor; // managing-director of the same company, restricted to branch 2
let branch2: string;

// Main-branch resources (owned by `admin`).
let A: Chain; // On Hire, invoiced, collection requested, job, driver, vehicle
let B: Chain; // Allocated, Pending gate pass
let C: Chain; // returned, intake inspection Pending, photo evidence
let invoice: { id: string; rowVersion: number };
let cn: { id: string; rowVersion: number };
let job: { id: string; rowVersion: number };
let driver: { id: string; rowVersion: number };
let vehicle: { id: string; rowVersion: number };
let doc: { id: string; versions: { id: string }[]; ownerId: string };
let docFile: string;
let photoFile: string;
let passB: { id: string; rowVersion: number };
let inspection: { id: string; rowVersion: number };
// Branch 2 resources (owned by `branchUser`).
let D: Chain;
let invoiceD: { id: string };

beforeAll(async () => {
  h = await createHarness({ files: true });
  admin = await h.actor('iso-admin', 'managing-director');
  other = await h.actor('iso-other', 'managing-director');
  branch2 = await h.addBranch(admin, 'B2');
  branchUser = await h.addUser(admin, { roleCode: 'managing-director', branchId: branch2, allBranches: false, sameRoleAs: admin });

  // Quotations carry an explicit branch: a quotation without one is company-wide by design.
  const main = { branchId: admin.branchId };
  A = await rentalChain(h, admin, { phase: ['WON'], quotation: main });
  expect((await gateOut(h, admin, A)).status).toBe(200);
  invoice = await newInvoice(h, admin, A);
  const collection = await initiateCollection(h, admin, A.booking.id);
  expect(collection.status).toBe(201);
  cn = collection.body.collectionNote;
  job = (await h.create(admin, '/transport-jobs', jobBody(A.machine.id, { bookingId: A.booking.id }))).body;
  driver = (await h.create(admin, '/drivers', { branchId: admin.branchId, name: 'Main Driver', phone: '1', licenseNo: 'L1', licenseExpiresOn: '2031-01-01' })).body;
  vehicle = (await h.create(admin, '/transport-vehicles', { branchId: admin.branchId, registrationNo: `MAIN-${randomUUID().slice(0, 6)}`, vehicleType: 'Lowboy', capacityKg: '9000' })).body;
  const pdf = await h.upload(admin, pdfBytes(), 'inv.pdf');
  docFile = pdf.body.id;
  const generated = await h.create(admin, '/documents/generate', {
    documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { n: 1 }, fileId: docFile,
  });
  expect(generated.status, JSON.stringify(generated.body)).toBe(201);
  doc = generated.body;

  B = await rentalChain(h, admin, { quotation: main });
  const pending = await newPass(h, admin, gatePassBody(B.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: B.booking.id }));
  expect(pending.status).toBe(201);
  passB = pending.body;

  C = await rentalChain(h, admin, { quotation: main });
  expect((await gateOut(h, admin, C)).status).toBe(200);
  const back = await gateIn(h, admin, C);
  expect(back.complete.status).toBe(200);
  inspection = back.complete.body.inspection;
  const photo = await h.upload(admin, pngBytes(), 'p.png', 'image/png');
  photoFile = photo.body.id;
  expect((await h.create(admin, '/evidence', { fileId: photoFile, inspectionId: inspection.id, photoRole: 'Damage' })).status).toBe(201);

  D = await rentalChain(h, branchUser, { phase: ['WON'], quotation: { branchId: branch2 } });
  invoiceD = await newInvoice(h, branchUser, D);
});
afterAll(async () => {
  await h.close();
});

type Attack = [label: string, run: (a: Actor) => request.Test];
const keyed = (a: Actor, path: string, body: object = {}, headers: Record<string, string> = {}) => {
  let r = h.call(a, 'post', path).set('Idempotency-Key', randomUUID());
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};

/** Every read and write against the main-branch resources. Another company or another branch must see 404 for all of them. */
const attacks: Attack[] = [
  ['GET booking', (a) => h.call(a, 'get', `/bookings/${A.booking.id}`)],
  ['PATCH booking', (a) => h.change(a, 'patch', `/bookings/${B.booking.id}`, B.booking.rowVersion, { notes: 'hacked' })],
  ['cancel booking', (a) => h.change(a, 'post', `/bookings/${B.booking.id}/cancel`, B.booking.rowVersion, { reason: 'x' })],
  ['off-hire request', (a) => h.change(a, 'post', `/bookings/${A.booking.id}/off-hire-request`, 1, {})],
  ['start hire', (a) => keyed(a, `/bookings/${B.booking.id}/start-hire`, {}, { 'If-Match': String(B.booking.rowVersion) })],
  ['GET invoice', (a) => h.call(a, 'get', `/invoices/${invoice.id}`)],
  ['PATCH invoice', (a) => h.change(a, 'patch', `/invoices/${invoice.id}`, invoice.rowVersion, { notes: 'hacked' })],
  ['issue invoice', (a) => h.change(a, 'post', `/invoices/${invoice.id}/issue`, invoice.rowVersion, {})],
  ['cancel invoice', (a) => h.change(a, 'post', `/invoices/${invoice.id}/cancel`, invoice.rowVersion, { reason: 'x' })],
  ['report payment', (a) => h.change(a, 'post', `/invoices/${invoice.id}/payment-status`, invoice.rowVersion, { status: 'Paid', amountDue: '0', reason: 'x' })],
  ['invoice prefill', (a) => h.call(a, 'get', `/quotations/${A.quotation.id}/invoice-prefill?type=Continuous%20Hire`)],
  ['create invoice', (a) => h.create(a, '/invoices', {
    quotationId: A.quotation.id, hireAgreementId: A.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-04-01', periodEnd: '2030-04-30',
    equipment: { quantity: '1', unitRate: '1', amount: '1' }, periodChargeConfirmed: true,
  })],
  ['GET job', (a) => h.call(a, 'get', `/transport-jobs/${job.id}`)],
  ['PATCH job', (a) => h.change(a, 'patch', `/transport-jobs/${job.id}`, job.rowVersion, { remarks: 'hacked' })],
  ['job status', (a) => h.change(a, 'post', `/transport-jobs/${job.id}/status`, job.rowVersion, { status: 'Cancelled' })],
  ['GET driver', (a) => h.call(a, 'get', `/drivers/${driver.id}`)],
  ['PATCH driver', (a) => h.change(a, 'patch', `/drivers/${driver.id}`, driver.rowVersion, { name: 'hacked' })],
  ['GET vehicle', (a) => h.call(a, 'get', `/transport-vehicles/${vehicle.id}`)],
  ['PATCH vehicle', (a) => h.change(a, 'patch', `/transport-vehicles/${vehicle.id}`, vehicle.rowVersion, { status: 'Offline' })],
  ['initiate collection', (a) => keyed(a, `/bookings/${A.booking.id}/collection`)],
  ['GET collection note', (a) => h.call(a, 'get', `/collection-notes/${cn.id}`)],
  ['PATCH collection note', (a) => h.change(a, 'patch', `/collection-notes/${cn.id}`, cn.rowVersion, { remarks: 'hacked' })],
  ['note picked up', (a) => h.change(a, 'post', `/collection-notes/${cn.id}/picked-up`, cn.rowVersion, {})],
  ['cancel note', (a) => h.change(a, 'post', `/collection-notes/${cn.id}/cancel`, cn.rowVersion, { reason: 'x' })],
  ['GET document', (a) => h.call(a, 'get', `/documents/${doc.id}`)],
  ['list documents', (a) => h.call(a, 'get', `/documents?ownerType=invoice&ownerId=${invoice.id}`)],
  ['generate document', (a) => keyed(a, '/documents/generate', {
    documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { n: 2 }, error: { code: 'X', message: 'y' },
  })],
  ['attach signed copy', (a) => keyed(a, `/documents/${doc.id}/versions/${doc.versions[0].id}/files`, { fileId: docFile, fileRole: 'Signed Copy' })],
  ['file metadata', (a) => h.call(a, 'get', `/files/${docFile}`)],
  ['file download', (a) => h.download(a, docFile)],
  ['evidence file download', (a) => h.download(a, photoFile)],
  ['GET gate pass', (a) => h.call(a, 'get', `/gate-passes/${passB.id}`)],
  ['approve pass', (a) => h.change(a, 'post', `/gate-passes/${passB.id}/approve`, passB.rowVersion, {})],
  ['cancel pass', (a) => h.change(a, 'post', `/gate-passes/${passB.id}/cancel`, passB.rowVersion, { reason: 'x' })],
  ['complete pass', (a) => completePass(h, a, passB.id)],
  ['GET inspection', (a) => h.call(a, 'get', `/inspections/${inspection.id}`)],
  ['PATCH inspection', (a) => h.change(a, 'patch', `/inspections/${inspection.id}`, inspection.rowVersion, { notes: 'hacked' })],
  ['inspection results', (a) => h.change(a, 'patch', `/inspections/${inspection.id}/results`, inspection.rowVersion, { results: [{ itemKey: 's1_1', result: 'Pass' }] })],
  ['submit inspection', (a) => h.change(a, 'post', `/inspections/${inspection.id}/submit`, inspection.rowVersion, {})],
  ['release hold', (a) => h.change(a, 'post', `/inspections/${inspection.id}/release-hold`, inspection.rowVersion, { reason: 'x', evidenceReviewed: true })],
  ['list evidence', (a) => h.call(a, 'get', `/evidence?ownerType=inspection&ownerId=${inspection.id}`)],
  ['add evidence', (a) => keyed(a, '/evidence', { fileId: photoFile, inspectionId: inspection.id, photoRole: 'x' })],
];

/** Everything the attackers must not be able to change. */
async function assertUntouched() {
  const get = async (path: string) => (await h.call(admin, 'get', path)).body;
  expect(await get(`/bookings/${B.booking.id}`)).toMatchObject({ status: 'Allocated', rowVersion: B.booking.rowVersion, notes: null });
  expect(await get(`/bookings/${A.booking.id}`)).toMatchObject({ status: 'On Hire' });
  expect(await get(`/invoices/${invoice.id}`)).toMatchObject({ status: 'Draft', rowVersion: invoice.rowVersion, notes: null });
  expect(await get(`/transport-jobs/${job.id}`)).toMatchObject({ status: 'Scheduled', rowVersion: job.rowVersion });
  expect(await get(`/drivers/${driver.id}`)).toMatchObject({ name: 'Main Driver' });
  expect(await get(`/transport-vehicles/${vehicle.id}`)).toMatchObject({ status: 'Available' });
  expect((await get(`/collection-notes/${cn.id}`)).collectionNote).toMatchObject({ status: 'Draft', remarks: null });
  expect(await get(`/gate-passes/${passB.id}`)).toMatchObject({ status: 'Pending', rowVersion: passB.rowVersion });
  expect(await get(`/inspections/${inspection.id}`)).toMatchObject({ status: 'Pending', holdReleasedAt: null, notes: null });
  expect((await get(`/documents/${doc.id}`)).versions[0].files).toHaveLength(1);
  expect(await h.sql(admin, 'SELECT 1 FROM invoices WHERE quotation_id = $1', [A.quotation.id])).toHaveLength(1);
}

describe('T18 company isolation for the rental resources', () => {
  it('another company gets 404 for every read and write and nothing changes', async () => {
    for (const [label, run] of attacks) {
      const res = await run(other);
      expect(res.status, label).toBe(404);
    }
    await assertUntouched();
  });

  it('lists never include another company, whatever the filter', async () => {
    for (const path of ['/bookings', '/invoices', '/transport-jobs', '/drivers', '/transport-vehicles', '/collection-notes', '/gate-passes', '/inspections']) {
      const res = await h.call(other, 'get', path);
      expect(res.status, path).toBe(200);
      expect(res.body.total, path).toBe(0);
    }
    for (const path of [
      `/bookings?machineId=${A.machine.id}`, `/invoices?quotationId=${A.quotation.id}`, `/transport-jobs?bookingId=${A.booking.id}`,
      `/collection-notes?bookingId=${A.booking.id}`, `/gate-passes?machineId=${A.machine.id}`, `/inspections?machineId=${C.machine.id}`,
    ]) {
      const res = await h.call(other, 'get', path);
      expect(res.status, path).toBe(200);
      expect(res.body.items, path).toEqual([]);
    }
    expect((await h.call(admin, 'get', '/bookings')).body.total).toBeGreaterThanOrEqual(4);
  });

  it('cannot build records out of another company\'s machine, customer, booking, quotation, QR or files', async () => {
    const mine = await newMachine(h, other);
    const myChain = await rentalChain(h, other);
    expect((await h.create(other, '/bookings', bookingBody(A.machine.id, myChain.customer.id))).status).toBe(422);
    expect((await h.create(other, '/bookings', bookingBody(mine.id, A.customer.id))).status).toBe(422);
    expect((await h.create(other, '/transport-jobs', jobBody(A.machine.id))).status).toBe(422);
    expect((await h.create(other, '/transport-jobs', jobBody(mine.id, { bookingId: A.booking.id }))).status).toBe(422);
    expect((await newPass(h, other, gatePassBody(A.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: A.booking.id }))).status).toBe(422);
    expect((await newPass(h, other, gatePassBody(mine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: A.booking.id }))).status).toBe(422);
    const qr = await h.call(other, 'post', '/gate/resolve-qr').send({ payload: `AXLEOPS-FLEET:${admin.orgId}:${A.machine.id}:${A.machine.fleetNo}` });
    expect(qr.status).toBe(422);
    expect(qr.body.code).toBe('QR_INVALID');
    const qr2 = await h.call(other, 'post', '/gate/resolve-qr').send({ payload: `AXLEOPS-FLEET:${other.orgId}:${A.machine.id}:${A.machine.fleetNo}` });
    expect(qr2.body.code).toBe('QR_INVALID');
    const theirPhoto = await h.upload(other, pngBytes(), 'x.png', 'image/png');
    expect((await h.create(other, '/evidence', { fileId: theirPhoto.body.id, inspectionId: inspection.id, photoRole: 'x' })).status).toBe(404);
    expect((await h.create(admin, '/evidence', { fileId: theirPhoto.body.id, inspectionId: inspection.id, photoRole: 'x' })).status).toBe(404);
    expect(await h.sql(admin, 'SELECT 1 FROM bookings WHERE machine_id = $1', [A.machine.id])).toHaveLength(1);
  });
});

describe('T18 branch isolation for the rental resources', () => {
  it('a branch-limited user gets 404 for every read and write on other-branch records', async () => {
    for (const [label, run] of attacks) {
      if (label === 'initiate collection') continue; // covered below with an explicit assertion
      const res = await run(branchUser);
      expect(res.status, label).toBe(404);
    }
    expect((await keyed(branchUser, `/bookings/${A.booking.id}/collection`)).status).toBe(404);
    await assertUntouched();
  });

  it('lists contain only the user\'s own branch while an all-branch user sees both', async () => {
    const ids = async (a: Actor, path: string) => (await h.call(a, 'get', path)).body.items.map((i: { id: string }) => i.id) as string[];
    expect(await ids(branchUser, '/bookings')).toEqual([D.booking.id]);
    expect(await ids(branchUser, '/invoices')).toEqual([invoiceD.id]);
    for (const path of ['/transport-jobs', '/collection-notes', '/gate-passes', '/inspections', '/drivers', '/transport-vehicles']) {
      expect(await ids(branchUser, path), path).toEqual([]);
    }
    expect(await ids(branchUser, `/bookings?branchId=${admin.branchId}`)).toEqual([]);
    const all = await ids(admin, '/bookings');
    expect(all).toEqual(expect.arrayContaining([A.booking.id, B.booking.id, C.booking.id, D.booking.id]));
    expect(await ids(admin, '/invoices')).toEqual(expect.arrayContaining([invoice.id, invoiceD.id]));
  });

  it('the user still works normally inside their own branch, and cannot reach other branches\' machines', async () => {
    expect((await h.call(branchUser, 'get', `/bookings/${D.booking.id}`)).status).toBe(200);
    expect((await h.call(branchUser, 'get', `/invoices/${invoiceD.id}`)).status).toBe(200);
    expect((await startHire(h, branchUser, D.booking.id, D.booking.rowVersion)).status).toBe(200);
    expect((await h.call(branchUser, 'get', `/machines/${A.machine.id}`)).status).toBe(404);
    // Cannot create records on a machine of another branch.
    expect((await h.create(branchUser, '/bookings', bookingBody(A.machine.id, D.customer.id, { status: 'Reserved', startDate: '2040-01-01', endDate: '2040-01-02' }))).status).toBe(422);
    expect((await h.create(branchUser, '/transport-jobs', jobBody(A.machine.id))).status).toBe(403);
    expect((await newPass(h, branchUser, gatePassBody(A.machine.id, { direction: 'OUT', movementPurpose: 'TRANSFER' }))).status).toBe(422);
    expect((await h.create(branchUser, '/drivers', { branchId: admin.branchId, name: 'X', phone: '1', licenseNo: 'L', licenseExpiresOn: '2031-01-01' })).status).toBe(403);
    expect((await h.create(branchUser, '/transport-vehicles', { branchId: admin.branchId, registrationNo: `NOPE-${randomUUID().slice(0, 5)}`, vehicleType: 'Flatbed', capacityKg: '1' })).status).toBe(403);
    expect(await h.sql(admin, 'SELECT 1 FROM gate_passes WHERE machine_id = $1', [A.machine.id])).toHaveLength(1); // only A's own OUT pass
  });
});

describe('T18 role isolation for the rental resources', () => {
  it('roles without the permission are refused (403) and read-only roles cannot write', async () => {
    const as = (roleCode: string) => h.addUser(admin, { roleCode, branchId: admin.branchId, allBranches: true });
    const driver_ = await as('driver');
    const security = await as('security');
    const checker = await as('phi-pdi-checker');
    const finance = await as('finance');
    const custom = await as('custom-nobody');

    for (const a of [driver_, custom]) {
      for (const path of [`/bookings/${A.booking.id}`, `/invoices/${invoice.id}`, `/collection-notes/${cn.id}`, `/gate-passes/${passB.id}`, `/inspections/${inspection.id}`, `/documents/${doc.id}`]) {
        expect((await h.call(a, 'get', path)).status, `${a.userId} ${path}`).toBe(403);
      }
    }
    // Driver: may read transport but not change it.
    expect((await h.call(driver_, 'get', `/transport-jobs/${job.id}`)).status).toBe(200);
    expect((await h.change(driver_, 'patch', `/transport-jobs/${job.id}`, job.rowVersion, { remarks: 'x' })).status).toBe(403);
    expect((await h.change(driver_, 'post', `/transport-jobs/${job.id}/status`, job.rowVersion, { status: 'Loading' })).status).toBe(403);
    // Security: gate only. No invoices, inspections or approvals.
    expect((await h.call(security, 'get', `/invoices/${invoice.id}`)).status).toBe(403);
    expect((await h.call(security, 'get', `/inspections/${inspection.id}`)).status).toBe(403);
    expect((await h.change(security, 'post', `/gate-passes/${passB.id}/approve`, passB.rowVersion, {})).status).toBe(403);
    // Checker: inspections only; cannot release the hold or touch the gate.
    expect((await h.call(checker, 'get', `/gate-passes/${passB.id}`)).status).toBe(403);
    expect((await h.change(checker, 'post', `/inspections/${inspection.id}/release-hold`, inspection.rowVersion, { reason: 'x', evidenceReviewed: true })).status).toBe(403);
    expect((await h.call(checker, 'get', `/invoices/${invoice.id}`)).status).toBe(403);
    // Finance: invoices and documents, no planner or gate writes.
    expect((await h.call(finance, 'get', `/invoices/${invoice.id}`)).status).toBe(200);
    expect((await h.change(finance, 'patch', `/bookings/${B.booking.id}`, B.booking.rowVersion, { notes: 'x' })).status).toBe(403);
    expect((await newPass(h, finance, gatePassBody(B.machine.id, { direction: 'OUT', movementPurpose: 'TRANSFER' }))).status).toBe(403);
    expect((await h.change(finance, 'post', `/bookings/${B.booking.id}/cancel`, B.booking.rowVersion, { reason: 'x' })).status).toBe(403);
    await assertUntouched();
  });
});
