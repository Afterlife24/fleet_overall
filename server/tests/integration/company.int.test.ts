// Task 10.9: company profile, branches, roles, users, apps and custom fields against fleet_test
// with the runtime role (fleet_app, RLS) and the real auth middleware (OIDC with a local test JWKS).
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuthRuntime } from '../../src/auth/index.js';
import { setTransactionPool } from '../../src/db/tx.js';
import { createLogger } from '../../src/logger.js';
import { APP_CATALOG } from '../../src/constants/appCatalog.js';
import { appUrl, inTenant, migrateTestDb, migratorUrl, seedOrg, type SeededOrg } from './testDb.js';

const ISSUER = 'https://idp.test.example/';
const AUDIENCE = 'fleet-api-test';
const KID = 'test-key-1';

let pool: pg.Pool;
let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let app: ReturnType<typeof createApp>;

interface Actor extends SeededOrg {
  token: string;
}

async function sql<T = unknown>(org: SeededOrg, text: string, params: unknown[] = []): Promise<T[]> {
  return inTenant(migratorUrl(), org.orgId, async (c) => (await c.query(text, params)).rows as T[]);
}

async function tokenFor(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
}

/** Seeds an organization whose single user holds the given role code (permissions come from the code's defaults). */
async function actor(label: string, roleCode: string): Promise<Actor> {
  const org = await seedOrg(label);
  await sql(org, 'UPDATE roles SET code = $1, name = $1 WHERE id = $2', [roleCode, org.roleId]);
  return { ...org, token: await tokenFor(org.authSubject) };
}

const call = (a: Actor, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${a.token}`);
const create = (a: Actor, path: string, body: object, key: string = randomUUID()) =>
  call(a, 'post', path).set('Idempotency-Key', key).send(body);
const change = (a: Actor, method: 'patch' | 'put' | 'delete', path: string, version: number, body?: object) => {
  const r = call(a, method, path).set('If-Match', String(version));
  return body ? r.send(body) : r;
};
const audit = (org: SeededOrg, action: string) =>
  sql<{ before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; actor_user_id: string }>(
    org,
    'SELECT before_data, after_data, actor_user_id FROM audit_events WHERE action = $1 ORDER BY occurred_at',
    [action],
  );

let admin: Actor; // managing-director: every company-area permission
let other: Actor; // another company
let plain: Actor; // driver: company.read only

beforeAll(async () => {
  await migrateTestDb();
  pool = new pg.Pool({ connectionString: appUrl(), max: 5 });
  setTransactionPool(pool);
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] });
  const auth = createAuthRuntime(
    {
      nodeEnv: 'test',
      host: '127.0.0.1',
      auth: { mode: 'oidc', allowDevAuth: false, oidc: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: 'https://idp.test.example/jwks.json' } },
    },
    pool,
    { oidcKeyResolver: jwks },
  );
  app = createApp({ logger: createLogger({ level: 'silent' }), dbProbe: async () => {}, jsonBodyBytes: 100_000, auth });
  admin = await actor('company-admin', 'managing-director');
  other = await actor('company-other', 'managing-director');
  plain = await actor('company-plain', 'driver');
});

afterAll(async () => {
  setTransactionPool(undefined);
  await pool.end();
});

describe('company profile', () => {
  it('reads the profile with issuer fields, the seven gating booleans and a version header', async () => {
    const res = await call(admin, 'get', '/company');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: admin.orgId, timezone: 'Asia/Dubai', currencyCode: 'AED', vatRate: 0.05, rowVersion: 1,
    });
    expect(Object.keys(res.body.gatingRules).sort()).toEqual([
      'blockCreditHold', 'requireHaReceived', 'requireHaSent', 'requireLpo', 'requireQuote', 'requireTpcValid', 'warnOverdueInspection',
    ]);
    expect(res.headers.etag).toBe('"1"');
  });

  it('lets a read-only role read but not update (403), checked before If-Match', async () => {
    expect((await call(plain, 'get', '/company')).status).toBe(200);
    const res = await call(plain, 'patch', '/company').send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('updates with If-Match, bumps the version and audits before and after', async () => {
    const o = await actor('company-update', 'managing-director');
    expect((await call(o, 'patch', '/company').send({ name: 'X' })).status).toBe(428);
    const ok = await change(o, 'patch', '/company', 1, { name: 'Renamed Co', vatRate: 0.1, phone: '+971 4 000 0000' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed Co', vatRate: 0.1, phone: '+971 4 000 0000', rowVersion: 2 });

    const stale = await change(o, 'patch', '/company', 1, { name: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    expect((await call(o, 'get', '/company')).body.name).toBe('Renamed Co');

    const events = await audit(o, 'company.updated');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(o.userId);
    expect(events[0].before_data).toMatchObject({ name: 'Org company-update', vatRate: 0.05 });
    expect(events[0].after_data).toMatchObject({ name: 'Renamed Co', vatRate: 0.1 });
  });

  it('accepts exactly the seven gating booleans and rejects anything else with 422', async () => {
    const o = await actor('company-gating', 'managing-director');
    const rules = { requireQuote: false, requireHaSent: true, requireHaReceived: true, requireLpo: true, blockCreditHold: false, requireTpcValid: true, warnOverdueInspection: false };
    const ok = await change(o, 'patch', '/company', 1, { gatingRules: rules });
    expect(ok.status).toBe(200);
    expect(ok.body.gatingRules).toEqual(rules);

    const { requireLpo: _drop, ...missing } = rules;
    void _drop;
    for (const bad of [missing, { ...rules, extra: true }, { ...rules, requireQuote: 'yes' }, null, []]) {
      const res = await change(o, 'patch', '/company', 2, { gatingRules: bad });
      expect(res.status).toBe(422);
    }
    expect((await call(o, 'get', '/company')).body.gatingRules).toEqual(rules);
  });

  it('rejects disabling Won-only invoicing or same-company ownership (422) and changes nothing', async () => {
    const o = await actor('company-locked', 'managing-director');
    const before = (await call(o, 'get', '/company')).body;
    for (const locked of [{ wonOnlyInvoicing: false }, { sameCompanyOwnership: false }]) {
      const res = await change(o, 'patch', '/company', 1, { gatingRules: { ...before.gatingRules, ...locked } });
      expect(res.status).toBe(422);
      expect(Object.values(res.body.fieldErrors)).toContain('locked_rule');
    }
    const after = (await call(o, 'get', '/company')).body;
    expect(after.rowVersion).toBe(1);
    expect(after.gatingRules).toEqual(before.gatingRules);
    expect(await audit(o, 'company.updated')).toHaveLength(0);
  });
});

describe('branches', () => {
  it('requires an Idempotency-Key, replays the same request and conflicts on a different body', async () => {
    const o = await actor('branch-idem', 'managing-director');
    const body = { code: 'DXB2', name: 'Dubai 2', countryCode: 'AE', city: 'Dubai', address: 'Yard 2', timezone: 'Asia/Dubai' };
    const noKey = await call(o, 'post', '/branches').send(body);
    expect(noKey.status).toBe(422);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await create(o, '/branches', body, key);
    expect(first.status).toBe(201);
    const replay = await create(o, '/branches', body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await sql(o, "SELECT 1 FROM branches WHERE code = 'DXB2'")).toHaveLength(1);

    const conflict = await create(o, '/branches', { ...body, name: 'Different' }, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('enforces a unique code per organization (409) but allows the same code in another company', async () => {
    const o = await actor('branch-dup', 'managing-director');
    const body = { code: 'MAIN2', name: 'Second', countryCode: 'AE', city: 'Dubai', address: 'A', timezone: 'Asia/Dubai' };
    expect((await create(o, '/branches', body)).status).toBe(201);
    const dup = await create(o, '/branches', body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');
    expect(dup.body.fieldErrors.code).toBe('duplicate');
    // 'MAIN' already exists from seeding, so the seeded code collides too.
    expect((await create(o, '/branches', { ...body, code: 'MAIN' })).status).toBe(409);
    expect((await create(other, '/branches', body)).status).toBe(201);
  });

  it('updates and deactivates with If-Match; stale and missing versions are rejected', async () => {
    const o = await actor('branch-update', 'managing-director');
    const created = (await create(o, '/branches', { code: 'B9', name: 'Nine', countryCode: 'AE', city: 'Abu Dhabi', address: 'Z', timezone: 'Asia/Dubai' })).body;
    expect((await call(o, 'patch', `/branches/${created.id}`).send({ name: 'x' })).status).toBe(428);

    const upd = await change(o, 'patch', `/branches/${created.id}`, created.rowVersion, { name: 'Nine Renamed', phone: '123' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Nine Renamed', phone: '123', rowVersion: created.rowVersion + 1 });

    const stale = await change(o, 'patch', `/branches/${created.id}`, created.rowVersion, { name: 'Stale' });
    expect(stale.status).toBe(409);

    const off = await change(o, 'delete', `/branches/${created.id}`, upd.body.rowVersion);
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect((await sql(o, 'SELECT active FROM branches WHERE id = $1', [created.id]))[0]).toEqual({ active: false });

    const activeOnly = await call(o, 'get', '/branches?active=true');
    expect(activeOnly.body.items.map((b: { code: string }) => b.code)).not.toContain('B9');
    expect((await audit(o, 'branch.deactivated')).length).toBe(1);
  });

  it('is permission gated (403) and invisible across companies (404)', async () => {
    const theirs = (await create(other, '/branches', { code: 'OTH', name: 'Other', countryCode: 'AE', city: 'Dubai', address: 'A', timezone: 'Asia/Dubai' })).body;
    expect((await create(plain, '/branches', { code: 'P' })).status).toBe(403); // 403 before key/body validation
    expect((await call(plain, 'get', '/branches')).status).toBe(200);
    expect((await call(admin, 'get', `/branches/${theirs.id}`)).status).toBe(404);
    expect((await change(admin, 'patch', `/branches/${theirs.id}`, 1, { name: 'Hijack' })).status).toBe(404);
    expect((await change(admin, 'delete', `/branches/${theirs.id}`, 1)).status).toBe(404);
    expect((await call(admin, 'get', '/branches/not-a-uuid')).status).toBe(404);
    const list = await call(admin, 'get', '/branches');
    expect(list.body.items.map((b: { id: string }) => b.id)).not.toContain(theirs.id);
  });
});

describe('roles and users', () => {
  it('lists roles with only allowlisted permission and app codes', async () => {
    const o = await actor('roles-list', 'managing-director');
    await sql(o, "UPDATE roles SET permissions = ARRAY['users.manage','customers.read','not.a.permission'], app_codes = ARRAY['crm','not_an_app'] WHERE id = $1", [o.roleId]);
    const res = await call(o, 'get', '/roles');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ permissions: ['users.manage', 'customers.read'], appCodes: ['crm'] });
    expect(res.body.permissionCodes).toContain('users.manage');
    expect((await call(plain, 'get', '/roles')).status).toBe(403);
  });

  it('creates a user with one role and a normalized unique email; duplicates are 409', async () => {
    const o = await actor('users-create', 'managing-director');
    const body = { email: '  New.User@Example.COM ', displayName: 'New User', roleId: o.roleId, branchId: o.branchId };
    const noKey = await call(o, 'post', '/users').send(body);
    expect(noKey.status).toBe(422);

    const key = randomUUID();
    const created = await create(o, '/users', body, key);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: 'new.user@example.com', roleId: o.roleId, branchId: o.branchId, status: 'ACTIVE' });
    expect((await create(o, '/users', body, key)).body.id).toBe(created.body.id);

    const dup = await create(o, '/users', { ...body, email: 'NEW.user@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.fieldErrors.email).toBe('duplicate');

    expect((await create(o, '/users', { ...body, email: 'x@example.com', roleId: other.roleId })).status).toBe(422);
    expect((await create(plain, '/users', body)).status).toBe(403);
  });

  it('audits role, branch and status changes with previous and new values', async () => {
    const o = await actor('users-audit', 'managing-director');
    const branch2 = (await create(o, '/branches', { code: 'B2', name: 'B2', countryCode: 'AE', city: 'Dubai', address: 'A', timezone: 'Asia/Dubai' })).body;
    const role2 = randomUUID();
    await sql(o, "INSERT INTO roles (id, org_id, code, name, permissions, app_codes) VALUES ($1, $2, 'sales-manager', 'Sales Manager', '{}', '{}')", [role2, o.orgId]);
    const user = (await create(o, '/users', { email: `u-${randomUUID()}@example.com`, displayName: 'Mover', roleId: o.roleId, branchId: o.branchId })).body;

    expect((await call(o, 'patch', `/users/${user.id}`).send({ roleId: role2 })).status).toBe(428);
    const moved = await change(o, 'patch', `/users/${user.id}`, user.rowVersion, { roleId: role2, branchId: branch2.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ roleId: role2, roleCode: 'sales-manager', branchId: branch2.id });
    expect((await change(o, 'patch', `/users/${user.id}`, user.rowVersion, { displayName: 'Stale' })).status).toBe(409);

    const access = await audit(o, 'user.access_changed');
    expect(access).toHaveLength(1);
    expect(access[0].before_data).toMatchObject({ roleId: o.roleId, branchId: o.branchId });
    expect(access[0].after_data).toMatchObject({ roleId: role2, branchId: branch2.id, roleCode: 'sales-manager' });

    const off = await change(o, 'patch', `/users/${user.id}/status`, moved.body.rowVersion, { status: 'SUSPENDED', reason: 'left company' });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('SUSPENDED');
    const status = await audit(o, 'user.status_changed');
    expect(status).toHaveLength(1);
    expect(status[0].before_data).toEqual({ status: 'ACTIVE' });
    expect(status[0].after_data).toEqual({ status: 'SUSPENDED' });

    const list = await call(o, 'get', '/users?status=SUSPENDED');
    expect(list.body.items.map((u: { id: string }) => u.id)).toEqual([user.id]);
    expect((await change(o, 'patch', `/users/${o.userId}/status`, 1, { status: 'INACTIVE' })).status).toBe(422); // own account
  });

  it('hides users of another company (404) and denies a role without users.manage (403)', async () => {
    const theirs = (await create(other, '/users', { email: `t-${randomUUID()}@example.com`, displayName: 'Theirs', roleId: other.roleId })).body;
    expect((await call(admin, 'get', `/users/${theirs.id}`)).status).toBe(404);
    expect((await change(admin, 'patch', `/users/${theirs.id}`, 1, { displayName: 'Hijack' })).status).toBe(404);
    expect((await change(admin, 'patch', `/users/${theirs.id}/status`, 1, { status: 'INACTIVE' })).status).toBe(404);
    const list = await call(admin, 'get', '/users');
    expect(list.body.items.map((u: { id: string }) => u.id)).not.toContain(theirs.id);
    expect((await call(plain, 'get', '/users')).status).toBe(403);
  });
});

describe('organization apps', () => {
  it('lists the whole catalog, activates dependencies, blocks deactivation of a needed app and retains records', async () => {
    const o = await actor('apps', 'managing-director');
    const list = await call(o, 'get', '/apps');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(APP_CATALOG.length);
    expect(list.body.items.every((a: { active: boolean; rowVersion: number | null }) => !a.active && a.rowVersion === null)).toBe(true);

    expect((await call(o, 'patch', '/apps/not_an_app').send({ active: true })).status).toBe(404);
    const crm = await call(o, 'patch', '/apps/crm').send({ active: true });
    expect(crm.status).toBe(200);
    expect(crm.body.alsoActivated.sort()).toEqual(['customer_ani', 'invoice']);
    const active = (await call(o, 'get', '/apps')).body.items.filter((a: { active: boolean }) => a.active).map((a: { appCode: string }) => a.appCode);
    expect(active.sort()).toEqual(['crm', 'customer_ani', 'invoice']);

    // An existing row requires If-Match.
    expect((await call(o, 'patch', '/apps/crm').send({ onboarded: true })).status).toBe(428);

    const invoice = (await call(o, 'get', '/apps')).body.items.find((a: { appCode: string }) => a.appCode === 'invoice');
    const blocked = await change(o, 'patch', '/apps/invoice', invoice.rowVersion, { active: false });
    expect(blocked.status).toBe(422);
    expect(blocked.body.fieldErrors.active).toBe('has_dependents');

    await sql(o, "INSERT INTO customers (org_id, customer_code, name, phone, address) VALUES ($1, 'C-1', 'Keep Me', '1', 'A')", [o.orgId]);
    const off = await change(o, 'patch', '/apps/crm', crm.body.rowVersion, { active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    const ca = (await call(o, 'get', '/apps')).body.items.find((a: { appCode: string }) => a.appCode === 'customer_ani');
    expect((await change(o, 'patch', '/apps/customer_ani', ca.rowVersion, { active: false })).status).toBe(200);
    expect(await sql(o, "SELECT 1 FROM customers WHERE customer_code = 'C-1'")).toHaveLength(1);
    expect(await sql(o, "SELECT 1 FROM organization_apps WHERE app_code = 'customer_ani' AND active = false")).toHaveLength(1);
    expect((await audit(o, 'app.deactivated')).length).toBe(2);
  });

  it('is permission gated and tenant scoped', async () => {
    expect((await call(plain, 'get', '/apps')).status).toBe(200);
    expect((await call(plain, 'patch', '/apps/crm').send({ active: true })).status).toBe(403);
    const mine = (await call(other, 'get', '/apps')).body.items.filter((a: { active: boolean }) => a.active);
    expect(mine).toEqual([]); // admin's activations never show up for another company
  });
});

describe('custom field definitions', () => {
  const field = { appCode: 'customer_ani', entityType: 'customer', fieldKey: 'region', label: 'Region', fieldType: 'SELECT', options: ['North', 'South'] };

  it('creates, rejects duplicates, bad types and options, and requires an Idempotency-Key', async () => {
    const o = await actor('fields', 'managing-director');
    expect((await call(o, 'post', '/custom-fields').send(field)).status).toBe(422);
    const created = await create(o, '/custom-fields', field);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ fieldKey: 'region', fieldType: 'SELECT', systemField: false, active: true, rowVersion: 1 });

    const dup = await create(o, '/custom-fields', field);
    expect(dup.status).toBe(409);
    expect(dup.body.fieldErrors.fieldKey).toBe('duplicate');
    expect((await create(other, '/custom-fields', field)).status).toBe(201);

    for (const bad of [
      { ...field, fieldKey: 'r2', fieldType: 'MONEY' },
      { ...field, fieldKey: 'r3', options: [] }, // SELECT without options
      { ...field, fieldKey: 'r4', fieldType: 'TEXT' }, // options on a non-SELECT
      { ...field, fieldKey: 'Bad Key' },
      { ...field, fieldKey: 'r5', appCode: 'not_an_app' },
      { ...field, fieldKey: 'r6', systemField: true },
    ]) {
      expect((await create(o, '/custom-fields', bad)).status).toBe(422);
    }
    for (const type of ['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN']) {
      const res = await create(o, '/custom-fields', { ...field, fieldKey: `f_${type.toLowerCase()}`, fieldType: type, options: [] });
      expect(res.status).toBe(201);
    }
  });

  it('updates with If-Match, keeps the key immutable and deactivates instead of deleting', async () => {
    const o = await actor('fields-update', 'managing-director');
    const created = (await create(o, '/custom-fields', field)).body;
    expect((await call(o, 'patch', `/custom-fields/${created.id}`).send({ label: 'x' })).status).toBe(428);
    const upd = await change(o, 'patch', `/custom-fields/${created.id}`, 1, { label: 'Sales Region', options: ['East'], required: true });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ label: 'Sales Region', options: ['East'], required: true, rowVersion: 2 });
    expect((await change(o, 'patch', `/custom-fields/${created.id}`, 1, { label: 'Stale' })).status).toBe(409);
    const rename = await change(o, 'patch', `/custom-fields/${created.id}`, 2, { fieldKey: 'other' });
    expect(rename.status).toBe(422);
    expect(rename.body.code).toBe('IMMUTABLE_FIELD');

    const off = await change(o, 'delete', `/custom-fields/${created.id}`, 2);
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect(await sql(o, 'SELECT 1 FROM custom_field_definitions WHERE id = $1', [created.id])).toHaveLength(1);
    expect((await call(o, 'get', '/custom-fields?active=true')).body.items).toHaveLength(0);
    expect((await call(o, 'get', '/custom-fields?active=false')).body.items).toHaveLength(1);
  });

  it('refuses to delete, deactivate or retype a system field (422) but allows relabeling', async () => {
    const o = await actor('fields-system', 'managing-director');
    const id = randomUUID();
    await sql(
      o,
      `INSERT INTO custom_field_definitions (id, org_id, app_code, entity_type, field_key, label, field_type, system_field)
       VALUES ($1, $2, 'customer_ani', 'customer', 'name', 'Name', 'TEXT', true)`,
      [id, o.orgId],
    );
    const del = await change(o, 'delete', `/custom-fields/${id}`, 1);
    expect(del.status).toBe(422);
    expect(del.body.fieldErrors.active).toBe('system_field');
    const retype = await change(o, 'patch', `/custom-fields/${id}`, 1, { fieldType: 'NUMBER' });
    expect(retype.status).toBe(422);
    expect(retype.body.fieldErrors.fieldType).toBe('system_field');
    expect((await change(o, 'patch', `/custom-fields/${id}`, 1, { active: false })).status).toBe(422);
    const rows = await sql<{ field_type: string; active: boolean; row_version: string }>(o, 'SELECT field_type, active, row_version FROM custom_field_definitions WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ field_type: 'TEXT', active: true, row_version: '1' });
    expect((await change(o, 'patch', `/custom-fields/${id}`, 1, { label: 'Customer Name' })).status).toBe(200);
  });

  it('is permission gated (403) and invisible across companies (404)', async () => {
    const theirs = (await create(other, '/custom-fields', { ...field, fieldKey: 'theirs' })).body;
    expect((await create(plain, '/custom-fields', field)).status).toBe(403);
    expect((await call(plain, 'get', '/custom-fields')).status).toBe(200);
    expect((await call(admin, 'get', `/custom-fields/${theirs.id}`)).status).toBe(404);
    expect((await change(admin, 'patch', `/custom-fields/${theirs.id}`, 1, { label: 'x' })).status).toBe(404);
    expect((await change(admin, 'delete', `/custom-fields/${theirs.id}`, 1)).status).toBe(404);
    const ids = (await call(admin, 'get', '/custom-fields')).body.items.map((f: { id: string }) => f.id);
    expect(ids).not.toContain(theirs.id);
  });
});
