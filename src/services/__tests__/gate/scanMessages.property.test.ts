import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { QrError } from '../../collectionCore';
import { GATE_SCAN_MESSAGES } from '../../gateCore';

const CODES: QrError[] = ['OTHER', 'OTHER_ORG', 'NOT_FOUND', 'AMBIGUOUS', 'MISMATCH'];

describe('gateCore scan messages', () => {
  // Feature: gate-in-qr-scan, Property 3: Scan messages are complete and distinct
  // **Validates: Requirements 3.6**
  it('has exactly one trimmed 1-200 char message per error, all distinct', () => {
    expect(Object.keys(GATE_SCAN_MESSAGES).sort()).toEqual([...CODES].sort());
    fc.assert(
      fc.property(fc.constantFrom(...CODES), fc.constantFrom(...CODES), (a, b) => {
        const ma = GATE_SCAN_MESSAGES[a].trim();
        expect(ma.length).toBeGreaterThanOrEqual(1);
        expect(ma.length).toBeLessThanOrEqual(200);
        if (a !== b) expect(ma).not.toBe(GATE_SCAN_MESSAGES[b].trim());
      }),
      { numRuns: 100 },
    );
  });
});
