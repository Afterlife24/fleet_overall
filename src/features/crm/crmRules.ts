import type { Quotation, QuotationPhase, PhaseHistoryEntry } from '@/types/quotation';

/** Valid phase changes. Lost -> Awaiting is only reachable through Reopen. */
export const ALLOWED: ReadonlyArray<readonly [QuotationPhase, QuotationPhase]> = [
  ['Awaiting', 'Tender'],
  ['Awaiting', 'Lost'],
  ['Tender', 'Won'],
  ['Tender', 'Lost'],
  ['Lost', 'Awaiting'],
];

export type TransitionResult =
  | { ok: true; quotation: Quotation }
  | { ok: false; error: string };

export function isAllowed(from: QuotationPhase, to: QuotationPhase): boolean {
  return ALLOWED.some(([f, t]) => f === from && t === to);
}

export function transitionError(from: QuotationPhase, to: QuotationPhase): string {
  return `Cannot move quotation from ${from} to ${to}`;
}

const isBlank = (s?: string) => !s || s.trim().length === 0;

let seq = 0;
const newId = () => `ph-${Date.now()}-${++seq}`;

/** The only function that changes a quotation's phase. Returns a new object. */
export function applyTransition(
  q: Quotation,
  to: QuotationPhase,
  user: string,
  now: string,
  reason?: string,
): TransitionResult {
  if (!isAllowed(q.phase, to)) return { ok: false, error: transitionError(q.phase, to) };
  const needsReason = to === 'Lost' || (q.phase === 'Lost' && to === 'Awaiting');
  if (needsReason && isBlank(reason)) return { ok: false, error: 'A reason is required' };

  const entry: PhaseHistoryEntry = {
    id: newId(),
    timestamp: now,
    user,
    fromPhase: q.phase,
    toPhase: to,
    ...(needsReason ? { reason: reason!.trim() } : {}),
  };
  const next: Quotation = { ...q, phase: to, updatedAt: now, history: [...q.history, entry] };

  if (to === 'Lost') {
    next.lostReason = reason!.trim();
    next.lostAt = now;
    next.lostBy = user;
  } else if (q.phase === 'Lost') {
    // Reopen: the old reason stays in the history entries.
    delete next.lostReason;
    delete next.lostAt;
    delete next.lostBy;
  }
  return { ok: true, quotation: next };
}

export const AUTO_WON_REASON = 'Auto: machine On Hire';

export type AutoWonResult =
  | { kind: 'changed'; quotation: Quotation }
  | { kind: 'unchanged'; reason: 'ALREADY_WON' | 'QUOTATION_LOST' };

/** Automatic Awaiting/Tender -> Won change. Separate from ALLOWED and applyTransition. */
export function applyAutoWon(q: Quotation, user: string, now: string): AutoWonResult {
  if (q.phase === 'Won') return { kind: 'unchanged', reason: 'ALREADY_WON' };
  if (q.phase === 'Lost') return { kind: 'unchanged', reason: 'QUOTATION_LOST' };
  const entry: PhaseHistoryEntry = {
    id: newId(),
    timestamp: now,
    user,
    fromPhase: q.phase,
    toPhase: 'Won',
    reason: AUTO_WON_REASON,
  };
  return {
    kind: 'changed',
    quotation: { ...q, phase: 'Won', updatedAt: now, history: [...q.history, entry] },
  };
}

export const byPhase = (qs: Quotation[], p: QuotationPhase) => qs.filter((q) => q.phase === p);
export const pipelineOf = (qs: Quotation[]) =>
  qs.filter((q) => q.phase === 'Awaiting' || q.phase === 'Tender');

export function pipelineTotals(qs: Quotation[]) {
  const p = pipelineOf(qs);
  return { count: p.length, amount: p.reduce((s, q) => s + q.amount, 0) };
}

const has = (v: string | undefined, text: string) => (v ?? '').toLowerCase().includes(text);

export function searchLost(qs: Quotation[], text: string): Quotation[] {
  const t = text.trim().toLowerCase();
  const lost = byPhase(qs, 'Lost');
  if (!t) return lost;
  return lost.filter((q) => has(q.number, t) || has(q.opportunity, t) || has(q.hireAgreementNo, t) || has(q.customerName, t) || has(q.lostReason, t));
}

export function filterList(qs: Quotation[], phase: QuotationPhase | 'All', text: string): Quotation[] {
  const t = text.trim().toLowerCase();
  return qs.filter(
    (q) =>
      (phase === 'All' || q.phase === phase) &&
      (!t || has(q.number, t) || has(q.opportunity, t) || has(q.hireAgreementNo, t) || has(q.customerName, t) || has(q.lostReason, t)),
  );
}

export function toInvoicePrefill(q: Quotation) {
  return {
    quotationId: q.id,
    customerId: q.customerId,
    customerName: q.customerName,
    amount: q.amount,
    quotationNumber: q.number,
  };
}

/** Next company-level number: HA-<year>-<5 digits>, one above the highest in use. */
export function nextHireAgreementNo(qs: Quotation[], year = new Date().getFullYear()): string {
  const max = qs.reduce((m, q) => {
    const n = /^HA-\d{4}-(\d+)$/.exec(q.hireAgreementNo ?? '')?.[1];
    return n ? Math.max(m, parseInt(n, 10)) : m;
  }, 0);
  return `HA-${year}-${String(max + 1).padStart(5, '0')}`;
}

export interface CompanyOption { hireAgreementNo: string; customerName: string; customerId: string; email?: string }

/** Companies that already have a hire agreement number (for the dropdown). */
export function companiesOf(qs: Quotation[]): CompanyOption[] {
  const seen = new Map<string, CompanyOption>();
  for (const q of qs) {
    if (q.hireAgreementNo && !seen.has(q.hireAgreementNo)) {
      seen.set(q.hireAgreementNo, { hireAgreementNo: q.hireAgreementNo, customerName: q.customerName, customerId: q.customerId, email: q.email });
    }
  }
  return [...seen.values()].sort((a, b) => a.hireAgreementNo.localeCompare(b.hireAgreementNo));
}