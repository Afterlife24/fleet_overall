// Pure invoice rules for quotation-based invoicing.
// Types-only imports: no stores, React or toast. The facade (quotationInvoicing.ts)
// gathers an InvoicingSnapshot from the stores and applies the results.
// Dates are YYYY-MM-DD strings handled with UTC arithmetic only.
import type { InvoiceStatus, InvoiceType, TaxInvoice } from '@/types/taxinvoice';
import type { QuotationPhase } from '@/types/quotation';

export const VAT_RATE = 0.05;
export const MAX_SEQUENCE = 99;

export type RuleCode =
  | 'QUOTATION_REQUIRED' | 'QUOTATION_NOT_FOUND' | 'NOT_WON' | 'CRM_INACTIVE'
  | 'NO_AGREEMENT' | 'AMBIGUOUS_AGREEMENT' | 'AGREEMENT_DATES_INVALID'
  | 'INVALID_TYPE' | 'END_DATE_REQUIRED' | 'INVALID_DATE' | 'END_BEFORE_START'
  | 'END_AFTER_HIRE_END' | 'END_DATE_NOT_ALLOWED' | 'NOTHING_TO_BILL'
  | 'ALREADY_OFF_HIRED' | 'OVERLAP' | 'GAP' | 'DUPLICATE_PERIOD'
  | 'SEQUENCE_EXHAUSTED' | 'IMMUTABLE_FIELD' | 'NOT_LATEST_INVOICE' | 'OFF_HIRE_NOT_DUE';

export const RULE_MESSAGES: Record<RuleCode, string> = {
  QUOTATION_REQUIRED: 'Select a Won quotation to create an invoice',
  QUOTATION_NOT_FOUND: 'The quotation was not found in this organisation',
  NOT_WON: 'Invoices can only be created for quotations in the Won phase',
  CRM_INACTIVE: 'The CRM app is not active, so invoices cannot be created from quotations',
  NO_AGREEMENT: 'No hire agreement is linked to this quotation',
  AMBIGUOUS_AGREEMENT: 'More than one hire agreement is linked to this quotation',
  AGREEMENT_DATES_INVALID: 'The linked hire agreement has missing or invalid hire dates',
  INVALID_TYPE: 'Invoice type must be Continuous Hire or Off-Hire',
  END_DATE_REQUIRED: 'Billing period end date is required for Continuous Hire',
  INVALID_DATE: 'Billing period end date is not a valid date',
  END_BEFORE_START: 'Billing period end date is before the billing period start date',
  END_AFTER_HIRE_END: 'Billing period end date is after the hire end date',
  END_DATE_NOT_ALLOWED: 'Off-Hire invoices always end on the hire end date; a different end date is not allowed',
  NOTHING_TO_BILL: 'The hire period is already fully invoiced, so there is nothing left to bill',
  ALREADY_OFF_HIRED: 'This quotation already has an Off-Hire invoice, so no further invoices can be created',
  OVERLAP: 'The billing period overlaps a period that is already invoiced',
  GAP: 'The billing period would leave an uninvoiced gap after the previous invoice',
  DUPLICATE_PERIOD: 'An invoice for this billing period already exists',
  SEQUENCE_EXHAUSTED: 'The maximum of 99 invoices for this quotation has been reached',
  IMMUTABLE_FIELD: 'Quotation, invoice number, type and billing period cannot be changed on a linked invoice',
  NOT_LATEST_INVOICE: 'Only the latest invoice of a quotation can be deleted, cancelled or re-dated',
  OFF_HIRE_NOT_DUE: 'An Off-Hire invoice can only be generated on or after the hire end date',
};

export type RuleResult<T> = { ok: true; value: T } | { ok: false; code: RuleCode; message: string };

export function ruleOk<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

export function ruleFail<T = never>(code: RuleCode, detail?: string): RuleResult<T> {
  const base = RULE_MESSAGES[code];
  return { ok: false, code, message: detail ? `${base}: ${detail}` : base };
}

export interface QuotationLite {
  id: string;
  orgId: string;
  number: string;
  phase: QuotationPhase;
  customerName: string;
  customerId: string;
  amount: number;
}

export interface AgreementLite {
  id: string;
  orgId: string;
  agreementNo: string;
  quotationId: string;
  status: string;
  hireStartDate: string;
  hireEndDate: string;
  customerId: string;
  customerName: string;
  customerTrn: string;
  attn: string;
  contactNumber: string;
  customerEmail: string;
  billingAddress: string;
  deliveryLocation: string;
  paymentTerms: string;
  paymentMethod: string;
  securityDeposit: number;
  equipmentName: string;
  equipmentModel: string;
  serialNumber: string;
  workingHeight: string;
  capacity: string;
  monthlyRental: number;
  transportationCharges: number;
}

export interface InvoiceLite {
  id: string;
  orgId: string;
  quotationId?: string;
  invoiceType?: InvoiceType;
  status: InvoiceStatus;
  periodStart?: string;
  periodEnd?: string;
  sequence?: number;
}

export interface InvoicingSnapshot {
  orgId: string;
  today: string;
  crmActive: boolean;
  quotations: QuotationLite[];
  agreements: AgreementLite[];
  invoices: InvoiceLite[];
  /** Highest sequence ever assigned per quotation id (survives deletes). */
  sequenceByQuotation: Record<string, number>;
}

// ---------------------------------------------------------------- Dates

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in `YYYY-MM-DD` form. */
export function isDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC maps years 0..99 to 1900..1999, so setUTCFullYear restores the year.
  t.setUTCFullYear(y);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** Adds `n` days (may be negative) to a valid `YYYY-MM-DD`. Returns '' for invalid input. */
export function addDays(iso: string, n: number): string {
  if (!isDateString(iso) || !Number.isFinite(n)) return '';
  const m = ISO_RE.exec(iso)!;
  const t = new Date(Date.UTC(2000, Number(m[2]) - 1, Number(m[3])));
  t.setUTCFullYear(Number(m[1]));
  t.setUTCDate(t.getUTCDate() + Math.trunc(n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}

/**
 * End of a one-month billing period that starts on `start`: the day before the same day of the next
 * month (clamped to the month length), capped at `hireEnd`. 2026-01-15 -> 2026-02-14, 2026-01-31 -> 2026-02-27.
 */
export function monthlyPeriodEnd(start: string, hireEnd?: string): string {
  if (!isDateString(start)) return '';
  const m = ISO_RE.exec(start)!;
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y += 1; }
  const dim = new Date(Date.UTC(y < 100 ? 2000 : y, mo, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), dim);
  const end = addDays(`${pad(y, 4)}-${pad(mo, 2)}-${pad(day, 2)}`, -1);
  return hireEnd && isDateString(hireEnd) && compareDates(end, hireEnd) > 0 ? hireEnd : end;
}

/** Lexicographic comparison of valid `YYYY-MM-DD` strings: negative, 0 or positive. */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------- Quotation / agreement

/** Won quotations of the snapshot's active organisation. */
export function listInvoiceableQuotations(s: InvoicingSnapshot): QuotationLite[] {
  return s.quotations.filter((q) => q.orgId === s.orgId && q.phase === 'Won');
}

/** The single non-Cancelled agreement of the active org linked to the quotation. */
export function resolveSourceAgreement(s: InvoicingSnapshot, quotationId: string): RuleResult<AgreementLite> {
  const candidates = s.agreements.filter(
    (a) => a.orgId === s.orgId && !!quotationId && a.quotationId === quotationId && a.status !== 'Cancelled',
  );
  if (candidates.length === 0) return ruleFail('NO_AGREEMENT');
  if (candidates.length > 1) {
    const nos = candidates.map((a) => a.agreementNo).sort();
    return ruleFail('AMBIGUOUS_AGREEMENT', nos.join(', '));
  }
  return ruleOk(candidates[0]);
}

// ------------------------------------------------------------ Numbering

/** `QT-2026-0003` + 1 -> `QT-2026-0003/01`. */
export function formatInvoiceNo(quotationNumber: string, seq: number): string {
  return `${quotationNumber}/${pad(seq, 2)}`;
}

/** Inverse of `formatInvoiceNo`; null when the text has no `/NN` suffix. */
export function parseInvoiceNo(no: string): { quotationNumber: string; seq: number } | null {
  const m = /^(.*)\/(\d{2})$/.exec(no);
  if (!m || !m[1]) return null;
  return { quotationNumber: m[1], seq: Number(m[2]) };
}

// --------------------------------------------------------------- Totals

export interface TotalsInput {
  equipmentQty: number;
  equipmentRate: number;
  transportationQty: number;
  transportationRate: number;
}

export interface TotalsOutput {
  equipmentAmount: number;
  transportationAmount: number;
  subtotal: number;
  vat: number;
  totalAmount: number;
  amountDue: number;
}

/** Extracted unchanged from InvoicePage.recalc (VAT 5%, rounded to 2 decimals). */
export function recalcTotals<T extends Partial<TotalsInput>>(f: T): T & TotalsOutput {
  const equipmentAmount = (f.equipmentQty ?? 0) * (f.equipmentRate ?? 0);
  const transportationAmount = (f.transportationQty ?? 0) * (f.transportationRate ?? 0);
  const subtotal = equipmentAmount + transportationAmount;
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  const totalAmount = Math.round((subtotal + vat) * 100) / 100;
  return { ...f, equipmentAmount, transportationAmount, subtotal, vat, totalAmount, amountDue: totalAmount };
}

// ------------------------------------------------- Requests and drafts

export interface InvoiceRequest {
  quotationId?: string;
  invoiceType?: string;
  /** Continuous Hire only. */
  periodEnd?: string;
  /** Optional; only compared with the derived start. */
  periodStart?: string;
}

export interface InvoicePlan {
  quotation: QuotationLite;
  agreement: AgreementLite;
  invoiceType: InvoiceType;
  periodStart: string;
  periodEnd: string;
  sequence: number;
  invoiceNo: string;
}

/** Org profile fields copied into the invoice issuer block. */
export interface InvoiceIssuer {
  name?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  tradeLicense?: string;
  companyTrn?: string;
}

/** User-editable values applied on top of the carried-over data. */
export interface InvoiceEdits {
  invoiceDate?: string;
  currency?: string;
  notes?: string;
  equipmentDescription?: string;
  equipmentQty?: number;
  equipmentRate?: number;
  transportationQty?: number;
  transportationRate?: number;
  paymentMethod?: string;
  securityDeposit?: number;
  billingAddress?: string;
  dueDate?: string;
  deliveryLocation?: string;
  paymentTerms?: string;
  customerTrn?: string;
  attn?: string;
  contactNumber?: string;
  customerEmail?: string;
}

export type ProtectedField =
  | 'quotationId' | 'quotationNumber' | 'invoiceNo' | 'sequence' | 'invoiceType'
  | 'periodStart' | 'periodEnd' | 'hireAgreementId' | 'orgId';

export const PROTECTED_FIELDS: readonly ProtectedField[] = [
  'quotationId', 'quotationNumber', 'invoiceNo', 'sequence', 'invoiceType',
  'periodStart', 'periodEnd', 'hireAgreementId', 'orgId',
];

export type ProtectedFields = Partial<Record<ProtectedField, unknown>>;

/** Invoices of the quotation (active org) that are not Cancelled. */
export function activeInvoices(s: InvoicingSnapshot, quotationId: string): InvoiceLite[] {
  return s.invoices.filter(
    (i) => i.orgId === s.orgId && !!quotationId && i.quotationId === quotationId && i.status !== 'Cancelled',
  );
}

function latestPeriodEnd(active: InvoiceLite[]): string | undefined {
  let latest: string | undefined;
  for (const i of active) {
    if (i.periodEnd && isDateString(i.periodEnd) && (latest === undefined || i.periodEnd > latest)) latest = i.periodEnd;
  }
  return latest;
}

/** Hire start with no active invoice, else the day after the latest active period end. */
export function nextPeriodStart(agreement: AgreementLite, active: InvoiceLite[]): string {
  const latest = latestPeriodEnd(active);
  return latest ? addDays(latest, 1) : agreement.hireStartDate;
}

export function validateInvoiceRequest(s: InvoicingSnapshot, r: InvoiceRequest): RuleResult<InvoicePlan> {
  // 1. quotation
  if (!r.quotationId) return ruleFail('QUOTATION_REQUIRED');
  if (!s.crmActive) return ruleFail('CRM_INACTIVE');
  const quotation = s.quotations.find((q) => q.id === r.quotationId && q.orgId === s.orgId);
  if (!quotation) return ruleFail('QUOTATION_NOT_FOUND');
  if (quotation.phase !== 'Won') return ruleFail('NOT_WON');

  // 2. agreement
  const ag = resolveSourceAgreement(s, quotation.id);
  if (!ag.ok) return ag;
  const agreement = ag.value;
  if (
    !isDateString(agreement.hireStartDate) || !isDateString(agreement.hireEndDate) ||
    compareDates(agreement.hireStartDate, agreement.hireEndDate) > 0
  ) return ruleFail('AGREEMENT_DATES_INVALID');

  // 3. type
  if (r.invoiceType !== 'Continuous Hire' && r.invoiceType !== 'Off-Hire') return ruleFail('INVALID_TYPE');
  const invoiceType: InvoiceType = r.invoiceType;

  // 4. Off-Hire finality and sequence
  const active = activeInvoices(s, quotation.id);
  if (active.some((i) => i.invoiceType === 'Off-Hire')) return ruleFail('ALREADY_OFF_HIRED');
  const stored = s.sequenceByQuotation[quotation.id];
  const maxSeq = stored ?? s.invoices
    .filter((i) => i.orgId === s.orgId && i.quotationId === quotation.id)
    .reduce((m, i) => Math.max(m, i.sequence ?? 0), 0);
  if (maxSeq >= MAX_SEQUENCE) return ruleFail('SEQUENCE_EXHAUSTED');

  // 5. derived start
  const start = nextPeriodStart(agreement, active);
  if (compareDates(start, agreement.hireEndDate) > 0) {
    return ruleFail(invoiceType === 'Off-Hire' ? 'NOTHING_TO_BILL' : 'END_AFTER_HIRE_END');
  }

  // 6. supplied start
  if (r.periodStart) {
    const c = compareDates(r.periodStart, start);
    if (c < 0) {
      const dup = !!r.periodEnd && active.some((i) => i.periodStart === r.periodStart && i.periodEnd === r.periodEnd);
      return ruleFail(dup ? 'DUPLICATE_PERIOD' : 'OVERLAP');
    }
    if (c > 0) return ruleFail('GAP');
  }

  // 7. end date
  let end: string;
  if (invoiceType === 'Continuous Hire') {
    if (!r.periodEnd) return ruleFail('END_DATE_REQUIRED');
    if (!isDateString(r.periodEnd)) return ruleFail('INVALID_DATE');
    if (compareDates(r.periodEnd, start) < 0) return ruleFail('END_BEFORE_START');
    if (compareDates(r.periodEnd, agreement.hireEndDate) > 0) return ruleFail('END_AFTER_HIRE_END');
    end = r.periodEnd;
  } else {
    if (r.periodEnd && r.periodEnd !== agreement.hireEndDate) return ruleFail('END_DATE_NOT_ALLOWED');
    // Off-Hire is the final invoice: it can only be generated once the hire has ended.
    if (compareDates(s.today, agreement.hireEndDate) < 0) return ruleFail('OFF_HIRE_NOT_DUE', agreement.hireEndDate);
    end = agreement.hireEndDate;
  }

  // 8. plan
  const sequence = maxSeq + 1;
  return ruleOk({
    quotation, agreement, invoiceType,
    periodStart: start, periodEnd: end, sequence,
    invoiceNo: formatInvoiceNo(quotation.number, sequence),
  });
}

/** Same description format as InvoicePage.pickAgreement. */
function equipmentDescriptionOf(h: AgreementLite): string {
  return `${h.equipmentModel} ${h.equipmentName} – Monthly Hire | Serial: ${h.serialNumber} | Working height: ${h.workingHeight} | Capacity: ${h.capacity}`;
}

export function buildInvoiceDraft(
  plan: InvoicePlan,
  s: InvoicingSnapshot,
  edits: InvoiceEdits = {},
  issuer: InvoiceIssuer = {},
): Omit<TaxInvoice, 'id' | 'createdAt' | 'updatedAt'> {
  const { agreement: h, quotation: q } = plan;
  const invoiceDate = edits.invoiceDate && isDateString(edits.invoiceDate) ? edits.invoiceDate : s.today;
  const terms = parseInt(edits.paymentTerms ?? h.paymentTerms, 10) || 30;
  const invoiceNo = plan.invoiceNo;
  const base = {
    orgId: s.orgId,
    quotationId: q.id,
    quotationNumber: q.number,
    invoiceType: plan.invoiceType,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    sequence: plan.sequence,
    hireAgreementId: h.id,
    invoiceNo,
    invoiceDate,
    dueDate: edits.dueDate && isDateString(edits.dueDate) ? edits.dueDate : addDays(invoiceDate, terms),
    currency: edits.currency ?? 'AED',
    status: 'Draft' as InvoiceStatus,
    issuerName: issuer.name ?? '',
    issuerAddress: issuer.companyAddress ?? '',
    issuerPhone: issuer.companyPhone ?? '',
    issuerEmail: issuer.companyEmail ?? '',
    issuerTradeLicense: issuer.tradeLicense ?? '',
    issuerTrn: issuer.companyTrn ?? '',
    customerId: h.customerId,
    customerName: h.customerName,
    customerTrn: edits.customerTrn ?? h.customerTrn,
    attn: edits.attn ?? h.attn,
    contactNumber: edits.contactNumber ?? h.contactNumber,
    customerEmail: edits.customerEmail ?? h.customerEmail,
    billingAddress: edits.billingAddress ?? h.billingAddress,
    hireAgreementNo: h.agreementNo,
    hirePeriod: `${plan.periodStart} – ${plan.periodEnd}`,
    deliveryLocation: edits.deliveryLocation ?? h.deliveryLocation,
    paymentTerms: edits.paymentTerms ?? h.paymentTerms,
    equipmentDescription: edits.equipmentDescription ?? equipmentDescriptionOf(h),
    equipmentQty: edits.equipmentQty ?? 1,
    equipmentRate: edits.equipmentRate ?? h.monthlyRental,
    transportationQty: edits.transportationQty ?? 1,
    transportationRate: edits.transportationRate ?? h.transportationCharges,
    paymentMethod: edits.paymentMethod ?? h.paymentMethod,
    securityDeposit: edits.securityDeposit ?? h.securityDeposit,
    notes: edits.notes ?? `Please mention invoice number ${invoiceNo} when making payment. This invoice covers the equipment hire and transportation charges listed above.`,
  };
  return recalcTotals(base);
}

/** Linked invoices keep protected fields; legacy invoices (no quotationId) accept any patch. */
export function validateInvoiceUpdate(
  existing: InvoiceLite & ProtectedFields,
  patch: Partial<TaxInvoice>,
): RuleResult<true> {
  if (!existing.quotationId) return ruleOk(true);
  const p = patch as ProtectedFields;
  const e = existing as ProtectedFields;
  for (const k of PROTECTED_FIELDS) {
    if (k in p && p[k] !== e[k]) return ruleFail('IMMUTABLE_FIELD', k);
  }
  return ruleOk(true);
}

/** Only the latest active linked invoice of a quotation can be deleted or cancelled. */
export function validateInvoiceRemoval(
  s: InvoicingSnapshot,
  invoiceId: string,
  _action: 'delete' | 'cancel',
): RuleResult<true> {
  void _action; // same rule for delete and cancel; kept for call-site clarity
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv || !inv.quotationId) return ruleOk(true);
  const active = activeInvoices(s, inv.quotationId);
  const latest = latestPeriodEnd(active);
  if (!active.some((i) => i.id === inv.id) || !inv.periodEnd || inv.periodEnd !== latest) {
    return ruleFail('NOT_LATEST_INVOICE');
  }
  return ruleOk(true);
}

/**
 * Suggested Billing_Period_End for a new Continuous Hire invoice: one month from the derived start,
 * capped at the hire end. Undefined when the request cannot be planned (no agreement, nothing to bill...).
 */
export function suggestContinuousEnd(s: InvoicingSnapshot, quotationId: string): string | undefined {
  const quotation = s.quotations.find((q) => q.id === quotationId && q.orgId === s.orgId);
  if (!quotation) return undefined;
  const ag = resolveSourceAgreement(s, quotation.id);
  if (!ag.ok || !isDateString(ag.value.hireStartDate) || !isDateString(ag.value.hireEndDate)) return undefined;
  const start = nextPeriodStart(ag.value, activeInvoices(s, quotation.id));
  if (!isDateString(start) || compareDates(start, ag.value.hireEndDate) > 0) return undefined;
  return monthlyPeriodEnd(start, ag.value.hireEndDate);
}

export interface InvoiceRevision { invoiceType?: string; periodEnd?: string }

/**
 * Re-checks a change of Invoice_Type or Billing_Period_End on an existing linked invoice. Only the latest
 * active invoice of its quotation can be revised; it is validated as if it were being created again
 * (same start, same sequence number), so every period rule still applies.
 */
export function validateInvoiceRevision(
  s: InvoicingSnapshot,
  invoiceId: string,
  rev: InvoiceRevision,
): RuleResult<InvoicePlan> {
  const inv = s.invoices.find((i) => i.id === invoiceId && i.orgId === s.orgId);
  if (!inv || !inv.quotationId) return ruleFail('QUOTATION_REQUIRED');
  const active = activeInvoices(s, inv.quotationId);
  if (!active.some((i) => i.id === inv.id) || inv.periodEnd !== latestPeriodEnd(active)) {
    return ruleFail('NOT_LATEST_INVOICE');
  }
  const without: InvoicingSnapshot = {
    ...s,
    invoices: s.invoices.filter((i) => i.id !== inv.id),
    sequenceByQuotation: { ...s.sequenceByQuotation, [inv.quotationId]: Math.max(0, (inv.sequence ?? 1) - 1) },
  };
  const invoiceType = rev.invoiceType ?? inv.invoiceType;
  return validateInvoiceRequest(without, {
    quotationId: inv.quotationId,
    invoiceType,
    periodStart: inv.periodStart,
    periodEnd: invoiceType === 'Off-Hire' ? undefined : (rev.periodEnd ?? inv.periodEnd),
  });
}