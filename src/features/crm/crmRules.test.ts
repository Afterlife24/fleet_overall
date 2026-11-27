import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ALLOWED, AUTO_WON_REASON, applyAutoWon, applyTransition, isAllowed } from './crmRules';
import { PHASES } from '@/types/quotation';
import type { PhaseHistoryEntry, Quotation, QuotationPhase } from '@/types/quotation';

const phaseArb = fc.constantFrom<QuotationPhase>(...PHASES);
const str = fc.string({ maxLength: 12 });
const isoArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
  .map((d) => d.toISOString());

const historyEntryArb: fc.Arbitrary<PhaseHistoryEntry> = fc.record(
  {
    id: str,
    timestamp: isoArb,
    user: str,
    fromPhase: fc.option(phaseArb, { nil: null }),
    toPhase: phaseArb,
    reason: str,
  },
  { requiredKeys: ['id', 'timestamp', 'user', 'fromPhase', 'toPhase'] },
);

const quotationArb = (phase: fc.Arbitrary<QuotationPhase>): fc.Arbitrary<Quotation> =>
  fc.record(
    {
      id: str,
      createdAt: isoArb,
      updatedAt: isoArb,
      orgId: str,
      number: str,
      opportunity: str,
      hireAgreementNo: str,
      email: str,
      customerId: str,
      customerName: str,
      amount: fc.integer({ min: 0, max: 1_000_000 }),
      currency: str,
      phase,
      lostReason: str,
      lostAt: isoArb,
      lostBy: str,
      salesRep: str,
      validUntil: isoArb,
      notes: str,
      history: fc.array(historyEntryArb, { maxLength: 5 }),
    },
    {
      requiredKeys: [
        'id', 'createdAt', 'updatedAt', 'orgId', 'number', 'opportunity', 'hireAgreementNo',
        'customerId', 'customerName', 'amount', 'currency', 'phase', 'history',
      ],
    },
  ) as fc.Arbitrary<Quotation>;

const runs = { numRuns: 100 };

describe('applyAutoWon', () => {
  // Feature: hire-agreement-planner-link, Property 9: applyAutoWon transition rule
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.5, 11.1, 15.1**
  it('Awaiting/Tender become Won with exactly one auto history entry', () => {
    fc.assert(
      fc.property(
        quotationArb(fc.constantFrom<QuotationPhase>('Awaiting', 'Tender')),
        str,
        isoArb,
        (q, user, now) => {
          const before = structuredClone(q);
          const r = applyAutoWon(q, user, now);
          expect(q).toEqual(before);
          expect(r.kind).toBe('changed');
          if (r.kind !== 'changed') return;
          const out = r.quotation;
          expect(out.phase).toBe('Won');
          expect(out.updatedAt).toBe(now);
          expect(out.history).toHaveLength(q.history.length + 1);
          expect(out.history.slice(0, -1)).toEqual(q.history);
          const entry = out.history[out.history.length - 1];
          expect(entry.fromPhase).toBe(q.phase);
          expect(entry.toPhase).toBe('Won');
          expect(entry.timestamp).toBe(now);
          expect(entry.user).toBe(user);
          expect(entry.reason).toBe(AUTO_WON_REASON);
          const rest = (x: Quotation): Record<string, unknown> => {
            const copy: Record<string, unknown> = { ...x };
            delete copy.phase;
            delete copy.updatedAt;
            delete copy.history;
            return copy;
          };
          expect(rest(out)).toEqual(rest(q));
        },
      ),
      runs,
    );
  });

  it('for Tender equals manual applyTransition to Won except entry id, reason and user', () => {
    fc.assert(
      fc.property(quotationArb(fc.constant<QuotationPhase>('Tender')), str, str, isoArb, (q, user, manualUser, now) => {
        const auto = applyAutoWon(q, user, now);
        const manual = applyTransition(q, 'Won', manualUser, now);
        expect(auto.kind).toBe('changed');
        expect(manual.ok).toBe(true);
        if (auto.kind !== 'changed' || !manual.ok) return;
        const strip = (x: Quotation) => {
          const last = x.history[x.history.length - 1];
          const entry: Record<string, unknown> = { ...last };
          delete entry.id;
          delete entry.reason;
          delete entry.user;
          return { ...x, history: [...x.history.slice(0, -1), entry] };
        };
        expect(strip(auto.quotation)).toEqual(strip(manual.quotation));
      }),
      runs,
    );
  });

  it('Won and Lost are unchanged and the input is not modified', () => {
    fc.assert(
      fc.property(
        quotationArb(fc.constantFrom<QuotationPhase>('Won', 'Lost')),
        str,
        isoArb,
        (q, user, now) => {
          const before = structuredClone(q);
          const r = applyAutoWon(q, user, now);
          expect(r.kind).toBe('unchanged');
          expect(q).toEqual(before);
        },
      ),
      runs,
    );
  });

  it('keeps the ALLOWED table and allows manual Awaiting -> Won without a reason', () => {
    expect(isAllowed('Awaiting', 'Won')).toBe(true);
    const q = {
      id: 'q1', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', orgId: 'o', number: 'QT-1',
      opportunity: 'x', hireAgreementNo: '', customerId: 'c', customerName: 'C', amount: 1, currency: 'AED',
      phase: 'Awaiting', history: [],
    } as Quotation;
    const r = applyTransition(q, 'Won', 'user', '2025-01-02T00:00:00.000Z');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quotation.phase).toBe('Won');
      expect(r.quotation.history[0]).toMatchObject({ fromPhase: 'Awaiting', toPhase: 'Won' });
    }
    expect(ALLOWED).toEqual([
      ['Awaiting', 'Tender'],
      ['Awaiting', 'Won'],
      ['Awaiting', 'Lost'],
      ['Tender', 'Won'],
      ['Tender', 'Lost'],
      ['Lost', 'Awaiting'],
    ]);
  });
});
