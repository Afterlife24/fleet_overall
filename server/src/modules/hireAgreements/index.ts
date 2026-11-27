import { Decimal } from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { loadQuotation, quotationVisibilityClauses } from '../quotations/index.js';
import { recordAudit } from '../shared/audit.js';
import { decimal, isCalendarDate, isoDate, pick, text } from '../shared/fields.js';
import {
  likePattern, parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

export const AGREEMENT_STATUSES = ['Draft', 'Active', 'Completed', 'Cancelled'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** Money is computed and stored at the precision of the currency (two decimals for AED and most currencies). */
export const CURRENCY_PRECISION = 2;

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface AgreementTotals {
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
}

/**
 * Pure, decimal arithmetic only: subtotal = monthly rental + transportation, VAT = subtotal x rate,
 * total = subtotal + VAT; each rounded half-up to the currency precision. Totals never come from the client.
 */
export function computeTotals(monthlyRental: string, transportationCharges: string, vatRate: string | number): AgreementTotals {
  const subtotal = new Money(monthlyRental).plus(new Money(transportationCharges)).toDecimalPlaces(CURRENCY_PRECISION);
  const vat = subtotal.times(new Money(vatRate)).toDecimalPlaces(CURRENCY_PRECISION);
  const total = subtotal.plus(vat);
  return {
    subtotal: subtotal.toFixed(CURRENCY_PRECISION),
    vatAmount: vat.toFixed(CURRENCY_PRECISION),
    totalAmount: total.toFixed(CURRENCY_PRECISION),
  };
}

interface AgreementRow {
  id: string;
  quotation_id: string;
  customer_id: string;
  agreement_no: string;
  agreement_date: string;
  status: AgreementStatus;
  issuer_snapshot: Record<string, unknown>;
  customer_snapshot: Record<string, unknown>;
  equipment_name: string;
  equipment_model: string;
  serial_number: string;
  quantity: number;
  capacity: string;
  working_height: string;
  delivery_location: string;
  hire_start_date: string;
  hire_end_date: string;
  hire_duration: string;
  monthly_rental: string;
  transportation_charges: string;
  subtotal: string;
  vat_amount: string;
  total_amount: string;
  payment_terms: string;
  payment_term_days: number;
  security_deposit: string;
  payment_method: string;
  sent_at: Date | null;
  received_at: Date | null;
  crm_ha_reference: string | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface HireAgreementDto {
  id: string;
  quotationId: string;
  customerId: string;
  agreementNo: string;
  agreementDate: string;
  status: AgreementStatus;
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  equipmentName: string;
  equipmentModel: string;
  serialNumber: string;
  quantity: number;
  capacity: string;
  workingHeight: string;
  deliveryLocation: string;
  hireStartDate: string;
  hireEndDate: string;
  hireDuration: string;
  monthlyRental: string;
  transportationCharges: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  paymentTerms: string;
  paymentTermDays: number;
  securityDeposit: string;
  paymentMethod: string;
  sentAt: string | null;
  receivedAt: string | null;
  /** The CRM display reference of the quotation. Separate from the agreement id and number. */
  crmHaReference: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const day = (c: string) => `to_char(h.${c}, 'YYYY-MM-DD') AS ${c}`;
const COLUMNS = `h.id, h.quotation_id, h.customer_id, h.agreement_no, ${day('agreement_date')}, h.status, h.issuer_snapshot,
  h.customer_snapshot, h.equipment_name, h.equipment_model, h.serial_number, h.quantity, h.capacity, h.working_height,
  h.delivery_location, ${day('hire_start_date')}, ${day('hire_end_date')}, h.hire_duration, h.monthly_rental,
  h.transportation_charges, h.subtotal, h.vat_amount, h.total_amount, h.payment_terms, h.payment_term_days,
  h.security_deposit, h.payment_method, h.sent_at, h.received_at, q.crm_ha_reference, h.created_at, h.updated_at, h.row_version`;
const FROM = 'hire_agreements h JOIN quotations q ON q.id = h.quotation_id AND q.org_id = h.org_id';

export function agreementToDto(r: AgreementRow): HireAgreementDto {
  return {
    id: r.id,
    quotationId: r.quotation_id,
    customerId: r.customer_id,
    agreementNo: r.agreement_no,
    agreementDate: r.agreement_date,
    status: r.status,
    issuerSnapshot: r.issuer_snapshot,
    customerSnapshot: r.customer_snapshot,
    equipmentName: r.equipment_name,
    equipmentModel: r.equipment_model,
    serialNumber: r.serial_number,
    quantity: r.quantity,
    capacity: r.capacity,
    workingHeight: r.working_height,
    deliveryLocation: r.delivery_location,
    hireStartDate: r.hire_start_date,
    hireEndDate: r.hire_end_date,
    hireDuration: r.hire_duration,
    monthlyRental: r.monthly_rental,
    transportationCharges: r.transportation_charges,
    subtotal: r.subtotal,
    vatAmount: r.vat_amount,
    totalAmount: r.total_amount,
    paymentTerms: r.payment_terms,
    paymentTermDays: r.payment_term_days,
    securityDeposit: r.security_deposit,
    paymentMethod: r.payment_method,
    sentAt: r.sent_at ? r.sent_at.toISOString() : null,
    receivedAt: r.received_at ? r.received_at.toISOString() : null,
    crmHaReference: r.crm_ha_reference,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const blankOk = (max: number) => z.string().trim().max(max);

const fields = {
  agreementDate: isoDate,
  status: z.enum(AGREEMENT_STATUSES),
  equipmentName: text(200),
  equipmentModel: text(200),
  serialNumber: text(200),
  quantity: z.number().int().min(1).max(100_000),
  capacity: blankOk(100),
  workingHeight: blankOk(100),
  deliveryLocation: text(500),
  hireStartDate: isoDate,
  hireEndDate: isoDate,
  hireDuration: blankOk(100),
  monthlyRental: decimal(14, 6),
  transportationCharges: decimal(14, 6),
  paymentTerms: text(500),
  paymentTermDays: z.number().int().min(0).max(365),
  securityDeposit: decimal(14, 6),
  paymentMethod: text(100),
};

/** Keys a client may send but that the server always computes or takes from the masters; they are ignored. */
const IGNORED = {
  subtotal: z.unknown().optional(),
  vatAmount: z.unknown().optional(),
  totalAmount: z.unknown().optional(),
  issuerSnapshot: z.unknown().optional(),
  customerSnapshot: z.unknown().optional(),
  agreementNo: z.unknown().optional(),
  sentAt: z.unknown().optional(),
  receivedAt: z.unknown().optional(),
};

const createSchema = z
  .object({
    quotationId: z.uuid(),
    customerId: z.uuid(),
    agreementDate: fields.agreementDate.optional(),
    status: fields.status.optional(),
    equipmentName: fields.equipmentName,
    equipmentModel: fields.equipmentModel,
    serialNumber: fields.serialNumber,
    quantity: fields.quantity.optional(),
    capacity: fields.capacity.optional(),
    workingHeight: fields.workingHeight.optional(),
    deliveryLocation: fields.deliveryLocation,
    hireStartDate: fields.hireStartDate,
    hireEndDate: fields.hireEndDate,
    hireDuration: fields.hireDuration.optional(),
    monthlyRental: fields.monthlyRental,
    transportationCharges: fields.transportationCharges.optional(),
    paymentTerms: fields.paymentTerms,
    paymentTermDays: fields.paymentTermDays.optional(),
    securityDeposit: fields.securityDeposit.optional(),
    paymentMethod: fields.paymentMethod,
    ...IGNORED,
  })
  .strict();

const updateSchema = z
  .object({ ...fields, ...IGNORED })
  .partial()
  .strict();

const reasonSchema = z.string().trim().min(1).max(500);
const sentSchema = z.object({}).strict();
const receivedSchema = z.object({ reason: reasonSchema }).strict();

const listSchema = z.object({
  quotationId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  status: z.enum(AGREEMENT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = { createdAt: 'h.created_at', number: 'h.agreement_no', status: 'h.status', hireStartDate: 'h.hire_start_date' };

const COLUMN_BY_FIELD: Record<string, string> = {
  agreementDate: 'agreement_date',
  status: 'status',
  equipmentName: 'equipment_name',
  equipmentModel: 'equipment_model',
  serialNumber: 'serial_number',
  quantity: 'quantity',
  capacity: 'capacity',
  workingHeight: 'working_height',
  deliveryLocation: 'delivery_location',
  hireStartDate: 'hire_start_date',
  hireEndDate: 'hire_end_date',
  hireDuration: 'hire_duration',
  monthlyRental: 'monthly_rental',
  transportationCharges: 'transportation_charges',
  paymentTerms: 'payment_terms',
  paymentTermDays: 'payment_term_days',
  securityDeposit: 'security_deposit',
  paymentMethod: 'payment_method',
};

const IGNORED_KEYS = new Set(Object.keys(IGNORED));

function assertDateOrder(start: string, end: string): void {
  if (isCalendarDate(start) && isCalendarDate(end) && end < start) {
    throw new AppError('VALIDATION_ERROR', 'Hire end date is before the hire start date', { hireEndDate: 'before_start' });
  }
}

/** Reads the agreement and proves its quotation is visible to the Principal (404 otherwise). */
async function loadAgreement(tx: TxClient, principal: Principal, id: string, lock: boolean): Promise<AgreementRow> {
  const res = await tx.query<AgreementRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE h.id = $1${lock ? ' FOR UPDATE OF h' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Hire agreement not found');
  try {
    await loadQuotation(tx, principal, row.quotation_id, { action: 'quotations.read' });
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', 'Hire agreement not found');
    throw err;
  }
  return row;
}

function mapAgreementUnique(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23505' && constraint === 'uq_live_quote_agreement') {
    throw new AppError('AGREEMENT_EXISTS', 'This quotation already has a hire agreement', { quotationId: 'agreement_exists' });
  }
  throw err;
}

/** Hire agreements: read (hire_agreements.read); create, update, mark sent / received (hire_agreements.write). */
export function hireAgreementsRouter(): Router {
  const router = Router();

  router.get('/hire-agreements', async (req, res) => {
    const principal = principalWith(req, 'hire_agreements.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'h.created_at', direction: 'DESC' });
    const params: unknown[] = [];
    const where = quotationVisibilityClauses(principal, 'q', params);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('h.quotation_id', query.quotationId);
    eq('h.customer_id', query.customerId);
    eq('h.status', query.status);
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`h.agreement_no ILIKE $${params.length} ESCAPE '\\'`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${FROM} ${clause}`, params);
      const rows = await tx.query<AgreementRow>(
        `SELECT ${COLUMNS} FROM ${FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, h.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(agreementToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<HireAgreementDto>;
    });
    res.json(body);
  });

  router.get('/hire-agreements/:id', async (req, res) => {
    const principal = principalWith(req, 'hire_agreements.read');
    const id = uuidParam(req);
    const dto = agreementToDto(await withTransaction(principal.orgId, (tx) => loadAgreement(tx, principal, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/hire-agreements', requireAction('hire_agreements.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'hire_agreements.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'hire_agreements.create', ctx, async () => {
          // Locking the quotation serializes concurrent creates for it; the partial unique index is the backstop.
          const quotation = await loadQuotation(tx, principal, input.quotationId, { lock: true, action: 'quotations.read' });
          if (quotation.customer_id !== input.customerId) {
            throw new AppError('VALIDATION_ERROR', 'Customer does not match the quotation', { customerId: 'quotation_mismatch' });
          }
          const live = await tx.query("SELECT 1 FROM hire_agreements WHERE quotation_id = $1 AND status <> 'Cancelled' LIMIT 1", [quotation.id]);
          if ((live.rowCount ?? 0) > 0) {
            throw new AppError('AGREEMENT_EXISTS', 'This quotation already has a hire agreement', { quotationId: 'agreement_exists' });
          }
          assertDateOrder(input.hireStartDate, input.hireEndDate);

          const org = await tx.query<{
            name: string; address: string; tax_registration_no: string | null; trade_license: string | null;
            phone: string | null; email: string | null; vat_rate: string;
          }>('SELECT name, address, tax_registration_no, trade_license, phone, email, vat_rate FROM organizations WHERE id = $1', [principal.orgId]);
          const cust = await tx.query<{
            customer_code: string; name: string; address: string; billing_address: string | null; tax_registration_no: string | null;
            attn: string | null; email: string | null; phone: string;
          }>(
            'SELECT customer_code, name, address, billing_address, tax_registration_no, attn, email, phone FROM customers WHERE id = $1',
            [input.customerId],
          );
          const o = org.rows[0];
          const c = cust.rows[0];
          if (!o || !c) throw new AppError('INTERNAL_ERROR', 'Agreement parties could not be read');
          // Snapshots: every lessor and hirer identity field shown on the agreement page, frozen at creation.
          const issuerSnapshot = {
            name: o.name, address: o.address, taxRegistrationNo: o.tax_registration_no, tradeLicense: o.trade_license,
            attention: null, email: o.email, contact: o.phone,
          };
          const customerSnapshot = {
            customerCode: c.customer_code, name: c.name, address: c.address, billingAddress: c.billing_address,
            taxRegistrationNo: c.tax_registration_no, attention: c.attn, email: c.email, contact: c.phone,
          };
          const monthly = input.monthlyRental;
          const transport = input.transportationCharges ?? '0';
          const totals = computeTotals(monthly, transport, o.vat_rate);
          const number = await allocateNumber(tx, principal.orgId, 'AGREEMENT');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO hire_agreements (org_id, quotation_id, customer_id, agreement_no, agreement_date, status, issuer_snapshot,
                customer_snapshot, equipment_name, equipment_model, serial_number, quantity, capacity, working_height,
                delivery_location, hire_start_date, hire_end_date, hire_duration, monthly_rental, transportation_charges,
                subtotal, vat_amount, total_amount, payment_terms, payment_term_days, security_deposit, payment_method,
                created_by, updated_by)
             VALUES ($1, $2, $3, $4, COALESCE($5::date, (now() AT TIME ZONE 'UTC')::date), $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $28)
             RETURNING id`,
            [
              principal.orgId, quotation.id, input.customerId, number, input.agreementDate ?? null, input.status ?? 'Draft',
              JSON.stringify(issuerSnapshot), JSON.stringify(customerSnapshot), input.equipmentName, input.equipmentModel,
              input.serialNumber, input.quantity ?? 1, input.capacity ?? '', input.workingHeight ?? '', input.deliveryLocation,
              input.hireStartDate, input.hireEndDate, input.hireDuration ?? '', monthly, transport, totals.subtotal, totals.vatAmount,
              totals.totalAmount, input.paymentTerms, input.paymentTermDays ?? 30, input.securityDeposit ?? '0', input.paymentMethod,
              principal.userId,
            ],
          );
          const dto = agreementToDto(await loadAgreement(tx, principal, ins.rows[0].id, false));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'hire_agreement.created',
            entityType: 'hire_agreement',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapAgreementUnique(err);
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/hire-agreements/:id', async (req, res) => {
    const principal = principalWith(req, 'hire_agreements.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    const keys = Object.keys(patch).filter((k) => !IGNORED_KEYS.has(k));
    if (keys.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    let dto: HireAgreementDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const beforeRow = await loadAgreement(tx, principal, id, true);
        const before = agreementToDto(beforeRow);
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        const patchRecord = patch as Record<string, unknown>;
        assertDateOrder(patch.hireStartDate ?? before.hireStartDate, patch.hireEndDate ?? before.hireEndDate);
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        for (const k of keys) set[COLUMN_BY_FIELD[k]] = patchRecord[k];
        if (patch.monthlyRental !== undefined || patch.transportationCharges !== undefined) {
          const org = await tx.query<{ vat_rate: string }>('SELECT vat_rate FROM organizations WHERE id = $1', [principal.orgId]);
          const totals = computeTotals(
            patch.monthlyRental ?? before.monthlyRental,
            patch.transportationCharges ?? before.transportationCharges,
            org.rows[0].vat_rate,
          );
          set.subtotal = totals.subtotal;
          set.vat_amount = totals.vatAmount;
          set.total_amount = totals.totalAmount;
        }
        await versionedUpdate(tx, { table: 'hire_agreements', orgId: principal.orgId, id, expectedVersion: expected, set });
        const after = agreementToDto(await loadAgreement(tx, principal, id, false));
        const cancelled = before.status !== 'Cancelled' && after.status === 'Cancelled';
        const auditKeys = [...keys, ...(set.subtotal === undefined ? [] : ['subtotal', 'vatAmount', 'totalAmount'])];
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: cancelled ? 'hire_agreement.cancelled' : 'hire_agreement.updated',
          entityType: 'hire_agreement',
          entityId: id,
          correlationId: req.correlationId,
          before: pick(before, auditKeys),
          after: pick(after, auditKeys),
        });
        return after;
      });
    } catch (err) {
      mapAgreementUnique(err);
    }
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  const stamp = (kind: 'sent' | 'received') =>
    async (req: Parameters<Parameters<Router['post']>[1]>[0], res: Parameters<Parameters<Router['post']>[1]>[1]) => {
      const principal = principalWith(req, 'hire_agreements.write');
      const id = uuidParam(req);
      const expected = parseIfMatch(req.headers['if-match']);
      // Stage 1 has no signed-evidence upload: receiving needs an audited manual confirmation reason.
      const input = kind === 'received' ? receivedSchema.parse(req.body ?? {}) : sentSchema.parse(req.body ?? {});
      const reason = 'reason' in input ? input.reason : undefined;
      const column = kind === 'sent' ? 'sent_at' : 'received_at';
      const dto = await withTransaction(principal.orgId, async (tx) => {
        const before = agreementToDto(await loadAgreement(tx, principal, id, true));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        if ((kind === 'sent' ? before.sentAt : before.receivedAt) !== null) {
          throw new AppError('VALIDATION_ERROR', `Agreement is already marked ${kind}`, { [kind === 'sent' ? 'sentAt' : 'receivedAt']: 'already_set' });
        }
        const now = new Date();
        await versionedUpdate(tx, {
          table: 'hire_agreements', orgId: principal.orgId, id, expectedVersion: expected,
          set: { [column]: now, updated_at: now, updated_by: principal.userId },
        });
        const after = agreementToDto(await loadAgreement(tx, principal, id, false));
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: `hire_agreement.${kind}`,
          entityType: 'hire_agreement',
          entityId: id,
          correlationId: req.correlationId,
          reason,
          before: { [kind === 'sent' ? 'sentAt' : 'receivedAt']: null },
          after: { [kind === 'sent' ? 'sentAt' : 'receivedAt']: kind === 'sent' ? after.sentAt : after.receivedAt },
        });
        return after;
      });
      setVersionHeader(res, dto.rowVersion);
      res.json(dto);
    };

  router.post('/hire-agreements/:id/sent', stamp('sent'));
  router.post('/hire-agreements/:id/received', stamp('received'));

  return router;
}
