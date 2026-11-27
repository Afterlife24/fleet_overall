// Pure core for the CRM Status panel and the four-column board. Value-imports crmRules only.

import type { Quotation, QuotationPhase } from '@/types/quotation';
import { isAllowed, transitionError } from './crmRules';

const ORDER: readonly QuotationPhase[] = ['Awaiting', 'Tender', 'Lost', 'Won'];

export interface StatusOption { phase: QuotationPhase; current: boolean; allowed: boolean; reason?: string }

/** One option per phase in the order Awaiting, Tender, Lost, Won. */
export function statusOptions(current: QuotationPhase): StatusOption[] {
  return ORDER.map((phase) => {
    if (phase === current) return { phase, current: true, allowed: false };
    const allowed = isAllowed(current, phase);
    return allowed
      ? { phase, current: false, allowed }
      : { phase, current: false, allowed, reason: transitionError(current, phase) };
  });
}

export const REASON_MAX = 500;

export function validateReason(s: string | undefined):
  { ok: true; reason: string } | { ok: false; message: string } {
  const t = (s ?? '').trim();
  if (t.length === 0) return { ok: false, message: 'A reason is required' };
  if (t.length > REASON_MAX) return { ok: false, message: `Reason must be at most ${REASON_MAX} characters` };
  return { ok: true, reason: t };
}

export type PhaseRequest =
  | { kind: 'reject'; error: string }
  | { kind: 'needsReason'; label: 'Lost' | 'Reopen' }
  | { kind: 'apply' };

export function planPhaseRequest(from: QuotationPhase, to: QuotationPhase): PhaseRequest {
  if (!isAllowed(from, to)) return { kind: 'reject', error: transitionError(from, to) };
  if (to === 'Lost') return { kind: 'needsReason', label: 'Lost' };
  if (from === 'Lost' && to === 'Awaiting') return { kind: 'needsReason', label: 'Reopen' };
  return { kind: 'apply' };
}

export interface PanelState { canSave: boolean; needsReason: boolean }

export function panelState(current: QuotationPhase, selected: QuotationPhase, reason: string): PanelState {
  const req = planPhaseRequest(current, selected);
  if (selected === current || req.kind === 'reject') return { canSave: false, needsReason: false };
  if (req.kind === 'needsReason') return { canSave: validateReason(reason).ok, needsReason: true };
  return { canSave: true, needsReason: false };
}

export const formatAedWhole = (n: number): string =>
  `AED ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export interface ColumnSummary { phase: QuotationPhase; count: number; amount: number; label: string }

export function columnSummary(qs: readonly Quotation[], phase: QuotationPhase): ColumnSummary {
  const rows = qs.filter((q) => q.phase === phase);
  const amount = rows.reduce((s, q) => s + q.amount, 0);
  return { phase, count: rows.length, amount, label: formatAedWhole(amount) };
}

export interface CardModel {
  number: string; opportunity: string; customerName: string; hireAgreementNo: string; amountLabel: string;
}

export function cardModel(q: Quotation): CardModel {
  return {
    number: q.number,
    opportunity: q.opportunity,
    customerName: q.customerName,
    hireAgreementNo: q.hireAgreementNo && q.hireAgreementNo.trim() ? q.hireAgreementNo : '—',
    amountLabel: formatAedWhole(q.amount),
  };
}
