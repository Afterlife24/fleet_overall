import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatDocNumber, parseDocNumber } from '../../collectionCore';

// Feature: offhire-collection-docs, Property 7: Document number format round trip
// **Validates: Requirements 2.1, 2.2, 2.3**
describe('Property 7: Document number format round trip', () => {
  it('parse(format(type, year, seq)) returns the same parts and matches the format', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('CN', 'MQD', 'TPS' as const),
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1, max: 99_999_999 }),
        (type, year, seq) => {
          const n = formatDocNumber(type as 'CN' | 'MQD' | 'TPS', year, seq);
          expect(n).toMatch(new RegExp(`^${type}-${year}-\\d{4,}$`));
          expect(parseDocNumber(n)).toEqual({ type, year, seq });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('formats a known example with 4-digit padding', () => {
    expect(formatDocNumber('CN', 2026, 1)).toBe('CN-2026-0001');
    expect(parseDocNumber('TPS-2026-12345')).toEqual({ type: 'TPS', year: 2026, seq: 12345 });
  });
});
