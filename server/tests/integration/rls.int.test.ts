// Task 6.8: row-level security with the actual runtime role (fleet_app) against fleet_test.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { appUrl, attempt, inTenant, migrateTestDb, migratorUrl, seedOrg, type SeededOrg } from './testDb.js';

let url: string;
let A: SeededOrg;
let B: SeededOrg;
let customerA: string;
let customerB: string;

const insertCustomerSql = `INSERT INTO customers (id, org_id, customer_code, name, phone, address)
                           VALUES ($1, $2, $3, 'Cust', '+971', 'Addr')`;

beforeAll(async () => {
  await migrateTestDb();
  url = appUrl();
  A = await seedOrg('rls-a');
  B = await seedOrg('rls-b');
  customerA = randomUUID();
  customerB = randomUUID();
  await inTenant(url, A.orgId, (c) => c.query(insertCustomerSql, [customerA, A.orgId, `CA-${customerA.slice(0, 8)}`]));
  await inTenant(url, B.orgId, (c) => c.query(insertCustomerSql, [customerB, B.orgId, `CB-${customerB.slice(0, 8)}`]));
});

describe('runtime role', () => {
  it('connects as fleet_app, which is not a superuser, has no BYPASSRLS and owns no table', async () => {
    const rows = await inTenant(url, null, async (c) => {
      const role = await c.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      const owned = await c.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`);
      return { role: role.rows[0], owned: owned.rowCount };
    });
    expect(rows.role).toEqual({ current_user: 'fleet_app', rolsuper: false, rolbypassrls: false });
    expect(rows.owned).toBe(0);
  });
});

describe('without Tenant_Context', () => {
  it('returns zero rows from every tenant table that has data and rejects inserts', async () => {
    const counts = await inTenant(url, null, async (c) => ({
      customers: (await c.query('SELECT count(*)::int AS n FROM customers')).rows[0].n,
      users: (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n,
      organizations: (await c.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,
      roles: (await c.query('SELECT count(*)::int AS n FROM roles')).rows[0].n,
    }));
    expect(counts).toEqual({ customers: 0, users: 0, organizations: 0, roles: 0 });

    const insert = await attempt(url, null, insertCustomerSql, [randomUUID(), A.orgId, `NC-${randomUUID().slice(0, 8)}`]);
    expect(insert).toMatchObject({ ok: false, code: '42501' });
  });

  it('still returns zero rows (no cast error) after an earlier transaction on the same connection set a context', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [A.orgId]);
      expect((await client.query('SELECT count(*)::int AS n FROM customers')).rows[0].n).toBeGreaterThan(0);
      await client.query('COMMIT');
      // The transaction-local setting is gone; the connection must not keep tenant A.
      const after = await client.query('SELECT count(*)::int AS n FROM customers');
      expect(after.rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe('with Tenant_Context', () => {
  it('shows organization A only its own rows and hides organization B rows', async () => {
    const rows = await inTenant(url, A.orgId, async (c) => (await c.query<{ id: string; org_id: string }>('SELECT id, org_id FROM customers')).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === A.orgId)).toBe(true);
    expect(rows.map((r) => r.id)).toContain(customerA);
    expect(rows.map((r) => r.id)).not.toContain(customerB);

    const orgs = await inTenant(url, A.orgId, async (c) => (await c.query<{ id: string }>('SELECT id FROM organizations')).rows);
    expect(orgs.map((o) => o.id)).toEqual([A.orgId]);
  });

  it('rejects inserting a row for another organization', async () => {
    const r = await attempt(url, A.orgId, insertCustomerSql, [randomUUID(), B.orgId, `X-${randomUUID().slice(0, 8)}`]);
    expect(r).toMatchObject({ ok: false, code: '42501' });
  });

  it('cannot update or delete another organization rows, and cannot move a row to another organization', async () => {
    const upd = await attempt(url, A.orgId, `UPDATE customers SET name = 'hijack' WHERE id = $1`, [customerB]);
    expect(upd).toMatchObject({ ok: true, rows: [] });
    const del = await attempt(url, A.orgId, `DELETE FROM customers WHERE id = $1`, [customerB]);
    expect(del).toMatchObject({ ok: true, rows: [] });
    const move = await attempt(url, A.orgId, `UPDATE customers SET org_id = $2 WHERE id = $1`, [customerA, B.orgId]);
    expect(move).toMatchObject({ ok: false, code: '42501' });

    const intact = await inTenant(migratorUrl(), B.orgId, async (c) => (await c.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [customerB])).rows);
    expect(intact).toEqual([{ name: 'Cust' }]);
  });
});

describe('append-only privileges', () => {
  it('grants only SELECT and INSERT on the append-only tables', async () => {
    const privileges = await inTenant(url, null, async (c) => {
      const out: Record<string, Record<string, boolean>> = {};
      for (const t of ['quotation_phase_history', 'gate_movements', 'audit_events']) {
        const r = await c.query<{ s: boolean; i: boolean; u: boolean; d: boolean; t: boolean }>(
          `SELECT has_table_privilege('fleet_app', $1, 'SELECT') AS s, has_table_privilege('fleet_app', $1, 'INSERT') AS i,
                  has_table_privilege('fleet_app', $1, 'UPDATE') AS u, has_table_privilege('fleet_app', $1, 'DELETE') AS d,
                  has_table_privilege('fleet_app', $1, 'TRUNCATE') AS t`,
          [t],
        );
        out[t] = r.rows[0];
      }
      return out;
    });
    for (const p of Object.values(privileges)) expect(p).toEqual({ s: true, i: true, u: false, d: false, t: false });
  });

  it('rejects UPDATE and DELETE on audit_events for the runtime role', async () => {
    const id = randomUUID();
    await inTenant(url, A.orgId, (c) =>
      c.query(`INSERT INTO audit_events (id, org_id, action, entity_type, correlation_id) VALUES ($1, $2, 'x', 'customer', $3)`, [id, A.orgId, randomUUID()]),
    );
    expect(await attempt(url, A.orgId, `UPDATE audit_events SET action = 'y' WHERE id = $1`, [id])).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(url, A.orgId, `DELETE FROM audit_events WHERE id = $1`, [id])).toMatchObject({ ok: false, code: '42501' });
  });

  it('gives the runtime role no access to the migration ledger', async () => {
    expect(await attempt(url, A.orgId, 'SELECT * FROM schema_migrations')).toMatchObject({ ok: false, code: '42501' });
  });
});

describe('identity_resolver', () => {
  it('is SECURITY DEFINER with a fixed search_path', async () => {
    const rows = await inTenant(migratorUrl(), null, async (c) =>
      (await c.query<{ prosecdef: boolean; proconfig: string[] }>(
        `SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'identity_resolver'`,
      )).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
  });

  it('returns only the matched active user, without any tenant context', async () => {
    const rows = await attempt<{ user_id: string; org_id: string; role_code: string; branch_id: string; all_branches: boolean }>(
      url,
      null,
      'SELECT * FROM identity_resolver($1)',
      [A.authSubject],
    );
    expect(rows).toMatchObject({ ok: true });
    if (rows.ok) {
      expect(rows.rows).toEqual([{ user_id: A.userId, org_id: A.orgId, role_code: 'admin', branch_id: A.branchId, all_branches: false }]);
    }
  });

  it('returns nothing for unknown subjects, wildcards, suspended users and inactive organizations', async () => {
    const suspended = await seedOrg('rls-suspended');
    await inTenant(migratorUrl(), suspended.orgId, (c) => c.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [suspended.userId]));
    const inactive = await seedOrg('rls-inactive');
    await inTenant(migratorUrl(), inactive.orgId, (c) => c.query(`UPDATE organizations SET status = 'INACTIVE' WHERE id = $1`, [inactive.orgId]));

    for (const subject of ['no-such-subject', '%', '', suspended.authSubject, inactive.authSubject]) {
      const r = await attempt(url, null, 'SELECT * FROM identity_resolver($1)', [subject]);
      expect(r, `subject "${subject}"`).toMatchObject({ ok: true, rows: [] });
    }
  });

  it('does not let the runtime role list users directly', async () => {
    const r = await attempt(url, null, 'SELECT id FROM users');
    expect(r).toMatchObject({ ok: true, rows: [] });
  });
});
