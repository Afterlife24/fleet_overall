import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { directionFor } from '../../gateCore';

describe('gateCore directionFor', () => {
  // Feature: gate-in-qr-scan, Property 10: Direction follows machine status
  // **Validates: Requirements 10.1, 10.2**
  it('is IN only for On Hire and OUT for every other status', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.constantFrom('On Hire', 'PHI', 'Available', 'on hire', ' On Hire', 'Under Maintenance'),
        ),
        (status) => {
          expect(directionFor(status)).toBe(status === 'On Hire' ? 'IN' : 'OUT');
        },
      ),
      { numRuns: 200 },
    );
  });
});
