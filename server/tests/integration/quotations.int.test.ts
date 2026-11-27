// Task 13.10: quotations API including tenant isolation, branch scope and own-records (T18).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { changePhase, newCustomer, newQuotation } from './crmFixtures.js';

let h: Harness;
let admin: Actor; // managing-director
let other: Actor; // another company
let reader: Actor; // finance: quotations.read only
let plain: Actor; // driver: nothing
let customerId: string;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('qt-admin', 'managing-director');
  other = await h.actor('qt-other', 'managing-director');
  reader = await h.addUser(admin, { roleCode: 'finance', branchId: admin.branchId, allBranches: true });
  plain = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
  customerId = (await newCustomer(h, admin)).id;
});

afterAll(async () => {
  await h.close();
});

describe('create', () => {
  it('requires an Idempotency-Key, starts AWAITING, numbers it, writes the first history row and replays', async () => {
    const body = { customerId, opportunity: 'Crane hire', amount: '2500.5', crmHaReference: 'HA-2026-00009' };
    expect((await h.call(admin, 'post', '/quotations').send(body)).status).toBe(422);

    const key = randomUUID();
    const first = await h.create(admin, '/quotations', body, key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      phase: 'AWAITING', amount: '2500.500000', currencyCode: 'AED', rowVersion: 1, salesUserId: admin.userId, wonAt: null,
      crmHaReference: 'HA-2026-00009',
    });
    expect(first.body.quotationNo).toMatch(/^QT-\d{4}\d{4,}$/);

    const hist = await h.sql<{ from_phase: string | null; to_phase: string; source: string; actor_user_id: string }>(
      admin, 'SELECT from_phase, to_phase, source, actor_user_id FROM quotation_phase_history WHERE quotation_id = $1', [first.body.id],
    );
    expect(hist).toEqual([{ from_phase: null, to_phase: 'AWAITING', source: 'MANUAL', actor_user_id: admin.userId }]);

    const replay = await h.create(admin, '/quotations', body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await h.create(admin, '/quotations', { ...body, amount: '1' }, key);
    expect(conflict.status).toBe(409);
    const second = await newQuotation(h, admin, customerId);
    expect(second.quotationNo).not.toBe(first.body.quotationNo);
    expect((await h.audit(admin, 'quotation.created')).length).toBeGreaterThanOrEqual(2);
  });

  it('validates currency and amount exactly', async () => {
    for (const bad of [
      { amount: '-1' }, { amount: 'abc' }, { amount: '1e3' }, { amount: '' }, { currencyCode: 'aed' }, { currencyCode: 'AEDX' },
      { currencyCode: 'AE' }, { extra: 1 }, { customerId: 'nope' }, { validUntil: '2026-02-30' },
    ]) {
      expect((await h.create(admin, '/quotations', { customerId, opportunity: 'x', amount: '1', ...bad })).status, JSON.stringify(bad)).toBe(422);
    }
    const ok = await h.create(admin, '/quotations', { customerId, opportunity: 'x', amount: 0, currencyCode: 'USD' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ amount: '0.000000', currencyCode: 'USD' });
    expect((await h.change(admin, 'patch', `/quotations/${ok.body.id}`, 1, { amount: '-5' })).status).toBe(422);
    expect((await h.change(admin, 'patch', `/quotations/${ok.body.id}`, 1, { currencyCode: 'usd' })).status).toBe(422);
  });

  it('gives distinct numbers to concurrent creates', async () => {
    const o = await h.actor('qt-concurrent', 'managing-director');
    const c = await newCustomer(h, o);
    const results = await Promise.all(Array.from({ length: 8 }, () => h.create(o, '/quotations', { customerId: c.id, opportunity: 'x', amount: '1' })));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const numbers = results.map((r) => r.body.quotationNo as string);
    expect(new Set(numbers).size).toBe(8);
  });
});

describe('update, list and filters', () => {
  it('updates with If-Match, rejects stale and missing versions and audits the change', async () => {
    const q = await newQuotation(h, admin, customerId);
    expect((await h.call(admin, 'patch', `/quotations/${q.id}`).send({ opportunity: 'x' })).status).toBe(428);
    const upd = await h.change(admin, 'patch', `/quotations/${q.id}`, 1, { opportunity: 'Renamed', amount: '1234.5', notes: 'n' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ opportunity: 'Renamed', amount: '1234.500000', rowVersion: 2, phase: 'AWAITING' });
    expect(upd.headers.etag).toBe('"2"');
    expect((await h.change(admin, 'patch', `/quotations/${q.id}`, 1, { notes: 'stale' })).body.code).toBe('STALE_VERSION');
    // The phase is changed only through the phase endpoint.
    expect((await h.change(admin, 'patch', `/quotations/${q.id}`, 2, { phase: 'WON' })).status).toBe(422);
    const events = await h.audit(admin, 'quotation.updated');
    expect(events.some((e) => (e.after_data as { opportunity?: string }).opportunity === 'Renamed')).toBe(true);
  });

  it('filters by phase, customer, branch, sales user and number, and paginates', async () => {
    const o = await h.actor('qt-list', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const c1 = await newCustomer(h, o, 'One');
    const c2 = await newCustomer(h, o, 'Two');
    const a = await newQuotation(h, o, c1.id, { opportunity: 'Alpha 100%', branchId: o.branchId });
    const b = await newQuotation(h, o, c2.id, { opportunity: 'Beta', branchId: branch2 });
    await newQuotation(h, o, c2.id, { opportunity: 'Gamma' });
    const t = await changePhase(h, o, b.id, 1, { toPhase: 'TENDER' });
    expect(t.status).toBe(200);

    const all = await h.call(o, 'get', '/quotations?pageSize=2&sort=createdAt');
    expect(all.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(all.body.items).toHaveLength(2);
    expect((await h.call(o, 'get', '/quotations?pageSize=2&page=2&sort=createdAt')).body.items).toHaveLength(1);
    const ids = async (qs: string) => ((await h.call(o, 'get', `/quotations?${qs}`)).body.items as { id: string }[]).map((x) => x.id);
    expect(await ids('phase=TENDER')).toEqual([b.id]);
    expect(await ids(`customerId=${c1.id}`)).toEqual([a.id]);
    expect(await ids(`branchId=${branch2}`)).toEqual([b.id]);
    expect(await ids(`salesUserId=${o.userId}`)).toHaveLength(3);
    expect(await ids(`salesUserId=${randomUUID()}`)).toEqual([]);
    expect(await ids(`number=${encodeURIComponent(a.quotationNo)}`)).toEqual([a.id]);
    expect(await ids(`q=${encodeURIComponent('100%')}`)).toEqual([a.id]);
    expect((await h.call(o, 'get', '/quotations?phase=NOPE')).status).toBe(422);
    expect((await h.call(o, 'get', '/quotations?sort=password')).status).toBe(422);
  });
});

describe('IMMUTABLE_FIELD once a hire agreement exists', () => {
  it('rejects a changed customer or amount, allows other edits and re-sent values, and lifts after cancellation', async () => {
    const c2 = await newCustomer(h, admin);
    const q = await newQuotation(h, admin, customerId, { amount: '100' });
    const agreement = await h.create(admin, '/hire-agreements', {
      quotationId: q.id, customerId, equipmentName: 'Boom', equipmentModel: 'B1', serialNumber: 'S1', deliveryLocation: 'Site',
      hireStartDate: '2026-01-01', hireEndDate: '2026-02-01', monthlyRental: '100', paymentTerms: '30 days', paymentMethod: 'Cheque',
    });
    expect(agreement.status).toBe(201);

    const amount = await h.change(admin, 'patch', `/quotations/${q.id}`, 1, { amount: '101' });
    expect(amount.status).toBe(422);
    expect(amount.body).toMatchObject({ code: 'IMMUTABLE_FIELD', fieldErrors: { amount: 'immutable' } });
    const cust = await h.change(admin, 'patch', `/quotations/${q.id}`, 1, { customerId: c2.id });
    expect(cust.body).toMatchObject({ code: 'IMMUTABLE_FIELD', fieldErrors: { customerId: 'immutable' } });
    // The same values and non-commercial fields are fine.
    const same = await h.change(admin, 'patch', `/quotations/${q.id}`, 1, { amount: '100.000', customerId, notes: 'fine' });
    expect(same.status).toBe(200);

    const cancelled = await h.change(admin, 'patch', `/hire-agreements/${agreement.body.id}`, 1, { status: 'Cancelled' });
    expect(cancelled.status).toBe(200);
    expect((await h.change(admin, 'patch', `/quotations/${q.id}`, 2, { amount: '101' })).status).toBe(200);
  });
});

describe('own-records restriction for sales roles', () => {
  it('lets a restricted sales executive see and change only quotations assigned to them', async () => {
    const o = await h.actor('qt-own', 'managing-director');
    const exec1 = await h.addUser(o, { roleCode: 'sales-executive', branchId: o.branchId, allBranches: true });
    const exec2 = await h.addUser(o, { roleCode: 'sales-executive', branchId: o.branchId, allBranches: true, sameRoleAs: exec1 });
    const manager = await h.addUser(o, { roleCode: 'sales-manager', branchId: o.branchId, allBranches: true });
    const c = await newCustomer(h, o);
    const mine = await newQuotation(h, exec1, c.id, { opportunity: 'exec1 own' });
    const theirs = await newQuotation(h, exec2, c.id, { opportunity: 'exec2 own' });
    const assigned = await newQuotation(h, o, c.id, { opportunity: 'assigned by md', salesUserId: exec1.userId });
    const unassigned = await newQuotation(h, o, c.id, { opportunity: 'md own' });

    const seen = async (a: Actor) => ((await h.call(a, 'get', '/quotations')).body.items as { id: string }[]).map((x) => x.id).sort();
    expect(await seen(exec1)).toEqual([mine.id, assigned.id].sort());
    expect(await seen(exec2)).toEqual([theirs.id]);
    expect((await seen(manager)).length).toBe(4);
    expect((await h.call(exec1, 'get', '/quotations')).body.total).toBe(2);

    for (const id of [theirs.id, unassigned.id]) {
      expect((await h.call(exec1, 'get', `/quotations/${id}`)).status).toBe(404);
      expect((await h.call(exec1, 'get', `/quotations/${id}/history`)).status).toBe(404);
      expect((await h.change(exec1, 'patch', `/quotations/${id}`, 1, { opportunity: 'hijack' })).status).toBe(404);
      expect((await changePhase(h, exec1, id, 1, { toPhase: 'TENDER' })).status).toBe(404);
    }
    expect((await h.call(exec1, 'get', `/quotations/${assigned.id}`)).status).toBe(200);
    expect((await changePhase(h, exec1, mine.id, 1, { toPhase: 'TENDER' })).status).toBe(200);
    expect((await h.call(exec1, 'get', `/quotations?salesUserId=${exec2.userId}`)).body.items).toEqual([]);

    // A restricted role cannot assign records to someone else.
    const give = await h.create(exec1, '/quotations', { customerId: c.id, opportunity: 'x', amount: '1', salesUserId: exec2.userId });
    expect(give.status).toBe(403);
    expect((await h.change(exec1, 'patch', `/quotations/${mine.id}`, 2, { salesUserId: exec2.userId })).status).toBe(403);
    // A manager sees and edits everything.
    expect((await h.change(manager, 'patch', `/quotations/${theirs.id}`, 1, { notes: 'by manager' })).status).toBe(200);
  });
});

describe('branch scope', () => {
  it('hides quotations of other branches from a branch-scoped user and forbids writing into them', async () => {
    const o = await h.actor('qt-branch', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const c = await newCustomer(h, o);
    const mineQ = await newQuotation(h, o, c.id, { branchId: o.branchId });
    const theirsQ = await newQuotation(h, o, c.id, { branchId: branch2 });
    const scoped = await h.addUser(o, { roleCode: 'sales-manager', branchId: o.branchId, allBranches: false });
    const ids = ((await h.call(scoped, 'get', '/quotations')).body.items as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual([mineQ.id]);
    expect((await h.call(scoped, 'get', `/quotations/${theirsQ.id}`)).status).toBe(404);
    expect((await changePhase(h, scoped, theirsQ.id, 1, { toPhase: 'TENDER' })).status).toBe(404);
    const place = await h.create(scoped, '/quotations', { customerId: c.id, opportunity: 'x', amount: '1', branchId: branch2 });
    expect(place.status).toBe(403);
  });
});

describe('tenant isolation and permissions (T18)', () => {
  it('rejects a customer of another organization and hides another company\'s quotations', async () => {
    const foreignCustomer = await newCustomer(h, other);
    const res = await h.create(admin, '/quotations', { customerId: foreignCustomer.id, opportunity: 'x', amount: '1' });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.customerId).toBe('not_found');

    const theirs = await newQuotation(h, other, foreignCustomer.id, { opportunity: 'Foreign deal' });
    expect((await h.call(admin, 'get', `/quotations/${theirs.id}`)).status).toBe(404);
    expect((await h.call(admin, 'get', `/quotations/${theirs.id}/history`)).status).toBe(404);
    expect((await h.change(admin, 'patch', `/quotations/${theirs.id}`, 1, { opportunity: 'Hijack' })).status).toBe(404);
    expect((await changePhase(h, admin, theirs.id, 1, { toPhase: 'TENDER' })).status).toBe(404);
    expect((await h.call(admin, 'get', '/quotations/not-a-uuid')).status).toBe(404);
    for (const path of ['/quotations', '/quotations?q=Foreign', `/quotations?number=${theirs.quotationNo}`, `/quotations?customerId=${foreignCustomer.id}`]) {
      const list = await h.call(admin, 'get', path);
      expect(list.status).toBe(200);
      expect((list.body.items as { id: string }[]).map((x) => x.id)).not.toContain(theirs.id);
    }
    const own = await h.call(other, 'get', `/quotations/${theirs.id}`);
    expect(own.body).toMatchObject({ opportunity: 'Foreign deal', phase: 'AWAITING', rowVersion: 1 });
  });

  it('answers 403 for same-company roles without the permission', async () => {
    const q = await newQuotation(h, admin, customerId);
    expect((await h.call(reader, 'get', `/quotations/${q.id}`)).status).toBe(200);
    for (const res of [
      await h.create(reader, '/quotations', { customerId, opportunity: 'x', amount: '1' }),
      await h.change(reader, 'patch', `/quotations/${q.id}`, 1, { notes: 'x' }),
      await changePhase(h, reader, q.id, 1, { toPhase: 'TENDER' }),
      await h.call(plain, 'get', '/quotations'),
      await h.call(plain, 'get', `/quotations/${q.id}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });
});
