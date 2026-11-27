// Task 14.8: hire agreements and customer LPOs against fleet_test, including tenant isolation (T18).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { insertFile, newCustomer, newQuotation, type Quotation } from './crmFixtures.js';

let h: Harness;
let admin: Actor; // managing-director
let other: Actor; // another company
let reader: Actor; // finance: read only
let plain: Actor; // driver: nothing

const agreementBody = (q: Pick<Quotation, 'id' | 'customerId'>, extra: object = {}) => ({
  quotationId: q.id,
  customerId: q.customerId,
  equipmentName: 'Boom lift',
  equipmentModel: 'JLG 600S',
  serialNumber: 'SN-1',
  deliveryLocation: 'Jebel Ali',
  hireStartDate: '2026-03-01',
  hireEndDate: '2026-04-01',
  monthlyRental: '1000.005',
  paymentTerms: '30 days from invoice',
  paymentMethod: 'Cheque',
  ...extra,
});

async function setup(a: Actor, quotationExtra: object = {}) {
  const customer = await newCustomer(h, a);
  const quotation = await newQuotation(h, a, customer.id, quotationExtra);
  return { customer, quotation };
}

async function newAgreement(a: Actor, q: Quotation, extra: object = {}) {
  const res = await h.create(a, '/hire-agreements', agreementBody(q, extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; agreementNo: string; rowVersion: number; customerSnapshot: Record<string, unknown> };
}

const lpoBody = (q: Pick<Quotation, 'id' | 'customerId'>, extra: object = {}) => ({
  quotationId: q.id, customerId: q.customerId, lpoNo: `LPO/${randomUUID().slice(0, 8)}`, receivedOn: '2026-03-02', ...extra,
});

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('ha-admin', 'managing-director');
  other = await h.actor('ha-other', 'managing-director');
  reader = await h.addUser(admin, { roleCode: 'finance', branchId: admin.branchId, allBranches: true });
  plain = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
});

afterAll(async () => {
  await h.close();
});

describe('hire agreement creation', () => {
  it('requires an Idempotency-Key, numbers the agreement, computes totals on the server and ignores client totals', async () => {
    const { quotation } = await setup(admin, { crmHaReference: 'HA-2026-00042' });
    expect((await h.call(admin, 'post', '/hire-agreements').send(agreementBody(quotation))).status).toBe(422);
    const key = randomUUID();
    const body = agreementBody(quotation, { subtotal: '1', vatAmount: '1', totalAmount: '1', transportationCharges: '0' });
    const res = await h.create(admin, '/hire-agreements', body, key);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'Draft', quantity: 1, paymentTermDays: 30, rowVersion: 1, sentAt: null, receivedAt: null,
      subtotal: '1000.010000', vatAmount: '50.000000', totalAmount: '1050.010000',
    });
    expect(res.body.agreementNo).toMatch(/^HA-\d{4}\d{4,}$/);
    // The CRM display reference is separate from the agreement id and number.
    expect(res.body.crmHaReference).toBe('HA-2026-00042');
    expect(res.body.crmHaReference).not.toBe(res.body.agreementNo);
    expect(res.body.id).not.toBe(res.body.agreementNo);

    const replay = await h.create(admin, '/hire-agreements', body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(res.body.id);
    expect(await h.sql(admin, 'SELECT 1 FROM hire_agreements WHERE quotation_id = $1', [quotation.id])).toHaveLength(1);
  });

  it('answers AGREEMENT_EXISTS (409) for a second live agreement and 422 for a customer mismatch', async () => {
    const { quotation } = await setup(admin);
    await newAgreement(admin, quotation);
    const dup = await h.create(admin, '/hire-agreements', agreementBody(quotation));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('AGREEMENT_EXISTS');

    const q2 = (await setup(admin)).quotation;
    const stranger = await newCustomer(h, admin);
    const mismatch = await h.create(admin, '/hire-agreements', agreementBody(q2, { customerId: stranger.id }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.fieldErrors.customerId).toBe('quotation_mismatch');
    expect(await h.sql(admin, 'SELECT 1 FROM hire_agreements WHERE quotation_id = $1', [q2.id])).toHaveLength(0);
  });

  it('validates date order, status, quantity and payment term bounds', async () => {
    const { quotation } = await setup(admin);
    const bad = await h.create(admin, '/hire-agreements', agreementBody(quotation, { hireEndDate: '2026-02-28' }));
    expect(bad.status).toBe(422);
    expect(bad.body.fieldErrors.hireEndDate).toBeDefined();
    for (const extra of [
      { status: 'Done' }, { quantity: 0 }, { quantity: 1.5 }, { quantity: -2 }, { paymentTermDays: 366 }, { paymentTermDays: -1 },
      { paymentTermDays: 1.5 }, { monthlyRental: '-1' }, { hireStartDate: '2026-13-01' }, { unknown: 1 },
    ]) {
      expect((await h.create(admin, '/hire-agreements', agreementBody(quotation, extra))).status, JSON.stringify(extra)).toBe(422);
    }
    const edge = await h.create(admin, '/hire-agreements', agreementBody(quotation, { paymentTermDays: 0, quantity: 1, hireEndDate: '2026-03-01' }));
    expect(edge.status).toBe(201);
    expect(edge.body.paymentTermDays).toBe(0);
    const max = await h.change(admin, 'patch', `/hire-agreements/${edge.body.id}`, 1, { paymentTermDays: 365, quantity: 3, status: 'Active' });
    expect(max.status).toBe(200);
    expect(max.body).toMatchObject({ paymentTermDays: 365, quantity: 3, status: 'Active' });
  });

  it('keeps issuer and customer snapshots unchanged after the masters change', async () => {
    const customer = await newCustomer(h, admin, 'Snapshot Co', { taxRegistrationNo: 'TRN-1', attn: 'Ms Contact', email: 'snap@example.com' });
    const quotation = await newQuotation(h, admin, customer.id);
    const agreement = await newAgreement(admin, quotation);
    expect(agreement.customerSnapshot).toMatchObject({
      name: 'Snapshot Co', taxRegistrationNo: 'TRN-1', attention: 'Ms Contact', email: 'snap@example.com', contact: '+971 4 000 0000', address: 'Dubai',
    });
    const before = (await h.call(admin, 'get', `/hire-agreements/${agreement.id}`)).body;
    expect(before.issuerSnapshot).toMatchObject({ name: expect.stringContaining('Org ha-admin'), address: 'Test address' });

    expect((await h.change(admin, 'patch', `/customers/${customer.id}`, 1, { name: 'Renamed Co', address: 'Abu Dhabi' })).status).toBe(200);
    await h.sql(admin, "UPDATE organizations SET name = 'Renamed Lessor', address = 'New HQ' WHERE id = $1", [admin.orgId]);
    const after = (await h.call(admin, 'get', `/hire-agreements/${agreement.id}`)).body;
    expect(after.customerSnapshot).toEqual(before.customerSnapshot);
    expect(after.issuerSnapshot).toEqual(before.issuerSnapshot);
    // A client-sent snapshot is ignored.
    const upd = await h.change(admin, 'patch', `/hire-agreements/${agreement.id}`, 1, { customerSnapshot: { name: 'Forged' }, capacity: '5t' });
    expect(upd.status).toBe(200);
    expect(upd.body.customerSnapshot).toEqual(before.customerSnapshot);
  });
});

describe('updates, cancellation and sent / received', () => {
  it('requires If-Match, recomputes totals on rental change and ignores client totals', async () => {
    const { quotation } = await setup(admin);
    const a = await newAgreement(admin, quotation);
    expect((await h.call(admin, 'patch', `/hire-agreements/${a.id}`).send({ capacity: 'x' })).status).toBe(428);
    const upd = await h.change(admin, 'patch', `/hire-agreements/${a.id}`, 1, {
      monthlyRental: '2000', transportationCharges: '100.50', totalAmount: '5', vatAmount: '5',
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ subtotal: '2100.500000', vatAmount: '105.030000', totalAmount: '2205.530000', rowVersion: 2 });
    const stale = await h.change(admin, 'patch', `/hire-agreements/${a.id}`, 1, { capacity: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    expect((await h.change(admin, 'patch', `/hire-agreements/${a.id}`, 2, { hireEndDate: '2026-01-01' })).status).toBe(422);
    expect((await h.change(admin, 'patch', `/hire-agreements/${a.id}`, 2, { status: 'Nope' })).status).toBe(422);
  });

  it('keeps the row and number when cancelled and then allows a new agreement for the quotation', async () => {
    const { quotation } = await setup(admin);
    const first = await newAgreement(admin, quotation);
    const cancelled = await h.change(admin, 'patch', `/hire-agreements/${first.id}`, 1, { status: 'Cancelled' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('Cancelled');
    expect(cancelled.body.agreementNo).toBe(first.agreementNo);
    expect((await h.audit(admin, 'hire_agreement.cancelled')).length).toBeGreaterThanOrEqual(1);

    const second = await newAgreement(admin, quotation);
    expect(second.agreementNo).not.toBe(first.agreementNo);
    expect(await h.sql(admin, 'SELECT 1 FROM hire_agreements WHERE quotation_id = $1', [quotation.id])).toHaveLength(2);
    // Re-activating the cancelled one would make two live agreements for the quotation.
    const revive = await h.change(admin, 'patch', `/hire-agreements/${first.id}`, 2, { status: 'Active' });
    expect(revive.status).toBe(409);
    expect(revive.body.code).toBe('AGREEMENT_EXISTS');
    const list = await h.call(admin, 'get', `/hire-agreements?quotationId=${quotation.id}`);
    expect(list.body.total).toBe(2);
    expect((await h.call(admin, 'get', `/hire-agreements?quotationId=${quotation.id}&status=Cancelled`)).body.total).toBe(1);
  });

  it('records sent_at and received_at with the actor in the audit trail; received needs a confirmation reason', async () => {
    const { quotation } = await setup(admin);
    const a = await newAgreement(admin, quotation);
    expect((await h.call(admin, 'post', `/hire-agreements/${a.id}/sent`).send({})).status).toBe(428);
    const sent = await h.change(admin, 'post', `/hire-agreements/${a.id}/sent`, 1, {});
    expect(sent.status).toBe(200);
    expect(sent.body.sentAt).toEqual(expect.any(String));
    expect(sent.body.receivedAt).toBeNull();
    const sentEvents = await h.audit(admin, 'hire_agreement.sent');
    expect(sentEvents.at(-1)).toMatchObject({ actor_user_id: admin.userId });

    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }]) {
      const res = await h.change(admin, 'post', `/hire-agreements/${a.id}/received`, 2, body);
      expect(res.status).toBe(422);
    }
    expect((await h.call(admin, 'get', `/hire-agreements/${a.id}`)).body.receivedAt).toBeNull();
    const received = await h.change(admin, 'post', `/hire-agreements/${a.id}/received`, 2, { reason: 'Signed copy confirmed by phone' });
    expect(received.status).toBe(200);
    expect(received.body.receivedAt).toEqual(expect.any(String));
    const events = await h.audit(admin, 'hire_agreement.received');
    expect(events.at(-1)).toMatchObject({ actor_user_id: admin.userId, reason: 'Signed copy confirmed by phone' });

    const again = await h.change(admin, 'post', `/hire-agreements/${a.id}/sent`, 3, {});
    expect(again.status).toBe(422);
    expect(again.body.fieldErrors.sentAt).toBe('already_set');
  });
});

describe('customer LPOs', () => {
  it('stores the customer LPO number as given, allocates no internal number and allows several per agreement', async () => {
    const { quotation } = await setup(admin);
    const agreement = await newAgreement(admin, quotation);
    expect((await h.call(admin, 'post', '/customer-lpos').send(lpoBody(quotation))).status).toBe(422);
    const first = await h.create(admin, '/customer-lpos', lpoBody(quotation, { lpoNo: ' LPO / 2026-001 ', hireAgreementId: agreement.id, amount: '500.5' }));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      lpoNo: ' LPO / 2026-001 ', hireAgreementId: agreement.id, amount: '500.500000', currencyCode: 'AED', fileId: null, rowVersion: 1,
    });
    const second = await h.create(admin, '/customer-lpos', lpoBody(quotation, { hireAgreementId: agreement.id }));
    expect(second.status).toBe(201);
    const kinds = await h.sql<{ sequence_kind: string }>(admin, 'SELECT DISTINCT sequence_kind FROM number_sequences');
    expect(kinds.map((k) => k.sequence_kind)).not.toContain('LPO');

    const list = await h.call(admin, 'get', `/customer-lpos?hireAgreementId=${agreement.id}`);
    expect(list.body.total).toBe(2);
    expect((await h.call(admin, 'get', `/customer-lpos?quotationId=${quotation.id}&customerId=${quotation.customerId}`)).body.total).toBe(2);
    expect((await h.call(admin, 'get', `/customer-lpos/${first.body.id}`)).body.lpoNo).toBe(' LPO / 2026-001 ');
  });

  it('answers 409 on a field error for a duplicate per customer, but allows the same number for another customer', async () => {
    const { quotation } = await setup(admin);
    const first = await h.create(admin, '/customer-lpos', lpoBody(quotation, { lpoNo: 'DUP-1' }));
    expect(first.status).toBe(201);
    const dup = await h.create(admin, '/customer-lpos', lpoBody(quotation, { lpoNo: 'DUP-1' }));
    expect(dup.status).toBe(409);
    expect(dup.body.fieldErrors.lpoNo).toBe('duplicate');
    const { quotation: otherQuotation } = await setup(admin);
    expect((await h.create(admin, '/customer-lpos', lpoBody(otherQuotation, { lpoNo: 'DUP-1' }))).status).toBe(201);

    const second = await h.create(admin, '/customer-lpos', lpoBody(quotation, { lpoNo: 'DUP-2' }));
    const clash = await h.change(admin, 'patch', `/customer-lpos/${second.body.id}`, 1, { lpoNo: 'DUP-1' });
    expect(clash.status).toBe(409);
  });

  it('validates dates, quotation, customer and agreement consistency', async () => {
    const { quotation } = await setup(admin);
    const { quotation: otherQuotation } = await setup(admin);
    const foreignAgreement = await newAgreement(admin, otherQuotation);
    const stranger = await newCustomer(h, admin);

    const dates = await h.create(admin, '/customer-lpos', lpoBody(quotation, { receivedOn: '2026-03-10', validUntil: '2026-03-09' }));
    expect(dates.status).toBe(422);
    expect(dates.body.fieldErrors.validUntil).toBeDefined();
    expect((await h.create(admin, '/customer-lpos', lpoBody(quotation, { receivedOn: '2026-03-10', validUntil: '2026-03-10' }))).status).toBe(201);

    const mismatch = await h.create(admin, '/customer-lpos', lpoBody(quotation, { customerId: stranger.id }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.fieldErrors.customerId).toBe('quotation_mismatch');
    const wrongAgreement = await h.create(admin, '/customer-lpos', lpoBody(quotation, { hireAgreementId: foreignAgreement.id }));
    expect(wrongAgreement.status).toBe(422);
    expect(wrongAgreement.body.fieldErrors.hireAgreementId).toBe('quotation_mismatch');
    expect((await h.create(admin, '/customer-lpos', lpoBody(quotation, { hireAgreementId: randomUUID() }))).status).toBe(422);
    expect((await h.create(admin, '/customer-lpos', lpoBody(quotation, { lpoNo: '   ' }))).status).toBe(422);
    expect((await h.create(admin, '/customer-lpos', lpoBody({ id: randomUUID(), customerId: quotation.customerId }))).status).toBe(404);

    const ok = await h.create(admin, '/customer-lpos', lpoBody(quotation));
    expect((await h.change(admin, 'patch', `/customer-lpos/${ok.body.id}`, 1, { validUntil: '2026-01-01' })).status).toBe(422);
    const upd = await h.change(admin, 'patch', `/customer-lpos/${ok.body.id}`, 1, { validUntil: '2026-12-31', notes: 'n' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ validUntil: '2026-12-31', rowVersion: 2 });
    expect((await h.change(admin, 'patch', `/customer-lpos/${ok.body.id}`, 1, { notes: 'stale' })).body.code).toBe('STALE_VERSION');
    expect((await h.call(admin, 'patch', `/customer-lpos/${ok.body.id}`).send({ notes: 'x' })).status).toBe(428);
  });

  it('attaches only a Verified and Clean file of the same organization', async () => {
    const { quotation } = await setup(admin);
    const infected = await insertFile(h, admin, { storage: 'Verified', scan: 'Rejected' });
    const pending = await insertFile(h, admin, { storage: 'Pending', scan: 'Pending' });
    const clean = await insertFile(h, admin, { storage: 'Verified', scan: 'Clean' });
    const foreign = await insertFile(h, other, { storage: 'Verified', scan: 'Clean' });
    for (const fileId of [infected, pending]) {
      const res = await h.create(admin, '/customer-lpos', lpoBody(quotation, { fileId }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('FILE_INVALID');
    }
    expect((await h.create(admin, '/customer-lpos', lpoBody(quotation, { fileId: foreign }))).status).toBe(404);
    const ok = await h.create(admin, '/customer-lpos', lpoBody(quotation, { fileId: clean }));
    expect(ok.status).toBe(201);
    expect(ok.body.fileId).toBe(clean);
    const swap = await h.change(admin, 'patch', `/customer-lpos/${ok.body.id}`, 1, { fileId: infected });
    expect(swap.body.code).toBe('FILE_INVALID');
  });
});

describe('tenant isolation and permissions (T18)', () => {
  it('hides another company\'s quotations, agreements and LPOs', async () => {
    const { quotation: theirQuotation } = await setup(other);
    const theirAgreement = await newAgreement(other, theirQuotation);
    const theirLpo = await h.create(other, '/customer-lpos', lpoBody(theirQuotation, { hireAgreementId: theirAgreement.id }));
    expect(theirLpo.status).toBe(201);

    expect((await h.create(admin, '/hire-agreements', agreementBody(theirQuotation))).status).toBe(404);
    expect((await h.create(admin, '/customer-lpos', lpoBody(theirQuotation))).status).toBe(404);
    const { quotation } = await setup(admin);
    const viaForeignAgreement = await h.create(admin, '/customer-lpos', lpoBody(quotation, { hireAgreementId: theirAgreement.id }));
    expect(viaForeignAgreement.status).toBe(422);
    expect(viaForeignAgreement.body.fieldErrors.hireAgreementId).toBe('not_found');

    for (const res of [
      await h.call(admin, 'get', `/hire-agreements/${theirAgreement.id}`),
      await h.change(admin, 'patch', `/hire-agreements/${theirAgreement.id}`, 1, { capacity: 'x' }),
      await h.change(admin, 'post', `/hire-agreements/${theirAgreement.id}/sent`, 1, {}),
      await h.call(admin, 'get', `/customer-lpos/${theirLpo.body.id}`),
      await h.change(admin, 'patch', `/customer-lpos/${theirLpo.body.id}`, 1, { notes: 'x' }),
    ]) {
      expect(res.status).toBe(404);
    }
    for (const path of ['/hire-agreements', `/hire-agreements?quotationId=${theirQuotation.id}`, `/hire-agreements?customerId=${theirQuotation.customerId}`]) {
      expect((await h.call(admin, 'get', path)).body.items.map((x: { id: string }) => x.id)).not.toContain(theirAgreement.id);
    }
    for (const path of ['/customer-lpos', `/customer-lpos?quotationId=${theirQuotation.id}`, `/customer-lpos?hireAgreementId=${theirAgreement.id}`]) {
      expect((await h.call(admin, 'get', path)).body.items.map((x: { id: string }) => x.id)).not.toContain(theirLpo.body.id);
    }
    expect((await h.call(other, 'get', `/hire-agreements/${theirAgreement.id}`)).body.rowVersion).toBe(1);
  });

  it('answers 403 for roles without the permission', async () => {
    const { quotation } = await setup(admin);
    const a = await newAgreement(admin, quotation);
    const lpo = await h.create(admin, '/customer-lpos', lpoBody(quotation));
    expect((await h.call(reader, 'get', `/hire-agreements/${a.id}`)).status).toBe(200);
    expect((await h.call(reader, 'get', `/customer-lpos/${lpo.body.id}`)).status).toBe(200);
    for (const res of [
      await h.create(reader, '/hire-agreements', agreementBody(quotation)),
      await h.change(reader, 'patch', `/hire-agreements/${a.id}`, 1, { capacity: 'x' }),
      await h.change(reader, 'post', `/hire-agreements/${a.id}/sent`, 1, {}),
      await h.create(reader, '/customer-lpos', lpoBody(quotation)),
      await h.change(reader, 'patch', `/customer-lpos/${lpo.body.id}`, 1, { notes: 'x' }),
      await h.call(plain, 'get', '/hire-agreements'),
      await h.call(plain, 'get', '/customer-lpos'),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('applies the sales own-records restriction to the agreements and LPOs of other people\'s quotations', async () => {
    const o = await h.actor('ha-own', 'managing-director');
    const exec = await h.addUser(o, { roleCode: 'sales-executive', branchId: o.branchId, allBranches: true });
    const { quotation } = await setup(o);
    const a = await newAgreement(o, quotation);
    const lpo = await h.create(o, '/customer-lpos', lpoBody(quotation));
    expect((await h.call(exec, 'get', `/hire-agreements/${a.id}`)).status).toBe(404);
    expect((await h.call(exec, 'get', `/customer-lpos/${lpo.body.id}`)).status).toBe(404);
    expect((await h.call(exec, 'get', '/hire-agreements')).body.total).toBe(0);
    expect((await h.call(exec, 'get', '/customer-lpos')).body.total).toBe(0);
    expect((await h.create(exec, '/hire-agreements', agreementBody(quotation))).status).toBe(404);
  });
});
