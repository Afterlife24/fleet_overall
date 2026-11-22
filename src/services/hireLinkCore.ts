// Pure decision core for the Hire_Link_Service.
// Types-only imports: no stores, React or toast. The facade (hireLink.ts) gathers
// a Snapshot from the stores and applies the resulting Plan.
// Agreements and quotations are resolved by `id` equality only. agreementNo,
// hireAgreementNo, company, machine and job are never used to resolve a record.
import type { BookingStatus } from '@/types/booking';
import type { QuotationPhase } from '@/types/quotation';

/** Org assumed for legacy allocations that carry no orgId (mirrors orgStore.JA_ORG_ID). */
const LEGACY_ORG_ID = 'org-ja';

export type SkipReason =
  | 'CRM_INACTIVE'
  | 'QUOTATION_INACTIVE'
  | 'NOT_ON_HIRE'
  | 'ALLOCATION_NOT_FOUND'
  | 'NO_ACTIVE_ALLOCATION'
  | 'MULTIPLE_ACTIVE_ALLOCATIONS'
  | 'ALLOCATION_ORG_MISMATCH'
  | 'NO_AGREEMENT_ID'
  | 'AGREEMENT_NOT_FOUND'
  | 'AGREEMENT_ORG_MISMATCH'
  | 'NO_QUOTATION_ID'
  | 'QUOTATION_NOT_FOUND'
  | 'QUOTATION_ORG_MISMATCH'
  | 'QUOTATION_LOST'
  | 'ALREADY_WON'
  | 'INTERNAL_ERROR';

export type ValidationCode = 'NOT_FOUND' | 'ORG_MISMATCH' | 'NO_QUOTATION' | 'QUOTATION_NOT_FOUND';

export interface AllocationLite {
  id: string;
  reference: string;
  machineId: string;
  orgId?: string;
  hireAgreementId?: string;
  startDate: string;
  endDate: string;
  status: BookingStatus;
}

export interface AgreementLite {
  id: string;
  orgId: string;
  agreementNo: string;
  customerName: string;
  quotationId: string;
}

export interface QuotationLite {
  id: string;
  orgId: string;
  number: string;
  phase: QuotationPhase;
  customerName: string;
}

export interface Snapshot {
  /** Active_Org */
  orgId: string;
  /** Local date, YYYY-MM-DD, injected by the caller */
  today: string;
  crmActive: boolean;
  quotationActive: boolean;
  /** User bookings only */
  allocations: AllocationLite[];
  agreements: AgreementLite[];
  quotations: QuotationLite[];
}

export type OnHireEvent =
  | { source: 'booking'; allocationId: string }
  | { source: 'machine'; machineId: string };

export type Plan =
  | { kind: 'skip'; reason: SkipReason; quotationNumber?: string; allocationId?: string }
  | { kind: 'win'; quotationId: string; allocationId: string; agreementId: string };

export const VALIDATION_MESSAGES: Record<ValidationCode, string> = {
  NOT_FOUND: 'Hire Agreement ID not found',
  ORG_MISMATCH: 'Hire Agreement belongs to another organisation',
  NO_QUOTATION: 'Hire Agreement has no linked quotation',
  QUOTATION_NOT_FOUND: 'Linked quotation not found',
};

const LEGAL_SUFFIXES = new Set(['llc', 'pjsc', 'ltd', 'limited', 'fze', 'fzco', 'inc', 'co']);

/** Normalised company key. Lower-case, punctuation to spaces, trailing legal-form tokens dropped. Idempotent. */
export function companyKey(name: string): string {
  let tokens = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  // "l l c" written with spaces/dots
  const n = tokens.length;
  if (n >= 3 && tokens[n - 3] === 'l' && tokens[n - 2] === 'l' && tokens[n - 1] === 'c') {
    tokens = tokens.slice(0, n - 3);
  }
  while (tokens.length > 0 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(' ');
}

export function isActiveAllocation(a: AllocationLite, today: string): boolean {
  if (a.status === 'Cancelled' || a.status === 'Returned') return false;
  return a.startDate <= today && today <= a.endDate;
}

export function resolveActiveAllocation(
  allocs: AllocationLite[],
  machineId: string,
  today: string,
):
  | { ok: true; allocation: AllocationLite }
  | { ok: false; reason: 'NO_ACTIVE_ALLOCATION' | 'MULTIPLE_ACTIVE_ALLOCATIONS' } {
  const active = allocs.filter((a) => a.machineId === machineId && isActiveAllocation(a, today));
  if (active.length === 0) return { ok: false, reason: 'NO_ACTIVE_ALLOCATION' };
  if (active.length > 1) return { ok: false, reason: 'MULTIPLE_ACTIVE_ALLOCATIONS' };
  return { ok: true, allocation: active[0] };
}

export function validateAgreementRef(
  raw: string,
  s: Pick<Snapshot, 'orgId' | 'crmActive' | 'agreements' | 'quotations'>,
): { ok: true; agreementId?: string } | { ok: false; code: ValidationCode; message: string } {
  const fail = (code: ValidationCode) => ({ ok: false as const, code, message: VALIDATION_MESSAGES[code] });
  const value = (raw ?? '').trim();
  if (!value) return { ok: true };
  const agreement = s.agreements.find((a) => a.id === value);
  if (!agreement) return fail('NOT_FOUND');
  if (agreement.orgId !== s.orgId) return fail('ORG_MISMATCH');
  if (!agreement.quotationId) return fail('NO_QUOTATION');
  if (s.crmActive) {
    const q = s.quotations.find((x) => x.id === agreement.quotationId);
    if (!q || q.orgId !== s.orgId) return fail('QUOTATION_NOT_FOUND');
  }
  return { ok: true, agreementId: agreement.id };
}

/** Stable partition: agreements of the given company first, the rest after. */
export function orderAgreementOptions(agreements: AgreementLite[], companyName?: string): AgreementLite[] {
  const key = companyName ? companyKey(companyName) : '';
  if (!key) return [...agreements];
  const first: AgreementLite[] = [];
  const rest: AgreementLite[] = [];
  for (const a of agreements) {
    (companyKey(a.customerName) === key ? first : rest).push(a);
  }
  return [...first, ...rest];
}

export function traceAllocation(
  s: Pick<Snapshot, 'allocations' | 'agreements' | 'quotations'>,
  allocationId: string,
):
  | { ok: true; allocation: AllocationLite; agreement: AgreementLite; quotation: QuotationLite }
  | { ok: false; reason: SkipReason } {
  const allocation = s.allocations.find((a) => a.id === allocationId);
  if (!allocation) return { ok: false, reason: 'ALLOCATION_NOT_FOUND' };
  if (!allocation.hireAgreementId) return { ok: false, reason: 'NO_AGREEMENT_ID' };
  const agreement = s.agreements.find((a) => a.id === allocation.hireAgreementId);
  if (!agreement) return { ok: false, reason: 'AGREEMENT_NOT_FOUND' };
  if (!agreement.quotationId) return { ok: false, reason: 'NO_QUOTATION_ID' };
  const quotation = s.quotations.find((q) => q.id === agreement.quotationId);
  if (!quotation) return { ok: false, reason: 'QUOTATION_NOT_FOUND' };
  return { ok: true, allocation, agreement, quotation };
}

export function allocationsForQuotation(
  s: Pick<Snapshot, 'allocations' | 'agreements'>,
  quotationId: string,
): AllocationLite[] {
  if (!quotationId) return [];
  const agreementIds = new Set(s.agreements.filter((a) => a.quotationId === quotationId).map((a) => a.id));
  return s.allocations.filter((a) => !!a.hireAgreementId && agreementIds.has(a.hireAgreementId));
}

export function evaluateOnHire(s: Snapshot, e: OnHireEvent): Plan {
  // 1. App flags, before any record is read
  if (!s.crmActive) return { kind: 'skip', reason: 'CRM_INACTIVE' };
  if (!s.quotationActive) return { kind: 'skip', reason: 'QUOTATION_INACTIVE' };

  // 2. Allocation
  let allocation: AllocationLite;
  if (e.source === 'booking') {
    const found = s.allocations.find((a) => a.id === e.allocationId);
    if (!found) return { kind: 'skip', reason: 'ALLOCATION_NOT_FOUND', allocationId: e.allocationId };
    if (found.status !== 'On Hire') return { kind: 'skip', reason: 'NOT_ON_HIRE', allocationId: found.id };
    allocation = found;
  } else {
    const r = resolveActiveAllocation(s.allocations, e.machineId, s.today);
    if (!r.ok) return { kind: 'skip', reason: r.reason };
    allocation = r.allocation;
  }

  // 3. Allocation org (legacy rows count as the demo org)
  if ((allocation.orgId ?? LEGACY_ORG_ID) !== s.orgId) {
    return { kind: 'skip', reason: 'ALLOCATION_ORG_MISMATCH', allocationId: allocation.id };
  }

  // 4. Agreement id
  if (!allocation.hireAgreementId) {
    return { kind: 'skip', reason: 'NO_AGREEMENT_ID', allocationId: allocation.id };
  }

  // 5. Agreement
  const agreement = s.agreements.find((a) => a.id === allocation.hireAgreementId);
  if (!agreement) return { kind: 'skip', reason: 'AGREEMENT_NOT_FOUND', allocationId: allocation.id };
  if (agreement.orgId !== s.orgId) {
    return { kind: 'skip', reason: 'AGREEMENT_ORG_MISMATCH', allocationId: allocation.id };
  }

  // 6. Quotation id
  if (!agreement.quotationId) return { kind: 'skip', reason: 'NO_QUOTATION_ID', allocationId: allocation.id };

  // 7. Quotation
  const quotation = s.quotations.find((q) => q.id === agreement.quotationId);
  if (!quotation) return { kind: 'skip', reason: 'QUOTATION_NOT_FOUND', allocationId: allocation.id };
  if (quotation.orgId !== s.orgId) {
    return {
      kind: 'skip',
      reason: 'QUOTATION_ORG_MISMATCH',
      quotationNumber: quotation.number,
      allocationId: allocation.id,
    };
  }

  // 8. Phase
  if (quotation.phase === 'Lost') {
    return { kind: 'skip', reason: 'QUOTATION_LOST', quotationNumber: quotation.number, allocationId: allocation.id };
  }
  if (quotation.phase === 'Won') {
    return { kind: 'skip', reason: 'ALREADY_WON', quotationNumber: quotation.number, allocationId: allocation.id };
  }

  // 9. Win
  return { kind: 'win', quotationId: quotation.id, allocationId: allocation.id, agreementId: agreement.id };
}
