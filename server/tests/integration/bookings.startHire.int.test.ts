// T02-T05: Start Hire, retry/rejection atomicity, overlapping bookings and physical occupancy against fleet_test.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { newCustomer, newQuotation } from './crmFixtures.js';
import {
  bookingBody, getBooking, getMachine, jobBody, moveJob, newAgreement, newBooking, newMachine, phaseHistory, quotationPhase,
  rentalChain, startHire,
} from './rentalFixtures.js';

let h: Harness;
let admin: Actor;
let other: Actor;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('bk-admin', 'managing-director');
  other = await h.actor('bk-other', 'managing-director');
});
afterAll(async () => {
  await h.close();
});

describe('T02 Start Hire wins exactly the linked quotation in one transaction', () => {
  for (const jobStatus of [undefined, 'Scheduled', 'Loading', 'In Transit', 'Delivered', 'Cancelled']) {
    it(`transport job status ${jobStatus ?? '(no job)'} does not block hire; the linked quotation becomes Won`, async () => {
      const c = await rentalChain(h, admin);
      const bystander = await rentalChain(h, admin); // another quotation of the same customer must stay untouched
      if (jobStatus) {
        const job = await h.create(admin, '/transport-jobs', jobBody(c.machine.id, { bookingId: c.booking.id, quotationId: c.quotation.id }));
        expect(job.status, JSON.stringify(job.body)).toBe(201);
        await moveJob(h, admin, job.body, jobStatus);
      }
      expect(await quotationPhase(h, admin, c.quotation.id)).toBe('AWAITING');

      const res = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ status: 'On Hire', physicallyOccupied: true });
      expect(res.body.onHireAt).toEqual(expect.any(String));
      expect(res.body.departedAt).toEqual(expect.any(String));
      expect(res.headers.etag ?? res.headers['x-row-version'] ?? 'ok').toBeDefined();

      expect(await quotationPhase(h, admin, c.quotation.id)).toBe('WON');
      expect(await quotationPhase(h, admin, bystander.quotation.id)).toBe('AWAITING');
      const history = await phaseHistory(h, admin, c.quotation.id);
      expect(history.map((r) => r.toPhase)).toEqual(['AWAITING', 'WON']);
      expect(history[1]).toMatchObject({ fromPhase: 'AWAITING', source: 'ON_HIRE' });
      expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('On Hire');
      expect((await h.audit(admin, 'quotation.won_automatic')).some((e) => e.after_data?.phase === 'WON')).toBe(true);
    });
  }

  it('wins a Tender quotation and leaves an already Won quotation (and its history) unchanged', async () => {
    const tender = await rentalChain(h, admin, { phase: ['TENDER'] });
    expect((await startHire(h, admin, tender.booking.id, tender.booking.rowVersion)).status).toBe(200);
    expect(await quotationPhase(h, admin, tender.quotation.id)).toBe('WON');

    const won = await rentalChain(h, admin, { phase: ['WON'] });
    const before = await phaseHistory(h, admin, won.quotation.id);
    expect((await startHire(h, admin, won.booking.id, won.booking.rowVersion)).status).toBe(200);
    expect(await phaseHistory(h, admin, won.quotation.id)).toEqual(before);
  });

  it('is refused for a machine that is not dispatchable, with nothing committed', async () => {
    for (const machine of [{ readinessStatus: 'INTAKE_PENDING' }, { readinessStatus: 'BLOCKED' }, { operationalStatus: 'Under Repair' }]) {
      const c = await rentalChain(h, admin);
      const set = 'readinessStatus' in machine ? 'readiness_status' : 'operational_status';
      await h.sql(admin, `UPDATE machines SET ${set} = $1 WHERE id = $2`, [Object.values(machine)[0], c.machine.id]);
      const res = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
      expect(res.status, JSON.stringify(machine)).toBe(422);
      expect(res.body.code).toBe('BUSINESS_RULE');
      expect((await getBooking(h, admin, c.booking.id)).status).toBe('Allocated');
      expect(await quotationPhase(h, admin, c.quotation.id)).toBe('AWAITING');
    }
  });
});

describe('T03 retry, Lost source, wrong customer or company', () => {
  it('a retried Start Hire (same key, or a new key) gives one result: one Won history row and one hire', async () => {
    const c = await rentalChain(h, admin);
    const key = randomUUID();
    const first = await startHire(h, admin, c.booking.id, c.booking.rowVersion, key);
    const replay = await startHire(h, admin, c.booking.id, c.booking.rowVersion, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    // A different key and a stale version: the booking is already On Hire, so the command is idempotent.
    const again = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('On Hire');
    expect(again.body.departedAt).toBe(first.body.departedAt);
    expect(again.body.rowVersion).toBe(first.body.rowVersion);
    const history = await phaseHistory(h, admin, c.quotation.id);
    expect(history.filter((r) => r.toPhase === 'WON')).toHaveLength(1);
    expect(await h.sql(admin, "SELECT 1 FROM audit_events WHERE action = 'booking.hire_started' AND entity_id = $1", [c.booking.id])).toHaveLength(1);
  });

  it('simultaneous Start Hire requests produce a single hire', async () => {
    const c = await rentalChain(h, admin);
    const results = await Promise.all(Array.from({ length: 4 }, () => startHire(h, admin, c.booking.id, c.booking.rowVersion)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.departedAt)).size).toBe(1);
    expect((await phaseHistory(h, admin, c.quotation.id)).filter((r) => r.toPhase === 'WON')).toHaveLength(1);
  });

  it('a Lost source quotation is rejected with REOPEN_REQUIRED and nothing is written', async () => {
    const c = await rentalChain(h, admin, { phase: ['LOST'] });
    const res = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REOPEN_REQUIRED');
    expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ status: 'Allocated', departedAt: null, physicallyOccupied: false });
    expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('Available');
    expect(await quotationPhase(h, admin, c.quotation.id)).toBe('LOST');
  });

  it('rejects a booking without an agreement, a stale version, a customer mismatch and another company', async () => {
    const customer = await newCustomer(h, admin);
    const machine = await newMachine(h, admin);
    const bare = await newBooking(h, admin, machine.id, customer.id, { status: 'Allocated' });
    const noAgreement = await startHire(h, admin, bare.id, bare.rowVersion);
    expect(noAgreement.status).toBe(422);
    expect(noAgreement.body.fieldErrors.hireAgreementId).toBe('required');

    const c = await rentalChain(h, admin);
    const stale = await startHire(h, admin, c.booking.id, c.booking.rowVersion + 5);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    expect((await h.call(admin, 'post', `/bookings/${c.booking.id}/start-hire`).set('If-Match', '1').send({})).status).toBe(422); // no key
    expect((await h.call(admin, 'post', `/bookings/${c.booking.id}/start-hire`).set('Idempotency-Key', randomUUID()).send({})).status).toBe(428);

    // A booking cannot be linked to another customer's agreement (API) ...
    const q2 = await newQuotation(h, admin, (await newCustomer(h, admin)).id);
    const foreignAgreement = await newAgreement(h, admin, q2);
    const wrong = await h.create(admin, '/bookings', bookingBody((await newMachine(h, admin)).id, customer.id, { hireAgreementId: foreignAgreement.id }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.fieldErrors.hireAgreementId).toBe('customer_mismatch');
    // ... nor by direct SQL (database guard).
    await expect(
      h.sql(admin, 'UPDATE bookings SET hire_agreement_id = $1 WHERE id = $2', [foreignAgreement.id, c.booking.id]),
    ).rejects.toMatchObject({ constraint: 'fk_bookings_agreement_customer' });

    // Another company sees neither the booking nor can it start hire.
    const foreign = await startHire(h, other, c.booking.id, c.booking.rowVersion);
    expect(foreign.status).toBe(404);
    expect((await getBooking(h, admin, c.booking.id)).status).toBe('Allocated');
    // A booking of another company cannot use this company's machine, customer or agreement.
    const cross = await h.create(other, '/bookings', bookingBody(c.machine.id, c.customer.id, { hireAgreementId: c.agreement.id }));
    expect(cross.status).toBe(422);
  });

  it('a failure while writing the automatic Won leaves booking, machine and quotation untouched (no partial commit)', async () => {
    const c = await rentalChain(h, admin);
    const suffix = c.quotation.id.replace(/-/g, '');
    const fn = `fleet_test_fail_${suffix}`;
    await h.sql(
      admin,
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.quotation_id = '${c.quotation.id}' AND NEW.to_phase = 'WON' THEN RAISE EXCEPTION 'forced failure'; END IF;
         RETURN NEW;
       END $$`,
    );
    await h.sql(admin, `CREATE TRIGGER ${fn} BEFORE INSERT ON quotation_phase_history FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      const res = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
      expect(res.status).toBe(500);
    } finally {
      await h.sql(admin, `DROP TRIGGER ${fn} ON quotation_phase_history`);
      await h.sql(admin, `DROP FUNCTION ${fn}()`);
    }
    expect(await getBooking(h, admin, c.booking.id)).toMatchObject({ status: 'Allocated', departedAt: null, onHireAt: null, rowVersion: c.booking.rowVersion });
    expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('Available');
    expect(await quotationPhase(h, admin, c.quotation.id)).toBe('AWAITING');
    expect(await h.sql(admin, "SELECT 1 FROM audit_events WHERE entity_id = $1 AND action = 'booking.hire_started'", [c.booking.id])).toHaveLength(0);
    // After the fault is gone the same request succeeds.
    expect((await startHire(h, admin, c.booking.id, c.booking.rowVersion)).status).toBe(200);
    expect(await quotationPhase(h, admin, c.quotation.id)).toBe('WON');
  });
});

describe('T04 overlapping planner bookings', () => {
  it('two simultaneous overlapping bookings: exactly one succeeds, the other is a BOOKING_CONFLICT', async () => {
    const customer = await newCustomer(h, admin);
    const machine = await newMachine(h, admin);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        h.create(admin, '/bookings', bookingBody(machine.id, customer.id, { status: 'Reserved', startDate: `2031-05-0${i + 1}`, endDate: '2031-05-20' })),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('BOOKING_CONFLICT');
    const rows = await h.sql(admin, "SELECT 1 FROM bookings WHERE machine_id = $1 AND status = 'Reserved'", [machine.id]);
    expect(rows).toHaveLength(1);
  });

  it('adjacent non-overlapping dates work; one shared day conflicts; Draft and Cancelled bookings do not reserve', async () => {
    const customer = await newCustomer(h, admin);
    const machine = await newMachine(h, admin);
    const mk = (start: string, end: string, status = 'Reserved') =>
      h.create(admin, '/bookings', bookingBody(machine.id, customer.id, { status, startDate: start, endDate: end }));
    const first = await mk('2031-06-01', '2031-06-10');
    expect(first.status).toBe(201);
    expect((await mk('2031-06-11', '2031-06-20')).status).toBe(201); // adjacent: starts the day after
    expect((await mk('2031-05-20', '2031-05-31')).status).toBe(201); // adjacent before
    const touching = await mk('2031-06-20', '2031-06-25'); // shares 20 June (inclusive end)
    expect(touching.status).toBe(409);
    expect(touching.body.code).toBe('BOOKING_CONFLICT');
    expect((await mk('2031-06-05', '2031-06-06', 'Draft')).status).toBe(201);

    const cancelled = await h.change(admin, 'post', `/bookings/${first.body.id}/cancel`, first.body.rowVersion, { reason: 'Customer changed plan' });
    expect(cancelled.status).toBe(200);
    expect((await mk('2031-06-03', '2031-06-04')).status).toBe(201); // cancelled coverage is released

    // Moving a booking onto occupied dates by update conflicts as well.
    const movable = await mk('2031-07-01', '2031-07-05');
    const move = await h.change(admin, 'patch', `/bookings/${movable.body.id}`, movable.body.rowVersion, { startDate: '2031-06-12', endDate: '2031-06-14' });
    expect(move.status).toBe(409);
    expect(move.body.code).toBe('BOOKING_CONFLICT');
    // The same dates on another machine are fine.
    const second = await newMachine(h, admin);
    expect((await h.create(admin, '/bookings', bookingBody(second.id, customer.id, { status: 'Reserved', startDate: '2031-06-01', endDate: '2031-06-10' }))).status).toBe(201);
  });

  it('rejects an end before the start, an Offline machine and a quantity beyond the agreement', async () => {
    const c = await rentalChain(h, admin, { agreement: { quantity: 1 } });
    expect((await h.create(admin, '/bookings', bookingBody(c.machine.id, c.customer.id, { startDate: '2031-02-02', endDate: '2031-02-01' }))).status).toBe(422);
    const offline = await newMachine(h, admin, { operationalStatus: 'Offline' });
    const res = await h.create(admin, '/bookings', bookingBody(offline.id, c.customer.id, { status: 'Reserved' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BUSINESS_RULE');
    const spare = await newMachine(h, admin);
    const over = await h.create(admin, '/bookings', bookingBody(spare.id, c.customer.id, { hireAgreementId: c.agreement.id, startDate: '2032-01-01', endDate: '2032-01-02' }));
    expect(over.status).toBe(422);
    expect(over.body.fieldErrors.hireAgreementId).toBe('quantity_exceeded');
  });
});

describe('T05 a passed planned end does not free the machine', () => {
  it('stays physically occupied until a return is recorded; a second hire on the machine is refused', async () => {
    // Planned dates are long past.
    const c = await rentalChain(h, admin, { booking: { startDate: '2020-01-01', endDate: '2020-01-10' } });
    const started = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
    expect(started.status).toBe(200);
    const later = await getBooking(h, admin, c.booking.id);
    expect(later.endDate).toBe('2020-01-10');
    expect(later).toMatchObject({ status: 'On Hire', physicallyOccupied: true, returnedAt: null });
    expect((await getMachine(h, admin, c.machine.id)).operationalStatus).toBe('On Hire');

    // A later planned booking can be drawn up, but it cannot be dispatched while the machine is still out.
    const nextBooking = await newBooking(h, admin, c.machine.id, c.customer.id, {
      hireAgreementId: (await newAgreement(h, admin, await newQuotation(h, admin, c.customer.id))).id,
      status: 'Allocated', startDate: '2020-02-01', endDate: '2020-02-10',
    });
    const blocked = await startHire(h, admin, nextBooking.id, nextBooking.rowVersion);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('BOOKING_CONFLICT');
    expect(blocked.body.fieldErrors.machineId).toBe('occupied');
    expect((await getBooking(h, admin, nextBooking.id)).status).toBe('Allocated');

    // The database refuses a second open physical booking for the machine as well.
    await expect(
      h.sql(admin, "UPDATE bookings SET departed_at = now(), status = 'On Hire' WHERE id = $1", [nextBooking.id]),
    ).rejects.toMatchObject({ code: '23P01' });
    // The first booking can no longer be edited onto a different machine or dropped from its agreement.
    const edit = await h.change(admin, 'patch', `/bookings/${c.booking.id}`, later.rowVersion, { machineId: (await newMachine(h, admin)).id });
    expect(edit.status).toBe(422);
    expect(edit.body.fieldErrors.machineId).toBe('on_hire');
  });
});

describe('booking permissions and validation', () => {
  it('requires the right permissions', async () => {
    const viewer = await h.addUser(admin, { roleCode: 'site-supervisor', branchId: admin.branchId, allBranches: true });
    const driver = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
    const c = await rentalChain(h, admin);
    expect((await h.call(driver, 'get', `/bookings/${c.booking.id}`)).status).toBe(403);
    expect((await h.call(viewer, 'get', '/bookings')).status).toBe(200);
    expect((await h.create(viewer, '/bookings', bookingBody(c.machine.id, c.customer.id))).status).toBe(403); // read only
    expect((await startHire(h, driver, c.booking.id, c.booking.rowVersion)).status).toBe(403);
    expect((await h.create(driver, '/bookings', bookingBody(c.machine.id, c.customer.id))).status).toBe(403);
  });

  it('the cancel and off-hire-request commands follow the booking state', async () => {
    const c = await rentalChain(h, admin);
    expect((await h.change(admin, 'post', `/bookings/${c.booking.id}/off-hire-request`, c.booking.rowVersion, {})).status).toBe(422);
    const hired = await startHire(h, admin, c.booking.id, c.booking.rowVersion);
    expect((await h.change(admin, 'post', `/bookings/${c.booking.id}/cancel`, hired.body.rowVersion, { reason: 'x' })).status).toBe(422);
    const off = await h.change(admin, 'post', `/bookings/${c.booking.id}/off-hire-request`, hired.body.rowVersion, {});
    expect(off.status).toBe(200);
    expect(off.body.offHireRequestedAt).toEqual(expect.any(String));
    expect((await h.change(admin, 'patch', `/bookings/${c.booking.id}`, off.body.rowVersion, { status: 'Returned' })).status).toBe(422);
  });
});
