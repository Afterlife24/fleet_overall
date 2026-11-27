// Shared helpers for schema integration tests. Everything here targets fleet_test only:
// every entry point asserts the database name contains "fleet_test" before touching it.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runMigrations } from '../../scripts/migrateLib.js';
import { assertTestDatabase } from './dbGuard.js';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', '..', 'migrations');

/** The 37 business tables of DATABASE_DESIGN.md (schema_migrations is deployment metadata, not one of them). */
export const BUSINESS_TABLES = [
  'organizations', 'branches', 'roles', 'users', 'organization_apps', 'custom_field_definitions',
  'customers', 'machine_models', 'machines', 'machine_documents',
  'quotations', 'quotation_phase_history', 'hire_agreements', 'customer_lpos', 'bookings',
  'invoices', 'invoice_lines',
  'drivers', 'transport_vehicles', 'transport_jobs',
  'gate_passes', 'gate_movements', 'collection_notes', 'mqd_reports',
  'third_party_service_reports', 'third_party_service_lines', 'delivery_notes',
  'inspections', 'inspection_results',
  'files', 'documents', 'document_versions', 'document_files', 'evidence_attachments',
  'number_sequences', 'idempotency_keys', 'audit_events',
] as const;

export function loadTestEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env'); // does not override variables already set
}

/** Connection string of the migration role against fleet_test. */
export function migratorUrl(): string {
  loadTestEnv();
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assertTestDatabase(url);
  return url as string;
}

/** Runtime-role (fleet_app) URL for fleet_test: host/port/db from TEST_DATABASE_URL, credentials from DATABASE_URL. */
export function appUrl(): string {
  loadTestEnv();
  const test = new URL(migratorUrl());
  const app = process.env.DATABASE_URL;
  if (!app) throw new Error('DATABASE_URL (runtime role credentials) is required for runtime-role tests.');
  const creds = new URL(app);
  test.username = creds.username;
  test.password = creds.password;
  return test.toString();
}

/** Drops and recreates the public schema of fleet_test (as its owner). Never call on another database. */
export async function resetPublicSchema(): Promise<void> {
  const client = new pg.Client({ connectionString: migratorUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
    assertTestDatabase(`postgres://x@localhost/${rows[0].db}`);
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

/** Applies every migration to fleet_test (no-op when already applied). */
export async function migrateTestDb(): Promise<{ applied: string[] }> {
  const { applied } = await runMigrations({ url: migratorUrl(), dir: MIGRATIONS_DIR });
  return { applied };
}

export interface SqlFailure {
  ok: false;
  code: string | undefined;
  constraint: string | undefined;
  message: string;
}
export type SqlResult<T> = { ok: true; rows: T[] } | SqlFailure;

/** Runs `fn` in one transaction with the transaction-local tenant context set (or none when orgId is null). */
export async function inTenant<T>(
  url: string,
  orgId: string | null,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (orgId) await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    await client.end();
  }
}

/** Runs one statement in its own transaction and reports success or the PostgreSQL error code/constraint. */
export async function attempt<T extends pg.QueryResultRow = pg.QueryResultRow>(
  url: string,
  orgId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<SqlResult<T>> {
  try {
    const rows = await inTenant(url, orgId, async (c) => (await c.query<T>(sql, params)).rows);
    return { ok: true, rows };
  } catch (err) {
    const e = err as { code?: string; constraint?: string; message?: string };
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message ?? String(err) };
  }
}

export interface SeededOrg {
  orgId: string;
  roleId: string;
  userId: string;
  branchId: string;
  authSubject: string;
}

const GATING = {
  requireQuote: true, requireHaSent: true, requireHaReceived: true, requireLpo: false,
  blockCreditHold: true, requireTpcValid: true, warnOverdueInspection: true,
};

/** Seeds an organization with one branch, role and user as the migration role (the table owner). */
export async function seedOrg(label: string): Promise<SeededOrg> {
  const orgId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const branchId = randomUUID();
  const authSubject = `sub-${label}-${orgId}`;
  await inTenant(migratorUrl(), orgId, async (c) => {
    await c.query(
      `INSERT INTO organizations (id, code, name, address, timezone, currency_code, vat_rate, gating_rules)
       VALUES ($1, $2, $3, 'Test address', 'Asia/Dubai', 'AED', 0.05, $4)`,
      [orgId, `org-${orgId}`, `Org ${label}`, JSON.stringify(GATING)],
    );
    await c.query(
      `INSERT INTO branches (id, org_id, code, name, country_code, city, address, timezone)
       VALUES ($1, $2, 'MAIN', 'Main', 'AE', 'Dubai', 'Yard', 'Asia/Dubai')`,
      [branchId, orgId],
    );
    await c.query(
      `INSERT INTO roles (id, org_id, code, name, permissions, app_codes) VALUES ($1, $2, 'admin', 'Admin', '{}', '{}')`,
      [roleId, orgId],
    );
    await c.query(
      `INSERT INTO users (id, org_id, role_id, branch_id, normalized_email, display_name, auth_provider, auth_subject)
       VALUES ($1, $2, $3, $4, $5, 'Test User', 'test', $6)`,
      [userId, orgId, roleId, branchId, `${label}-${orgId}@example.test`, authSubject],
    );
  });
  return { orgId, roleId, userId, branchId, authSubject };
}
