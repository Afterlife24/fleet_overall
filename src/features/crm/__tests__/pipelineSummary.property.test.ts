import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { PHASES } from '@/types/quotation';
import { byPhase, pipelineTotals, searchLost } from '../crmRules';
import { cardModel, columnSummary } from '../statusPanelCore';

const quotationArb: fc.Arbitrary<Quotation> = fc.record({
  id: fc.uuid(),
  orgId: fc.constant('org-p'),
  number: fc.integer({ min: 1, max: 9999 }).map((n) => `QT-2026-${String(n).padStart(4, '0')}`),
  opportunity: fc.string({ minLength: 1, maxLength: 30 }),
  hireAgreementNo: fc.oneof(
    fc.constant(''),
    fc.integer({ min: 1, max: 99999 }).map((n) => `HA-2026-${String(n).padStart(5, '0')}`),
  ),
  customerId: fc.constant('CUST-000125'),
  customerName: fc.string({ minLength: 1, maxLength: 30 }),
  amount: fc.integer({ min: 0, max: 50_000_000 }),
  currency: fc.constant('AED'),
  phase: fc.constantFrom<QuotationPhase>(...PHASES),
  lostReason: fc.constant('Price too high'),
  createdAt: fc.constant('2026-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2026-01-01T00:00:00.000Z'),
  history: fc.constant([]),
});

const withCommas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Feature: rental-flow-integration, Property 10: Board summaries and tab consistency
describe('Property 10: Board summaries and tab consistency', () => {
  /** **Validates: Requirements 2.2, 2.5, 2.6, 2.7** */
  it('columnSummary counts, sums and formats per phase', () => {
    fc.assert(
      fc.property(fc.array(quotationArb, { maxLength: 25 }), (qs) => {
        for (const p of PHASES) {
          const rows = qs.filter((q) => q.phase === p);
          const sum = rows.reduce((s, q) => s + q.amount, 0);
          const c = columnSummary(qs, p);
          expect(c.count).toBe(rows.length);
          expect(c.amount).toBe(sum);
          expect(c.label).toBe(`AED ${withCommas(sum)}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('an empty column gives 0 and AED 0', () => {
    for (const p of PHASES) expect(columnSummary([], p)).toMatchObject({ count: 0, amount: 0, label: 'AED 0' });
  });

  it('Lost and Won tabs equal the columns and the active total is Awaiting plus Tender', () => {
    fc.assert(
      fc.property(fc.array(quotationArb, { maxLength: 25 }), (qs) => {
        expect(searchLost(qs, '')).toEqual(qs.filter((q) => q.phase === 'Lost'));
        expect(byPhase(qs, 'Won')).toEqual(qs.filter((q) => q.phase === 'Won'));
        expect(pipelineTotals(qs).amount).toBe(columnSummary(qs, 'Awaiting').amount + columnSummary(qs, 'Tender').amount);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: rental-flow-integration, Property 11: Card content
describe('Property 11: Card content', () => {
  /** **Validates: Requirements 2.3, 2.4** */
  it('cardModel carries the five fields and a dash for an empty agreement number', () => {
    fc.assert(
      fc.property(quotationArb, (q) => {
        const m = cardModel(q);
        expect(m.number).toBe(q.number);
        expect(m.opportunity).toBe(q.opportunity);
        expect(m.customerName).toBe(q.customerName);
        expect(m.hireAgreementNo).toBe(q.hireAgreementNo === '' ? '—' : q.hireAgreementNo);
        expect(m.amountLabel).toBe(`AED ${withCommas(q.amount)}`);
      }),
      { numRuns: 100 },
    );
  });
});
