// Quotation_Invoicing facade. The only module that reads the CRM, Hire Agreement and
// Tax Invoice stores together. Decisions live in invoiceRulesCore.
// Must not import services.ts, appStore.ts or any component (keeps the graph acyclic).
import { useMemo } from 'react';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { ensureHireLinkDemo, ensureInvoiceDemo } from './demoSeed';
import type { TaxInvoice } from '@/types/taxinvoice';
import {
  RULE_MESSAGES,
  buildInvoiceDraft,
  listInvoiceableQuotations,
  recalcTotals,
  suggestContinuousEnd,
  validateInvoiceRemoval,
  validateInvoiceRequest,
  validateInvoiceRevision,
  type InvoicePlan,
  validateInvoiceUpdate,
  type InvoiceEdits,
  type InvoiceIssuer,
  type InvoiceRequest,
  type InvoicingSnapshot,
  type RuleCode,
} from './invoiceRulesCore';

export type { RuleCode, InvoiceEdits, InvoiceRequest } from './invoiceRulesCore';

const CRM_APP_ID = 'crm';

// ── Errors and types ─────────────────────────────────────────────────────────

export class InvoiceRuleError extends Error {
  readonly code: RuleCode;
  constructor(code: RuleCode, message?: string) {
    super(message ?? RULE_MESSAGES[code]);
    this.name = 'InvoiceRuleError';
    this.code = code;
  }
}

export interface InvoiceableQuotation {
  id: string;
  number: string;
  customerName: string;
  amount: number;
}

export interface CreateInvoiceInput extends InvoiceRequest {
  edits?: InvoiceEdits;
}

export interface InvoicePreview {
  ok: boolean;
  code?: RuleCode;
  message?: string;
  agreementNo?: string;
  hireStartDate?: string;
  hireEndDate?: string;
  periodStart?: string;
  periodEnd?: string;
  invoiceNo?: string;
  sequence?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Local calendar date, YYYY-MM-DD (not UTC). */
function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function activeOrgId(): string {
  return useAuthStore.getState().user?.orgId ?? JA_ORG_ID;
}

function buildSnapshot(orgId: string): InvoicingSnapshot {
  ensureHireLinkDemo(orgId);
  useHireAgreementStore.getState().ensureSeeded(orgId);
  useTaxInvoiceStore.getState().ensureSeeded(orgId);
  if (orgId === JA_ORG_ID) ensureInvoiceDemo(orgId);

  const inv = useTaxInvoiceStore.getState();
  return {
    orgId,
    today: todayLocal(),
    crmActive: useOrgStore.getState().isAppActive(orgId, CRM_APP_ID),
    quotations: useCrmStore.getState().quotations.map((q) => ({
      id: q.id,
      orgId: q.orgId,
      number: q.number,
      phase: q.phase,
      customerName: q.customerName,
      customerId: q.customerId,
      amount: q.amount,
    })),
    agreements: useHireAgreementStore.getState().agreements.map((a) => ({
      id: a.id,
      orgId: a.orgId,
      agreementNo: a.agreementNo,
      quotationId: a.quotationId,
      status: a.status,
      hireStartDate: a.hireStartDate,
      hireEndDate: a.hireEndDate,
      customerId: a.customerId,
      customerName: a.customerName,
      customerTrn: a.customerTrn,
      attn: a.attn,
      contactNumber: a.contactNumber,
      customerEmail: a.customerEmail,
      billingAddress: a.billingAddress,
      deliveryLocation: a.deliveryLocation,
      paymentTerms: a.paymentTerms,
      paymentMethod: a.paymentMethod,
      securityDeposit: a.securityDeposit,
      equipmentName: a.equipmentName,
      equipmentModel: a.equipmentModel,
      serialNumber: a.serialNumber,
      workingHeight: a.workingHeight,
      capacity: a.capacity,
      monthlyRental: a.monthlyRental,
      transportationCharges: a.transportationCharges,
    })),
    invoices: inv.invoices.map((i) => ({
      id: i.id,
      orgId: i.orgId ?? JA_ORG_ID,
      quotationId: i.quotationId,
      invoiceType: i.invoiceType,
      status: i.status,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      sequence: i.sequence,
    })),
    sequenceByQuotation: { ...inv.sequenceByQuotation },
  };
}

function issuerOf(orgId: string): InvoiceIssuer {
  const org = useOrgStore.getState().getOrg(orgId);
  return {
    name: org?.name,
    companyAddress: org?.companyAddress,
    companyPhone: org?.companyPhone,
    companyEmail: org?.companyEmail,
    tradeLicense: org?.tradeLicense,
    companyTrn: org?.companyTrn,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function listWonQuotations(): InvoiceableQuotation[] {
  return listInvoiceableQuotations(buildSnapshot(activeOrgId())).map((q) => ({
    id: q.id,
    number: q.number,
    customerName: q.customerName,
    amount: q.amount,
  }));
}

function toPreview(p: InvoicePlan): InvoicePreview {
  return {
    ok: true,
    agreementNo: p.agreement.agreementNo,
    hireStartDate: p.agreement.hireStartDate,
    hireEndDate: p.agreement.hireEndDate,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    invoiceNo: p.invoiceNo,
    sequence: p.sequence,
  };
}

/** Continuous Hire without an end date previews the default monthly period (start + 1 month, capped at hire end). */
export function previewInvoice(req: InvoiceRequest): InvoicePreview {
  const s = buildSnapshot(activeOrgId());
  const request = req.invoiceType === 'Continuous Hire' && !req.periodEnd && req.quotationId
    ? { ...req, periodEnd: suggestContinuousEnd(s, req.quotationId) }
    : req;
  const r = validateInvoiceRequest(s, request);
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  return toPreview(r.value);
}

/** Live check of a type / end-date change on an existing linked invoice. */
export function previewRevision(id: string, rev: { invoiceType?: string; periodEnd?: string }): InvoicePreview {
  const r = validateInvoiceRevision(buildSnapshot(activeOrgId()), id, rev);
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  return toPreview(r.value);
}

export function listInvoices(): TaxInvoice[] {
  const orgId = activeOrgId();
  buildSnapshot(orgId);
  return useTaxInvoiceStore.getState().forOrg(orgId);
}

export function getInvoice(id: string): TaxInvoice | undefined {
  const orgId = activeOrgId();
  buildSnapshot(orgId);
  const inv = useTaxInvoiceStore.getState().getById(id);
  return inv && (inv.orgId ?? JA_ORG_ID) === orgId ? inv : undefined;
}

export function invoicesForQuotation(quotationId: string): TaxInvoice[] {
  if (!quotationId) return [];
  return listInvoices().filter((i) => i.quotationId === quotationId);
}

/** Zustand selector hook: re-renders when invoices change. */
export function useInvoicesForQuotation(quotationId: string): TaxInvoice[] {
  const invoices = useTaxInvoiceStore((s) => s.invoices);
  const orgId = useAuthStore((s) => s.user?.orgId) ?? JA_ORG_ID;
  return useMemo(
    () =>
      quotationId
        ? invoices.filter((i) => i.quotationId === quotationId && (i.orgId ?? JA_ORG_ID) === orgId)
        : [],
    [invoices, quotationId, orgId],
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** Validates on a fresh snapshot and inserts synchronously. Throws InvoiceRuleError. */
export function createFromQuotation(input: CreateInvoiceInput): TaxInvoice {
  const orgId = activeOrgId();
  const snapshot = buildSnapshot(orgId);
  const { edits, ...request } = input;
  const plan = validateInvoiceRequest(snapshot, request);
  if (!plan.ok) throw new InvoiceRuleError(plan.code, plan.message);

  const draft = buildInvoiceDraft(plan.value, snapshot, edits, issuerOf(orgId));
  const store = useTaxInvoiceStore.getState();
  const now = new Date().toISOString();
  const invoice: TaxInvoice = { ...draft, id: store.newId(), createdAt: now, updatedAt: now };
  store.insertLinked(invoice);
  return invoice;
}

const TOTAL_KEYS = [
  'equipmentAmount', 'transportationAmount', 'subtotal', 'vat', 'totalAmount', 'amountDue',
] as const;

export function updateInvoice(id: string, patch: Partial<TaxInvoice>): TaxInvoice {
  const orgId = activeOrgId();
  const snapshot = buildSnapshot(orgId);
  const store = useTaxInvoiceStore.getState();
  const existing = store.getById(id);
  if (!existing || (existing.orgId ?? JA_ORG_ID) !== orgId) throw new Error('Tax invoice not found');

  let revised: Partial<TaxInvoice> = {};
  if (existing.quotationId) {
    // Invoice type and billing period end can be changed on the latest invoice, re-validated by the period rules.
    const typeChanged = 'invoiceType' in patch && patch.invoiceType !== existing.invoiceType;
    const endChanged = 'periodEnd' in patch && patch.periodEnd !== existing.periodEnd;
    if (typeChanged || endChanged) {
      const rev = validateInvoiceRevision(snapshot, id, {
        invoiceType: typeChanged ? patch.invoiceType : undefined,
        periodEnd: endChanged ? patch.periodEnd : undefined,
      });
      if (!rev.ok) throw new InvoiceRuleError(rev.code, rev.message);
      revised = {
        invoiceType: rev.value.invoiceType,
        periodEnd: rev.value.periodEnd,
        hirePeriod: `${rev.value.periodStart} – ${rev.value.periodEnd}`,
      };
      patch = { ...patch };
      delete patch.invoiceType;
      delete patch.periodEnd;
    }
    const check = validateInvoiceUpdate({ ...existing, orgId: existing.orgId ?? JA_ORG_ID }, patch);
    if (!check.ok) throw new InvoiceRuleError(check.code, check.message);
    if (patch.status === 'Cancelled' && existing.status !== 'Cancelled') {
      const rm = validateInvoiceRemoval(snapshot, id, 'cancel');
      if (!rm.ok) throw new InvoiceRuleError(rm.code, rm.message);
    }
  }

  // Client-supplied totals are ignored; they are recomputed from the merged values.
  const clean: Partial<TaxInvoice> = { ...patch, ...revised };
  for (const k of TOTAL_KEYS) delete clean[k];
  const merged = recalcTotals({ ...existing, ...clean });
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, merged[k]])) as Pick<TaxInvoice, (typeof TOTAL_KEYS)[number]>;
  return store.patch(id, { ...clean, ...totals, updatedAt: new Date().toISOString() });
}

export function removeInvoice(id: string, action: 'delete' | 'cancel' = 'delete'): void {
  const snapshot = buildSnapshot(activeOrgId());
  const existing = useTaxInvoiceStore.getState().getById(id);
  if (!existing || (existing.orgId ?? JA_ORG_ID) !== snapshot.orgId) throw new Error('Tax invoice not found');
  const rm = validateInvoiceRemoval(snapshot, id, action);
  if (!rm.ok) throw new InvoiceRuleError(rm.code, rm.message);
  useTaxInvoiceStore.getState().remove(id);
}
