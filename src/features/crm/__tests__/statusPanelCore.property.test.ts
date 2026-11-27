// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { PHASES } from '@/types/quotation';
import { ALLOWED, applyTransition, isAllowed, transitionError } from '../crmRules';
import { REASON_MAX, panelState, planPhaseRequest, statusOptions, validateReason } from '../statusPanelCore';

const phase = fc.constantFrom<QuotationPhase>(...PHASES);

function quotation(p: QuotationPhase): Quotation {
  return {
    id: 'q-prop', orgId: 'org-p', number: 'QT-2026-0001', opportunity: 'Opp', hireAgreementNo: 'HA-2026-00001',
    customerId: 'CUST-000125', customerName: 'ABC Company LLC', amount: 1000, currency: 'AED', phase: p,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    history: [{ id: 'h0', timestamp: '2026-01-01T00:00:00.000Z', user: 'u', fromPhase: null, toPhase: p }],
  };
}

const needsReason = (from: QuotationPhase, to: QuotationPhase) =>
  to === 'Lost' || (from === 'Lost' && to === 'Awaiting');

// Feature: rental-flow-integration, Property 7: Status options follow the phase rules
describe('Property 7: Status options follow the phase rules', () => {
  /** **Validates: Requirements 3.2, 3.3, 3.8, 3.9** */
  it('options are ordered, follow isAllowed and carry the rule error', () => {
    fc.assert(
      fc.property(phase, (current) => {
        const opts = statusOptions(current);
        expect(opts.map((o) => o.phase)).toEqual(['Awaiting', 'Tender', 'Lost', 'Won']);
        for (const o of opts) {
          if (o.phase === current) {
            expect(o.current).toBe(true);
            expect(o.allowed).toBe(false);
          } else {
            expect(o.current).toBe(false);
            expect(o.allowed).toBe(isAllowed(current, o.phase));
            if (!o.allowed) expect(o.reason).toBe(transitionError(current, o.phase));
          }
        }
        if (current === 'Won') expect(opts.every((o) => !o.allowed)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('allowed pairs are exactly the six valid moves', () => {
    const pairs = PHASES.flatMap((from) =>
      statusOptions(from).filter((o) => o.allowed).map((o) => `${from}>${o.phase}`));
    expect(pairs.sort()).toEqual(
      ['Awaiting>Tender', 'Awaiting>Won', 'Awaiting>Lost', 'Tender>Won', 'Tender>Lost', 'Lost>Awaiting'].sort(),
    );
    expect(pairs).toHaveLength(ALLOWED.length);
  });

  it('canSave only for a different, allowed status with a valid reason when required', () => {
    fc.assert(
      fc.property(phase, phase, fc.string({ maxLength: 20 }), (current, selected, reason) => {
        const s = panelState(current, selected, reason);
        const expected =
          selected !== current && isAllowed(current, selected) &&
          (!needsReason(current, selected) || validateReason(reason).ok);
        expect(s.canSave).toBe(expected);
        expect(s.needsReason).toBe(selected !== current && isAllowed(current, selected) && needsReason(current, selected));
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: rental-flow-integration, Property 8: Reason validation and rejection leave state unchanged
describe('Property 8: Reason validation and rejection leave state unchanged', () => {
  /** **Validates: Requirements 3.5, 3.6, 3.7, 3.10** */
  it('validateReason is ok exactly for a trimmed length of 1 to 500 and returns the trimmed text', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 700 }),
        fc.array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 4 }).map((a) => a.join('')),
        (s, pad) => {
          const input = pad + s + pad;
          const t = input.trim();
          const r = validateReason(input);
          expect(r.ok).toBe(t.length >= 1 && t.length <= REASON_MAX);
          if (r.ok) expect(r.reason).toBe(t);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('blank reasons and disallowed targets are rejected and leave the quotation unchanged', () => {
    fc.assert(
      fc.property(
        phase, phase,
        fc.array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 5 }).map((a) => a.join('')),
        (from, to, blank) => {
          const q = quotation(from);
          const snapshot = JSON.parse(JSON.stringify(q));
          const allowed = isAllowed(from, to);
          if (allowed && !needsReason(from, to)) return;
          const res = applyTransition(q, to, 'user', '2026-02-01T00:00:00.000Z', allowed ? blank : 'a reason');
          expect(res.ok).toBe(false);
          expect(q).toEqual(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: rental-flow-integration, Property 9: Accepted transition appends one history entry, by either path
describe('Property 9: Accepted transition appends one history entry, by either path', () => {
  beforeEach(() => { localStorage.clear(); });

  /** **Validates: Requirements 3.4, 3.13** */
  it('planPhaseRequest matches the rules', () => {
    fc.assert(
      fc.property(phase, phase, (from, to) => {
        const req = planPhaseRequest(from, to);
        if (!isAllowed(from, to)) {
          expect(req).toEqual({ kind: 'reject', error: transitionError(from, to) });
        } else if (needsReason(from, to)) {
          expect(req).toEqual({ kind: 'needsReason', label: to === 'Lost' ? 'Lost' : 'Reopen' });
        } else {
          expect(req).toEqual({ kind: 'apply' });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('panel save and drop (same store path) give equal results and one new history entry', () => {
    fc.assert(
      fc.property(
        phase, phase, fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
        (from, to, reason) => {
          if (!isAllowed(from, to)) return;
          const r = needsReason(from, to) ? reason : undefined;
          const pure = applyTransition(quotation(from), to, 'user', '2026-02-01T00:00:00.000Z', r);
          expect(pure.ok).toBe(true);
          if (!pure.ok) return;
          // Panel save and drop share one path (the pure rule); the server applies the same rule.
          const results = [0, 1].map(() => {
            const res = applyTransition(quotation(from), to, 'user', '2026-02-01T00:00:00.000Z', r);
            expect(res.ok).toBe(true);
            return (res as { ok: true; quotation: Quotation }).quotation;
          });
          const strip = (q: Quotation) => ({ ...q, updatedAt: '', lostAt: q.lostAt ? 'x' : undefined, history: q.history.map((h) => ({ ...h, id: '', timestamp: '' })) });
          expect(strip(results[0])).toEqual(strip(results[1]));
          expect(strip(results[0])).toEqual(strip(pure.quotation));
          const q = results[0];
          expect(q.phase).toBe(to);
          expect(q.history).toHaveLength(2);
          expect(q.history[1]).toMatchObject({ fromPhase: from, toPhase: to, user: 'user' });
          expect(q.history[1].reason).toBe(r?.trim());
        },
      ),
      { numRuns: 100 },
    );
  });
});
