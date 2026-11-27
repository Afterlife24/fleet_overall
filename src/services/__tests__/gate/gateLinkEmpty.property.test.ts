import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { linkNoteToGate } from '@/services/gateCore';

const gateArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  reference: fc.string({ minLength: 1, maxLength: 10 }),
  timestamp: fc
    .date({ min: new Date('2020-01-01'), max: new Date('2035-01-01'), noInvalidDate: true })
    .map((d) => d.toISOString()),
});

// Feature: gate-in-qr-scan, Property 24: Gate link is written only into an empty link
// **Validates: Requirements 15.3, 16.3**
describe('Property 24: linkNoteToGate', () => {
  it('fills an empty link from the gate and never overwrites an existing one', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }), gateArb, (existing, gate) => {
        const res = linkNoteToGate({ collectedByGateId: existing }, gate);
        if (existing) {
          expect(res).toEqual({});
        } else {
          expect(res).toEqual({
            collectedByGateId: gate.id,
            collectedByGateRef: gate.reference,
            collectedAt: gate.timestamp,
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});
