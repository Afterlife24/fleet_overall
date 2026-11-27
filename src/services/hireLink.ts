// Hire_Link_Service facade. The only module that reads stores of more than one plugin
// for the Booking -> Hire Agreement -> Quotation link. Decisions live in hireLinkCore.
// Must not import services.ts, appStore.ts or any component (keeps the graph acyclic).
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useBookingStore } from '@/store/bookingStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useCrmStore } from '@/store/crmStore';
import { toastError, toastInfo, toastSuccess, toastWarning } from '@/lib/toast-helper';
import type { HireAgreement } from '@/types/hireagreement';
import type { QuotationPhase } from '@/types/quotation';
import {
  allocationsForQuotation as coreAllocationsForQuotation,
  companyKey,
  evaluateOnHire,
  orderAgreementOptions,
  traceAllocation,
  validateAgreementRef as coreValidateAgreementRef,
  type AllocationLite,
  type OnHireEvent,
  type SkipReason,
  type Snapshot,
  type ValidationCode,
} from './hireLinkCore';

export type { OnHireEvent, SkipReason, AllocationLite } from './hireLinkCore';

const CRM_APP_ID = 'crm';
const QUOTATION_APP_ID = 'quotation';
const INTERNAL_ERROR_MESSAGE = 'Could not update the linked quotation';

// ── Errors ───────────────────────────────────────────────────────────────────

export class HireLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HireLinkValidationError';
  }
}

export class HireAgreementInUseError extends Error {
  readonly references: { id: string; reference: string }[];
  constructor(references: { id: string; reference: string }[]) {
    super(`Cannot delete: used by bookings ${references.map((r) => r.reference).join(', ')}`);
    this.name = 'HireAgreementInUseError';
    this.references = references;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type HireLinkResult =
  | { outcome: 'won'; quotationId: string; quotationNumber: string }
  | { outcome: 'skipped'; reason: SkipReason; quotationNumber?: string };

export type ValidationResult =
  | { ok: true; agreementId?: string }
  | { ok: false; code: ValidationCode; message: string };

export interface AgreementOption {
  id: string;
  /** agreementNo · customerName · id */
  label: string;
  agreementNo: string;
  customerName: string;
}

export interface LinkSummary {
  agreementId: string;
  agreementNo: string;
  quotationNumber?: string;
}

export interface QuotationOption {
  id: string;
  number: string;
  opportunity: string;
  phase: QuotationPhase;
}

export type TraceResult = ReturnType<typeof traceAllocation>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Local calendar date, YYYY-MM-DD (not UTC). */
export function toLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function activeOrgId(): string {
  return useAuthStore.getState().user?.orgId ?? JA_ORG_ID;
}

function buildSnapshot(orgId: string): Snapshot {
  // Bookings, agreements and quotations are in-memory mirrors of the API; nothing is seeded here.
  const org = useOrgStore.getState();
  return {
    orgId,
    today: toLocalISODate(new Date()),
    crmActive: org.isAppActive(orgId, CRM_APP_ID),
    quotationActive: org.isAppActive(orgId, QUOTATION_APP_ID),
    allocations: useBookingStore.getState().userBookings.map((b) => ({
      id: b.id,
      reference: b.reference,
      machineId: b.machineId,
      orgId: b.orgId,
      hireAgreementId: b.hireAgreementId,
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
    })),
    agreements: useHireAgreementStore.getState().agreements.map((a) => ({
      id: a.id,
      orgId: a.orgId,
      agreementNo: a.agreementNo,
      customerName: a.customerName,
      quotationId: a.quotationId,
    })),
    quotations: useCrmStore.getState().quotations.map((q) => ({
      id: q.id,
      orgId: q.orgId,
      number: q.number,
      phase: q.phase,
      customerName: q.customerName,
    })),
  };
}

// ── Planner API ──────────────────────────────────────────────────────────────

export function validateAgreementRef(raw: string): ValidationResult {
  return coreValidateAgreementRef(raw, buildSnapshot(activeOrgId()));
}

/** Active_Org agreements, those of `companyName` first. */
export function listAgreementOptions(companyName?: string): AgreementOption[] {
  const s = buildSnapshot(activeOrgId());
  const own = s.agreements.filter((a) => a.orgId === s.orgId);
  return orderAgreementOptions(own, companyName).map((a) => ({
    id: a.id,
    label: `${a.agreementNo} · ${a.customerName} · ${a.id}`,
    agreementNo: a.agreementNo,
    customerName: a.customerName,
  }));
}

export function describeLink(agreementId: string): LinkSummary | undefined {
  const s = buildSnapshot(activeOrgId());
  const agreement = s.agreements.find((a) => a.id === agreementId && a.orgId === s.orgId);
  if (!agreement) return undefined;
  const quotation = agreement.quotationId
    ? s.quotations.find((q) => q.id === agreement.quotationId && q.orgId === s.orgId)
    : undefined;
  return {
    agreementId: agreement.id,
    agreementNo: agreement.agreementNo,
    quotationNumber: quotation?.number,
  };
}

// ── On-hire handling ─────────────────────────────────────────────────────────

function safeNotice(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error('[hireLink]', err);
  }
}

function showNotice(
  reason: SkipReason,
  quotationNumber: string | undefined,
  source: OnHireEvent['source'],
): void {
  switch (reason) {
    case 'QUOTATION_LOST':
      toastWarning(`Quotation ${quotationNumber ?? ''} is Lost and was not changed`.replace('  ', ' '));
      break;
    case 'CRM_INACTIVE':
      toastInfo('CRM app is inactive; quotation not updated');
      break;
    case 'QUOTATION_INACTIVE':
      toastInfo('Quotation app is inactive; quotation not updated');
      break;
    case 'NO_ACTIVE_ALLOCATION':
      toastInfo('No active booking linked to this machine');
      break;
    case 'MULTIPLE_ACTIVE_ALLOCATIONS':
      toastWarning('Multiple active bookings; link cannot be resolved');
      break;
    case 'NO_AGREEMENT_ID':
      if (source === 'machine') toastInfo('Booking has no Hire Agreement');
      break;
    case 'AGREEMENT_NOT_FOUND':
      toastWarning('Hire Agreement not found');
      break;
    case 'QUOTATION_NOT_FOUND':
      toastWarning('Linked quotation not found');
      break;
    case 'QUOTATION_ORG_MISMATCH':
      toastError('Linked quotation belongs to another organisation');
      break;
    case 'AGREEMENT_ORG_MISMATCH':
      toastError('Hire Agreement belongs to another organisation');
      break;
    case 'ALLOCATION_ORG_MISMATCH':
      toastError('Booking belongs to another organisation');
      break;
    case 'INTERNAL_ERROR':
      toastError(INTERNAL_ERROR_MESSAGE);
      break;
    // NO_QUOTATION_ID, ALREADY_WON, NOT_ON_HIRE, ALLOCATION_NOT_FOUND: silent
    default:
      break;
  }
}

/** Moves the Linked_Quotation to Won when an allocation goes On Hire. Never throws. */
export function handleOnHire(e: OnHireEvent): HireLinkResult {
  try {
    const orgId = activeOrgId();
    const snapshot = buildSnapshot(orgId);
    const plan = evaluateOnHire(snapshot, e);

    if (plan.kind === 'skip') {
      safeNotice(() => showNotice(plan.reason, plan.quotationNumber, e.source));
      return { outcome: 'skipped', reason: plan.reason, quotationNumber: plan.quotationNumber };
    }

    const res = useCrmStore.getState().autoWon(orgId, plan.quotationId, 'System');
    const number = snapshot.quotations.find((q) => q.id === plan.quotationId)?.number ?? '';

    if (!res.ok) {
      const reason: SkipReason = res.error;
      safeNotice(() => showNotice(reason, number, e.source));
      return { outcome: 'skipped', reason, quotationNumber: number };
    }
    if (res.result.kind === 'unchanged') {
      const reason: SkipReason = res.result.reason;
      safeNotice(() => showNotice(reason, number, e.source));
      return { outcome: 'skipped', reason, quotationNumber: number };
    }

    safeNotice(() => toastSuccess(`Quotation ${number} moved to Won`));
    return { outcome: 'won', quotationId: plan.quotationId, quotationNumber: number };
  } catch (err) {
    console.error('[hireLink]', err);
    safeNotice(() => toastError(INTERNAL_ERROR_MESSAGE));
    return { outcome: 'skipped', reason: 'INTERNAL_ERROR' };
  }
}

// ── Quotation plugin API ─────────────────────────────────────────────────────

export function listQuotationOptions(
  orgId: string,
  companyName: string,
): { active: boolean; options: QuotationOption[] } {
  const active = useOrgStore.getState().isAppActive(orgId, CRM_APP_ID);
  if (!active) return { active: false, options: [] };
  const key = companyKey(companyName);
  if (!key) return { active: true, options: [] };
  const options = useCrmStore
    .getState()
    .quotations.filter((q) => q.orgId === orgId && companyKey(q.customerName) === key)
    .map((q) => ({ id: q.id, number: q.number, opportunity: q.opportunity, phase: q.phase }));
  return { active: true, options };
}

/** Throws HireLinkValidationError when the linked quotation is missing or of another company. */
export function assertQuotationMatchesCompany(
  orgId: string,
  a: Pick<HireAgreement, 'customerName' | 'quotationId'>,
): void {
  if (!a.quotationId) return;
  // With CRM inactive the quotation cannot be inspected; the stored link is kept as is.
  if (!useOrgStore.getState().isAppActive(orgId, CRM_APP_ID)) return;
  const q = useCrmStore
    .getState()
    .quotations.find((x) => x.id === a.quotationId && x.orgId === orgId);
  if (!q) throw new HireLinkValidationError('Linked quotation not found');
  if (companyKey(q.customerName) !== companyKey(a.customerName)) {
    throw new HireLinkValidationError('Quotation belongs to a different company than this agreement');
  }
}

export function findAllocationsForAgreement(agreementId: string): { id: string; reference: string }[] {
  if (!agreementId) return [];
  return useBookingStore
    .getState()
    .userBookings.filter((b) => b.hireAgreementId === agreementId)
    .map((b) => ({ id: b.id, reference: b.reference }));
}

// ── Traceability ─────────────────────────────────────────────────────────────

export function resolveAllocation(allocationId: string): TraceResult {
  return traceAllocation(buildSnapshot(activeOrgId()), allocationId);
}

export function allocationsForQuotation(quotationId: string): AllocationLite[] {
  return coreAllocationsForQuotation(buildSnapshot(activeOrgId()), quotationId);
}
