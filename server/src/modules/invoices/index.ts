import { Decimal } from 'decimal.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authorize, type Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { computeTotals, CURRENCY_PRECISION } from '../hireAgreements/index.js';
import { ownRecordsOnly, quotationVisibilityClauses } from '../quotations/index.js';
import { recordAudit } from '../shared/audit.js';
import { assertInScope } from '../shared/branchScope.js';
import { decimal, isoDate, nullableText, pick } from '../shared/fields.js';
import {
  parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_TYPES = ['Continuous Hire', 'Off-Hire'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
const REPORTABLE_STATUSES = ['Paid', 'Overdue', 'Sent'] as const;

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const money2 = (v: Decimal.Value) => new Money(v).toDecimalPlaces(CURRENCY_PRECISION).toFixed(CURRENCY_PRECISION);

// ---------------------------------------------------------------- rows and DTOs

interface InvoiceRow {
  id: string;
  quotation_id: string;
  hire_agreement_id: string;
  customer_id: string;
  invoice_no: string;
  quotation_no_snapshot: string;
  agreement_no_snapshot: string;
  sequence_no: string;
  invoice_type: InvoiceType;
  period_start: string;
  period_end: string;
  invoice_date: string;
  due_date: string;
  currency_code: string;
  status: InvoiceStatus;
  issuer_snapshot: Record<string, unknown>;
  customer_snapshot: Record<string, unknown>;
  hire_period_text: string;
  delivery_location: string;
  payment_terms: string;
  payment_term_days: number;
  payment_method: string;
  security_deposit: string;
  subtotal: string;
  vat_rate: string;
  vat_amount: string;
  total_amount: string;
  amount_due: string;
  issued_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
  quotation_branch_id: string | null;
  quotation_sales_user_id: string | null;
}

interface LineRow {
  invoice_id: string;
  line_no: number;
  line_type: 'EQUIPMENT' | 'TRANSPORT';
  description: string;
  quantity: string;
  unit_rate: string;
  amount: string;
}

export interface InvoiceLineDto {
  lineNo: number;
  lineType: 'EQUIPMENT' | 'TRANSPORT';
  description: string;
  quantity: string;
  unitRate: string;
  amount: string;
}

export interface InvoiceDto {
  id: string;
  quotationId: string;
  hireAgreementId: string;
  customerId: string;
  invoiceNo: string;
  quotationNo: string;
  agreementNo: string;
  sequenceNo: number;
  invoiceType: InvoiceType;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  status: InvoiceStatus;
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  hirePeriodText: string;
  deliveryLocation: string;
  paymentTerms: string;
  paymentTermDays: number;
  paymentMethod: string;
  securityDeposit: string;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  amountDue: string;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  lines: InvoiceLineDto[];
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const day = (c: string) => `to_char(i.${c}, 'YYYY-MM-DD') AS ${c}`;
const COLUMNS = `i.id, i.quotation_id, i.hire_agreement_id, i.customer_id, i.invoice_no, i.quotation_no_snapshot,
  i.agreement_no_snapshot, i.sequence_no, i.invoice_type, ${day('period_start')}, ${day('period_end')}, ${day('invoice_date')},
  ${day('due_date')}, i.currency_code, i.status, i.issuer_snapshot, i.customer_snapshot, i.hire_period_text, i.delivery_location,
  i.payment_terms, i.payment_term_days, i.payment_method, i.security_deposit, i.subtotal, i.vat_rate, i.vat_amount,
  i.total_amount, i.amount_due, i.issued_at, i.cancelled_at, i.cancellation_reason, i.notes, i.created_at, i.updated_at,
  i.row_version, q.branch_id AS quotation_branch_id, q.sales_user_id AS quotation_sales_user_id`;
const FROM = 'invoices i JOIN quotations q ON q.id = i.quotation_id AND q.org_id = i.org_id';

function lineToDto(l: LineRow): InvoiceLineDto {
  return {
    lineNo: l.line_no, lineType: l.line_type, description: l.description,
    quantity: l.quantity, unitRate: l.unit_rate, amount: l.amount,
  };
}

export function invoiceToDto(r: InvoiceRow, lines: LineRow[]): InvoiceDto {
  return {
    id: r.id,
    quotationId: r.quotation_id,
    hireAgreementId: r.hire_agreement_id,
    customerId: r.customer_id,
    invoiceNo: r.invoice_no,
    quotationNo: r.quotation_no_snapshot,
    agreementNo: r.agreement_no_snapshot,
    sequenceNo: Number(r.sequence_no),
    invoiceType: r.invoice_type,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    currencyCode: r.currency_code.trim(),
    status: r.status,
    issuerSnapshot: r.issuer_snapshot,
    customerSnapshot: r.customer_snapshot,
    hirePeriodText: r.hire_period_text,
    deliveryLocation: r.delivery_location,
    paymentTerms: r.payment_terms,
    paymentTermDays: r.payment_term_days,
    paymentMethod: r.payment_method,
    securityDeposit: r.security_deposit,
    subtotal: r.subtotal,
    vatRate: r.vat_rate,
    vatAmount: r.vat_amount,
    totalAmount: r.total_amount,
    amountDue: r.amount_due,
    issuedAt: r.issued_at ? r.issued_at.toISOString() : null,
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancellationReason: r.cancellation_reason,
    notes: r.notes,
    lines: lines.filter((l) => l.invoice_id === r.id).sort((a, b) => a.line_no - b.line_no).map(lineToDto),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

async function loadLines(tx: TxClient, ids: string[]): Promise<LineRow[]> {
  if (ids.length === 0) return [];
  const res = await tx.query<LineRow>(
    `SELECT invoice_id, line_no, line_type, description, quantity, unit_rate, amount
       FROM invoice_lines WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id, line_no`,
    [ids],
  );
  return res.rows;
}

// ---------------------------------------------------------------- schemas

const reasonSchema = z.string().trim().min(1).max(500);
const periodDecimal = decimal(14, 6);

const equipmentInput = z.object({ quantity: periodDecimal, unitRate: periodDecimal, amount: periodDecimal }).strict();
const transportInput = z.object({ amount: periodDecimal }).strict();

const createSchema = z
  .object({
    quotationId: z.uuid(),
    hireAgreementId: z.uuid(),
    invoiceType: z.enum(INVOICE_TYPES),
    periodStart: isoDate,
    periodEnd: isoDate.optional(),
    invoiceDate: isoDate.optional(),
    equipment: equipmentInput,
    periodChargeConfirmed: z.literal(true),
    transport: transportInput.optional(),
    repeatTransportConfirmed: z.boolean().optional(),
    notes: nullableText(4000).optional(),
    // Client-computed values are accepted and ignored: the server recomputes every total.
    subtotal: z.unknown().optional(),
    vatAmount: z.unknown().optional(),
    totalAmount: z.unknown().optional(),
    amountDue: z.unknown().optional(),
  })
  .strict();

/** Fields that identify the invoice. A patch may repeat them but never change them. */
const PROTECTED_KEYS = [
  'quotationId', 'hireAgreementId', 'invoiceType', 'periodStart', 'periodEnd', 'invoiceNo', 'sequenceNo', 'status', 'amountDue',
] as const;

const patchSchema = z
  .object({
    equipment: equipmentInput.partial().optional(),
    periodChargeConfirmed: z.boolean().optional(),
    transport: transportInput.nullable().optional(),
    repeatTransportConfirmed: z.boolean().optional(),
    invoiceDate: isoDate.optional(),
    notes: nullableText(4000).optional(),
    subtotal: z.unknown().optional(),
    vatAmount: z.unknown().optional(),
    totalAmount: z.unknown().optional(),
    quotationId: z.unknown().optional(),
    hireAgreementId: z.unknown().optional(),
    invoiceType: z.unknown().optional(),
    periodStart: z.unknown().optional(),
    periodEnd: z.unknown().optional(),
    invoiceNo: z.unknown().optional(),
    sequenceNo: z.unknown().optional(),
    status: z.unknown().optional(),
    amountDue: z.unknown().optional(),
  })
  .strict();

const cancelSchema = z.object({ reason: reasonSchema }).strict();
const issueSchema = z.object({}).strict();
const paymentSchema = z
  .object({ status: z.enum(REPORTABLE_STATUSES), amountDue: periodDecimal, reason: reasonSchema })
  .strict();

const listSchema = z.object({
  quotationId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  hireAgreementId: z.uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const prefillSchema = z.object({ type: z.enum(INVOICE_TYPES) });

const SORTS = {
  createdAt: 'i.created_at', number: 'i.invoice_no', status: 'i.status', invoiceDate: 'i.invoice_date',
  dueDate: 'i.due_date', periodStart: 'i.period_start',
};

// ---------------------------------------------------------------- date helpers (UTC calendar arithmetic)

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  t.setUTCDate(t.getUTCDate() + n);
  const p = (v: number, w: number) => String(v).padStart(w, '0');
  return `${p(t.getUTCFullYear(), 4)}-${p(t.getUTCMonth() + 1, 2)}-${p(t.getUTCDate(), 2)}`;
}

/** End of a one-month billing period starting on `start`, capped at `hireEnd` (same rule as the existing invoicing UI). */
export function monthlyPeriodEnd(start: string, hireEnd: string): string {
  const [y0, m0, d0] = start.split('-').map(Number);
  let y = y0;
  let mo = m0 + 1;
  if (mo > 12) { mo = 1; y += 1; }
  const dim = new Date(Date.UTC(y < 100 ? 2000 : y, mo, 0)).getUTCDate();
  const p = (v: number, w: number) => String(v).padStart(w, '0');
  const end = addDays(`${p(y, 4)}-${p(mo, 2)}-${p(Math.min(d0, dim), 2)}`, -1);
  return end > hireEnd ? hireEnd : end;
}

async function today(tx: TxClient): Promise<string> {
  const r = await tx.query<{ d: string }>("SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d");
  return r.rows[0].d;
}

// ---------------------------------------------------------------- loading and scope

interface QuotationLite {
  id: string;
  quotation_no: string;
  customer_id: string;
  phase: string;
  currency_code: string;
  branch_id: string | null;
  sales_user_id: string | null;
}

/** The quotation, hidden (404) when outside the Principal's branch / own-records scope. */
async function loadQuotationScoped(
  tx: TxClient, principal: Principal, id: string, action: 'invoices.read' | 'invoices.write', lock: boolean,
): Promise<QuotationLite> {
  const res = await tx.query<QuotationLite>(
    `SELECT id, quotation_no, customer_id, phase, currency_code, branch_id, sales_user_id
       FROM quotations WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Quotation not found');
  assertInScope(principal, action, row.branch_id);
  if (ownRecordsOnly(principal) && row.sales_user_id !== principal.userId) {
    throw new AppError('NOT_FOUND', 'Quotation not found');
  }
  return row;
}

async function loadInvoice(
  tx: TxClient, principal: Principal, id: string, action: 'invoices.read' | 'invoices.write', lock: boolean,
): Promise<InvoiceDto> {
  const res = await tx.query<InvoiceRow>(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE i.id = $1${lock ? ' FOR UPDATE OF i' : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Invoice not found');
  assertInScope(principal, action, row.quotation_branch_id);
  if (ownRecordsOnly(principal) && row.quotation_sales_user_id !== principal.userId) {
    throw new AppError('NOT_FOUND', 'Invoice not found');
  }
  return invoiceToDto(row, await loadLines(tx, [row.id]));
}

/**
 * Locks the owning quotation first (the same order the create path uses), then the invoice, then checks the
 * row version. Every mutation of an invoice goes through here so period decisions are serialized per quotation.
 */
async function lockInvoiceForUpdate(tx: TxClient, principal: Principal, id: string, expected: number): Promise<InvoiceDto> {
  const peek = await tx.query<{ quotation_id: string }>('SELECT quotation_id FROM invoices WHERE id = $1', [id]);
  if (!peek.rows[0]) throw new AppError('NOT_FOUND', 'Invoice not found');
  await loadQuotationScoped(tx, principal, peek.rows[0].quotation_id, 'invoices.write', true);
  const invoice = await loadInvoice(tx, principal, id, 'invoices.write', true);
  if (invoice.rowVersion !== expected) {
    throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
  }
  return invoice;
}

interface AgreementRow {
  id: string;
  quotation_id: string;
  customer_id: string;
  agreement_no: string;
  status: string;
  equipment_name: string;
  equipment_model: string;
  serial_number: string;
  quantity: number;
  capacity: string;
  working_height: string;
  delivery_location: string;
  hire_start_date: string;
  hire_end_date: string;
  monthly_rental: string;
  transportation_charges: string;
  payment_terms: string;
  payment_term_days: number;
  security_deposit: string;
  payment_method: string;
}

async function loadAgreement(tx: TxClient, id: string, quotation: QuotationLite): Promise<AgreementRow> {
  const res = await tx.query<AgreementRow>(
    `SELECT id, quotation_id, customer_id, agreement_no, status, equipment_name, equipment_model, serial_number, quantity,
            capacity, working_height, delivery_location, to_char(hire_start_date, 'YYYY-MM-DD') AS hire_start_date,
            to_char(hire_end_date, 'YYYY-MM-DD') AS hire_end_date, monthly_rental, transportation_charges, payment_terms,
            payment_term_days, security_deposit, payment_method
       FROM hire_agreements WHERE id = $1`,
    [id],
  );
  const a = res.rows[0];
  if (!a || a.quotation_id !== quotation.id) {
    throw new AppError('VALIDATION_ERROR', 'Hire agreement does not belong to the quotation', { hireAgreementId: 'quotation_mismatch' });
  }
  if (a.customer_id !== quotation.customer_id) {
    throw new AppError('VALIDATION_ERROR', 'Hire agreement customer does not match the quotation', { hireAgreementId: 'customer_mismatch' });
  }
  if (a.status === 'Cancelled') {
    throw new AppError('BUSINESS_RULE', 'The hire agreement is cancelled, so it cannot be invoiced', { hireAgreementId: 'cancelled' });
  }
  return a;
}

async function liveAgreementOf(tx: TxClient, quotation: QuotationLite): Promise<AgreementRow> {
  const res = await tx.query<{ id: string }>(
    "SELECT id FROM hire_agreements WHERE quotation_id = $1 AND status <> 'Cancelled' ORDER BY created_at LIMIT 2",
    [quotation.id],
  );
  if (res.rows.length === 0) throw new AppError('BUSINESS_RULE', 'No hire agreement is linked to this quotation', { hireAgreementId: 'missing' });
  if (res.rows.length > 1) throw new AppError('BUSINESS_RULE', 'More than one hire agreement is linked to this quotation', { hireAgreementId: 'ambiguous' });
  return loadAgreement(tx, res.rows[0].id, quotation);
}

interface ActiveInvoice {
  id: string;
  invoice_type: InvoiceType;
  period_start: string;
  period_end: string;
  sequence_no: string;
}

async function activeInvoices(tx: TxClient, quotationId: string): Promise<ActiveInvoice[]> {
  const res = await tx.query<ActiveInvoice>(
    `SELECT id, invoice_type, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, sequence_no
       FROM invoices WHERE quotation_id = $1 AND status <> 'Cancelled' ORDER BY period_end DESC, sequence_no DESC`,
    [quotationId],
  );
  return res.rows;
}

/** Next contiguous start: the day after the latest non-cancelled period end, else the agreement start. */
function nextPeriodStart(agreement: AgreementRow, active: ActiveInvoice[]): string {
  return active.length > 0 ? addDays(active[0].period_end, 1) : agreement.hire_start_date;
}

/** Rules shared by prefill and create that depend only on the type and the already-billed periods. */
function assertBillable(agreement: AgreementRow, active: ActiveInvoice[], type: InvoiceType, now: string): string {
  if (active.some((i) => i.invoice_type === 'Off-Hire')) {
    throw new AppError('BUSINESS_RULE', 'This quotation already has an Off-Hire invoice, so no further invoices can be created', { invoiceType: 'already_off_hired' });
  }
  const start = nextPeriodStart(agreement, active);
  if (start > agreement.hire_end_date) {
    throw new AppError('BUSINESS_RULE', 'The hire period is already fully invoiced, so there is nothing left to bill', { periodStart: 'nothing_to_bill' });
  }
  if (type === 'Off-Hire' && now < agreement.hire_end_date) {
    throw new AppError('BUSINESS_RULE', `An Off-Hire invoice can only be generated on or after the hire end date (${agreement.hire_end_date})`, { invoiceType: 'off_hire_not_due' });
  }
  return start;
}

interface Parties {
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  vatRate: string;
  currencyCode: string;
}

async function loadParties(tx: TxClient, orgId: string, customerId: string): Promise<Parties> {
  const org = await tx.query<{
    name: string; address: string; tax_registration_no: string | null; trade_license: string | null;
    phone: string | null; email: string | null; vat_rate: string; currency_code: string;
  }>('SELECT name, address, tax_registration_no, trade_license, phone, email, vat_rate, currency_code FROM organizations WHERE id = $1', [orgId]);
  const cust = await tx.query<{
    customer_code: string; name: string; address: string; billing_address: string | null; tax_registration_no: string | null;
    attn: string | null; email: string | null; phone: string;
  }>('SELECT customer_code, name, address, billing_address, tax_registration_no, attn, email, phone FROM customers WHERE id = $1', [customerId]);
  const o = org.rows[0];
  const c = cust.rows[0];
  if (!o || !c) throw new AppError('INTERNAL_ERROR', 'Invoice parties could not be read');
  return {
    issuerSnapshot: {
      name: o.name, address: o.address, taxRegistrationNo: o.tax_registration_no, tradeLicense: o.trade_license,
      attention: null, email: o.email, contact: o.phone,
    },
    customerSnapshot: {
      customerCode: c.customer_code, name: c.name, address: c.address, billingAddress: c.billing_address,
      taxRegistrationNo: c.tax_registration_no, attention: c.attn, email: c.email, contact: c.phone,
    },
    vatRate: o.vat_rate,
    currencyCode: o.currency_code.trim(),
  };
}

const equipmentDescription = (a: AgreementRow) =>
  `${a.equipment_model} ${a.equipment_name} \u2013 Monthly Hire | Serial: ${a.serial_number} | Working height: ${a.working_height} | Capacity: ${a.capacity}`;
const TRANSPORT_DESCRIPTION = 'Transportation charges';
const periodText = (start: string, end: string) => `${start} \u2013 ${end}`;

interface TransportCheck { repeat: boolean }

/**
 * A transport charge after the first active invoice of the quotation is a repeat charge: it needs an explicit
 * confirmation and the `invoices.transport_repeat` permission. The first active invoice may carry it freely.
 */
function checkTransport(principal: Principal, amount: Decimal | null, isFirstActive: boolean, confirmed: boolean | undefined): TransportCheck {
  if (!amount || amount.lte(0) || isFirstActive) return { repeat: false };
  if (!confirmed) {
    throw new AppError('BUSINESS_RULE', 'A repeat transportation charge must be explicitly confirmed', { repeatTransportConfirmed: 'required' });
  }
  if (authorize(principal, 'invoices.transport_repeat') !== 'allow') {
    throw new AppError('FORBIDDEN', 'You do not have permission to confirm a repeat transportation charge', { repeatTransportConfirmed: 'forbidden' });
  }
  return { repeat: true };
}

function mapInvoiceDbError(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23P01' && constraint === 'ex_quote_invoice_overlap') {
    throw new AppError('PERIOD_CONFLICT', 'The billing period overlaps a period that is already invoiced', { periodStart: 'overlap' });
  }
  if (code === '23505' && constraint === 'uq_invoices_quotation_sequence') {
    throw new AppError('PERIOD_CONFLICT', 'Another invoice was created for this quotation at the same time; retry', { periodStart: 'conflict' });
  }
  if (code === '23514' && err instanceof Error && err.message.startsWith('NOT_WON')) {
    throw new AppError('NOT_WON', 'Invoices can only be created for quotations in the Won phase');
  }
  throw err;
}

function positiveQuantity(q: string): void {
  if (new Money(q).lte(0)) {
    throw new AppError('VALIDATION_ERROR', 'Quantity must be greater than zero', { 'equipment.quantity': 'positive_required' });
  }
}

interface Amounts {
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
}

function totalsFor(equipmentAmount: string, transportAmount: string, vatRate: string): Amounts {
  return computeTotals(equipmentAmount, transportAmount, vatRate);
}

const AUDIT_FIELDS = [
  'invoiceNo', 'status', 'invoiceDate', 'dueDate', 'subtotal', 'vatAmount', 'totalAmount', 'amountDue', 'notes', 'lines',
];

const sameDecimal = (a: string, b: string) => new Money(a).eq(new Money(b));

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** A client may echo a stored value in another decimal format ("300" for "300.000000"); numbers compare by value. */
function sameIdentityValue(sent: unknown, stored: unknown): boolean {
  const a = String(sent);
  const b = String(stored);
  return NUMERIC.test(a) && NUMERIC.test(b) ? sameDecimal(a, b) : a === b;
}

function sendInvoice(req: Request, res: Response, dto: InvoiceDto, status = 200): void {
  void req;
  setVersionHeader(res, dto.rowVersion);
  res.status(status).json(dto);
}

// ---------------------------------------------------------------- router

/**
 * Invoices: read (invoices.read); create, edit Draft, issue, cancel (invoices.write); confirm a repeat transport charge
 * (invoices.transport_repeat); record externally reported payment state (invoices.report_payment).
 */
export function invoicesRouter(): Router {
  const router = Router();

  router.get('/invoices', async (req, res) => {
    const principal = principalWith(req, 'invoices.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'i.created_at', direction: 'DESC' });
    const params: unknown[] = [];
    const where = quotationVisibilityClauses(principal, 'q', params);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('i.quotation_id', query.quotationId);
    eq('i.customer_id', query.customerId);
    eq('i.hire_agreement_id', query.hireAgreementId);
    eq('i.status', query.status);
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${FROM} ${clause}`, params);
      const rows = await tx.query<InvoiceRow>(
        `SELECT ${COLUMNS} FROM ${FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, i.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const lines = await loadLines(tx, rows.rows.map((r) => r.id));
      return {
        items: rows.rows.map((r) => invoiceToDto(r, lines)), page, pageSize, total: Number(total.rows[0].n),
      } satisfies Page<InvoiceDto>;
    });
    res.json(body);
  });

  router.get('/invoices/:id', async (req, res) => {
    const principal = principalWith(req, 'invoices.read');
    const id = uuidParam(req);
    const dto = await withTransaction(principal.orgId, (tx) => loadInvoice(tx, principal, id, 'invoices.read', false));
    sendInvoice(req, res, dto);
  });

  router.get('/quotations/:id/invoice-prefill', async (req, res) => {
    const principal = principalWith(req, 'invoices.write');
    const id = uuidParam(req);
    const { type } = parseQuery(req, prefillSchema);
    const body = await withTransaction(principal.orgId, async (tx) => {
      const quotation = await loadQuotationScoped(tx, principal, id, 'invoices.write', false);
      if (quotation.phase !== 'WON') throw new AppError('NOT_WON', 'Invoices can only be created for quotations in the Won phase');
      const agreement = await liveAgreementOf(tx, quotation);
      const active = await activeInvoices(tx, quotation.id);
      const now = await today(tx);
      const periodStart = assertBillable(agreement, active, type, now);
      const parties = await loadParties(tx, principal.orgId, quotation.customer_id);
      const first = active.length === 0;
      const quantity = String(agreement.quantity);
      return {
        quotationId: quotation.id,
        hireAgreementId: agreement.id,
        agreementNo: agreement.agreement_no,
        invoiceType: type,
        periodStart,
        // Off-Hire ends on the agreement end (read-only); Continuous Hire is entered by the employee.
        periodEnd: type === 'Off-Hire' ? agreement.hire_end_date : null,
        suggestedPeriodEnd: type === 'Off-Hire' ? agreement.hire_end_date : monthlyPeriodEnd(periodStart, agreement.hire_end_date),
        hireStartDate: agreement.hire_start_date,
        hireEndDate: agreement.hire_end_date,
        invoiceDate: now,
        dueDate: addDays(now, agreement.payment_term_days),
        paymentTermDays: agreement.payment_term_days,
        paymentTerms: agreement.payment_terms,
        paymentMethod: agreement.payment_method,
        deliveryLocation: agreement.delivery_location,
        securityDeposit: agreement.security_deposit,
        currencyCode: parties.currencyCode,
        vatRate: parties.vatRate,
        // The amount is a suggestion only: the employee confirms the period charge (no automatic proration).
        equipment: {
          description: equipmentDescription(agreement),
          quantity,
          unitRate: agreement.monthly_rental,
          amount: money2(new Money(quantity).times(agreement.monthly_rental)),
        },
        transport: {
          description: TRANSPORT_DESCRIPTION,
          amount: first ? money2(agreement.transportation_charges) : '0.00',
          repeatRequiresConfirmation: !first,
        },
        issuerSnapshot: parties.issuerSnapshot,
        customerSnapshot: parties.customerSnapshot,
      };
    });
    res.json(body);
  });

  router.post('/invoices', requireAction('invoices.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'invoices.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'invoices.create', ctx, async () => {
          // Serializes all invoice creation, cancellation and edits of this quotation.
          const quotation = await loadQuotationScoped(tx, principal, input.quotationId, 'invoices.write', true);
          // Checked before any number is allocated so a rejected request never consumes one.
          if (quotation.phase !== 'WON') throw new AppError('NOT_WON', 'Invoices can only be created for quotations in the Won phase');
          const agreement = await loadAgreement(tx, input.hireAgreementId, quotation);
          const active = await activeInvoices(tx, quotation.id);
          const now = await today(tx);
          const expectedStart = assertBillable(agreement, active, input.invoiceType, now);
          if (input.periodStart < expectedStart) {
            throw new AppError('PERIOD_CONFLICT', 'The billing period overlaps a period that is already invoiced', { periodStart: 'overlap' });
          }
          if (input.periodStart > expectedStart) {
            throw new AppError('BUSINESS_RULE', `The billing period must start on ${expectedStart} to stay contiguous with the previous invoice`, { periodStart: 'gap' });
          }
          let periodEnd: string;
          if (input.invoiceType === 'Continuous Hire') {
            if (!input.periodEnd) throw new AppError('VALIDATION_ERROR', 'Billing period end date is required for Continuous Hire', { periodEnd: 'required' });
            if (input.periodEnd < expectedStart) throw new AppError('BUSINESS_RULE', 'Billing period end date is before the billing period start date', { periodEnd: 'before_start' });
            if (input.periodEnd > agreement.hire_end_date) throw new AppError('BUSINESS_RULE', 'Billing period end date is after the hire end date', { periodEnd: 'after_hire_end' });
            periodEnd = input.periodEnd;
          } else {
            if (input.periodEnd !== undefined && input.periodEnd !== agreement.hire_end_date) {
              throw new AppError('BUSINESS_RULE', 'Off-Hire invoices always end on the hire end date; a different end date is not allowed', { periodEnd: 'not_allowed' });
            }
            periodEnd = agreement.hire_end_date;
          }
          positiveQuantity(input.equipment.quantity);
          const transportAmount = input.transport ? new Money(input.transport.amount) : null;
          const transportCheck = checkTransport(principal, transportAmount, active.length === 0, input.repeatTransportConfirmed);

          const parties = await loadParties(tx, principal.orgId, quotation.customer_id);
          const equipmentAmount = money2(input.equipment.amount);
          const transportStored = transportAmount ? money2(transportAmount) : '0.00';
          const totals = totalsFor(equipmentAmount, transportStored, parties.vatRate);
          const invoiceDate = input.invoiceDate ?? now;
          const dueDate = addDays(invoiceDate, agreement.payment_term_days);

          const seq = await tx.query<{ n: string }>('SELECT COALESCE(max(sequence_no), 0) + 1 AS n FROM invoices WHERE quotation_id = $1', [quotation.id]);
          // Header number = quote number + "/" + the quote-specific suffix (01, 02, ... 100), unique per company.
          const suffix = await allocateNumber(tx, principal.orgId, 'INVOICE', { quotationId: quotation.id });
          const invoiceNo = `${quotation.quotation_no}/${suffix}`;
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO invoices (org_id, quotation_id, hire_agreement_id, customer_id, invoice_no, quotation_no_snapshot,
                agreement_no_snapshot, sequence_no, invoice_type, period_start, period_end, invoice_date, due_date, currency_code,
                status, issuer_snapshot, customer_snapshot, hire_period_text, delivery_location, payment_terms, payment_term_days,
                payment_method, security_deposit, subtotal, vat_rate, vat_amount, total_amount, amount_due, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'Draft', $15::jsonb, $16::jsonb, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $26, $27, $28, $28)
             RETURNING id`,
            [
              principal.orgId, quotation.id, agreement.id, quotation.customer_id, invoiceNo, quotation.quotation_no,
              agreement.agreement_no, seq.rows[0].n, input.invoiceType, input.periodStart, periodEnd, invoiceDate, dueDate,
              parties.currencyCode, JSON.stringify(parties.issuerSnapshot), JSON.stringify(parties.customerSnapshot),
              periodText(input.periodStart, periodEnd), agreement.delivery_location, agreement.payment_terms,
              agreement.payment_term_days, agreement.payment_method, agreement.security_deposit, totals.subtotal,
              parties.vatRate, totals.vatAmount, totals.totalAmount, input.notes ?? null, principal.userId,
            ],
          );
          const invoiceId = ins.rows[0].id;
          await tx.query(
            `INSERT INTO invoice_lines (org_id, invoice_id, line_no, line_type, description, quantity, unit_rate, amount, created_by, updated_by)
             VALUES ($1, $2, 1, 'EQUIPMENT', $3, $4, $5, $6, $7, $7)`,
            [principal.orgId, invoiceId, equipmentDescription(agreement), input.equipment.quantity, input.equipment.unitRate, equipmentAmount, principal.userId],
          );
          if (transportAmount && transportAmount.gt(0)) {
            await tx.query(
              `INSERT INTO invoice_lines (org_id, invoice_id, line_no, line_type, description, quantity, unit_rate, amount, created_by, updated_by)
               VALUES ($1, $2, 2, 'TRANSPORT', $3, 1, $4, $4, $5, $5)`,
              [principal.orgId, invoiceId, TRANSPORT_DESCRIPTION, transportStored, principal.userId],
            );
          }
          const dto = await loadInvoice(tx, principal, invoiceId, 'invoices.write', false);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'invoice.created', entityType: 'invoice', entityId: dto.id,
            correlationId: req.correlationId, after: dto,
          });
          if (transportCheck.repeat) {
            await recordAudit(tx, principal.orgId, {
              actorUserId: principal.userId, action: 'invoice.transport_repeat_confirmed', entityType: 'invoice', entityId: dto.id,
              correlationId: req.correlationId, reason: 'Repeat transportation charge confirmed',
              after: { transportAmount: transportStored, quotationId: quotation.id },
            });
          }
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapInvoiceDbError(err);
    }
    if (result.status === 201) setVersionHeader(res, (result.body as InvoiceDto).rowVersion);
    res.status(result.status).json(result.body);
  });

  router.patch('/invoices/:id', async (req, res) => {
    const principal = principalWith(req, 'invoices.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = patchSchema.parse(req.body ?? {});
    const hasEffect = patch.equipment !== undefined || patch.transport !== undefined || patch.invoiceDate !== undefined ||
      patch.notes !== undefined;
    let dto: InvoiceDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const before = await lockInvoiceForUpdate(tx, principal, id, expected);
        const current = before as unknown as Record<string, unknown>;
        // Identity fields may be echoed back but never changed.
        for (const key of PROTECTED_KEYS) {
          const sent = (patch as Record<string, unknown>)[key];
          if (sent !== undefined && !sameIdentityValue(sent, current[key])) {
            throw new AppError('IMMUTABLE_FIELD', `${key} cannot be changed on an invoice`, { [key]: 'immutable' });
          }
        }
        if (!hasEffect) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
        if (before.status === 'Cancelled') {
          throw new AppError('INVALID_TRANSITION', 'A cancelled invoice cannot be changed', { status: 'cancelled' });
        }

        const eqLine = before.lines.find((l) => l.lineType === 'EQUIPMENT');
        const trLine = before.lines.find((l) => l.lineType === 'TRANSPORT');
        if (!eqLine) throw new AppError('INTERNAL_ERROR', 'Invoice has no equipment line');
        const nextEq = {
          quantity: patch.equipment?.quantity ?? eqLine.quantity,
          unitRate: patch.equipment?.unitRate ?? eqLine.unitRate,
          amount: patch.equipment?.amount ?? eqLine.amount,
        };
        const nextTransport = patch.transport === undefined ? (trLine?.amount ?? null) : (patch.transport?.amount ?? null);
        const nextInvoiceDate = patch.invoiceDate ?? before.invoiceDate;
        const equipmentChanged = !sameDecimal(nextEq.quantity, eqLine.quantity) || !sameDecimal(nextEq.unitRate, eqLine.unitRate) ||
          !sameDecimal(nextEq.amount, eqLine.amount);
        const transportChanged = !sameDecimal(nextTransport ?? '0', trLine?.amount ?? '0');
        const dateChanged = nextInvoiceDate !== before.invoiceDate;
        const financialChanged = equipmentChanged || transportChanged || dateChanged;

        if (financialChanged && before.status !== 'Draft') {
          throw new AppError('IMMUTABLE_FIELD', 'Financial fields cannot be changed once an invoice has been issued', { status: 'not_draft' });
        }

        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        if (patch.notes !== undefined) set.notes = patch.notes;
        let repeat = false;
        let newTransportStored: string | null = null;

        if (financialChanged) {
          // Draft recomputation is latest-only: earlier coverage is already settled by the invoices after it.
          const active = await activeInvoices(tx, before.quotationId);
          if (active[0]?.id !== before.id) {
            throw new AppError('BUSINESS_RULE', 'Only the latest invoice of a quotation can be recomputed', { id: 'not_latest' });
          }
          if (equipmentChanged) {
            if (patch.periodChargeConfirmed !== true) {
              throw new AppError('VALIDATION_ERROR', 'The period charge must be confirmed', { periodChargeConfirmed: 'required' });
            }
            positiveQuantity(nextEq.quantity);
          }
          if (transportChanged) {
            const amt = nextTransport === null ? null : new Money(nextTransport);
            const isFirst = active[active.length - 1].id === before.id;
            repeat = checkTransport(principal, amt, isFirst, patch.repeatTransportConfirmed).repeat;
          }
          const vat = await tx.query<{ vat_rate: string }>('SELECT vat_rate FROM invoices WHERE id = $1', [before.id]);
          newTransportStored = nextTransport === null ? '0.00' : money2(nextTransport);
          const totals = totalsFor(money2(nextEq.amount), newTransportStored, vat.rows[0].vat_rate);
          set.subtotal = totals.subtotal;
          set.vat_amount = totals.vatAmount;
          set.total_amount = totals.totalAmount;
          // A Draft has no recorded payment, so its balance follows the recomputed total.
          set.amount_due = totals.totalAmount;
          set.invoice_date = nextInvoiceDate;
          set.due_date = addDays(nextInvoiceDate, before.paymentTermDays);
        }

        await versionedUpdate(tx, { table: 'invoices', orgId: principal.orgId, id, expectedVersion: expected, set });

        if (financialChanged) {
          if (equipmentChanged) {
            await tx.query(
              `UPDATE invoice_lines SET quantity = $3, unit_rate = $4, amount = $5, updated_at = now(), updated_by = $6,
                      row_version = row_version + 1
                WHERE invoice_id = $1 AND line_type = $2`,
              [id, 'EQUIPMENT', nextEq.quantity, nextEq.unitRate, money2(nextEq.amount), principal.userId],
            );
          }
          if (transportChanged) {
            if (newTransportStored !== null && new Money(newTransportStored).gt(0)) {
              if (trLine) {
                await tx.query(
                  `UPDATE invoice_lines SET unit_rate = $2, amount = $2, updated_at = now(), updated_by = $3, row_version = row_version + 1
                    WHERE invoice_id = $1 AND line_type = 'TRANSPORT'`,
                  [id, newTransportStored, principal.userId],
                );
              } else {
                await tx.query(
                  `INSERT INTO invoice_lines (org_id, invoice_id, line_no, line_type, description, quantity, unit_rate, amount, created_by, updated_by)
                   VALUES ($1, $2, 2, 'TRANSPORT', $3, 1, $4, $4, $5, $5)`,
                  [principal.orgId, id, TRANSPORT_DESCRIPTION, newTransportStored, principal.userId],
                );
              }
            } else if (trLine) {
              await tx.query("DELETE FROM invoice_lines WHERE invoice_id = $1 AND line_type = 'TRANSPORT'", [id]);
            }
          }
        }

        const after = await loadInvoice(tx, principal, id, 'invoices.write', false);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'invoice.updated', entityType: 'invoice', entityId: id,
          correlationId: req.correlationId, before: pick(before, AUDIT_FIELDS), after: pick(after, AUDIT_FIELDS),
        });
        if (repeat) {
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'invoice.transport_repeat_confirmed', entityType: 'invoice', entityId: id,
            correlationId: req.correlationId, reason: 'Repeat transportation charge confirmed',
            after: { transportAmount: newTransportStored, quotationId: before.quotationId },
          });
        }
        return after;
      });
    } catch (err) {
      mapInvoiceDbError(err);
    }
    sendInvoice(req, res, dto);
  });

  router.post('/invoices/:id/issue', async (req, res) => {
    const principal = principalWith(req, 'invoices.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    issueSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await lockInvoiceForUpdate(tx, principal, id, expected);
      if (before.status !== 'Draft') {
        throw new AppError('INVALID_TRANSITION', `Only a Draft invoice can be issued (current status ${before.status})`, { status: 'not_draft' });
      }
      const now = new Date();
      await versionedUpdate(tx, {
        table: 'invoices', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Sent', issued_at: now, updated_at: now, updated_by: principal.userId },
      });
      const after = await loadInvoice(tx, principal, id, 'invoices.write', false);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'invoice.issued', entityType: 'invoice', entityId: id,
        correlationId: req.correlationId, before: pick(before, ['status', 'issuedAt']), after: pick(after, ['status', 'issuedAt']),
      });
      return after;
    });
    sendInvoice(req, res, dto);
  });

  router.post('/invoices/:id/cancel', async (req, res) => {
    const principal = principalWith(req, 'invoices.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const { reason } = cancelSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await lockInvoiceForUpdate(tx, principal, id, expected);
      if (before.status !== 'Draft') {
        throw new AppError('INVALID_TRANSITION', 'Only a Draft invoice can be cancelled; issued invoices cannot be corrected here', { status: 'not_draft' });
      }
      const active = await activeInvoices(tx, before.quotationId);
      if (active[0]?.id !== before.id) {
        throw new AppError('BUSINESS_RULE', 'Only the latest invoice of a quotation can be cancelled', { id: 'not_latest' });
      }
      const now = new Date();
      // The invoice number stays allocated: the sequence is never decremented or reused.
      await versionedUpdate(tx, {
        table: 'invoices', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Cancelled', cancelled_at: now, cancellation_reason: reason, updated_at: now, updated_by: principal.userId },
      });
      const after = await loadInvoice(tx, principal, id, 'invoices.write', false);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'invoice.cancelled', entityType: 'invoice', entityId: id,
        correlationId: req.correlationId, reason,
        before: pick(before, ['status', 'periodStart', 'periodEnd']), after: pick(after, ['status', 'cancelledAt']),
      });
      return after;
    });
    sendInvoice(req, res, dto);
  });

  router.post('/invoices/:id/payment-status', async (req, res) => {
    const principal = principalWith(req, 'invoices.report_payment');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = paymentSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await lockInvoiceForUpdate(tx, principal, id, expected);
      if (before.status === 'Draft' || before.status === 'Cancelled') {
        throw new AppError('INVALID_TRANSITION', `Payment state can only be reported on an issued invoice (current status ${before.status})`, { status: before.status });
      }
      const due = new Money(input.amountDue);
      if (due.lt(0) || due.gt(new Money(before.totalAmount))) {
        throw new AppError('VALIDATION_ERROR', 'Amount due must be between 0 and the invoice total', { amountDue: 'out_of_range' });
      }
      if (input.status === 'Paid' && !due.isZero()) {
        throw new AppError('VALIDATION_ERROR', 'A Paid invoice must have an amount due of 0', { amountDue: 'paid_requires_zero' });
      }
      const now = new Date();
      await versionedUpdate(tx, {
        table: 'invoices', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: input.status, amount_due: due.toFixed(CURRENCY_PRECISION), updated_at: now, updated_by: principal.userId },
      });
      const after = await loadInvoice(tx, principal, id, 'invoices.write', false);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'invoice.payment_status_reported', entityType: 'invoice', entityId: id,
        correlationId: req.correlationId, reason: input.reason,
        before: pick(before, ['status', 'amountDue']), after: pick(after, ['status', 'amountDue']),
      });
      return after;
    });
    sendInvoice(req, res, dto);
  });

  return router;
}

