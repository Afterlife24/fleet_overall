// Task 6.6: migrate an empty fleet_test and verify the 37 business tables.
// The role that migrates has no CREATEDB, so "empty" means a freshly recreated public schema in fleet_test.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { BUSINESS_TABLES, migrateTestDb, migratorUrl, resetPublicSchema } from './testDb.js';

async function q<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: migratorUrl() });
  await c.connect();
  try {
    return (await c.query<T>(sql)).rows;
  } finally {
    await c.end();
  }
}

describe('schema migration from empty (fleet_test)', () => {
  it('applies all ten migrations and creates exactly the 37 business tables plus schema_migrations', async () => {
    await resetPublicSchema();
    const first = await migrateTestDb();
    expect(first.applied).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010']);

    const tables = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const names = tables.map((t) => t.table_name);
    expect(BUSINESS_TABLES).toHaveLength(37);
    expect(names.filter((n) => n !== 'schema_migrations')).toEqual([...BUSINESS_TABLES].sort());
    expect(names).toContain('schema_migrations');

    const ledger = await q<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
    expect(ledger).toHaveLength(10);
    for (const row of ledger) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies nothing on a second run', async () => {
    const again = await migrateTestDb();
    expect(again.applied).toEqual([]);
    const ledger = await q('SELECT 1 FROM schema_migrations');
    expect(ledger).toHaveLength(10);
  });

  it('enables and forces row level security on every business table', async () => {
    const rows = await q<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'`,
    );
    expect(rows).toHaveLength(37);
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
  });
});
