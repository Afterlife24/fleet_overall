export type Phase = 'AWAITING' | 'TENDER' | 'LOST' | 'WON';

export const PHASES: readonly Phase[] = ['AWAITING', 'TENDER', 'LOST', 'WON'];

export const REASON_MAX = 500;

export interface TransitionRequest {
  from: Phase;
  to: Phase;
  reason?: string | null;
  hasReopenPermission: boolean;
}

export type TransitionCheck =
  | { ok: true; reason: string | null }
  | { ok: false; code: 'INVALID_TRANSITION' | 'VALIDATION_ERROR' | 'FORBIDDEN'; fieldErrors?: Record<string, string> };

/** The manual transitions, exactly. LOST -> AWAITING is the reopen. WON is terminal. */
export const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [Phase, Phase]> = [
  ['AWAITING', 'TENDER'],
  ['AWAITING', 'LOST'],
  ['AWAITING', 'WON'],
  ['TENDER', 'WON'],
  ['TENDER', 'LOST'],
  ['LOST', 'AWAITING'],
];

export function isAllowedTransition(from: Phase, to: Phase): boolean {
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** Moving to LOST and reopening from LOST both need a reason. */
export function transitionNeedsReason(from: Phase, to: Phase): boolean {
  return to === 'LOST' || (from === 'LOST' && to === 'AWAITING');
}

/**
 * Pure. Allowed pairs are exactly ALLOWED_TRANSITIONS. A change to LOST and a reopen need a reason
 * of 1..500 characters after trimming (422 on `reason`); a reopen additionally needs the reopen
 * permission (403, checked before the reason so a caller without permission learns nothing else).
 * For other transitions a supplied reason is kept (trimmed) when valid and ignored when blank.
 */
export function checkTransition(req: TransitionRequest): TransitionCheck {
  if (!isAllowedTransition(req.from, req.to)) return { ok: false, code: 'INVALID_TRANSITION' };
  const reopen = req.from === 'LOST' && req.to === 'AWAITING';
  if (reopen && !req.hasReopenPermission) return { ok: false, code: 'FORBIDDEN' };
  const trimmed = typeof req.reason === 'string' ? req.reason.trim() : '';
  if (transitionNeedsReason(req.from, req.to)) {
    if (trimmed.length < 1) return { ok: false, code: 'VALIDATION_ERROR', fieldErrors: { reason: 'required' } };
    if (trimmed.length > REASON_MAX) return { ok: false, code: 'VALIDATION_ERROR', fieldErrors: { reason: 'too_long' } };
    return { ok: true, reason: trimmed };
  }
  if (trimmed.length > REASON_MAX) return { ok: false, code: 'VALIDATION_ERROR', fieldErrors: { reason: 'too_long' } };
  return { ok: true, reason: trimmed.length > 0 ? trimmed : null };
}
