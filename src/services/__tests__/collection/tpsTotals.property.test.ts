import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { lineAmount, tpsTotal } from '../../collectionCore';
import type { ServiceLine } from '../../../types/collection';

const SERVICE_TYPES = ['Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other'] as const;

const lineArb: fc.Arbitrary<ServiceLine> = fc.record({
  id: fc.uuid(),
  provider: fc.string({ maxLength: 20 }),
  serviceType: fc.constantFrom(...SERVICE_TYPES),
  description: fc.string({ maxLength: 30 }),
  date: fc.constant('2025-01-01'),
  reference: fc.string({ maxLength: 10 }),
  // quantity in hundredths, rate in cents
  quantity: fc.integer({ min: 0, max: 100000 }).map((n) => n / 100),
  rate: fc.integer({ min: 0, max: 10000000 }).map((n) => n / 100),
});

const linesArb = fc.array(lineArb, { maxLength: 15 });

const toCents = (n: number) => Math.round(n * 100);

describe('TPS totals', () => {
  it('Property 16: Totals', () => {
    // Feature: offhire-collection-docs, Property 16: Totals
    // **Validates: Requirements 9.5, 9.6, 9.9**
    fc.assert(
      fc.property(linesArb, lineArb, (lines, extra) => {
        // line amount = quantity x rate (rounded to cents)
        for (const l of lines) {
          expect(Math.abs(lineAmount(l) - l.quantity * l.rate)).toBeLessThanOrEqual(0.005 + 1e-6);
          expect(lineAmount(l)).toBeGreaterThanOrEqual(0);
        }

        // total = sum of line amounts, no tax
        const expectedCents = lines.reduce((s, l) => s + toCents(lineAmount(l)), 0);
        const total = tpsTotal(lines);
        expect(toCents(total)).toBe(expectedCents);

        // order independent
        expect(tpsTotal([...lines].reverse())).toBe(total);
        const rotated = lines.length ? [...lines.slice(1), lines[0]] : [];
        expect(tpsTotal(rotated)).toBe(total);

        // adding a line changes total by exactly its amount; removing restores
        const added = tpsTotal([...lines, extra]);
        expect(toCents(added)).toBe(expectedCents + toCents(lineAmount(extra)));
        expect(tpsTotal(lines)).toBe(total);
      }),
      { numRuns: 200 },
    );
  });

  it('empty list totals zero', () => {
    expect(tpsTotal([])).toBe(0);
  });
});
