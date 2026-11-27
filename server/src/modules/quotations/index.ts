import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertActiveBranch, assertInScope, assertWritableBranch, branchScopeClause, loadFieldDefs } from '../shared/branchScope.js';
import { validateCustomAttributes } from '../shared/customAttributes.js';
import { decimal, isoDate, nullableText, pick, text } from '../shared/fields.js';
import {
  likePattern, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';
import { checkTransition, PHASES, type Phase } from './transitions.js';

/** Entity type of custom field definitions that apply to quotations. */
export const QUOTATION_ENTITY = 'quotation';

/**
 * Sales roles restricted to their own records (Requirement 12.17): they see and change only quotations
 * whose `sales_user_id` is their own user id. Managers and operations roles are not restricted.
 */
export const OWN_RECORDS_ROLES: ReadonlySet<string> = new Set(['sales-executive']);

export function ownRecordsOnly(principal: Principal): boolean {
  return OWN_RECORDS_ROLES.has(principal.roleCode);
}

export interface QuotationRow {
  id: string;
  branch_id: string | null;
  customer_id: string;
  quotation_no: string;
  opportunity: string;
  email: string | null;
  crm_ha_reference: string | null;
  amount: string;
  currency_code: string;
  phase: Phase;
  sales_user_id: string | null;
  valid_until: string | null;
  lost_reason: string | null;
  lost_at: Date | null;
  lost_by: string | null;
  won_at: Date | null;
  notes: string | null;
  custom_attributes: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface QuotationDto {
  id: string;
  branchId: string | null;
  customerId: string;
  quotationNo: string;
  opportunity: string;
  email: string | null;
  crmHaReference: string | null;
  amount: string;
  currencyCode: string;
  phase: Phase;
  salesUserId: string | null;
  validUntil: string | null;
  lostReason: string | null;
  lostAt: string | null;
  lostBy: string | null;
  wonAt: string | null;
  notes: string | null;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface PhaseHistoryDto {
  id: string;
  quotationId: string;
  fromPhase: Phase | null;
  toPhase: Phase;
  actorUserId: string | null;
  reason: string | null;
  source: string;
  occurredAt: string;
}

const COLUMNS = `id, branch_id, customer_id, quotation_no, opportunity, email, crm_ha_reference, amount, currency_code, phase,
  sales_user_id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, lost_reason, lost_at, lost_by, won_at, notes,
  custom_attributes, created_at, updated_at, row_version`;

export function quotationToDto(r: QuotationRow): QuotationDto {
  return {
    id: r.id,
    branchId: r.branch_id,
    customerId: r.customer_id,
    quotationNo: r.quotation_no,
    opportunity: r.opportunity,
    email: r.email,
    crmHaReference: r.crm_ha_reference,
    amount: r.amount,
    currencyCode: r.currency_code,
    phase: r.phase,
    salesUserId: r.sales_user_id,
    validUntil: r.valid_until,
    lostReason: r.lost_reason,
    lostAt: r.lost_at ? r.lost_at.toISOString() : null,
    lostBy: r.lost_by,
    wonAt: r.won_at ? r.won_at.toISOString() : null,
    notes: r.notes,
    customAttributes: r.custom_attributes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const fields = {
  customerId: z.uuid(),
  opportunity: text(200),
  email: z.union([z.string().trim().toLowerCase().pipe(z.email().max(254)), z.null()]),
  crmHaReference: nullableText(100),
  amount: decimal(14, 6),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  branchId: z.union([z.uuid(), z.null()]),
  salesUserId: z.union([z.uuid(), z.null()]),
  validUntil: z.union([isoDate, z.null()]),
  notes: z.union([z.string().trim().max(4000).transform((v) => (v === '' ? null : v)), z.null()]),
  customAttributes: z.record(z.string(), z.unknown()),
};

const createSchema = z
  .object({
    customerId: fields.customerId,
    opportunity: fields.opportunity,
    email: fields.email.optional(),
    crmHaReference: fields.crmHaReference.optional(),
    amount: fields.amount,
    currencyCode: fields.currencyCode.optional(),
    branchId: fields.branchId.optional(),
    salesUserId: fields.salesUserId.optional(),
    validUntil: fields.validUntil.optional(),
    notes: fields.notes.optional(),
    customAttributes: fields.customAttributes.optional(),
  })
  .strict();

const updateSchema = z.object(fields).partial().strict();

const phaseSchema = z
  .object({
    toPhase: z.enum(PHASES as [Phase, ...Phase[]]),
    reason: z.string().max(5000).optional(),
  })
  .strict();

const listSchema = z.object({
  phase: z.enum(PHASES as [Phase, ...Phase[]]).optional(),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  salesUserId: z.uuid().optional(),
  number: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = {
  createdAt: 'created_at', number: 'quotation_no', amount: 'amount', phase: 'phase', opportunity: 'lower(opportunity)',
};

const COLUMN_BY_FIELD: Record<string, string> = {
  customerId: 'customer_id',
  opportunity: 'opportunity',
  email: 'email',
  crmHaReference: 'crm_ha_reference',
  amount: 'amount',
  currencyCode: 'currency_code',
  branchId: 'branch_id',
  salesUserId: 'sales_user_id',
  validUntil: 'valid_until',
  notes: 'notes',
};

/**
 * Loads a quotation visible to the Principal: another company's row is invisible (RLS), and rows outside the
 * branch scope or (for own-records roles) owned by someone else answer 404.
 */
export async function loadQuotation(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: 'quotations.read' | 'quotations.write' } = {},
): Promise<QuotationRow> {
  const res = await tx.query<QuotationRow>(`SELECT ${COLUMNS} FROM quotations WHERE id = $1${opts.lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Quotation not found');
  assertInScope(principal, opts.action ?? 'quotations.read', row.branch_id);
  if (ownRecordsOnly(principal) && row.sales_user_id !== principal.userId) {
    throw new AppError('NOT_FOUND', 'Quotation not found');
  }
  return row;
}

/**
 * SQL conditions limiting rows joined to a quotation (alias `alias`) to what the Principal may see:
 * branch scope and, for own-records roles, their own quotations. Used by child lists (agreements, LPOs).
 */
export function quotationVisibilityClauses(principal: Principal, alias: string, params: unknown[]): string[] {
  const where: string[] = [];
  const scope = branchScopeClause(principal, `${alias}.branch_id`, params, true);
  if (scope) where.push(scope);
  if (ownRecordsOnly(principal)) {
    params.push(principal.userId);
    where.push(`${alias}.sales_user_id = $${params.length}`);
  }
  return where;
}

/** The customer must exist in the Principal's company and branch scope; otherwise it does not exist for them (422). */
async function requireCustomer(tx: TxClient, principal: Principal, customerId: string): Promise<{ branch_id: string | null }> {
  const res = await tx.query<{ branch_id: string | null }>('SELECT branch_id FROM customers WHERE id = $1', [customerId]);
  const row = res.rows[0];
  if (!row || (!principal.allBranches && row.branch_id !== null && row.branch_id !== principal.branchId)) {
    throw new AppError('VALIDATION_ERROR', 'Customer not found', { customerId: 'not_found' });
  }
  return row;
}

async function requireSalesUser(tx: TxClient, principal: Principal, userId: string | null): Promise<void> {
  if (userId === null) return;
  if (ownRecordsOnly(principal) && userId !== principal.userId) {
    throw new AppError('FORBIDDEN', 'You can only assign quotations to yourself', { salesUserId: 'own_records_only' });
  }
  const res = await tx.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]);
  if (!res.rows[0] || res.rows[0].status !== 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', 'Sales user not found', { salesUserId: 'not_found' });
  }
}

async function hasLiveAgreement(tx: TxClient, quotationId: string): Promise<boolean> {
  const res = await tx.query("SELECT 1 FROM hire_agreements WHERE quotation_id = $1 AND status <> 'Cancelled' LIMIT 1", [quotationId]);
  return (res.rowCount ?? 0) > 0;
}

const sameDecimal = (a: string, b: string): boolean => new Decimal(a).equals(new Decimal(b));

/** Quotations: read (quotations.read); create, update, phase change (quotations.write). */
export function quotationsRouter(): Router {
  const router = Router();

  router.get('/quotations', async (req, res) => {
    const principal = principalWith(req, 'quotations.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'created_at', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, true);
    if (scope) where.push(scope);
    if (ownRecordsOnly(principal)) {
      params.push(principal.userId);
      where.push(`sales_user_id = $${params.length}`);
    }
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('phase', query.phase);
    eq('customer_id', query.customerId);
    eq('branch_id', query.branchId);
    eq('sales_user_id', query.salesUserId);
    if (query.number) {
      params.push(likePattern(query.number));
      where.push(`quotation_no ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`(opportunity ILIKE $${params.length} ESCAPE '\\' OR quotation_no ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM quotations ${clause}`, params);
      const rows = await tx.query<QuotationRow>(
        `SELECT ${COLUMNS} FROM quotations ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(quotationToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<QuotationDto>;
    });
    res.json(body);
  });

  router.get('/quotations/:id', async (req, res) => {
    const principal = principalWith(req, 'quotations.read');
    const id = uuidParam(req);
    const dto = quotationToDto(await withTransaction(principal.orgId, (tx) => loadQuotation(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.get('/quotations/:id/history', async (req, res) => {
    const principal = principalWith(req, 'quotations.read');
    const id = uuidParam(req);
    const items = await withTransaction(principal.orgId, async (tx) => {
      await loadQuotation(tx, principal, id);
      const rows = await tx.query<{
        id: string; quotation_id: string; from_phase: Phase | null; to_phase: Phase; actor_user_id: string | null;
        reason: string | null; source: string; occurred_at: Date;
      }>(
        `SELECT id, quotation_id, from_phase, to_phase, actor_user_id, reason, source, occurred_at
           FROM quotation_phase_history WHERE quotation_id = $1 ORDER BY occurred_at, created_at, id`,
        [id],
      );
      return rows.rows.map((r): PhaseHistoryDto => ({
        id: r.id,
        quotationId: r.quotation_id,
        fromPhase: r.from_phase,
        toPhase: r.to_phase,
        actorUserId: r.actor_user_id,
        reason: r.reason,
        source: r.source,
        occurredAt: r.occurred_at.toISOString(),
      }));
    });
    res.json({ items });
  });

  router.post('/quotations', requireAction('quotations.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'quotations.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'quotations.create', ctx, async () => {
        const customer = await requireCustomer(tx, principal, input.customerId);
        const branchId = input.branchId === undefined ? customer.branch_id : input.branchId;
        assertWritableBranch(principal, 'quotations.write', branchId);
        await assertActiveBranch(tx, branchId);
        const salesUserId = input.salesUserId === undefined ? principal.userId : input.salesUserId;
        await requireSalesUser(tx, principal, salesUserId);
        const attrs = validateCustomAttributes(await loadFieldDefs(tx, QUOTATION_ENTITY), input.customAttributes);
        let currency = input.currencyCode;
        if (!currency) {
          const org = await tx.query<{ currency_code: string }>('SELECT currency_code FROM organizations WHERE id = $1', [principal.orgId]);
          currency = org.rows[0].currency_code;
        }
        const number = await allocateNumber(tx, principal.orgId, 'QUOTATION');
        const ins = await tx.query<QuotationRow>(
          `INSERT INTO quotations (org_id, branch_id, customer_id, quotation_no, opportunity, email, crm_ha_reference, amount,
                                   currency_code, phase, sales_user_id, valid_until, notes, custom_attributes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AWAITING', $10, $11, $12, $13::jsonb, $14, $14)
           RETURNING ${COLUMNS}`,
          [
            principal.orgId, branchId, input.customerId, number, input.opportunity, input.email ?? null, input.crmHaReference ?? null,
            input.amount, currency, salesUserId, input.validUntil ?? null, input.notes ?? null, JSON.stringify(attrs), principal.userId,
          ],
        );
        const dto = quotationToDto(ins.rows[0]);
        await tx.query(
          `INSERT INTO quotation_phase_history (org_id, quotation_id, from_phase, to_phase, actor_user_id, source, source_key, created_by)
           VALUES ($1, $2, NULL, 'AWAITING', $3, 'MANUAL', $4, $3)`,
          [principal.orgId, dto.id, principal.userId, `create:${dto.id}`],
        );
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'quotation.created',
          entityType: 'quotation',
          entityId: dto.id,
          correlationId: req.correlationId,
          after: dto,
        });
        return { status: 201, body: dto };
      }),
    );
    res.status(result.status).json(result.body);
  });

  router.patch('/quotations/:id', async (req, res) => {
    const principal = principalWith(req, 'quotations.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = quotationToDto(await loadQuotation(tx, principal, id, { lock: true, action: 'quotations.write' }));
      if (before.rowVersion !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      const changesCustomer = patch.customerId !== undefined && patch.customerId !== before.customerId;
      const changesAmount = patch.amount !== undefined && !sameDecimal(patch.amount, before.amount);
      if ((changesCustomer || changesAmount) && (await hasLiveAgreement(tx, id))) {
        const fieldErrors: Record<string, string> = {};
        if (changesCustomer) fieldErrors.customerId = 'immutable';
        if (changesAmount) fieldErrors.amount = 'immutable';
        throw new AppError('IMMUTABLE_FIELD', 'customerId and amount cannot be changed once a hire agreement exists', fieldErrors);
      }
      if (changesCustomer) await requireCustomer(tx, principal, patch.customerId as string);
      if (patch.branchId !== undefined && patch.branchId !== before.branchId) {
        assertWritableBranch(principal, 'quotations.write', patch.branchId);
        await assertActiveBranch(tx, patch.branchId);
      }
      if (patch.salesUserId !== undefined && patch.salesUserId !== before.salesUserId) {
        await requireSalesUser(tx, principal, patch.salesUserId);
      }
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      const keys: string[] = [];
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'customAttributes') continue;
        set[COLUMN_BY_FIELD[field]] = value;
        keys.push(field);
      }
      if (patch.customAttributes !== undefined) {
        set.custom_attributes = JSON.stringify(
          validateCustomAttributes(await loadFieldDefs(tx, QUOTATION_ENTITY), patch.customAttributes),
        );
        keys.push('customAttributes');
      }
      await versionedUpdate(tx, { table: 'quotations', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = quotationToDto(await loadQuotation(tx, principal, id, { action: 'quotations.write' }));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'quotation.updated',
        entityType: 'quotation',
        entityId: id,
        correlationId: req.correlationId,
        before: pick(before, keys),
        after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // Phase change: quotation update, row version, history row and audit event commit together or not at all.
  router.post(
    '/quotations/:id/phase',
    requireAction('quotations.write'),
    idempotencyMiddleware({ required: true }),
    async (req, res) => {
      const principal = principalWith(req, 'quotations.write');
      const id = uuidParam(req);
      const expected = parseIfMatch(req.headers['if-match']);
      const input = phaseSchema.parse(req.body ?? {});
      const ctx = getIdempotency(res);
      const result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'quotations.phase', ctx, async () => {
          const before = await loadQuotation(tx, principal, id, { lock: true, action: 'quotations.write' });
          if (Number(before.row_version) !== expected) {
            throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
          }
          const check = checkTransition({
            from: before.phase,
            to: input.toPhase,
            reason: input.reason,
            hasReopenPermission: principal.permissions.includes('quotations.reopen'),
          });
          if (!check.ok) {
            if (check.code === 'INVALID_TRANSITION') {
              throw new AppError('INVALID_TRANSITION', `Cannot move quotation from ${before.phase} to ${input.toPhase}`);
            }
            if (check.code === 'FORBIDDEN') throw new AppError('FORBIDDEN', 'You do not have permission to reopen a lost quotation');
            throw new AppError('VALIDATION_ERROR', 'A reason of 1 to 500 characters is required', check.fieldErrors);
          }
          const now = new Date();
          const set: Record<string, unknown> = { phase: input.toPhase, updated_at: now, updated_by: principal.userId };
          if (input.toPhase === 'WON') set.won_at = now;
          if (input.toPhase === 'LOST') {
            set.lost_reason = check.reason;
            set.lost_at = now;
            set.lost_by = principal.userId;
          }
          if (before.phase === 'LOST') {
            // Reopen: the old reason stays in the history row of the move to LOST.
            set.lost_reason = null;
            set.lost_at = null;
            set.lost_by = null;
          }
          await versionedUpdate(tx, { table: 'quotations', orgId: principal.orgId, id, expectedVersion: expected, set });
          await tx.query(
            `INSERT INTO quotation_phase_history (org_id, quotation_id, from_phase, to_phase, actor_user_id, reason, source, source_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $5)`,
            [principal.orgId, id, before.phase, input.toPhase, principal.userId, check.reason, `manual:${randomUUID()}`],
          );
          const after = quotationToDto(await loadQuotation(tx, principal, id, { action: 'quotations.write' }));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'quotation.phase_changed',
            entityType: 'quotation',
            entityId: id,
            correlationId: req.correlationId,
            reason: check.reason ?? undefined,
            before: { phase: before.phase },
            after: { phase: after.phase },
          });
          return { status: 200, body: after };
        }),
      );
      const body = result.body as QuotationDto;
      if (typeof body.rowVersion === 'number') setVersionHeader(res, body.rowVersion);
      res.status(result.status).json(body);
    },
  );

  return router;
}
