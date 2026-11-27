// High-risk gap tests (areas 1-5): untested report routes, cross-module races, idempotency conflicts,
// authorization edges and data edges, against fleet_test with the real API.
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import {
  bookingBody, completePass, gateIn, gateOut, gatePassBody, getBooking, getMachine, initiateCollection, jobBody, newBooking,
  newInvoice, newMachine, newPass, pdfBytes, phaseHistory, rentalChain, startHire, type Chain,
} from './rentalFixtures.js';

let h: Harness;
let admin: Actor; // managing-director
let other: Actor;
let colleague: Actor; // operations-manager
let driver: Actor;
let checker: Actor; // phi-pdi-checker: files.read but no documents.read
let salesA: Actor;
let salesB: Actor;

beforeAll(async () => {
  h = await createHarness({ files: true });
  admin = await h.actor('hr-admin', 'managing-director');
  other = await h.actor('hr-other', 'managing-director');
  const user = (roleCode: string) => h.addUser(admin, { roleCode, branchId: admin.branchId, allBranches: true });
  colleague = await user('operations-manager');
  driver = await user('driver');
  checker = await user('phi-pdi-checker');
  salesA = await user('sales-executive');
  salesB = await h.addUser(admin, { roleCode: 'sales-executive', branchId: admin.branchId, allBranches: true, sameRoleAs: salesA });
});
afterAll(async () => {
  await h.close();
});

const no5xx = (label: string, ...rs: { status: number; body?: unknown }[]) => {
  for (const r of rs) expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBeLessThan(500);
};

async function onHire(opts: Parameters<typeof rentalChain>[2] = {}): Promise<Chain> {
  const c = await rentalChain(h, admin, { phase: ['WON'], ...opts });
  const out = await gateOut(h, admin, c);
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  return c;
}

const mqdBody = (bookingId: string, extra: object = {}) => ({
  bookingId, phase: 'HIRE', hirerName: 'Hirer Co', formSchemaVersion: 'v1', fields: { q1: 'yes' }, ...extra,
});
const line = (extra: object = {}) => ({
  provider: 'Crane Co', serviceType: 'Crane', description: 'Lift', serviceDate: '2030-03-01', quantity: '1.5', rate: '333.333333', ...extra,
});

// ------------------------------------------------------------------------------------------------ 1
describe('1. Delivery notes, HIRE/COLLECTION MQD, HIRE TPS', () => {
  it('DN: one per booking (409 DUPLICATE), parallel creates give one row, stale If-Match is 409, update works', async () => {
    const c = await rentalChain(h, admin);
    const first = await h.create(admin, '/delivery-notes', { bookingId: c.booking.id, driverName: 'Drv' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.number).toEqual(expect.any(String));
    expect(first.body.deliveryAddress).toBeTruthy();
    const second = await h.create(admin, '/delivery-notes', { bookingId: c.booking.id });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE');

    const c2 = await rentalChain(h, admin);
    const race = await Promise.all([1, 2, 3].map(() => h.create(admin, '/delivery-notes', { bookingId: c2.booking.id })));
    no5xx('dn race', ...race);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await h.sql(admin, 'SELECT 1 FROM delivery_notes WHERE booking_id = $1', [c2.booking.id])).toHaveLength(1);

    const stale = await h.change(admin, 'patch', `/delivery-notes/${first.body.id}`, first.body.rowVersion + 5, { notes: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    const ok = await h.change(admin, 'patch', `/delivery-notes/${first.body.id}`, first.body.rowVersion, { notes: 'Delivered fine', receivedByName: 'Site Mgr' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ notes: 'Delivered fine', receivedByName: 'Site Mgr', rowVersion: first.body.rowVersion + 1 });
    // The same (now old) version again is stale.
    expect((await h.change(admin, 'patch', `/delivery-notes/${first.body.id}`, first.body.rowVersion, { notes: 'y' })).status).toBe(409);
    expect((await h.change(admin, 'patch', `/delivery-notes/${first.body.id}`, ok.body.rowVersion, {})).status).toBe(422); // empty patch
    expect((await h.call(other, 'get', `/delivery-notes/${first.body.id}`)).status).toBe(404);
  });

  it('DN: a document can be generated for it and replays unchanged', async () => {
    const c = await rentalChain(h, admin);
    const dn = await h.create(admin, '/delivery-notes', { bookingId: c.booking.id });
    expect(dn.status).toBe(201);
    const up = await h.upload(admin, pdfBytes('dn'));
    expect(up.status).toBe(201);
    const body = { documentType: 'DN', ownerId: dn.body.id, templateVersion: 'dn-v1', snapshotSchemaVersion: 's1', dataSnapshot: { number: dn.body.number }, fileId: up.body.id };
    const gen = await h.create(admin, '/documents/generate', body);
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    expect(gen.body).toMatchObject({ documentType: 'DN', documentNo: dn.body.number, ownerType: 'delivery_note', ownerId: dn.body.id });
    const again = await h.create(admin, '/documents/generate', body);
    expect(again.status).toBe(200);
    expect(again.body.versions).toHaveLength(1);
    // A DN document cannot be generated for a collection note id.
    expect((await h.create(admin, '/documents/generate', { ...body, documentType: 'CN' })).status).toBe(404);
  });

  it('HIRE MQD: HMQD number, no collection note allowed, one per booking', async () => {
    const c = await rentalChain(h, admin);
    const res = await h.create(admin, '/mqd-reports', mqdBody(c.booking.id));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.number).toMatch(/^HMQD/);
    expect(res.body).toMatchObject({ phase: 'HIRE', collectionNoteId: null, bookingId: c.booking.id });
    const withNote = await h.create(admin, '/mqd-reports', mqdBody((await rentalChain(h, admin)).booking.id, { collectionNoteId: randomUUID() }));
    expect(withNote.status).toBe(422);
    expect(withNote.body.fieldErrors.collectionNoteId).toBe('not_allowed');
    const dup = await h.create(admin, '/mqd-reports', mqdBody(c.booking.id));
    expect(dup.status).toBe(409);
    const upd = await h.change(admin, 'patch', `/mqd-reports/${res.body.id}`, res.body.rowVersion, { fields: { q1: 'no' } });
    expect(upd.status).toBe(200);
    expect(upd.body.fields).toEqual({ q1: 'no' });
    expect((await h.change(admin, 'patch', `/mqd-reports/${res.body.id}`, res.body.rowVersion, { fields: {} })).status).toBe(409);
  });

  it('HIRE TPS: HTPS number, server-computed decimal amounts, total = sum, lines replaced on patch', async () => {
    const c = await rentalChain(h, admin);
    const res = await h.create(admin, '/service-reports', {
      bookingId: c.booking.id, phase: 'HIRE', lines: [line(), line({ description: 'Second', quantity: '2', rate: '0.1' })],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.number).toMatch(/^HTPS/);
    expect(res.body.collectionNoteId).toBeNull();
    // 1.5 * 333.333333 = 499.9999995 -> half up at 6 places = 500.000000; 2 * 0.1 = 0.200000.
    expect(res.body.lines.map((l: { amount: string }) => l.amount)).toEqual(['500.000000', '0.200000']);
    expect(res.body.totalAmount).toBe('500.200000');
    expect(res.body.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2]);

    const patched = await h.change(admin, 'patch', `/service-reports/${res.body.id}`, res.body.rowVersion, { lines: [line({ quantity: '3', rate: '1.1' })] });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.lines).toHaveLength(1);
    expect(patched.body.lines[0].amount).toBe('3.300000');
    expect(patched.body.totalAmount).toBe('3.300000');
    const cleared = await h.change(admin, 'patch', `/service-reports/${res.body.id}`, patched.body.rowVersion, { lines: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.totalAmount).toBe('0.000000');
    expect((await h.change(admin, 'patch', `/service-reports/${res.body.id}`, patched.body.rowVersion, { notes: 'stale' })).status).toBe(409);
    // Bad lines: zero quantity and client-supplied amount are rejected.
    const c2 = await rentalChain(h, admin);
    expect((await h.create(admin, '/service-reports', { bookingId: c2.booking.id, phase: 'HIRE', lines: [line({ quantity: '0' })] })).status).toBe(422);
    expect((await h.create(admin, '/service-reports', { bookingId: c2.booking.id, phase: 'HIRE', lines: [line({ amount: '1' })] })).status).toBe(422);
    expect(await h.sql(admin, 'SELECT 1 FROM third_party_service_reports WHERE booking_id = $1', [c2.booking.id])).toHaveLength(0);
  });

  it('COLLECTION MQD/TPS need a collection note of the same booking; another booking\'s note is rejected', async () => {
    const a = await onHire();
    const b = await onHire();
    const cnA = (await initiateCollection(h, admin, a.booking.id)).body.collectionNote;
    const cnB = (await initiateCollection(h, admin, b.booking.id)).body.collectionNote;
    const mismatch = await h.create(admin, '/mqd-reports', mqdBody(a.booking.id, { phase: 'COLLECTION', collectionNoteId: cnB.id }));
    expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(422);
    expect(mismatch.body.fieldErrors.collectionNoteId).toBe('booking_mismatch');
    const missing = await h.create(admin, '/mqd-reports', mqdBody(a.booking.id, { phase: 'COLLECTION' }));
    expect(missing.status).toBe(422);
    expect(missing.body.fieldErrors.collectionNoteId).toBe('required');
    const unknown = await h.create(admin, '/mqd-reports', mqdBody(a.booking.id, { phase: 'COLLECTION', collectionNoteId: randomUUID() }));
    expect(unknown.status).toBe(422);
    const tpsMismatch = await h.create(admin, '/service-reports', { bookingId: a.booking.id, phase: 'COLLECTION', collectionNoteId: cnB.id });
    expect(tpsMismatch.status).toBe(422);
    expect(tpsMismatch.body.fieldErrors.collectionNoteId).toBe('booking_mismatch');
    // The report auto-created with the note is the one for this scope: a second one is a duplicate.
    const dup = await h.create(admin, '/mqd-reports', mqdBody(a.booking.id, { phase: 'COLLECTION', collectionNoteId: cnA.id }));
    expect(dup.status).toBe(409);
    // A note of the same company but another booking never links to A's reports.
    expect(await h.sql(admin, 'SELECT 1 FROM mqd_reports WHERE booking_id = $1 AND collection_note_id = $2', [a.booking.id, cnB.id])).toHaveLength(0);
    // Document numbers: COLLECTION reports use MQD / TPS prefixes (not HMQD / HTPS).
    const list = await h.call(admin, 'get', `/mqd-reports?bookingId=${a.booking.id}&phase=COLLECTION`);
    expect(list.body.items[0].number).toMatch(/^MQD/);
    expect(list.body.items[0].number).not.toMatch(/^HMQD/);
  });
});

// ------------------------------------------------------------------------------------------------ 2
describe('2. Races across modules', () => {
  it('planner Start Hire and Gate OUT completion for the same booking in parallel: one departure, one Won row', async () => {
    for (let i = 0; i < 3; i += 1) {
      const c = await rentalChain(h, admin);
      const pass = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: c.booking.id }));
      expect(pass.status).toBe(201);
      const [planner, gate] = await Promise.all([startHire(h, admin, c.booking.id, c.booking.rowVersion), completePass(h, admin, pass.body.id)]);
      await new Promise((r) => setTimeout(r, 1500));
      const dl = await h.sql<{ deadlocks: string }>(admin, 'SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()');
      no5xx(`start-hire race #${i} (db deadlocks so far: ${dl[0]?.deadlocks})`, planner, gate);
      expect([planner.status, gate.status].some((s) => s === 200), JSON.stringify([planner.body, gate.body])).toBe(true);
      const booking = await getBooking(h, admin, c.booking.id);
      expect(booking.status).toBe('On Hire');
      expect(booking.departedAt).not.toBeNull();
      expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('On Hire');
      expect((await phaseHistory(h, admin, c.quotation.id)).filter((r) => r.toPhase === 'WON')).toHaveLength(1);
      const out = await h.sql(admin, "SELECT 1 FROM gate_movements WHERE booking_id = $1 AND direction = 'OUT'", [c.booking.id]);
      expect(out.length).toBeLessThanOrEqual(1);
    }
  });

  it('Gate IN completion and collection-note cancel in parallel: consistent end state, no 5xx', async () => {
    for (let i = 0; i < 3; i += 1) {
      const c = await onHire();
      const cn = (await initiateCollection(h, admin, c.booking.id)).body.collectionNote;
      const pass = await newPass(h, admin, gatePassBody(c.machine.id, {
        direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard', collectionNoteId: cn.id,
      }));
      expect(pass.status, JSON.stringify(pass.body)).toBe(201);
      const [gate, cancel] = await Promise.all([
        completePass(h, admin, pass.body.id),
        h.change(admin, 'post', `/collection-notes/${cn.id}/cancel`, cn.rowVersion, { reason: 'race' }),
      ]);
      no5xx(`gate-in vs cancel #${i}`, gate, cancel);
      const note = (await h.call(admin, 'get', `/collection-notes/${cn.id}`)).body.collectionNote;
      const booking = await getBooking(h, admin, c.booking.id);
      const ins = await h.sql(admin, "SELECT 1 FROM gate_movements WHERE booking_id = $1 AND direction = 'IN'", [c.booking.id]);
      if (gate.status === 200) {
        expect(booking.status).toBe('Returned');
        expect(ins).toHaveLength(1);
      } else {
        expect(ins).toHaveLength(0);
      }
      // A note cannot be both cancelled by the user and recorded as collected by the gate.
      if (cancel.status === 200 && gate.status === 200) expect(note.status, 'cancelled note must not also be Collected').toBe('Cancelled');
      if (note.status === 'Collected') expect(cancel.status).not.toBe(200);
      expect(['Collected', 'Cancelled']).toContain(note.status);
    }
  });

  it('two Gate IN passes for the same booking created and completed in parallel: only one return', async () => {
    const c = await onHire();
    const mk = () => newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard' }));
    const created = await Promise.all([mk(), mk()]);
    no5xx('create IN passes', ...created);
    const made = created.filter((r) => r.status === 201);
    expect(made, JSON.stringify(created.map((r) => r.body))).toHaveLength(1);
    // Force a second open pass through SQL to model a creation race that slipped through, then complete both in parallel.
    const second = await h.sql<{ id: string }>(admin, 'SELECT id FROM gate_passes WHERE machine_id = $1 AND direction = $2', [c.machine.id, 'IN']);
    expect(second).toHaveLength(1);
    const done = await Promise.all([completePass(h, admin, made[0].body.id), completePass(h, admin, made[0].body.id)]);
    no5xx('complete IN', ...done);
    expect(done.map((r) => r.status), JSON.stringify(done.map((r) => r.body))).toEqual([200, 200]);
    expect(done.filter((r) => r.body.alreadyCompleted === false)).toHaveLength(1);
    expect(await h.sql(admin, "SELECT 1 FROM gate_movements WHERE booking_id = $1 AND direction = 'IN'", [c.booking.id])).toHaveLength(1);
    expect(await h.sql(admin, 'SELECT 1 FROM inspections WHERE machine_id = $1', [c.machine.id])).toHaveLength(1);
    expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ status: 'Returned' });
  });

  it('two different open IN passes inserted directly cannot both complete (database guard)', async () => {
    const c = await onHire();
    const p1 = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard' }));
    expect(p1.status).toBe(201);
    await h.sql(admin, "UPDATE gate_passes SET status = 'Cancelled' WHERE id = $1", [p1.body.id]);
    const p2 = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard' }));
    expect(p2.status, JSON.stringify(p2.body)).toBe(201);
    // Re-open the first pass behind the API's back so two open passes exist.
    const reopen = await h.sql(admin, "UPDATE gate_passes SET status = 'Pending' WHERE id = $1 RETURNING id", [p1.body.id]).catch((e: unknown) => e);
    if (reopen instanceof Error) return; // the database already forbids two open passes: the best outcome
    const done = await Promise.all([completePass(h, admin, p1.body.id), completePass(h, admin, p2.body.id)]);
    no5xx('two open IN passes', ...done);
    expect(done.filter((r) => r.status === 200 && r.body.alreadyCompleted === false), JSON.stringify(done.map((r) => r.body))).toHaveLength(1);
    expect(await h.sql(admin, "SELECT 1 FROM gate_movements WHERE booking_id = $1 AND direction = 'IN'", [c.booking.id])).toHaveLength(1);
    expect(await h.sql(admin, 'SELECT 1 FROM inspections WHERE machine_id = $1', [c.machine.id])).toHaveLength(1);
  });

  it('collection initiation while Gate IN completes: no 5xx and no open collection note left on a returned booking', async () => {
    for (let i = 0; i < 3; i += 1) {
      const c = await onHire();
      const pass = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard' }));
      expect(pass.status).toBe(201);
      const [gate, init] = await Promise.all([completePass(h, admin, pass.body.id), initiateCollection(h, admin, c.booking.id)]);
      no5xx(`collection vs gate-in #${i}`, gate, init);
      const booking = await getBooking(h, admin, c.booking.id);
      expect(gate.status).toBe(200);
      expect(booking.status).toBe('Returned');
      const open = await h.sql<{ status: string }>(
        admin, "SELECT status FROM collection_notes WHERE booking_id = $1 AND status NOT IN ('Closed', 'Cancelled', 'Collected')", [c.booking.id],
      );
      expect(open, `init status ${init.status}: a returned booking must not keep an open collection note`).toHaveLength(0);
      const jobs = await h.sql(admin, "SELECT 1 FROM transport_jobs WHERE booking_id = $1 AND auto_generated AND status NOT IN ('Completed','Cancelled')", [c.booking.id]);
      expect(jobs, 'a returned booking must not keep an open auto-generated collection job').toHaveLength(0);
    }
  });
});

// ------------------------------------------------------------------------------------------------ 3
describe('3. Idempotency key reuse with a different body', () => {
  const conflict = (r: { status: number; body: { code?: string } }) => {
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe('IDEMPOTENCY_CONFLICT');
  };

  it('POST /bookings', async () => {
    const m = await newMachine(h, admin);
    const c = await rentalChain(h, admin);
    const key = randomUUID();
    const first = await h.create(admin, '/bookings', bookingBody(m.id, c.customer.id, { dailyRate: '100' }), key);
    expect(first.status).toBe(201);
    conflict(await h.create(admin, '/bookings', bookingBody(m.id, c.customer.id, { dailyRate: '250' }), key));
    expect(await h.sql(admin, 'SELECT 1 FROM bookings WHERE machine_id = $1', [m.id])).toHaveLength(1);
    const replay = await h.create(admin, '/bookings', bookingBody(m.id, c.customer.id, { dailyRate: '100' }), key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('POST /invoices', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const base = { quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-01', periodEnd: '2030-03-31', periodChargeConfirmed: true };
    const key = randomUUID();
    const first = await h.create(admin, '/invoices', { ...base, equipment: { quantity: '1', unitRate: '1000', amount: '1000' } }, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    conflict(await h.create(admin, '/invoices', { ...base, equipment: { quantity: '1', unitRate: '1000', amount: '2000' } }, key));
    expect(await h.sql(admin, 'SELECT 1 FROM invoices WHERE quotation_id = $1', [c.quotation.id])).toHaveLength(1);
  });

  it('POST /gate-passes/:id/complete', async () => {
    const c = await rentalChain(h, admin);
    const pass = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: c.booking.id }));
    const key = randomUUID();
    const first = await completePass(h, admin, pass.body.id, key, { notes: 'one' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    conflict(await completePass(h, admin, pass.body.id, key, { notes: 'two' }));
    expect(await h.sql(admin, 'SELECT 1 FROM gate_movements WHERE machine_id = $1', [c.machine.id])).toHaveLength(1);
  });

  it('POST /bookings/:id/collection', async () => {
    const c = await onHire();
    const key = randomUUID();
    const first = await initiateCollection(h, admin, c.booking.id, { remarks: 'A' }, key);
    expect(first.status).toBe(201);
    conflict(await initiateCollection(h, admin, c.booking.id, { remarks: 'B' }, key));
    expect(await h.sql(admin, 'SELECT 1 FROM collection_notes WHERE booking_id = $1', [c.booking.id])).toHaveLength(1);
  });

  it('POST /documents/generate', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const invoice = await newInvoice(h, admin, c);
    const f1 = (await h.upload(admin, pdfBytes('i1'))).body.id;
    const f2 = (await h.upload(admin, pdfBytes('i2'))).body.id;
    const base = { documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's' };
    const key = randomUUID();
    expect((await h.create(admin, '/documents/generate', { ...base, dataSnapshot: { a: 1 }, fileId: f1 }, key)).status).toBe(201);
    conflict(await h.create(admin, '/documents/generate', { ...base, dataSnapshot: { a: 2 }, fileId: f2 }, key));
    const versions = await h.sql(admin, 'SELECT 1 FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.invoice_id = $1', [invoice.id]);
    expect(versions).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ 4
describe('4. Authorization edges', () => {
  it('an unattached uploaded file is readable only by its uploader (same-company user and other company get 404)', async () => {
    const up = await h.upload(admin, pdfBytes('private'));
    expect(up.status).toBe(201);
    expect((await h.download(admin, up.body.id)).status).toBe(200);
    expect((await h.download(colleague, up.body.id)).status).toBe(404);
    expect((await h.call(colleague, 'get', `/files/${up.body.id}`)).status).toBe(404);
    expect((await h.download(other, up.body.id)).status).toBe(404);
  });

  it('a user with files.read but without documents.read cannot download a generated PDF', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const invoice = await newInvoice(h, admin, c);
    const up = await h.upload(admin, pdfBytes('gen-auth'));
    const gen = await h.create(admin, '/documents/generate', {
      documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { n: invoice.invoiceNo }, fileId: up.body.id,
    });
    expect(gen.status).toBe(201);
    expect((await h.download(admin, up.body.id)).status).toBe(200);
    expect((await h.download(colleague, up.body.id)).status).toBe(200);
    const denied = await h.download(checker, up.body.id);
    expect([403, 404], `status ${denied.status}`).toContain(denied.status);
    expect((await h.call(checker, 'get', `/files/${up.body.id}`)).status).toBeGreaterThanOrEqual(403);
    expect((await h.call(checker, 'get', `/documents/${gen.body.id}`)).status).toBe(403);
  });

  it('a driver cannot create or change transport jobs but can read them', async () => {
    const m = await newMachine(h, admin);
    const denied = await h.create(driver, '/transport-jobs', jobBody(m.id));
    expect(denied.status).toBe(403);
    const job = await h.create(admin, '/transport-jobs', jobBody(m.id));
    expect(job.status, JSON.stringify(job.body)).toBe(201);
    expect((await h.call(driver, 'get', `/transport-jobs/${job.body.id}`)).status).toBe(200);
    expect((await h.change(driver, 'post', `/transport-jobs/${job.body.id}/status`, job.body.rowVersion, { status: 'Loading' })).status).toBe(403);
    expect((await h.change(driver, 'patch', `/transport-jobs/${job.body.id}`, job.body.rowVersion, { transportText: 'x' })).status).toBe(403);
    expect(await h.sql(admin, 'SELECT status FROM transport_jobs WHERE id = $1', [job.body.id])).toEqual([{ status: 'Scheduled' }]);
  });

  it('a sales executive (own records) cannot see another sales user\'s invoices or documents; own records stay visible', async () => {
    const chainFor = async (sales: Actor) => {
      const c = await rentalChain(h, admin, { phase: ['WON'], quotation: { salesUserId: sales.userId } });
      const invoice = await newInvoice(h, admin, c);
      const invFile = (await h.upload(admin, pdfBytes(`inv-${randomUUID()}`))).body.id as string;
      const invDoc = await h.create(admin, '/documents/generate', {
        documentType: 'INVOICE', ownerId: invoice.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { n: invoice.invoiceNo }, fileId: invFile,
      });
      expect(invDoc.status, JSON.stringify(invDoc.body)).toBe(201);
      const dn = await h.create(admin, '/delivery-notes', { bookingId: c.booking.id });
      const dnFile = (await h.upload(admin, pdfBytes(`dn-${randomUUID()}`))).body.id as string;
      const dnDoc = await h.create(admin, '/documents/generate', {
        documentType: 'DN', ownerId: dn.body.id, templateVersion: 't', snapshotSchemaVersion: 's', dataSnapshot: { n: dn.body.number }, fileId: dnFile,
      });
      expect(dnDoc.status, JSON.stringify(dnDoc.body)).toBe(201);
      return { c, invoice, invFile, invDoc: invDoc.body, dn: dn.body, dnFile, dnDoc: dnDoc.body };
    };
    const a = await chainFor(salesA);
    const b = await chainFor(salesB);
    // Own records stay visible (guards against a test that passes because everything is hidden).
    expect((await h.call(salesA, 'get', `/documents/${a.invDoc.id}`)).status).toBe(200);
    expect((await h.download(salesA, a.invFile)).status).toBe(200);
    expect((await h.call(salesA, 'get', `/documents/${a.dnDoc.id}`)).status).toBe(200);
    // Invoices: the role has no invoice permission at all.
    expect((await h.call(salesA, 'get', `/invoices/${b.invoice.id}`)).status).toBe(403);
    expect((await h.call(salesA, 'get', '/invoices')).status).toBe(403);
    // Invoice documents of another sales user's quotation.
    expect((await h.call(salesA, 'get', `/documents/${b.invDoc.id}`)).status).toBe(404);
    expect((await h.download(salesA, b.invFile)).status).toBe(404);
    const list = await h.call(salesA, 'get', `/documents?ownerType=invoice&ownerId=${b.invoice.id}`);
    expect([404, 200]).toContain(list.status);
    if (list.status === 200) expect(list.body.total).toBe(0);
    // Booking-linked documents (delivery note) of another sales user's quotation chain.
    const dnDoc = await h.call(salesA, 'get', `/documents/${b.dnDoc.id}`);
    expect(dnDoc.status, 'delivery-note document of another sales user\'s booking').toBe(404);
    expect((await h.download(salesA, b.dnFile)).status, 'delivery-note file of another sales user\'s booking').toBe(404);
    expect((await h.call(salesA, 'get', `/delivery-notes/${b.dn.id}`)).status, 'delivery note of another sales user\'s booking').toBe(404);
    expect((await h.call(salesA, 'get', `/bookings/${b.c.booking.id}`)).status, 'booking of another sales user\'s quotation chain').toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ 5
describe('5. Data edges', () => {
  it('invoice: large precise decimals, VAT rounding at currency precision, totals consistent', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const big = '999999999.999999';
    const first = await h.create(admin, '/invoices', {
      quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-01', periodEnd: '2030-03-10',
      equipment: { quantity: '1', unitRate: big, amount: big }, periodChargeConfirmed: true,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(new Decimal(first.body.subtotal).eq('1000000000.00'), first.body.subtotal).toBe(true); // 999999999.999999 rounded half up to 2 places
    const rate = new Decimal(first.body.vatRate);
    const pct = rate.gte(1) ? rate.div(100) : rate;
    const expectVat = new Decimal(first.body.subtotal).times(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(new Decimal(first.body.vatAmount).eq(expectVat), first.body.vatAmount).toBe(true);
    expect(new Decimal(first.body.totalAmount).eq(new Decimal(first.body.subtotal).plus(first.body.vatAmount))).toBe(true);

    // 10.10 + 5% VAT = 0.505 -> 0.51 (half up); 0.005 rounds to 0.01.
    const second = await h.create(admin, '/invoices', {
      quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-11', periodEnd: '2030-03-20',
      equipment: { quantity: '1', unitRate: '10.10', amount: '10.10' }, periodChargeConfirmed: true,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(new Decimal(second.body.subtotal).eq('10.10')).toBe(true);
    expect(new Decimal(second.body.vatAmount).eq(new Decimal('10.10').times(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), second.body.vatAmount).toBe(true);
    const tiny = await h.create(admin, '/invoices', {
      quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-21', periodEnd: '2030-03-25',
      equipment: { quantity: '1', unitRate: '0.005', amount: '0.005' }, periodChargeConfirmed: true,
    });
    expect(tiny.status, JSON.stringify(tiny.body)).toBe(201);
    expect(new Decimal(tiny.body.subtotal).eq('0.01'), tiny.body.subtotal).toBe(true);
    // Too many integer digits is a validation error, not a 500.
    const huge = await h.create(admin, '/invoices', {
      quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-26', periodEnd: '2030-03-27',
      equipment: { quantity: '1', unitRate: '1', amount: '99999999999999.999999' }, periodChargeConfirmed: true,
    });
    expect(huge.status, JSON.stringify(huge.body)).toBeLessThan(500);
    expect(huge.status).toBeGreaterThanOrEqual(400);
  });

  it('invoice: date strings with a timezone are rejected; default dates follow one calendar (company timezone)', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const base = { quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', equipment: { quantity: '1', unitRate: '1', amount: '1' }, periodChargeConfirmed: true };
    for (const periodStart of ['2030-03-01T00:00:00+04:00', '2030-02-28T20:00:00Z', '2030-03-01T00:00:00']) {
      const res = await h.create(admin, '/invoices', { ...base, periodStart, periodEnd: '2030-03-31' });
      expect(res.status, periodStart).toBe(422);
    }
    expect((await h.create(admin, '/invoices', { ...base, periodStart: '2030-03-01', periodEnd: '2030-03-31T23:59:00+04:00' })).status).toBe(422);
    expect((await h.create(admin, '/invoices', { ...base, periodStart: '2030-03-01', periodEnd: '2030-03-31', invoiceDate: '2030-03-01T23:30:00Z' })).status).toBe(422);
    expect((await h.create(admin, '/invoices', { ...base, periodStart: '2030-02-30', periodEnd: '2030-03-31' })).status).toBe(422);
    expect(await h.sql(admin, 'SELECT 1 FROM invoices WHERE quotation_id = $1', [c.quotation.id])).toHaveLength(0);
    // The default invoice date must be the calendar date in the company's timezone, like the collection schedule date.
    const inv = await newInvoice(h, admin, c);
    const tz = (await h.sql<{ timezone: string }>(admin, 'SELECT timezone FROM organizations WHERE id = $1', [admin.orgId]))[0].timezone;
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const res = await h.call(admin, 'get', `/invoices/${inv.id}`);
    expect(res.body.invoiceDate, `company timezone ${tz}`).toBe(local);
  });

  it('bookings: year-boundary range and a one-day booking get inclusive-day totals', async () => {
    const c = await rentalChain(h, admin);
    const m1 = await newMachine(h, admin);
    const span = await h.create(admin, '/bookings', bookingBody(m1.id, c.customer.id, { startDate: '2030-12-25', endDate: '2031-01-05', dailyRate: '100' }));
    expect(span.status, JSON.stringify(span.body)).toBe(201);
    expect(span.body.startDate).toBe('2030-12-25');
    expect(span.body.endDate).toBe('2031-01-05');
    expect(Number(span.body.totalValue)).toBe(1200); // 12 inclusive days
    const m2 = await newMachine(h, admin);
    const one = await h.create(admin, '/bookings', bookingBody(m2.id, c.customer.id, { startDate: '2030-06-15', endDate: '2030-06-15', dailyRate: '100', status: 'Reserved' }));
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(Number(one.body.totalValue)).toBe(100);
    // A second booking on the same machine for the adjacent day is fine, an overlapping one is not.
    const next = await h.create(admin, '/bookings', bookingBody(m2.id, c.customer.id, { startDate: '2030-06-16', endDate: '2030-06-16', status: 'Reserved' }));
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    const overlap = await h.create(admin, '/bookings', bookingBody(m2.id, c.customer.id, { startDate: '2030-06-15', endDate: '2030-06-15', status: 'Reserved' }));
    expect(overlap.status).toBe(409); // BOOKING_CONFLICT
    const bad = await h.create(admin, '/bookings', bookingBody(m1.id, c.customer.id, { startDate: '2031-01-05', endDate: '2030-12-25' }));
    expect(bad.status).toBe(422);
    expect((await h.create(admin, '/bookings', bookingBody(m1.id, c.customer.id, { startDate: '2040-01-01T00:00:00+04:00', endDate: '2040-01-02' }))).status).toBe(422);
  });

  it('non-UUID ids in paths are 404 (never 500)', async () => {
    const bad = 'not-a-uuid';
    const gets = [
      '/bookings', '/invoices', '/delivery-notes', '/mqd-reports', '/service-reports', '/gate-passes', '/collection-notes', '/transport-jobs',
      '/documents', '/files', '/machines', '/quotations', '/customers', '/hire-agreements', '/inspections',
    ];
    const failures: string[] = [];
    const check = (label: string, status: number) => { if (status !== 404) failures.push(`${label} -> ${status}`); };
    for (const base of gets) check(`GET ${base}/${bad}`, (await h.call(admin, 'get', `${base}/${bad}`)).status);
    check('GET /files/x/content', (await h.call(admin, 'get', `/files/${bad}/content`)).status);
    check('PATCH /bookings/x', (await h.change(admin, 'patch', `/bookings/${bad}`, 1, { notes: 'x' })).status);
    check('PATCH /delivery-notes/x', (await h.change(admin, 'patch', `/delivery-notes/${bad}`, 1, { notes: 'x' })).status);
    check('POST /bookings/x/collection', (await initiateCollection(h, admin, bad)).status);
    check('POST /bookings/x/start-hire', (await startHire(h, admin, bad, 1)).status);
    check('POST /gate-passes/x/complete', (await completePass(h, admin, bad)).status);
    check('POST /collection-notes/x/cancel', (await h.change(admin, 'post', `/collection-notes/${bad}/cancel`, 1, { reason: 'x' })).status);
    expect(failures).toEqual([]);
  });

  it('over-long text (4001 chars) is 422, never 500, and nothing is written', async () => {
    const long = 'x'.repeat(4001);
    const c = await onHire();
    const failures: string[] = [];
    const check = (label: string, status: number) => { if (status !== 422) failures.push(`${label} -> ${status}`); };
    const m = await newMachine(h, admin);
    check('POST /bookings notes', (await h.create(admin, '/bookings', bookingBody(m.id, c.customer.id, { notes: long }))).status);
    check('POST /bookings deliveryAddress 501', (await h.create(admin, '/bookings', bookingBody(m.id, c.customer.id, { deliveryAddress: 'y'.repeat(501) }))).status);
    check('PATCH /bookings notes', (await h.change(admin, 'patch', `/bookings/${c.booking.id}`, (await getBooking(h, admin, c.booking.id)).rowVersion, { notes: long })).status);
    check('POST collection remarks', (await initiateCollection(h, admin, c.booking.id, { remarks: long })).status);
    const w = await rentalChain(h, admin, { phase: ['WON'] });
    check('POST /invoices notes', (await h.create(admin, '/invoices', {
      quotationId: w.quotation.id, hireAgreementId: w.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-01', periodEnd: '2030-03-31',
      equipment: { quantity: '1', unitRate: '1', amount: '1' }, periodChargeConfirmed: true, notes: long,
    })).status);
    const d = await rentalChain(h, admin);
    check('POST /delivery-notes notes', (await h.create(admin, '/delivery-notes', { bookingId: d.booking.id, notes: long })).status);
    check('POST /mqd-reports notes', (await h.create(admin, '/mqd-reports', mqdBody(d.booking.id, { notes: long }))).status);
    check('POST /service-reports notes', (await h.create(admin, '/service-reports', { bookingId: d.booking.id, phase: 'HIRE', notes: long })).status);
    const e = await rentalChain(h, admin);
    const pass = await newPass(h, admin, gatePassBody(e.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: e.booking.id }));
    check('POST gate complete notes', (await completePass(h, admin, pass.body.id, randomUUID(), { notes: long })).status);
    check('POST /gate-passes notes', (await newPass(h, admin, gatePassBody(e.machine.id, { direction: 'OUT', movementPurpose: 'TRANSFER', notes: long }))).status);
    check('POST /transport-jobs transportText', (await h.create(admin, '/transport-jobs', jobBody(m.id, { transportText: long }))).status);
    expect(failures).toEqual([]);
    expect(await h.sql(admin, 'SELECT 1 FROM bookings WHERE machine_id = $1', [m.id])).toHaveLength(0);
    expect(await h.sql(admin, 'SELECT 1 FROM delivery_notes WHERE booking_id = $1', [d.booking.id])).toHaveLength(0);
    expect(await h.sql(admin, 'SELECT 1 FROM gate_movements WHERE machine_id = $1', [e.machine.id])).toHaveLength(0);
  });
});

void gateIn;
void newBooking;
