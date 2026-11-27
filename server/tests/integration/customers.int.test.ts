// Task 11.5: customers API against fleet_test with the runtime role (fleet_app, RLS) and the real auth middleware.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { inTenant, migratorUrl } from './testDb.js';

let h: Harness;
let admin: Actor; // managing-director: customers.read + customers.write
let other: Actor; // another company
let reader: Actor; // finance: customers.read only (same company as admin)
let plain: Actor; // driver: no customer permission at all (same company as admin)

const base = { name: 'Acme Rentals', phone: '+971 4 111 1111', address: 'Dubai Industrial City' };
const customer = (extra: object = {}) => ({ ...base, ...extra });

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('cust-admin', 'managing-director');
  other = await h.actor('cust-other', 'managing-director');
  reader = await h.addUser(admin, { roleCode: 'finance', branchId: admin.branchId, allBranches: true });
  plain = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
});

afterAll(async () => {
  await h.close();
});

describe('create', () => {
  it('requires an Idempotency-Key, allocates a code, replays the same request and conflicts on a different body', async () => {
    const o = await h.actor('cust-idem', 'managing-director');
    const noKey = await h.call(o, 'post', '/customers').send(customer());
    expect(noKey.status).toBe(422);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await h.create(o, '/customers', customer(), key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'ACTIVE', creditLimit: '0.000000', creditHold: false, rowVersion: 1, branchId: null });
    expect(first.body.customerCode).toMatch(/^CUS-\d{4}\d{4,}$/);

    const replay = await h.create(o, '/customers', customer(), key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await h.sql(o, 'SELECT 1 FROM customers')).toHaveLength(1);

    const conflict = await h.create(o, '/customers', customer({ name: 'Different' }), key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const second = await h.create(o, '/customers', customer({ name: 'Second' }));
    expect(second.body.customerCode).not.toBe(first.body.customerCode);
    expect((await h.audit(o, 'customer.created')).length).toBe(2);
  });

  it('accepts an explicit unique code, skips it when allocating, and rejects duplicate codes with a field error (409)', async () => {
    const o = await h.actor('cust-codes', 'managing-director');
    const year = new Date().getUTCFullYear();
    const next = `CUS-${year}0001`; // what the allocator would hand out first
    const explicit = await h.create(o, '/customers', customer({ customerCode: next, fleetLogCode: 'FL-1' }));
    expect(explicit.status).toBe(201);
    expect(explicit.body.customerCode).toBe(next);

    const allocated = await h.create(o, '/customers', customer({ name: 'Gets next free code' }));
    expect(allocated.status).toBe(201);
    expect(allocated.body.customerCode).toBe(`CUS-${year}0002`);

    const dupCode = await h.create(o, '/customers', customer({ customerCode: next }));
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.code).toBe('DUPLICATE');
    expect(dupCode.body.fieldErrors.customerCode).toBe('duplicate');

    const dupLog = await h.create(o, '/customers', customer({ fleetLogCode: 'FL-1' }));
    expect(dupLog.status).toBe(409);
    expect(dupLog.body.fieldErrors.fleetLogCode).toBe('duplicate');

    // Null fleet log codes never collide, and another company may reuse both codes.
    expect((await h.create(o, '/customers', customer({ name: 'No log code A' }))).status).toBe(201);
    expect((await h.create(o, '/customers', customer({ name: 'No log code B' }))).status).toBe(201);
    expect((await h.create(other, '/customers', customer({ customerCode: next, fleetLogCode: 'FL-1' }))).status).toBe(201);
  });

  it('accepts exactly the four statuses and rejects other values or unknown fields (422)', async () => {
    const o = await h.actor('cust-status', 'managing-director');
    for (const status of ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLACKLISTED']) {
      const res = await h.create(o, '/customers', customer({ name: status, status }));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe(status);
    }
    for (const bad of [{ status: 'DELETED' }, { status: 'active' }, { creditLimit: '-1' }, { email: 'nope' }, { extra: 1 }]) {
      expect((await h.create(o, '/customers', customer(bad))).status).toBe(422);
    }
    const created = (await h.create(o, '/customers', customer({ name: 'Patched' }))).body;
    const bad = await h.change(o, 'patch', `/customers/${created.id}`, created.rowVersion, { status: 'GONE' });
    expect(bad.status).toBe(422);
    const ok = await h.change(o, 'patch', `/customers/${created.id}`, created.rowVersion, { status: 'BLACKLISTED' });
    expect(ok.body.status).toBe('BLACKLISTED');
  });

  it('validates custom_attributes against the active customer field definitions', async () => {
    const o = await h.actor('cust-attrs', 'managing-director');
    await h.sql(
      o,
      `INSERT INTO custom_field_definitions (org_id, app_code, entity_type, field_key, label, field_type, options, required)
       VALUES ($1, 'customer_ani', 'customer', 'region', 'Region', 'SELECT', '["North","South"]', false),
              ($1, 'customer_ani', 'customer', 'fleet_size', 'Fleet size', 'NUMBER', '[]', false),
              ($1, 'customer_ani', 'customer', 'retired', 'Retired', 'TEXT', '[]', false),
              ($1, 'customer_ani', 'machine', 'machine_only', 'Machine only', 'TEXT', '[]', false)`,
      [o.orgId],
    );
    await h.sql(o, "UPDATE custom_field_definitions SET active = false WHERE field_key = 'retired'");

    const ok = await h.create(o, '/customers', customer({ customAttributes: { region: 'North', fleet_size: 12 } }));
    expect(ok.status).toBe(201);
    expect(ok.body.customAttributes).toEqual({ region: 'North', fleet_size: 12 });

    for (const attrs of [{ region: 'East' }, { fleet_size: 'many' }, { unknown_key: 1 }, { retired: 'x' }, { machine_only: 'x' }]) {
      const res = await h.create(o, '/customers', customer({ customAttributes: attrs }));
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.fieldErrors)[0]).toMatch(/^customAttributes\./);
    }

    const upd = await h.change(o, 'patch', `/customers/${ok.body.id}`, 1, { customAttributes: { region: 'South' } });
    expect(upd.status).toBe(200);
    expect(upd.body.customAttributes).toEqual({ region: 'South' });
    expect((await h.change(o, 'patch', `/customers/${ok.body.id}`, 2, { customAttributes: { region: 'West' } })).status).toBe(422);
  });
});

describe('update and archive', () => {
  it('updates with If-Match, rejects stale and missing versions, keeps the code immutable and audits the change', async () => {
    const o = await h.actor('cust-update', 'managing-director');
    const created = (await h.create(o, '/customers', customer())).body;
    expect((await h.call(o, 'patch', `/customers/${created.id}`).send({ name: 'x' })).status).toBe(428);

    const upd = await h.change(o, 'patch', `/customers/${created.id}`, 1, { name: 'Renamed', creditLimit: 5000.5, creditHold: true });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Renamed', creditLimit: '5000.500000', creditHold: true, rowVersion: 2 });
    expect(upd.headers.etag).toBe('"2"');

    const stale = await h.change(o, 'patch', `/customers/${created.id}`, 1, { name: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');

    const code = await h.change(o, 'patch', `/customers/${created.id}`, 2, { customerCode: 'OTHER-1' });
    expect(code.status).toBe(422);
    expect(code.body.code).toBe('IMMUTABLE_FIELD');
    // Re-sending the unchanged code (a full-DTO round trip) is fine.
    expect((await h.change(o, 'patch', `/customers/${created.id}`, 2, { customerCode: created.customerCode, phone: '1' })).status).toBe(200);

    const events = await h.audit(o, 'customer.updated');
    expect(events[0].before_data).toMatchObject({ name: 'Acme Rentals', creditHold: false });
    expect(events[0].after_data).toMatchObject({ name: 'Renamed', creditHold: true });
  });

  it('archives instead of deleting, including a customer referenced by a quotation', async () => {
    const o = await h.actor('cust-archive', 'managing-director');
    const created = (await h.create(o, '/customers', customer())).body;
    await h.sql(
      o,
      `INSERT INTO quotations (org_id, customer_id, quotation_no, opportunity, amount, currency_code)
       VALUES ($1, $2, 'Q-1', 'Boom lift hire', 1000, 'AED')`,
      [o.orgId, created.id],
    );
    // The database refuses a hard delete of a referenced customer.
    await expect(
      inTenant(migratorUrl(), o.orgId, (c) => c.query('DELETE FROM customers WHERE id = $1', [created.id])),
    ).rejects.toMatchObject({ code: '23503' });

    expect((await h.call(o, 'delete', `/customers/${created.id}`)).status).toBe(428);
    const archived = await h.change(o, 'delete', `/customers/${created.id}`, 1);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ status: 'INACTIVE', rowVersion: 2 });
    expect(await h.sql(o, "SELECT 1 FROM customers WHERE id = $1 AND status = 'INACTIVE'", [created.id])).toHaveLength(1);
    expect((await h.audit(o, 'customer.archived')).length).toBe(1);

    const inactive = await h.call(o, 'get', '/customers?status=INACTIVE');
    expect(inactive.body.items.map((c: { id: string }) => c.id)).toEqual([created.id]);
    expect((await h.call(o, 'get', '/customers?status=ACTIVE')).body.items).toHaveLength(0);
  });
});

describe('list filters', () => {
  it('filters by status and branch, searches name or code literally and paginates', async () => {
    const o = await h.actor('cust-list', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const mk = (name: string, extra: object = {}) => h.create(o, '/customers', customer({ name, ...extra }));
    await mk('Alpha Cranes', { branchId: o.branchId });
    await mk('Beta Cranes', { branchId: branch2, status: 'SUSPENDED' });
    await mk('100% Lifts');
    await mk('Gamma_Lifts');
    await mk('Delta Hire', { customerCode: 'ZED-9' });

    const all = await h.call(o, 'get', '/customers?pageSize=2&sort=name');
    expect(all.body).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(all.body.items.map((c: { name: string }) => c.name)).toEqual(['100% Lifts', 'Alpha Cranes']);
    const p3 = await h.call(o, 'get', '/customers?pageSize=2&page=3&sort=name');
    expect(p3.body.items.map((c: { name: string }) => c.name)).toEqual(['Gamma_Lifts']);

    const byBranch = await h.call(o, 'get', `/customers?branchId=${branch2}`);
    expect(byBranch.body.items.map((c: { name: string }) => c.name)).toEqual(['Beta Cranes']);
    const byStatus = await h.call(o, 'get', '/customers?status=SUSPENDED');
    expect(byStatus.body.total).toBe(1);

    const byName = await h.call(o, 'get', '/customers?q=cranes');
    expect(byName.body.total).toBe(2);
    expect((await h.call(o, 'get', '/customers?q=zed-9')).body.items[0].name).toBe('Delta Hire');
    // LIKE wildcards in the search text are literal, and injection text is just text.
    expect((await h.call(o, 'get', `/customers?q=${encodeURIComponent('100%')}`)).body.total).toBe(1);
    expect((await h.call(o, 'get', `/customers?q=${encodeURIComponent('%')}`)).body.total).toBe(1);
    expect((await h.call(o, 'get', `/customers?q=${encodeURIComponent("'; DROP TABLE customers;--")}`)).body.total).toBe(0);
    expect((await h.call(o, 'get', '/customers?status=nope')).status).toBe(422);
    expect((await h.call(o, 'get', '/customers?sort=password')).status).toBe(422);
  });
});

describe('branch scope', () => {
  it('omits customers of other branches from lists and answers 404 on direct read, update and archive', async () => {
    const o = await h.actor('cust-scope', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const mine = (await h.create(o, '/customers', customer({ name: 'In my branch', branchId: o.branchId }))).body;
    const theirs = (await h.create(o, '/customers', customer({ name: 'Other branch', branchId: branch2 }))).body;
    const shared = (await h.create(o, '/customers', customer({ name: 'No branch' }))).body;
    const scoped = await h.addUser(o, { roleCode: 'sales-manager', branchId: o.branchId, allBranches: false });

    const list = await h.call(scoped, 'get', '/customers');
    expect(list.body.items.map((c: { id: string }) => c.id).sort()).toEqual([mine.id, shared.id].sort());
    expect(list.body.total).toBe(2);
    expect((await h.call(scoped, 'get', `/customers/${mine.id}`)).status).toBe(200);
    expect((await h.call(scoped, 'get', `/customers/${shared.id}`)).status).toBe(200);
    expect((await h.call(scoped, 'get', `/customers/${theirs.id}`)).status).toBe(404);
    expect((await h.change(scoped, 'patch', `/customers/${theirs.id}`, 1, { name: 'Hijack' })).status).toBe(404);
    expect((await h.change(scoped, 'delete', `/customers/${theirs.id}`, 1)).status).toBe(404);
    // Filtering by the hidden branch yields nothing rather than leaking.
    expect((await h.call(scoped, 'get', `/customers?branchId=${branch2}`)).body.items).toEqual([]);
    // Writing into a branch outside the scope is forbidden.
    const create = await h.create(scoped, '/customers', customer({ name: 'Wrong branch', branchId: branch2 }));
    expect(create.status).toBe(403);
    expect(create.body.fieldErrors.branchId).toBe('out_of_scope');
    expect((await h.change(scoped, 'patch', `/customers/${mine.id}`, 1, { branchId: branch2 })).status).toBe(403);

    // A user with all branches sees everything.
    expect((await h.call(o, 'get', '/customers')).body.total).toBe(3);
  });
});

describe('tenant isolation and permissions (T18)', () => {
  it('another company\'s customer is 404 on read, update and archive and never appears in lists, search or filters', async () => {
    const theirs = (await h.create(other, '/customers', customer({ name: 'Foreign Co', customerCode: 'FOREIGN-1' }))).body;
    expect((await h.call(admin, 'get', `/customers/${theirs.id}`)).status).toBe(404);
    expect((await h.change(admin, 'patch', `/customers/${theirs.id}`, 1, { name: 'Hijack' })).status).toBe(404);
    expect((await h.change(admin, 'delete', `/customers/${theirs.id}`, 1)).status).toBe(404);
    expect((await h.call(admin, 'get', '/customers/not-a-uuid')).status).toBe(404);
    expect((await h.call(admin, 'get', `/customers/${randomUUID()}`)).status).toBe(404);
    for (const path of ['/customers', '/customers?q=Foreign', '/customers?q=FOREIGN-1', `/customers?branchId=${other.branchId}`, '/customers?status=ACTIVE']) {
      const res = await h.call(admin, 'get', path);
      expect(res.status).toBe(200);
      expect(res.body.items.map((c: { id: string }) => c.id)).not.toContain(theirs.id);
    }
    // Nothing changed for the owner.
    const own = await h.call(other, 'get', `/customers/${theirs.id}`);
    expect(own.body).toMatchObject({ name: 'Foreign Co', status: 'ACTIVE', rowVersion: 1 });
    // A foreign branch id cannot be used to place a customer: it does not exist for this company.
    const placed = await h.create(admin, '/customers', customer({ branchId: other.branchId }));
    expect(placed.status).toBe(422);
    expect(placed.body.fieldErrors.branchId).toBe('not_found');
  });

  it('answers 403 for a same-company role without the permission', async () => {
    const mine = (await h.create(admin, '/customers', customer({ name: 'Mine' }))).body;
    // finance: read only.
    expect((await h.call(reader, 'get', '/customers')).status).toBe(200);
    expect((await h.call(reader, 'get', `/customers/${mine.id}`)).status).toBe(200);
    for (const res of [
      await h.create(reader, '/customers', customer()),
      await h.change(reader, 'patch', `/customers/${mine.id}`, 1, { name: 'x' }),
      await h.change(reader, 'delete', `/customers/${mine.id}`, 1),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    // driver: no customer permission at all.
    for (const res of [
      await h.call(plain, 'get', '/customers'),
      await h.call(plain, 'get', `/customers/${mine.id}`),
      await h.create(plain, '/customers', customer()),
    ]) {
      expect(res.status).toBe(403);
    }
    expect((await h.call(admin, 'get', `/customers/${mine.id}`)).body.name).toBe('Mine');
  });
});
