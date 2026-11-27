import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { dashIfMissing } from '../../gateCore';

describe('gateCore dashIfMissing', () => {
  // Feature: gate-in-qr-scan, Property 12: Missing values render as a dash
  // **Validates: Requirements 9.6**
  it('returns "-" for undefined, null or empty and the value unchanged otherwise', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null)), (v) => {
        if (v === undefined || v === null || v === '') expect(dashIfMissing(v)).toBe('-');
        else expect(dashIfMissing(v)).toBe(v);
      }),
      { numRuns: 200 },
    );
  });
});
