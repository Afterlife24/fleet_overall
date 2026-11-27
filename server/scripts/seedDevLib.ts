// Development seed library. The CLI wrapper is server/scripts/seedDev.ts (`npm run db:seed:dev`).
// Rules (Requirement 16): refuses production and any database other than fleet_local or a fleet_test*
// database, is idempotent (natural-key upserts, so a rerun creates no duplicates), runs as the migration
// role and sets the transaction-local tenant context before writing because every table has FORCE RLS.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { devFixtureSubject } from '../src/auth/devFixtureAuth.js';
import { defaultActionsForRole, roleCodeFromName } from '../src/auth/principal.js';
import { withDependencies } from '../src/constants/appCatalog.js';
import { buildPgSsl, type SslMode } from '../src/config.js';
import { DEFAULT_TARGET_CONFIG, TEST_DB_PATTERN, databaseNameFromUrl, ODOO_DENYLIST } from './migrateLib.js';

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SEED_ORG_CODE = 'dev-fleet';
export const SEED_USER_EMAIL = 'dev.fixture@example.test';
/** Fixed year in the seeded document numbers, so a rerun in another year still finds the same rows. */
export const SEED_YEAR = 2026;

/** Tables the seed fills, in the order reported. */
export const SEED_TABLES = [
  'organizations', 'branches', 'roles', 'users', 'organization_apps', 'customers', 'machine_models', 'machines',
  'quotations', 'quotation_phase_history', 'hire_agreements', 'customer_lpos', 'number_sequences',
] as const;
export type SeedCounts = Record<(typeof SEED_TABLES)[number], number>;

/** Throws SeedError unless the environment and database are allowed. Runs before any connection. */
export function assertSeedAllowed(nodeEnv: string | undefined, url: string | undefined, devUserId: string | undefined): string {
  if ((nodeEnv ?? '').trim().toLowerCase() === 'production') {
    throw new SeedError('Refusing to seed: NODE_ENV is production.');
  }
  if (!url || url.trim() === '') throw new SeedError('MIGRATION_DATABASE_URL is required and is blank.');
  let name: string;
  try {
    name = databaseNameFromUrl(url);
  } catch {
    throw new SeedError('MIGRATION_DATABASE_URL is not a valid URL.');
  }
  assertSeedDatabaseName(name);
  if (!devUserId || !UUID_RE.test(devUserId)) throw new SeedError('DEV_AUTH_USER_ID must be set to a UUID.');
  return name;
}

/** Only fleet_local and fleet_test / fleet_test_<suffix> may be seeded; the Odoo databases never. */
export function assertSeedDatabaseName(name: string): void {
  if (ODOO_DENYLIST.includes(name.trim().toLowerCase())) {
    throw new SeedError(`Refusing to seed database "${name}": it is on the Odoo denylist.`);
  }
  if (!(DEFAULT_TARGET_CONFIG.applicationDatabases.includes(name) || TEST_DB_PATTERN.test(name))) {
    throw new SeedError(`Refusing to seed database "${name}": only fleet_local or a fleet_test database is allowed.`);
  }
}

const GATING_RULES = {
  requireQuote: true,
  requireHaSent: true,
  requireHaReceived: true,
  requireLpo: false,
  blockCreditHold: true,
  requireTpcValid: true,
  warnOverdueInspection: true,
};

const BRANCHES = [
  { code: 'DXB', name: 'Dubai Main Yard', city: 'Dubai', address: 'Al Quoz Industrial Area 3, Dubai' },
  { code: 'AUH', name: 'Abu Dhabi Depot', city: 'Abu Dhabi', address: 'Mussafah Industrial Area, Abu Dhabi' },
  { code: 'SHJ', name: 'Sharjah Yard', city: 'Sharjah', address: 'Industrial Area 12, Sharjah' },
];

// The CRM-chain roles; the fixture user is the Managing Director.
const ROLE_NAMES = ['Managing Director', 'Operations Manager', 'Ops Executive', 'Sales Manager', 'Sales Executive', 'Finance'];
const FIXTURE_ROLE = roleCodeFromName('Managing Director');
const CRM_CHAIN_APPS = [...new Set([
  'dashboard', 'fleet', 'quotation', 'lpo', 'crm', 'customer_ani', 'invoice',
  // Full rental chain (stages 2+).
  'planner', 'transport', 'gate', 'delivery_note', 'collection_note', 'mqd', 'third_party_services', 'phi',
].flatMap(withDependencies))];

const CUSTOMERS = [
  'ABC Company LLC', 'DEF Company LLC', 'GHI Company PJSC', 'JKL Company LLC',
  'MNO Company LLC', 'CK Groups', 'Damac Properties', 'Arabtec Construction LLC',
];

const MODELS = [
  { make: 'JLG', model: '1930ES', category: 'Scissor Lift', power: 'Electric', platform: 5.8, working: 7.8, capacity: 230 },
  { make: 'Genie', model: 'GS-3246', category: 'Scissor Lift', power: 'Electric', platform: 9.7, working: 11.7, capacity: 320 },
  { make: 'Skyjack', model: 'SJ63 AJ', category: 'Boom Lift', power: 'Diesel', platform: 20.5, working: 22.5, capacity: 230 },
];

const MACHINES = [
  { fleet: 'J101', model: 0, branch: 'DXB', year: 2022 },
  { fleet: 'J102', model: 0, branch: 'DXB', year: 2022 },
  { fleet: 'J103', model: 1, branch: 'DXB', year: 2021 },
  { fleet: 'J104', model: 1, branch: 'AUH', year: 2023 },
  { fleet: 'J105', model: 2, branch: 'SHJ', year: 2020 },
];

type Phase = 'AWAITING' | 'TENDER' | 'LOST' | 'WON';
interface QuoteSeed {
  customer: number;
  opportunity: string;
  amount: number;
  phase: Phase;
  path: Phase[]; // phases after creation, in order
  reason?: string;
}
const QUOTATIONS: QuoteSeed[] = [
  { customer: 0, opportunity: 'ABC tower scissor lifts', amount: 18000, phase: 'AWAITING', path: [] },
  { customer: 1, opportunity: 'DEF warehouse boom lift', amount: 26500, phase: 'TENDER', path: ['TENDER'] },
  { customer: 2, opportunity: 'GHI facade works', amount: 41000, phase: 'LOST', path: ['TENDER', 'LOST'], reason: 'Customer chose another supplier on price.' },
  { customer: 3, opportunity: 'JKL mall fit-out', amount: 12500, phase: 'WON', path: ['TENDER', 'WON'] },
];

const pad = (n: number, width = 4): string => String(n).padStart(width, '0');

export interface SeedOptions {
  /** Migration-role connection string (MIGRATION_DATABASE_URL). */
  url: string | undefined;
  devUserId: string | undefined;
  nodeEnv?: string;
  sslMode?: SslMode;
  caFile?: string;
  log?: (message: string) => void;
}

export interface SeedResult {
  orgId: string;
  userId: string;
  database: string;
  counts: SeedCounts;
}

async function one<T extends pg.QueryResultRow>(c: pg.Client, sql: string, params: unknown[]): Promise<T> {
  const r = await c.query<T>(sql, params);
  if (!r.rows[0]) throw new SeedError(`Seed lookup returned no row: ${sql.slice(0, 60)}`);
  return r.rows[0];
}

/** Counts the seeded tables for one organization (call inside its tenant context). */
export async function countSeedRows(c: pg.Client, orgId: string): Promise<SeedCounts> {
  const counts = {} as SeedCounts;
  for (const t of SEED_TABLES) {
    const sql =
      t === 'organizations' ? 'SELECT count(*)::int AS n FROM organizations WHERE id = $1' : `SELECT count(*)::int AS n FROM ${t} WHERE org_id = $1`;
    counts[t] = (await one<{ n: number }>(c, sql, [orgId])).n;
  }
  return counts;
}

export async function runSeed(opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  const database = assertSeedAllowed(opts.nodeEnv, opts.url, opts.devUserId);
  const userId = (opts.devUserId as string).toLowerCase();

  const client = new pg.Client({ connectionString: opts.url, ssl: buildPgSsl(opts.sslMode ?? 'disable', opts.caFile) });
  await client.connect();
  try {
    // Defense in depth: the server's own database name must pass the guard as well.
    assertSeedDatabaseName((await one<{ db: string }>(client, 'SELECT current_database() AS db', [])).db);

    await client.query('BEGIN');
    try {
      // The identity_resolver_read policy lets the owner role find the organization before any tenant context.
      const existing = await client.query<{ id: string }>('SELECT id FROM organizations WHERE code = $1', [SEED_ORG_CODE]);
      const orgId = existing.rows[0]?.id ?? randomUUID();
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);

      await client.query(
        `INSERT INTO organizations (id, code, name, trade_license, tax_registration_no, address, phone, email, timezone,
                                    currency_code, vat_rate, gating_rules)
         VALUES ($1, $2, 'Dev Fleet Rental LLC', 'DEV-TL-0001', 'DEV-TRN-100000000000003', 'Al Quoz Industrial Area 3, Dubai',
                 '+971 4 000 0000', 'info@dev-fleet.example.test', 'Asia/Dubai', 'AED', 0.05, $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [orgId, SEED_ORG_CODE, JSON.stringify(GATING_RULES)],
      );

      const branchIds = new Map<string, string>();
      for (const b of BRANCHES) {
        await client.query(
          `INSERT INTO branches (org_id, code, name, country_code, city, address, timezone)
           VALUES ($1, $2, $3, 'AE', $4, $5, 'Asia/Dubai') ON CONFLICT (org_id, code) DO NOTHING`,
          [orgId, b.code, b.name, b.city, b.address],
        );
        branchIds.set(b.code, (await one<{ id: string }>(client, 'SELECT id FROM branches WHERE org_id = $1 AND code = $2', [orgId, b.code])).id);
      }

      const roleIds = new Map<string, string>();
      for (const name of ROLE_NAMES) {
        const code = roleCodeFromName(name);
        await client.query(
          `INSERT INTO roles (org_id, code, name, permissions, app_codes) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_id, code) DO UPDATE SET permissions = EXCLUDED.permissions, app_codes = EXCLUDED.app_codes,
             updated_at = now(), row_version = roles.row_version + 1
           WHERE roles.permissions IS DISTINCT FROM EXCLUDED.permissions OR roles.app_codes IS DISTINCT FROM EXCLUDED.app_codes`,
          [orgId, code, name, defaultActionsForRole(code), CRM_CHAIN_APPS],
        );
        roleIds.set(code, (await one<{ id: string }>(client, 'SELECT id FROM roles WHERE org_id = $1 AND code = $2', [orgId, code])).id);
      }

      // The fixture user: id = DEV_AUTH_USER_ID, auth_subject = devFixtureSubject(id).
      const clash = await client.query<{ id: string }>('SELECT id FROM users WHERE normalized_email = $1 OR auth_subject = $2', [
        SEED_USER_EMAIL,
        devFixtureSubject(userId),
      ]);
      if (clash.rows.some((r) => r.id !== userId)) {
        throw new SeedError('A fixture user with a different DEV_AUTH_USER_ID already exists in this database; remove it or use the original id.');
      }
      await client.query(
        `INSERT INTO users (id, org_id, role_id, branch_id, normalized_email, display_name, auth_provider, auth_subject,
                            is_owner, all_branches, avatar_color)
         VALUES ($1, $2, $3, $4, $5, 'Dev Fixture User', 'development-fixture', $6, true, true, '#2563eb')
         ON CONFLICT (id) DO NOTHING`,
        [userId, orgId, roleIds.get(FIXTURE_ROLE), branchIds.get('DXB'), SEED_USER_EMAIL, devFixtureSubject(userId)],
      );

      for (const app of CRM_CHAIN_APPS) {
        await client.query(
          `INSERT INTO organization_apps (org_id, app_code, active, onboarded, created_by, updated_by)
           VALUES ($1, $2, true, true, $3, $3) ON CONFLICT (org_id, app_code) DO NOTHING`,
          [orgId, app, userId],
        );
      }

      const customerIds: string[] = [];
      for (const [i, name] of CUSTOMERS.entries()) {
        const code = `CUS-${SEED_YEAR}${pad(i + 1)}`;
        await client.query(
          `INSERT INTO customers (org_id, customer_code, name, email, phone, address, credit_limit, branch_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, 50000, $7, $8, $8) ON CONFLICT (org_id, customer_code) DO NOTHING`,
          [
            orgId, code, name, `accounts${i + 1}@example.test`, `+971 4 100 ${pad(i + 1)}`, `Office ${i + 1}, Business Bay, Dubai`,
            branchIds.get('DXB'), userId,
          ],
        );
        customerIds.push((await one<{ id: string }>(client, 'SELECT id FROM customers WHERE org_id = $1 AND customer_code = $2', [orgId, code])).id);
      }

      const modelIds: string[] = [];
      for (const m of MODELS) {
        await client.query(
          `INSERT INTO machine_models (org_id, make, model, category, power_source, platform_height_m, working_height_m, capacity_kg,
                                       created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (org_id, make, model) DO NOTHING`,
          [orgId, m.make, m.model, m.category, m.power, m.platform, m.working, m.capacity, userId],
        );
        modelIds.push(
          (await one<{ id: string }>(client, 'SELECT id FROM machine_models WHERE org_id = $1 AND make = $2 AND model = $3', [orgId, m.make, m.model])).id,
        );
      }

      for (const m of MACHINES) {
        const model = MODELS[m.model];
        const branch = BRANCHES.find((b) => b.code === m.branch);
        await client.query(
          `INSERT INTO machines (org_id, branch_id, model_id, asset_no, fleet_no, serial_no, manufacture_year, power_source,
                                 platform_height_m, working_height_m, capacity_kg, current_location, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) ON CONFLICT (org_id, fleet_no) DO NOTHING`,
          [
            orgId, branchIds.get(m.branch), modelIds[m.model], `AST-${m.fleet}`, m.fleet, `SN-${m.fleet}-${m.year}`, m.year,
            model.power, model.platform, model.working, model.capacity, branch?.name ?? 'Yard', userId,
          ],
        );
      }

      const quotationIds: string[] = [];
      for (const [i, q] of QUOTATIONS.entries()) {
        const no = `QT-${SEED_YEAR}${pad(i + 1)}`;
        const won = q.phase === 'WON';
        const lost = q.phase === 'LOST';
        await client.query(
          `INSERT INTO quotations (org_id, branch_id, customer_id, quotation_no, opportunity, email, amount, currency_code, phase,
                                   sales_user_id, lost_reason, lost_at, lost_by, won_at, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'AED', $8, $9, $10,
                   CASE WHEN $11::boolean THEN now() END, CASE WHEN $11::boolean THEN $9::uuid END,
                   CASE WHEN $12::boolean THEN now() END, $9, $9)
           ON CONFLICT (org_id, quotation_no) DO NOTHING`,
          [
            orgId, branchIds.get('DXB'), customerIds[q.customer], no, q.opportunity, `accounts${q.customer + 1}@example.test`, q.amount,
            q.phase, userId, lost ? (q.reason ?? null) : null, lost, won,
          ],
        );
        const quotationId = (await one<{ id: string }>(client, 'SELECT id FROM quotations WHERE org_id = $1 AND quotation_no = $2', [orgId, no])).id;
        quotationIds.push(quotationId);

        // Phase history: creation, then each step. source_key is stable, so a rerun inserts nothing.
        const steps: Array<[Phase | null, Phase]> = [[null, 'AWAITING']];
        let prev: Phase = 'AWAITING';
        for (const next of q.path) {
          steps.push([prev, next]);
          prev = next;
        }
        for (const [n, [from, to]] of steps.entries()) {
          await client.query(
            `INSERT INTO quotation_phase_history (org_id, quotation_id, from_phase, to_phase, actor_user_id, reason, source, source_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $5) ON CONFLICT (org_id, source_key) DO NOTHING`,
            [orgId, quotationId, from, to, userId, to === 'LOST' ? (q.reason ?? null) : null, `seed:${no}:${n}`],
          );
        }
      }

      // One hire agreement and one LPO on the WON quotation.
      const wonIdx = QUOTATIONS.findIndex((q) => q.phase === 'WON');
      const wonCustomer = CUSTOMERS[QUOTATIONS[wonIdx].customer];
      const agreementNo = `HA-${SEED_YEAR}${pad(1)}`;
      const machine = MACHINES[0];
      const mm = MODELS[machine.model];
      await client.query(
        `INSERT INTO hire_agreements (org_id, quotation_id, customer_id, agreement_no, agreement_date, status, issuer_snapshot,
                                      customer_snapshot, equipment_name, equipment_model, serial_number, quantity, capacity,
                                      working_height, delivery_location, hire_start_date, hire_end_date, hire_duration,
                                      monthly_rental, transportation_charges, subtotal, vat_amount, total_amount, payment_terms,
                                      payment_term_days, security_deposit, payment_method, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-01-05', 'Active', $5::jsonb, $6::jsonb, $7, $8, $9, 1, $10, $11, 'JKL Mall, Dubai',
                 '2026-01-10', '2026-04-09', '3 months', 12000, 500, 12500, 625, 13125, 'Net 30', 30, 2000, 'Bank transfer', $12, $12)
         ON CONFLICT (org_id, agreement_no) DO NOTHING`,
        [
          orgId, quotationIds[wonIdx], customerIds[QUOTATIONS[wonIdx].customer], agreementNo,
          JSON.stringify({ name: 'Dev Fleet Rental LLC', address: 'Al Quoz Industrial Area 3, Dubai', taxRegistrationNo: 'DEV-TRN-100000000000003' }),
          JSON.stringify({ name: wonCustomer, address: `Office ${QUOTATIONS[wonIdx].customer + 1}, Business Bay, Dubai` }),
          `${mm.make} ${mm.category}`, mm.model, `SN-${machine.fleet}-${machine.year}`, `${mm.capacity} kg`, `${mm.working} m`, userId,
        ],
      );
      const agreementId = (await one<{ id: string }>(client, 'SELECT id FROM hire_agreements WHERE org_id = $1 AND agreement_no = $2', [orgId, agreementNo])).id;
      await client.query(
        `INSERT INTO customer_lpos (org_id, quotation_id, hire_agreement_id, customer_id, lpo_no, received_on, valid_until, amount,
                                    currency_code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'LPO-JKL-0001', '2026-01-08', '2026-04-30', 13125, 'AED', $5, $5)
         ON CONFLICT (org_id, customer_id, lpo_no) DO NOTHING`,
        [orgId, quotationIds[wonIdx], agreementId, customerIds[QUOTATIONS[wonIdx].customer], userId],
      );

      // Advance the sequences past the seeded numbers so later creates do not collide. Never moves one backwards.
      const sequences: Array<[string, string, number, number]> = [
        ['CUSTOMER', 'CUS-', CUSTOMERS.length + 1, 4],
        ['QUOTATION', 'QT-', QUOTATIONS.length + 1, 4],
        ['AGREEMENT', 'HA-', 2, 4],
      ];
      for (const [kind, prefix, next, width] of sequences) {
        await client.query(
          `INSERT INTO number_sequences (org_id, sequence_kind, sequence_year, next_value, min_width, prefix, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (org_id, sequence_kind, sequence_year) WHERE quotation_id IS NULL
           DO UPDATE SET next_value = EXCLUDED.next_value, updated_at = now(), row_version = number_sequences.row_version + 1
           WHERE number_sequences.next_value < EXCLUDED.next_value`,
          [orgId, kind, SEED_YEAR, next, width, prefix, userId],
        );
      }

      const counts = await countSeedRows(client, orgId);
      await client.query('COMMIT');
      log(`Seeded ${database}: organization ${SEED_ORG_CODE}.`);
      return { orgId, userId, database, counts };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    await client.end();
  }
}
