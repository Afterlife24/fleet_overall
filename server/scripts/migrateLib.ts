// Migration runner library. The CLI wrapper is server/scripts/migrate.ts.
// Rules (Requirement 3): ordered apply, sha256 ledger written in the same transaction as each
// migration, advisory lock against concurrent runners, target database guard, never drops anything.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { buildPgSsl, type SslMode } from '../src/config.js';

/** Database names that must never be a migration target (Odoo). */
export const ODOO_DENYLIST: readonly string[] = ['odoo_dev', 'odoo'];

/** Test databases: `fleet_test` or `fleet_test_<suffix>` (throwaway databases). */
export const TEST_DB_PATTERN = /^fleet_test(_[a-z0-9_]{1,40})?$/;

export interface TargetConfig {
  /** Non-test application database names that may be migrated. */
  applicationDatabases: readonly string[];
  denylist: readonly string[];
}

export const DEFAULT_TARGET_CONFIG: TargetConfig = {
  applicationDatabases: ['fleet_local'],
  denylist: ODOO_DENYLIST,
};

export class MigrationError extends Error {
  readonly exitCode: number;
  readonly version?: string;
  constructor(message: string, exitCode = 1, version?: string) {
    super(message);
    this.name = 'MigrationError';
    this.exitCode = exitCode;
    this.version = version;
  }
}

export const EXIT_CHECKSUM_MISMATCH = 2;

export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** True when the checksum recorded in the ledger differs from the checksum of the file now on disk. */
export function checksumMismatch(applied: string, current: string): boolean {
  return applied.trim().toLowerCase() !== current.trim().toLowerCase();
}

/** Throws MigrationError unless `dbName` is the application database or a test database and is not denylisted. */
export function assertAllowedTarget(dbName: string, config: TargetConfig = DEFAULT_TARGET_CONFIG): void {
  const normalized = dbName.trim().toLowerCase();
  if (config.denylist.some((d) => d.trim().toLowerCase() === normalized)) {
    throw new MigrationError(`Refusing to migrate database "${dbName}": it is on the Odoo denylist.`);
  }
  if (dbName !== dbName.trim() || !(config.applicationDatabases.includes(dbName) || TEST_DB_PATTERN.test(dbName))) {
    throw new MigrationError(
      `Refusing to migrate database "${dbName}": only the application database (${config.applicationDatabases.join(', ')}) or a fleet_test database is allowed.`,
    );
  }
}

export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MigrationError('MIGRATION_DATABASE_URL is not a valid URL.');
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

const FILE_PATTERN = /^(\d{4,})_([A-Za-z0-9_]+)\.sql$/;

/** Reads `NNNN_name.sql` files in ascending version order. */
export function loadMigrationFiles(dir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const entry of readdirSync(dir)) {
    const m = FILE_PATTERN.exec(entry);
    if (!m) continue;
    const sql = readFileSync(path.join(dir, entry), 'utf8');
    files.push({ version: m[1], name: m[2], file: entry, sql, checksum: sha256Hex(sql) });
  }
  files.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  for (let i = 1; i < files.length; i++) {
    if (files[i].version === files[i - 1].version) {
      throw new MigrationError(`Duplicate migration version ${files[i].version}.`);
    }
  }
  return files;
}

/** Fixed application-wide advisory lock key ("fleetmig" as an int). */
export const MIGRATION_LOCK_KEY = 0x666c6d67;

export interface RunOptions {
  /** Connection string of the migration role. Blank is rejected. */
  url: string | undefined;
  dir: string;
  target?: TargetConfig;
  sslMode?: SslMode;
  caFile?: string;
  /** Optional dedicated schema holding the ledger and migrated objects (used by tests). */
  schema?: string;
  log?: (message: string) => void;
}

export interface RunResult {
  applied: string[];
  skipped: number;
}

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

export async function runMigrations(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => undefined);
  if (!opts.url || opts.url.trim() === '') {
    throw new MigrationError('MIGRATION_DATABASE_URL is required and is blank.');
  }
  // Guard runs before any connection so a refused target never receives SQL.
  assertAllowedTarget(databaseNameFromUrl(opts.url), opts.target);
  if (opts.schema !== undefined && !SAFE_SCHEMA.test(opts.schema)) {
    throw new MigrationError('Invalid migration schema name.');
  }
  const files = loadMigrationFiles(opts.dir);

  const client = new pg.Client({
    connectionString: opts.url,
    ssl: buildPgSsl(opts.sslMode ?? 'disable', opts.caFile),
  });
  await client.connect();
  let locked = false;
  try {
    // Blocks until a concurrent runner finishes, then re-reads the ledger below.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    locked = true;

    if (opts.schema) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${opts.schema}"`);
      await client.query(`SET search_path TO "${opts.schema}"`);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const ledger = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const appliedByVersion = new Map(ledger.rows.map((r) => [r.version, r.checksum]));

    for (const f of files) {
      const recorded = appliedByVersion.get(f.version);
      if (recorded !== undefined && checksumMismatch(recorded, f.checksum)) {
        throw new MigrationError(
          `Checksum mismatch for applied migration ${f.version} (${f.file}). The file changed after it was applied.`,
          EXIT_CHECKSUM_MISMATCH,
          f.version,
        );
      }
    }

    const applied: string[] = [];
    for (const f of files) {
      if (appliedByVersion.has(f.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(f.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          f.version,
          f.name,
          f.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = err instanceof Error ? err.message : String(err);
        throw new MigrationError(`Migration ${f.version} (${f.file}) failed: ${detail}`, 1, f.version);
      }
      applied.push(f.version);
      log(`applied ${f.file}`);
    }
    return { applied, skipped: files.length - applied.length };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
