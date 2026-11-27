// Task 15.2: the dev seed command against fleet_test (Requirement 16.1-16.4).
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { devFixtureSubject } from '../../src/auth/devFixtureAuth.js';
import { resolvePrincipal } from '../../src/auth/middleware.js';
import { SeedError, countSeedRows, runSeed } from '../../scripts/seedDevLib.js';
import { appUrl, inTenant, migrateTestDb, migratorUrl, resetPublicSchema } from './testDb.js';

const DEV_USER_ID = '5d1b7c52-3f0e-4a8a-9d52-0c6f2b8a9e11';
const CANONICAL_CUSTOMERS = [
  'ABC Company LLC', 'DEF Company LLC', 'GHI Company PJSC', 'JKL Company LLC',
  'MNO Company LLC', 'CK Groups', 'Damac Properties', 'Arabtec Construction LLC',
];

const seed = () => runSeed({ url: migratorUrl(), devUserId: DEV_USER_ID, nodeEnv: 'test' });

describe('seed:dev against fleet_test', () => {
  beforeAll(async () => {
    await resetPublicSchema();
    await migrateTestDb();
  });

  it('creates the fixture data, and a second run creates no duplicates', async () => {
    const first = await seed();
    const second = await seed();
    expect(second.orgId).toBe(first.orgId);
    expect(second.counts).toEqual(first.counts);
    expect(first.counts).toMatchObject({
      organizations: 1, branches: 3, users: 1, customers: 8, machines: 5, quotations: 4, hire_agreements: 1, customer_lpos: 1,
    });

    await inTenant(migratorUrl(), first.orgId, async (c) => {
      const names = (await c.query<{ name: string }>('SELECT name FROM customers ORDER BY customer_code')).rows.map((r) => r.name);
      expect(names).toEqual(CANONICAL_CUSTOMERS);
      const fleet = (await c.query<{ fleet_no: string }>('SELECT fleet_no FROM machines ORDER BY fleet_no')).rows.map((r) => r.fleet_no);
      expect(fleet).toEqual(['J101', 'J102', 'J103', 'J104', 'J105']);
      const phases = (await c.query<{ phase: string }>('SELECT DISTINCT phase FROM quotations ORDER BY phase')).rows.map((r) => r.phase);
      expect(phases).toEqual(['AWAITING', 'LOST', 'TENDER', 'WON']);
      const rules = (await c.query<{ gating_rules: Record<string, boolean> }>('SELECT gating_rules FROM organizations')).rows[0];
      expect(Object.keys(rules.gating_rules)).toHaveLength(7);
      expect(await countSeedRows(c, first.orgId)).toEqual(first.counts);
    });
  });

  it('resolves the fixture user through the identity resolver with the runtime role', async () => {
    const pool = new pg.Pool({ connectionString: appUrl(), max: 1 });
    try {
      const principal = await resolvePrincipal(pool, devFixtureSubject(DEV_USER_ID), 'development-fixture');
      expect(principal?.userId).toBe(DEV_USER_ID);
      expect(principal?.roleCode).toBe('managing-director');
      expect(principal?.permissions).toContain('quotations.write');
    } finally {
      await pool.end();
    }
  });

  it('advances the number sequences past the seeded numbers', async () => {
    const { orgId } = await seed();
    const rows = await inTenant(migratorUrl(), orgId, async (c) =>
      (await c.query<{ sequence_kind: string; next_value: string }>(
        `SELECT sequence_kind, next_value FROM number_sequences ORDER BY sequence_kind`,
      )).rows,
    );
    expect(rows).toEqual([
      { sequence_kind: 'AGREEMENT', next_value: '2' },
      { sequence_kind: 'CUSTOMER', next_value: '9' },
      { sequence_kind: 'QUOTATION', next_value: '5' },
    ]);
  });

  describe('refusals (no connection is made)', () => {
    const url = (db: string) => `postgres://u:p@127.0.0.1:1/${db}`;

    it('refuses NODE_ENV=production even on a test database', async () => {
      await expect(runSeed({ url: migratorUrl(), devUserId: DEV_USER_ID, nodeEnv: 'production' })).rejects.toThrow(SeedError);
    });

    it.each(['odoo_dev', 'odoo', 'postgres', 'fleet_prod', 'fleet_testing', 'my_fleet_test'])('refuses database %s', async (db) => {
      await expect(runSeed({ url: url(db), devUserId: DEV_USER_ID, nodeEnv: 'development' })).rejects.toThrow(/Refusing to seed/);
    });

    it('refuses a missing URL and a missing or invalid DEV_AUTH_USER_ID', async () => {
      await expect(runSeed({ url: '', devUserId: DEV_USER_ID, nodeEnv: 'development' })).rejects.toThrow(SeedError);
      await expect(runSeed({ url: url('fleet_local'), devUserId: '', nodeEnv: 'development' })).rejects.toThrow(/DEV_AUTH_USER_ID/);
      await expect(runSeed({ url: url('fleet_local'), devUserId: 'not-a-uuid', nodeEnv: 'development' })).rejects.toThrow(/DEV_AUTH_USER_ID/);
    });
  });
});
