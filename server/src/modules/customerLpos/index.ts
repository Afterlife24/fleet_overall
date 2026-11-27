import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { assertAttachable } from '../files/index.js';
import { loadQuotation, quotationVisibilityClauses } from '../quotations/index.js';
import { recordAudit } from '../shared/audit.js';
import { decimal, isCalendarDate, isoDate, pick } from '../shared/fields.js';
import {
  likePattern, mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

interface LpoRow {
  id: string;
  quotation_id: string;
  hire_agreement_id: string | null;
  customer_id: string;
  lpo_no: string;
  received_on: string;
  valid_until: string | null;
  amount: string | null;
  currency_code: string;
  file_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface CustomerLpoDto {
  id: string;
  quotationId: string;
  hireAgreementId: string | null;
  customerId: string;
  /** The customer's own LPO number, stored as given. The system allocates no number for it. */
  lpoNo: string;
  receivedOn: string;
  validUntil: string | null;
  amount: string | null;
  currencyCode: string;
  fileId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS = `l.id, l.quotation_id, l.hire_agreement_id, l.customer_id, l.lpo_no, to_char(l.received_on, 'YYYY-MM-DD') AS received_on,
  to_char(l.valid_until, 'YYYY-MM-DD') AS valid_until, l.amount, l.currency_code, l.file_id, l.notes, l.created_at, l.updated_at, l.row_version`;
const FROM = 'customer_lpos l JOIN quotations q ON q.id = l.quotation_id AND q.org_id = l.org_id';

export function lpoToDto(r: LpoRow): CustomerLpoDto {
  return {
    id: r.id,
    quotationId: r.quotation_id,
    hireAgreementId: r.hire_agreement_id,
    customerId: r.customer_id,
    lpoNo: r.lpo_no,
    receivedOn: r.received_on,
    validUntil: r.valid_until,
    amount: r.amount,
    currencyCode: r.currency_code,
    fileId: r.file_id,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

/** The LPO number is the customer's own text: stored exactly as given (only an all-blank value is refused). */
const lpoNo = z.string().max(100).refine((v) => v.trim().length > 0, 'blank');

const fields = {
  hireAgreementId: z.union([z.uuid(), z.null()]),
  lpoNo,
  receivedOn: isoDate,
  validUntil: z.union([isoDate, z.null()]),
  amount: z.union([decimal(14, 6), z.null()]),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  fileId: z.union([z.uuid(), z.null()]),
  notes: z.union([z.string().trim().max(4000).transform((v) => (v === '' ? null : v)), z.null()]),
};

const createSchema = z
  .object({
    quotationId: z.uuid(),
    customerId: z.uuid(),
    hireAgreementId: fields.hireAgreementId.optional(),
    lpoNo: fields.lpoNo,
    receivedOn: fields.receivedOn,
    validUntil: fields.validUntil.optional(),
    amount: fields.amount.optional(),
    currencyCode: fields.currencyCode.optional(),
    fileId: fields.fileId.optional(),
    notes: fields.notes.optional(),
  })
  .strict();

const updateSchema = z.object(fields).partial().strict();

const listSchema = z.object({
  quotationId: z.uuid().optional(),
  hireAgreementId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = { createdAt: 'l.created_at', lpoNo: 'l.lpo_no', receivedOn: 'l.received_on', validUntil: 'l.valid_until' };

const COLUMN_BY_FIELD: Record<string, string> = {
  hireAgreementId: 'hire_agreement_id',
  lpoNo: 'lpo_no',
  receivedOn: 'received_on',
  validUntil: 'valid_until',
  amount: 'amount',
  currencyCode: 'currency_code',
  fileId: 'file_id',
  notes: 'notes',
};

const DUPLICATES = { uq_customer_lpos_no: 'lpoNo' };
const DUPLICATE_MESSAGE = 'This customer already has an LPO with this number';

function assertValidity(receivedOn: string, validUntil: string | null): void {
  if (validUntil !== null && isCalendarDate(receivedOn) && isCalendarDate(validUntil) && validUntil < receivedOn) {
    throw new AppError('VALIDATION_ERROR', 'Valid-until date is before the received date', { validUntil: 'before_received_on' });
  }
}

/** An agreement of the same quotation (and, by the table's composite key, the same customer). */
async function assertAgreementOfQuotation(tx: TxClient, agreementId: string | null | undefined, quotationId: string): Promise<void> {
  if (!agreementId) return;
  const res = await tx.query<{ quotation_id: string }>('SELECT quotation_id FROM hire_agreements WHERE id = $1', [agreementId]);
  if (!res.rows[0]) throw new AppError('VALIDATION_ERROR', 'Hire agreement not found', { hireAgreementId: 'not_found' });
  if (res.rows[0].quotation_id !== quotationId) {
    throw new AppError('VALIDATION_ERROR', 'Hire agreement belongs to another quotation', { hireAgreementId: 'quotation_mismatch' });
  }
}

async function loadLpo(tx: TxClient, principal: Principal, id: string, lock: boolean): Promise<LpoRow> {
  const res = await tx.query<LpoRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE l.id = $1${lock ? ' FOR UPDATE OF l' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'LPO not found');
  try {
    await loadQuotation(tx, principal, row.quotation_id, { action: 'quotations.read' });
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', 'LPO not found');
    throw err;
  }
  return row;
}

/** Customer LPOs: read (lpos.read); create and update (lpos.write). No internal LPO document is generated. */
export function customerLposRouter(): Router {
  const router = Router();

  router.get('/customer-lpos', async (req, res) => {
    const principal = principalWith(req, 'lpos.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'l.created_at', direction: 'DESC' });
    const params: unknown[] = [];
    const where = quotationVisibilityClauses(principal, 'q', params);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('l.quotation_id', query.quotationId);
    eq('l.hire_agreement_id', query.hireAgreementId);
    eq('l.customer_id', query.customerId);
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`l.lpo_no ILIKE $${params.length} ESCAPE '\\'`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${FROM} ${clause}`, params);
      const rows = await tx.query<LpoRow>(
        `SELECT ${COLUMNS} FROM ${FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, l.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(lpoToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<CustomerLpoDto>;
    });
    res.json(body);
  });

  router.get('/customer-lpos/:id', async (req, res) => {
    const principal = principalWith(req, 'lpos.read');
    const id = uuidParam(req);
    const dto = lpoToDto(await withTransaction(principal.orgId, (tx) => loadLpo(tx, principal, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/customer-lpos', requireAction('lpos.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'lpos.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'customer_lpos.create', ctx, async () => {
          const quotation = await loadQuotation(tx, principal, input.quotationId, { action: 'quotations.read' });
          if (quotation.customer_id !== input.customerId) {
            throw new AppError('VALIDATION_ERROR', 'Customer does not match the quotation', { customerId: 'quotation_mismatch' });
          }
          await assertAgreementOfQuotation(tx, input.hireAgreementId, quotation.id);
          assertValidity(input.receivedOn, input.validUntil ?? null);
          if (input.fileId) await assertAttachable(tx, input.fileId);
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO customer_lpos (org_id, quotation_id, hire_agreement_id, customer_id, lpo_no, received_on, valid_until, amount,
                                        currency_code, file_id, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
            [
              principal.orgId, quotation.id, input.hireAgreementId ?? null, input.customerId, input.lpoNo, input.receivedOn,
              input.validUntil ?? null, input.amount ?? null, input.currencyCode ?? quotation.currency_code, input.fileId ?? null,
              input.notes ?? null, principal.userId,
            ],
          );
          const dto = lpoToDto(await loadLpo(tx, principal, ins.rows[0].id, false));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'customer_lpo.created',
            entityType: 'customer_lpo',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, DUPLICATES, DUPLICATE_MESSAGE);
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/customer-lpos/:id', async (req, res) => {
    const principal = principalWith(req, 'lpos.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    let dto: CustomerLpoDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const before = lpoToDto(await loadLpo(tx, principal, id, true));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        if (patch.hireAgreementId !== undefined) await assertAgreementOfQuotation(tx, patch.hireAgreementId, before.quotationId);
        assertValidity(patch.receivedOn ?? before.receivedOn, patch.validUntil === undefined ? before.validUntil : patch.validUntil);
        if (patch.fileId && patch.fileId !== before.fileId) await assertAttachable(tx, patch.fileId);
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        const keys = Object.keys(patch);
        for (const [field, value] of Object.entries(patch)) set[COLUMN_BY_FIELD[field]] = value;
        await versionedUpdate(tx, { table: 'customer_lpos', orgId: principal.orgId, id, expectedVersion: expected, set });
        const after = lpoToDto(await loadLpo(tx, principal, id, false));
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'customer_lpo.updated',
          entityType: 'customer_lpo',
          entityId: id,
          correlationId: req.correlationId,
          before: pick(before, keys),
          after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      mapUniqueViolation(err, DUPLICATES, DUPLICATE_MESSAGE);
    }
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
