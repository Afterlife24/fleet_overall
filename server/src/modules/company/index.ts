import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { principalWith, setVersionHeader } from '../shared/http.js';
import { parseIfMatch } from '../shared/rowVersion.js';

/** The exact seven gating booleans of `organizations.gating_rules` (Requirement 9.2). */
export const GATING_RULE_KEYS = [
  'requireQuote',
  'requireHaSent',
  'requireHaReceived',
  'requireLpo',
  'blockCreditHold',
  'requireTpcValid',
  'warnOverdueInspection',
] as const;

export type GatingRules = Record<(typeof GATING_RULE_KEYS)[number], boolean>;

/**
 * Rules that are fixed by the platform: invoicing only from a Won quotation and same-company ownership.
 * They are not gating booleans, so any attempt to send them (to disable them) is rejected with 422.
 * Names are compared ignoring case and punctuation.
 */
const LOCKED_RULE_KEYS: ReadonlySet<string> = new Set([
  'wononlyinvoicing', 'wononly', 'requirewon', 'invoicewononly', 'invoiceonlywon', 'requirewonquotation',
  'samecompanyownership', 'samecompany', 'samecompanyonly', 'requiresamecompany', 'enforcesamecompany',
]);

const normalizeKey = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Validates a gating rules document: exactly the seven named booleans.
 * Locked rules (Won-only invoicing, same-company ownership) are rejected with `locked_rule`,
 * any other unknown key with `unrecognized_key`. All failures are 422 with a field error per key.
 */
export function validateGatingRules(input: unknown): GatingRules {
  const errors: Record<string, string> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError('VALIDATION_ERROR', 'gatingRules must be an object', { gatingRules: 'invalid_type' });
  }
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if ((GATING_RULE_KEYS as readonly string[]).includes(key)) continue;
    errors[`gatingRules.${key}`] = LOCKED_RULE_KEYS.has(normalizeKey(key)) ? 'locked_rule' : 'unrecognized_key';
  }
  for (const key of GATING_RULE_KEYS) {
    if (!(key in obj)) errors[`gatingRules.${key}`] = 'required';
    else if (typeof obj[key] !== 'boolean') errors[`gatingRules.${key}`] = 'invalid_type';
  }
  if (Object.keys(errors).length > 0) {
    const locked = Object.values(errors).includes('locked_rule');
    throw new AppError(
      'VALIDATION_ERROR',
      locked
        ? 'Won-only invoicing and same-company ownership are always enforced and cannot be changed'
        : 'gatingRules must contain exactly the seven rule booleans',
      errors,
    );
  }
  return Object.fromEntries(GATING_RULE_KEYS.map((k) => [k, obj[k] as boolean])) as GatingRules;
}

interface OrganizationRow {
  id: string;
  code: string;
  name: string;
  trade_license: string | null;
  tax_registration_no: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency_code: string;
  vat_rate: string;
  status: string;
  gating_rules: GatingRules;
  updated_at: Date;
  row_version: string;
}

export interface CompanyDto {
  id: string;
  code: string;
  name: string;
  tradeLicense: string | null;
  taxRegistrationNo: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currencyCode: string;
  vatRate: number;
  status: string;
  gatingRules: GatingRules;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS =
  'id, code, name, trade_license, tax_registration_no, address, phone, email, timezone, currency_code, vat_rate, status, gating_rules, updated_at, row_version';

function toDto(r: OrganizationRow): CompanyDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    tradeLicense: r.trade_license,
    taxRegistrationNo: r.tax_registration_no,
    address: r.address,
    phone: r.phone,
    email: r.email,
    timezone: r.timezone,
    currencyCode: r.currency_code,
    vatRate: Number(r.vat_rate),
    status: r.status,
    gatingRules: r.gating_rules,
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

const patchSchema = z
  .object({
    name: text(200),
    tradeLicense: optionalText(100),
    taxRegistrationNo: optionalText(100),
    address: text(500),
    phone: optionalText(50),
    email: z.union([z.email().max(254), z.null()]),
    timezone: text(64).refine(isTimeZone, 'invalid timezone'),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    vatRate: z.number().min(0).max(1),
  })
  .partial()
  .strict();

const COLUMN_BY_FIELD: Record<keyof z.infer<typeof patchSchema>, string> = {
  name: 'name',
  tradeLicense: 'trade_license',
  taxRegistrationNo: 'tax_registration_no',
  address: 'address',
  phone: 'phone',
  email: 'email',
  timezone: 'timezone',
  currencyCode: 'currency_code',
  vatRate: 'vat_rate',
};

async function loadCompany(tx: TxClient, orgId: string, lock: boolean): Promise<OrganizationRow> {
  const res = await tx.query<OrganizationRow>(
    `SELECT ${COLUMNS} FROM organizations WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [orgId],
  );
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Company not found');
  return res.rows[0];
}

/** Company profile: `GET /company`, `PATCH|PUT /company` (If-Match required). */
export function companyRouter(): Router {
  const router = Router();

  router.get('/company', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const row = await withTransaction(principal.orgId, (tx) => loadCompany(tx, principal.orgId, false));
    const dto = toDto(row);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  const update: RequestHandler = async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const expected = parseIfMatch(req.headers['if-match']);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    // Gating rules are validated first so a locked rule always yields its dedicated field error.
    const gating = 'gatingRules' in raw ? validateGatingRules(raw.gatingRules) : undefined;
    const rest = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'gatingRules'));
    const patch = patchSchema.parse(rest);
    if (Object.keys(patch).length === 0 && gating === undefined) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }

    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadCompany(tx, principal.orgId, true);
      if (Number(before.row_version) !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      const params: unknown[] = [principal.orgId];
      const assignments: string[] = [];
      const beforeData: Record<string, unknown> = {};
      const afterData: Record<string, unknown> = {};
      const beforeDto = toDto(before) as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) {
        params.push(value);
        assignments.push(`${COLUMN_BY_FIELD[field as keyof typeof COLUMN_BY_FIELD]} = $${params.length}`);
        beforeData[field] = beforeDto[field];
        afterData[field] = value;
      }
      if (gating) {
        params.push(JSON.stringify(gating));
        assignments.push(`gating_rules = $${params.length}::jsonb`);
        beforeData.gatingRules = before.gating_rules;
        afterData.gatingRules = gating;
      }
      params.push(expected);
      const updated = await tx.query<OrganizationRow>(
        `UPDATE organizations SET ${assignments.join(', ')}, updated_at = now(), row_version = row_version + 1
          WHERE id = $1 AND row_version = $${params.length} RETURNING ${COLUMNS}`,
        params,
      );
      if (!updated.rows[0]) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'company.updated',
        entityType: 'organization',
        entityId: principal.orgId,
        correlationId: req.correlationId,
        before: beforeData,
        after: afterData,
      });
      return toDto(updated.rows[0]);
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  };

  router.patch('/company', update);
  router.put('/company', update);
  return router;
}
