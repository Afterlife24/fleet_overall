// T15 (QR and manual fallback), T16 (pending vs completed passes) and T17 (return intake, hold release) against fleet_test.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import {
  answerInspection, completePass, gateIn, gateOut, gatePassBody, getBooking, getMachine, initiateCollection, newMachine, newPass,
  phaseHistory, pngBytes, quotationPhase, rentalChain, startHire, bookingBody, type Chain,
} from './rentalFixtures.js';

let h: Harness;
let admin: Actor; // managing-director
let other: Actor; // another company
let security: Actor; // gate.read / gate.write, no approval
let supervisor: Actor; // gate.write + gate.approve
let checker: Actor; // PHI/PDI checker: inspections.write, no release
let workshop: Actor; // workshop manager: inspections.release_hold

beforeAll(async () => {
  h = await createHarness({ files: true });
  admin = await h.actor('gate-admin', 'managing-director');
  other = await h.actor('gate-other', 'managing-director');
  const user = (roleCode: string) => h.addUser(admin, { roleCode, branchId: admin.branchId, allBranches: true });
  security = await user('security');
  supervisor = await user('site-supervisor');
  checker = await user('phi-pdi-checker');
  workshop = await user('workshop-manager');
});
afterAll(async () => {
  await h.close();
});

const fleetQr = (orgId: string, machineId: string, fleetNo: string) => `AXLEOPS-FLEET:${orgId}:${machineId}:${fleetNo}`;
const resolve = (a: Actor, payload: unknown) => h.call(a, 'post', '/gate/resolve-qr').send({ payload });
const movements = (machineId: string) => h.sql<{ id: string }>(admin, 'SELECT id FROM gate_movements WHERE machine_id = $1', [machineId]);
const passes = (machineId: string) => h.sql<{ id: string }>(admin, 'SELECT id FROM gate_passes WHERE machine_id = $1', [machineId]);
const approve = (a: Actor, pass: { id: string; rowVersion: number }) => h.change(a, 'post', `/gate-passes/${pass.id}/approve`, pass.rowVersion, {});
const outBody = (c: Pick<Chain, 'machine' | 'booking'>, extra: object = {}) =>
  gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: c.booking.id, ...extra });

describe('T15 QR resolution is strict and the manual fallback works', () => {
  it('resolves a valid fleet QR for the company and finds the one booking that is out, never "the latest"', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const qr = fleetQr(admin.orgId, c.machine.id, c.machine.fleetNo);
    const idle = await resolve(security, qr);
    expect(idle.status, JSON.stringify(idle.body)).toBe(200);
    expect(idle.body).toMatchObject({ kind: 'FLEET', machine: { id: c.machine.id, fleetNo: c.machine.fleetNo }, candidateBooking: null, manualSelectionRequired: true });
    // A later planned booking exists, but only the booking that actually left is a return candidate.
    expect((await gateOut(h, admin, c)).status).toBe(200);
    const later = await h.create(admin, '/bookings', bookingBody(c.machine.id, c.customer.id, { status: 'Reserved', startDate: '2032-01-01', endDate: '2032-01-31' }));
    expect(later.status).toBe(201);
    const out = await resolve(security, qr.toLowerCase().replace('axleops-fleet', 'AXLEOPS-FLEET')); // ids and fleet number compare case-insensitively
    expect(out.status).toBe(200);
    expect(out.body.candidateBooking).toMatchObject({ id: c.booking.id, status: 'On Hire' });
    expect(out.body.manualSelectionRequired).toBe(false);
    expect(out.body.candidateCollectionNote).toBeNull();
    const cn = await initiateCollection(h, admin, c.booking.id);
    expect((await resolve(security, qr)).body.candidateCollectionNote).toMatchObject({ id: cn.body.collectionNote.id });
  });

  it('rejects malformed, foreign, unknown and stale payloads with QR_INVALID and creates nothing', async () => {
    const c = await rentalChain(h, admin);
    const theirs = await newMachine(h, other);
    const good = fleetQr(admin.orgId, c.machine.id, c.machine.fleetNo);
    const bad: [string, unknown][] = [
      ['empty', ''],
      ['not text', 42],
      ['random text', 'hello world'],
      ['wrong prefix', good.replace('AXLEOPS-FLEET', 'AXLEOPS-OTHER')],
      ['bad org id', `AXLEOPS-FLEET:not-a-uuid:${c.machine.id}:${c.machine.fleetNo}`],
      ['bad machine id', `AXLEOPS-FLEET:${admin.orgId}:123:${c.machine.fleetNo}`],
      ['missing fleet no', `AXLEOPS-FLEET:${admin.orgId}:${c.machine.id}:`],
      ['too few parts', `AXLEOPS-FLEET:${admin.orgId}`],
      ['too long', `${good}${'x'.repeat(600)}`],
      ['other company id', fleetQr(other.orgId, c.machine.id, c.machine.fleetNo)],
      ['machine of another company', fleetQr(admin.orgId, theirs.id, theirs.fleetNo)],
      ['machine unknown', fleetQr(admin.orgId, randomUUID(), c.machine.fleetNo)],
      ['wrong fleet no', fleetQr(admin.orgId, c.machine.id, 'SOMETHING-ELSE')],
      ['gate QR with 5 parts', `AXLEOPS-GATE:${admin.orgId}:${randomUUID()}:GP-1:extra`],
      ['gate pass unknown', `AXLEOPS-GATE:${admin.orgId}:${randomUUID()}:GP-1`],
    ];
    for (const [label, payload] of bad) {
      const res = await resolve(admin, payload);
      expect([422, 404], label).toContain(res.status);
      if (typeof payload === 'string' && payload !== '') expect(res.body.code, label).toBe(label === 'too long' ? 'VALIDATION_ERROR' : 'QR_INVALID'); // over-long input fails schema validation first
    }
    // A QR printed before the fleet number changed is stale.
    const stale = fleetQr(admin.orgId, c.machine.id, c.machine.fleetNo);
    await h.sql(admin, "UPDATE machines SET fleet_no = fleet_no || '-R' WHERE id = $1", [c.machine.id]);
    const staleRes = await resolve(admin, stale);
    expect(staleRes.status).toBe(422);
    expect(staleRes.body.code).toBe('QR_INVALID');
    await h.sql(admin, "UPDATE machines SET fleet_no = $2 WHERE id = $1", [c.machine.id, c.machine.fleetNo]);

    // The same payloads cannot be used to create a pass: no pass and no movement results.
    const body = (extra: object) => outBody(c, extra);
    const attempts = [
      { captureMethod: 'QR' }, // no payload
      { captureMethod: 'QR', qrPayload: 'garbage' },
      { captureMethod: 'QR', qrPayload: fleetQr(other.orgId, c.machine.id, c.machine.fleetNo) },
      { captureMethod: 'QR', qrPayload: fleetQr(admin.orgId, theirs.id, theirs.fleetNo) },
      { captureMethod: 'QR', qrPayload: fleetQr(admin.orgId, c.machine.id, 'WRONG') },
      { captureMethod: 'QR', qrPayload: `AXLEOPS-GATE:${admin.orgId}:${randomUUID()}:GP-1` },
      { captureMethod: 'Manual', qrPayload: good },
    ];
    for (const extra of attempts) {
      const res = await newPass(h, security, body(extra));
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    expect(await passes(c.machine.id)).toHaveLength(0);
    expect(await movements(c.machine.id)).toHaveLength(0);
  });

  it('a valid QR capture stores the payload and scan time; the manual fallback needs no QR', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const qr = fleetQr(admin.orgId, c.machine.id, c.machine.fleetNo);
    const scannedAt = '2030-03-01T08:00:00.000Z';
    const res = await newPass(h, security, outBody(c, { captureMethod: 'QR', qrPayload: qr, scannedAt }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ captureMethod: 'QR', qrPayload: qr, scannedAt, status: 'Pending', movement: null });
    const lookup = await resolve(security, qr);
    expect(lookup.body.openPasses.map((p: { id: string }) => p.id)).toEqual([res.body.id]);
    // The pass QR resolves to the exact pass; a changed reference does not.
    const passQr = `AXLEOPS-GATE:${admin.orgId}:${res.body.id}:${res.body.reference}`;
    expect((await resolve(security, passQr)).body).toMatchObject({ kind: 'GATE_PASS', pass: { id: res.body.id }, candidateBooking: { id: c.booking.id } });
    expect((await resolve(security, `AXLEOPS-GATE:${admin.orgId}:${res.body.id}:GP-WRONG`)).body.code).toBe('QR_INVALID');
    expect((await resolve(other, passQr)).body.code).toBe('QR_INVALID');

    // Manual fallback on another machine.
    const m = await rentalChain(h, admin);
    const manual = await newPass(h, security, outBody(m, { captureMethod: 'Manual' }));
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ captureMethod: 'Manual', qrPayload: null, scannedAt: null });
  });

  it('refuses wrong machine/booking/note combinations and duplicate open passes without recording a movement', async () => {
    const c = await rentalChain(h, admin, { phase: ['WON'] });
    const spare = await newMachine(h, admin);
    const mismatch = await newPass(h, admin, outBody({ machine: spare, booking: c.booking }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.fieldErrors.machineId).toBe('booking_machine_mismatch');
    expect((await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_HIRE', bookingId: c.booking.id }))).body.fieldErrors.direction).toBe('purpose_mismatch');
    expect((await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE' }))).body.fieldErrors.bookingId).toBe('required');
    const notOut = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id }));
    expect(notOut.status).toBe(422);
    expect(notOut.body.fieldErrors.bookingId).toBe('not_on_hire');
    expect((await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'TRANSFER', bookingId: c.booking.id }))).status).toBe(422);
    const first = await newPass(h, admin, outBody(c));
    expect(first.status).toBe(201);
    const dup = await newPass(h, admin, outBody(c));
    expect(dup.status).toBe(409);
    expect(dup.body.fieldErrors.machineId).toBe('open_pass_exists');
    expect(await movements(c.machine.id)).toHaveLength(0);
    // Permission and tenant.
    expect((await newPass(h, other, outBody(c))).status).toBe(422);
    expect((await h.call(other, 'get', `/gate-passes/${first.body.id}`)).status).toBe(404);
    const driver = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
    expect((await newPass(h, driver, outBody(c))).status).toBe(403);
  });
});

describe('T16 pending passes have no side effects; completion happens once', () => {
  it('Pending and Approved leave booking, machine and quotation unchanged; Security cannot complete a Pending pass', async () => {
    const c = await rentalChain(h, admin);
    const pass = await newPass(h, security, outBody(c));
    expect(pass.status).toBe(201);
    const unchanged = async () => {
      expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ status: 'Allocated', departedAt: null, physicallyOccupied: false });
      expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('Available');
      expect(await quotationPhase(h, admin, c.quotation.id)).toBe('AWAITING');
      expect(await movements(c.machine.id)).toHaveLength(0);
    };
    await unchanged();
    const early = await completePass(h, security, pass.body.id);
    expect(early.status).toBe(422);
    expect(early.body.fieldErrors.status).toBe('approval_required');
    await unchanged();
    expect((await approve(security, pass.body)).status).toBe(403);
    const approved = await approve(supervisor, pass.body);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'Approved', approvedBy: supervisor.userId });
    await unchanged();
    // Approved passes are cancelled only with approval rights.
    expect((await h.change(security, 'post', `/gate-passes/${pass.body.id}/cancel`, approved.body.rowVersion, { reason: 'x' })).status).toBe(403);
  });

  it('completion records one movement with database time, starts hire (auto Won) and is idempotent under retries and races', async () => {
    const c = await rentalChain(h, admin);
    const pass = await newPass(h, security, outBody(c, { captureMethod: 'QR', qrPayload: fleetQr(admin.orgId, c.machine.id, c.machine.fleetNo), scannedAt: '2020-01-01T00:00:00.000Z' }));
    const approved = await approve(supervisor, pass.body);
    const key = randomUUID();
    const done = await completePass(h, security, pass.body.id, key);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ alreadyCompleted: false, pass: { status: 'Completed' }, booking: { status: 'On Hire' } });
    const movement = done.body.movement;
    expect(movement).toMatchObject({ timeSource: 'DATABASE', operatorUserId: security.userId, closesMovementId: null });
    // The scan time is kept separately from the crossing time.
    expect(done.body.pass.scannedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(new Date(movement.occurredAt).getTime()).toBeGreaterThan(new Date('2025-01-01').getTime());
    const booking = await getBooking(h, admin, c.booking.id);
    expect(booking.departedAt).toBe(movement.occurredAt);
    expect(booking).toMatchObject({ status: 'On Hire', physicallyOccupied: true });
    expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('On Hire');
    expect(await quotationPhase(h, admin, c.quotation.id)).toBe('WON');
    expect((await phaseHistory(h, admin, c.quotation.id)).at(-1)).toMatchObject({ toPhase: 'WON', source: 'ON_HIRE' });
    expect(approved.status).toBe(200);

    // Retries: same key replays, a new key returns the existing result, parallel calls do not duplicate.
    const replay = await completePass(h, security, pass.body.id, key);
    const again = await completePass(h, security, pass.body.id);
    const racing = await Promise.all(Array.from({ length: 3 }, () => completePass(h, security, pass.body.id)));
    expect(replay.body).toEqual(done.body);
    for (const r of [again, ...racing]) {
      expect(r.status).toBe(200);
      expect(r.body.alreadyCompleted).toBe(true);
      expect(r.body.movement.id).toBe(movement.id);
    }
    expect(await movements(c.machine.id)).toHaveLength(1);
    expect((await phaseHistory(h, admin, c.quotation.id)).filter((r) => r.toPhase === 'WON')).toHaveLength(1);
    expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ departedAt: movement.occurredAt, rowVersion: booking.rowVersion });
    expect((await h.change(admin, 'post', `/gate-passes/${pass.body.id}/cancel`, 99, { reason: 'late' })).status).toBe(409);
    const cancelled = await h.call(admin, 'get', `/gate-passes/${pass.body.id}`);
    expect(cancelled.body.status).toBe('Completed');
  });

  it('a Pending pass can be completed directly by a user who also holds approval rights (one transaction)', async () => {
    const c = await rentalChain(h, admin);
    const res = await gateOut(h, admin, c);
    expect(res.status).toBe(200);
    expect(res.body.pass).toMatchObject({ status: 'Completed', approvedBy: admin.userId });
  });

  it('Gate IN updates exactly the returning booking and its own collection note; one inspection; the machine is held', async () => {
    const c = await rentalChain(h, admin);
    const bystander = await rentalChain(h, admin, { customer: undefined });
    expect((await gateOut(h, admin, c)).status).toBe(200);
    expect((await gateOut(h, admin, bystander)).status).toBe(200);
    const cn = (await initiateCollection(h, admin, c.booking.id)).body.collectionNote;
    const bystanderCn = (await initiateCollection(h, admin, bystander.booking.id)).body.collectionNote;
    const out = (await h.sql<{ id: string }>(admin, "SELECT id FROM gate_movements WHERE machine_id = $1 AND direction = 'OUT'", [c.machine.id]))[0];

    // A collection note of another booking cannot be used.
    const wrongNote = await newPass(h, admin, gatePassBody(c.machine.id, {
      direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, collectionNoteId: bystanderCn.id,
    }));
    expect(wrongNote.status).toBe(422);
    expect(wrongNote.body.fieldErrors.collectionNoteId).toBe('booking_mismatch');

    const { pass, complete } = await gateIn(h, admin, c, cn.id);
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    const body = complete.body;
    expect(body.movement.closesMovementId).toBe(out.id);
    expect(body.booking).toMatchObject({ id: c.booking.id, status: 'Returned', returnedAt: body.movement.occurredAt });
    expect(body.inspection).toMatchObject({ status: 'Pending', bookingId: c.booking.id, inspectionType: 'Return Intake', checklistVersion: 'return-intake-v1' });
    const machine = await getMachine(h, admin, c.machine.id);
    expect(machine).toMatchObject({ operationalStatus: 'Available', readinessStatus: 'INTAKE_PENDING' }); // not immediately usable
    const note = (await h.call(admin, 'get', `/collection-notes/${cn.id}`)).body.collectionNote;
    expect(note).toMatchObject({ status: 'Collected', collectedMovementId: body.movement.id, collectedAt: body.movement.occurredAt });
    const booking = await getBooking(h, admin, c.booking.id);
    expect(booking).toMatchObject({ status: 'Returned', physicallyOccupied: false });
    // The other booking and its note are untouched.
    expect(await getBooking(h, admin, bystander.booking.id)).toMatchObject({ status: 'On Hire', returnedAt: null });
    expect((await h.call(admin, 'get', `/collection-notes/${bystanderCn.id}`)).body.collectionNote.status).toBe('Draft');

    // Retry: no second movement, inspection or note change.
    const retry = await Promise.all([completePass(h, admin, pass.id), completePass(h, admin, pass.id)]);
    for (const r of retry) expect(r.body).toMatchObject({ alreadyCompleted: true, inspection: { id: body.inspection.id } });
    expect(await h.sql(admin, 'SELECT 1 FROM inspections WHERE machine_id = $1', [c.machine.id])).toHaveLength(1);
    expect(await h.sql(admin, 'SELECT 1 FROM inspection_results WHERE inspection_id = $1', [body.inspection.id])).toHaveLength(31);
    expect(await movements(c.machine.id)).toHaveLength(2);
    // The machine is back, so a second return pass is refused.
    expect((await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id }))).status).toBe(422);
    // A new hire cannot start on the held machine.
    const again = await rentalChain(h, admin);
    await h.sql(admin, 'UPDATE machines SET readiness_status = $2 WHERE id = $1', [again.machine.id, 'INTAKE_PENDING']);
    expect((await startHire(h, admin, again.booking.id, again.booking.rowVersion)).body.fieldErrors.machineId).toBe('not_ready');
  });

  it('a Transfer moves the machine without touching quotations or bookings', async () => {
    const c = await rentalChain(h, admin);
    const pass = await newPass(h, admin, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'TRANSFER', destination: 'Sharjah branch' }));
    expect(pass.status, JSON.stringify(pass.body)).toBe(201);
    const done = await completePass(h, admin, pass.body.id);
    expect(done.status).toBe(200);
    expect(done.body.booking).toBeNull();
    expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ status: 'Allocated', departedAt: null });
    expect(await quotationPhase(h, admin, c.quotation.id)).toBe('AWAITING');
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ operationalStatus: 'Available' });
  });
});

describe('T17 intake failure, pass and authorised, evidence-based release', () => {
  async function returned() {
    const c = await rentalChain(h, admin);
    expect((await gateOut(h, admin, c)).status).toBe(200);
    const { complete } = await gateIn(h, admin, c);
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    return { c, inspection: complete.body.inspection as { id: string; rowVersion: number } };
  }
  const submit = (a: Actor, id: string, version: number) => h.change(a, 'post', `/inspections/${id}/submit`, version, {});
  const release = (a: Actor, id: string, version: number, body: object) => h.change(a, 'post', `/inspections/${id}/release-hold`, version, body);
  const reload = async (id: string) => (await h.call(checker, 'get', `/inspections/${id}`)).body;

  it('cannot be submitted incomplete; a critical Fail blocks the machine and the hold persists until an authorised, evidenced release', async () => {
    const { c, inspection } = await returned();
    const incomplete = await submit(checker, inspection.id, inspection.rowVersion);
    expect(incomplete.status).toBe(422);
    expect(Object.keys(incomplete.body.fieldErrors).length).toBeGreaterThan(10);

    const critical = await h.change(checker, 'patch', `/inspections/${inspection.id}/results`, inspection.rowVersion, { results: [{ itemKey: 's1_2', result: 'N/A' }] });
    expect(critical.status).toBe(422);
    expect(critical.body.fieldErrors.s1_2).toBe('not_applicable_not_allowed');

    const answered = await answerInspection(h, checker, inspection.id, ['s1_2']);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const failed = await submit(checker, inspection.id, answered.body.rowVersion);
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: 'Failed', overallResult: 'Fail', inspectorUserId: checker.userId });
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ readinessStatus: 'BLOCKED' });
    expect((await h.change(checker, 'patch', `/inspections/${inspection.id}/results`, failed.body.rowVersion, { results: [{ itemKey: 's1_1', result: 'Pass' }] })).status).toBe(422); // closed

    // The checker cannot release; the workshop manager needs a reason and reviewed evidence.
    expect((await release(checker, inspection.id, failed.body.rowVersion, { reason: 'ok', evidenceReviewed: true })).status).toBe(403);
    expect((await release(workshop, inspection.id, failed.body.rowVersion, { evidenceReviewed: true })).status).toBe(422); // reason
    const noEvidence = await release(workshop, inspection.id, failed.body.rowVersion, { reason: 'Looks fine' });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.fieldErrors.evidence).toBe('required');
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ readinessStatus: 'BLOCKED' });
    expect((await reload(inspection.id)).holdReleasedAt).toBeNull();
    // Cannot book it out while held.
    const next = await h.create(admin, '/bookings', bookingBody(c.machine.id, c.customer.id, { status: 'Reserved', startDate: '2033-01-01', endDate: '2033-01-02' }));
    expect(next.status).toBe(422);

    // Evidence: attach a photo through the evidence API, then release.
    const photo = await h.upload(checker, pngBytes(), 'damage.png', 'image/png');
    expect(photo.status).toBe(201);
    const ev = await h.create(checker, '/evidence', { fileId: photo.body.id, inspectionId: inspection.id, photoRole: 'Damage' });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    expect((await h.call(workshop, 'get', `/evidence?ownerType=inspection&ownerId=${inspection.id}`)).body.total).toBe(1);
    expect((await h.download(admin, photo.body.id)).status).toBe(200);
    const fresh = await reload(inspection.id);
    expect(fresh.evidenceCount).toBe(1);
    const released = await release(workshop, inspection.id, fresh.rowVersion, { reason: 'Hose replaced, photos reviewed' });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(released.body.machine).toMatchObject({ readinessStatus: 'READY', released: true, blockers: [] });
    expect(released.body.inspection).toMatchObject({ holdReleasedBy: workshop.userId, holdReleaseReason: 'Hose replaced, photos reviewed' });
    expect(released.body.inspection.holdReleasedAt).toEqual(expect.any(String));
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ readinessStatus: 'READY' });
    expect((await h.audit(admin, 'inspection.hold_released')).at(-1)).toMatchObject({ actor_user_id: workshop.userId, reason: 'Hose replaced, photos reviewed' });
    expect((await release(workshop, inspection.id, released.body.inspection.rowVersion, { reason: 'again' })).body.fieldErrors.status).toBe('already_released');
  });

  it('a passed intake does not release the hold by itself; release needs permission and a reason; unrelated blockers stay', async () => {
    const { c, inspection } = await returned();
    const early = await release(workshop, inspection.id, inspection.rowVersion, { reason: 'Too early' });
    expect(early.status).toBe(422);
    expect(early.body.fieldErrors.status).toBe('not_submitted');

    const answered = await answerInspection(h, checker, inspection.id);
    const passed = await submit(checker, inspection.id, answered.body.rowVersion);
    expect(passed.status).toBe(200);
    expect(passed.body).toMatchObject({ status: 'Passed', overallResult: 'Pass' });
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ readinessStatus: 'INTAKE_PENDING', operationalStatus: 'Available' });

    expect((await release(checker, inspection.id, passed.body.rowVersion, { reason: 'self' })).status).toBe(403);
    expect((await release(workshop, inspection.id, passed.body.rowVersion, { reason: '   ' })).status).toBe(422);
    // An unrelated blocking restriction (the machine went into the workshop) is preserved.
    await h.sql(admin, "UPDATE machines SET operational_status = 'In Workshop' WHERE id = $1", [c.machine.id]);
    const held = await release(workshop, inspection.id, passed.body.rowVersion, { reason: 'Intake passed' });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    expect(held.body.machine).toMatchObject({ readinessStatus: 'INTAKE_PENDING', released: false, blockers: ['operational_status:In Workshop'] });
    expect(await getMachine(h, admin, c.machine.id)).toMatchObject({ readinessStatus: 'INTAKE_PENDING' });
  });

  it('a passed intake releases to READY, after which the machine can be booked and dispatched again', async () => {
    const { c, inspection } = await returned();
    const answered = await answerInspection(h, checker, inspection.id);
    const passed = await submit(checker, inspection.id, answered.body.rowVersion);
    const released = await release(workshop, inspection.id, passed.body.rowVersion, { reason: 'Intake passed, machine clean' });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(released.body.machine).toMatchObject({ readinessStatus: 'READY', released: true });
    const next = await rentalChain(h, admin);
    // Reuse the released machine for a new hire.
    const booking = await h.create(admin, '/bookings', bookingBody(c.machine.id, next.customer.id, {
      hireAgreementId: next.agreement.id, status: 'Allocated', startDate: '2034-01-01', endDate: '2034-01-31',
    }));
    expect(booking.status, JSON.stringify(booking.body)).toBe(422); // the agreement already has its one unit allocated to another machine
    const spare = await h.create(admin, '/bookings', bookingBody(c.machine.id, c.customer.id, {
      hireAgreementId: c.agreement.id, status: 'Allocated', startDate: '2034-01-01', endDate: '2034-01-31',
    }));
    expect(spare.status, JSON.stringify(spare.body)).toBe(201);
    expect((await startHire(h, admin, spare.body.id, spare.body.rowVersion)).status).toBe(200);
  });
});
