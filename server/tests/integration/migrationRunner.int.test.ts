// Integration tests for the migration runner against fleet_test only.
// Every test uses a temporary migrations directory and a dedicated throwaway schema that is dropped afterwards.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MigrationError, runMigrations } from '../../scripts/migrateLib.js';
import { assertTestDatabase } from './dbGuard.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'server', 'scripts', 'migrate.ts');

let url: string;
const schemas: string[] = [];
const dirs: string[] = [];

function newSchema(): string {
  const s = `mig_test_${randomBytes(5).toString('hex')}`;
  schemas.push(s);
  return s;
}

function newDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fleet-mig-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

const BASE_FILES = {
  // Written out of order on purpose: 0002 depends on 0001.
  '0002_child.sql': 'CREATE TABLE child (id int PRIMARY KEY, parent_id int NOT NULL REFERENCES parent(id));',
  '0001_parent.sql': 'CREATE TABLE parent (id int PRIMARY KEY);',
  'README.txt': 'ignored',
};

async function query<T extends pg.QueryResultRow>(schema: string, sql: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schema}"`);
    return (await c.query<T>(sql)).rows;
  } finally {
    await c.end();
  }
}

beforeAll(() => {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const u = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assertTestDatabase(u);
  url = u as string;
});

afterAll(async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const s of schemas) await c.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  } finally {
    await c.end();
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('migration runner (fleet_test)', () => {
  it('applies files in ascending order and records ledger rows with sha256 checksums', async () => {
    const schema = newSchema();
    const dir = newDir(BASE_FILES);
    const result = await runMigrations({ url, dir, schema });
    expect(result.applied).toEqual(['0001', '0002']);
    const rows = await query<{ version: string; name: string; checksum: string }>(
      schema,
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => [r.version, r.name])).toEqual([
      ['0001', 'parent'],
      ['0002', 'child'],
    ]);
    for (const r of rows) expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies nothing on a second run and succeeds', async () => {
    const schema = newSchema();
    const dir = newDir(BASE_FILES);
    await runMigrations({ url, dir, schema });
    const second = await runMigrations({ url, dir, schema });
    expect(second.applied).toEqual([]);
    const rows = await query(schema, 'SELECT 1 FROM schema_migrations');
    expect(rows).toHaveLength(2);
  });

  it('rolls back a failing migration together with its ledger row', async () => {
    const schema = newSchema();
    const dir = newDir({
      '0001_ok.sql': 'CREATE TABLE ok_table (id int);',
      '0002_bad.sql': 'CREATE TABLE half_done (id int); SELECT 1/0;',
    });
    await expect(runMigrations({ url, dir, schema })).rejects.toMatchObject({ version: '0002' });
    const ledger = await query<{ version: string }>(schema, 'SELECT version FROM schema_migrations');
    expect(ledger.map((r) => r.version)).toEqual(['0001']);
    const t = await query<{ n: string }>(
      schema,
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = 'half_done'`,
    );
    expect(t[0].n).toBe('0');
  });

  it('fails on a checksum change, names the version and applies nothing further', async () => {
    const schema = newSchema();
    const dir = newDir(BASE_FILES);
    await runMigrations({ url, dir, schema });
    writeFileSync(path.join(dir, '0001_parent.sql'), 'CREATE TABLE parent (id int PRIMARY KEY); -- edited');
    writeFileSync(path.join(dir, '0003_new.sql'), 'CREATE TABLE should_not_exist (id int);');
    const err = await runMigrations({ url, dir, schema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).version).toBe('0001');
    expect((err as MigrationError).message).toContain('0001');
    expect((err as MigrationError).exitCode).not.toBe(0);
    const ledger = await query(schema, 'SELECT 1 FROM schema_migrations');
    expect(ledger).toHaveLength(2);
  });

  it('does not double-apply when runners start concurrently', async () => {
    const schema = newSchema();
    const dir = newDir({
      '0001_counter.sql':
        'CREATE TABLE applied_log (n int); SELECT pg_sleep(0.5); INSERT INTO applied_log VALUES (1);',
      '0002_more.sql': 'INSERT INTO applied_log VALUES (2);',
    });
    const results = await Promise.all([1, 2, 3].map(() => runMigrations({ url, dir, schema })));
    const allApplied = results.flatMap((r) => r.applied).sort();
    expect(allApplied).toEqual(['0001', '0002']);
    const log = await query<{ n: number }>(schema, 'SELECT n FROM applied_log ORDER BY n');
    expect(log.map((r) => r.n)).toEqual([1, 2]);
    const ledger = await query(schema, 'SELECT 1 FROM schema_migrations');
    expect(ledger).toHaveLength(2);
  });

  it('rejects a blank MIGRATION_DATABASE_URL without connecting', async () => {
    const dir = newDir(BASE_FILES);
    await expect(runMigrations({ url: '', dir })).rejects.toBeInstanceOf(MigrationError);
    await expect(runMigrations({ url: '   ', dir })).rejects.toBeInstanceOf(MigrationError);
  });

  it('refuses an odoo_dev target before any SQL (unreachable host proves no connection attempt)', async () => {
    const dir = newDir(BASE_FILES);
    const err = await runMigrations({
      url: 'postgres://nobody:nopass@127.0.0.1:1/odoo_dev',
      dir,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).message).toContain('odoo_dev');
    expect((err as MigrationError).message).not.toMatch(/ECONNREFUSED/);
  });

  describe('CLI', () => {
    // Runs in an empty working directory so the repository .env is never loaded.
    function runCli(env: Record<string, string>) {
      const cwd = newDir({});
      const tsx = pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
      return spawnSync(process.execPath, ['--import', tsx, CLI], {
        cwd,
        env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
        encoding: 'utf8',
        timeout: 60_000,
      });
    }

    it('exits non-zero when MIGRATION_DATABASE_URL is blank', () => {
      const r = runCli({ MIGRATIONS_DIR: newDir(BASE_FILES) });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('MIGRATION_DATABASE_URL');
    });

    it('exits non-zero for an odoo_dev target', () => {
      const r = runCli({
        MIGRATION_DATABASE_URL: 'postgres://nobody:nopass@127.0.0.1:1/odoo_dev',
        MIGRATIONS_DIR: newDir(BASE_FILES),
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('odoo_dev');
      expect(r.stderr).not.toContain('nopass');
    });
  });
});
