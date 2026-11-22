import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { recalcTotals, VAT_RATE } from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 9: Totals follow the existing VAT rules
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

const qty = fc.integer({ min: 0, max: 10_000 });
const rate = fc.integer({ min: 0, max: 10_000_000 }).map((c) => c / 100);

const input = fc.record({
  equipmentQty: qty,
  equipmentRate: rate,
  transportationQty: qty,
  transportationRate: rate,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

describe('Property 9: Totals follow the existing VAT rules', () => {
  it('amounts, subtotal, VAT, total and amount due follow the formulas', () => {
    fc.assert(
      fc.property(input, (f) => {
        const r = recalcTotals(f);
        expect(r.equipmentAmount).toBe(f.equipmentQty * f.equipmentRate);
        expect(r.transportationAmount).toBe(f.transportationQty * f.transportationRate);
        expect(r.subtotal).toBe(r.equipmentAmount + r.transportationAmount);
        expect(r.vat).toBe(round2(r.subtotal * VAT_RATE));
        expect(r.totalAmount).toBe(round2(r.subtotal + r.vat));
        expect(r.amountDue).toBe(r.totalAmount);
      }),
      { numRuns: 200 },
    );
  });

  it('results are non-negative and total is within a cent of subtotal x 1.05', () => {
    fc.assert(
      fc.property(input, (f) => {
        const r = recalcTotals(f);
        expect(r.vat).toBeGreaterThanOrEqual(0);
        expect(r.totalAmount).toBeGreaterThanOrEqual(r.subtotal - 0.005);
        expect(Math.abs(r.totalAmount - r.subtotal * 1.05)).toBeLessThanOrEqual(0.011);
      }),
      { numRuns: 200 },
    );
  });

  it('client-supplied total fields are overwritten by recomputed values', () => {
    fc.assert(
      fc.property(
        input,
        fc.record({
          equipmentAmount: fc.double({ noNaN: true }),
          transportationAmount: fc.double({ noNaN: true }),
          subtotal: fc.double({ noNaN: true }),
          vat: fc.double({ noNaN: true }),
          totalAmount: fc.double({ noNaN: true }),
          amountDue: fc.double({ noNaN: true }),
        }),
        (f, bogus) => {
          const clean = recalcTotals(f);
          const dirty = recalcTotals({ ...f, ...bogus });
          expect(dirty).toEqual(clean);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('example: 2 x 100 + 1 x 50 -> subtotal 250, VAT 12.5, total 262.5', () => {
    const r = recalcTotals({ equipmentQty: 2, equipmentRate: 100, transportationQty: 1, transportationRate: 50 });
    expect(r).toMatchObject({
      equipmentAmount: 200,
      transportationAmount: 50,
      subtotal: 250,
      vat: 12.5,
      totalAmount: 262.5,
      amountDue: 262.5,
    });
  });

  it('missing quantities and rates count as zero', () => {
    expect(recalcTotals({})).toMatchObject({ subtotal: 0, vat: 0, totalAmount: 0, amountDue: 0 });
  });
});
