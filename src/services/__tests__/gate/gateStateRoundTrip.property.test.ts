import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { migrateGateState } from '@/services/gateCore';
import type { GateRecord, GateStoreState } from '@/types/gate';

const ts = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2035-01-01'), noInvalidDate: true })
  .map((d) => d.toISOString());

const recordArb: fc.Arbitrary<GateRecord> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    orgId: fc.string({ minLength: 1, maxLength: 8 }),
    reference: fc.string({ maxLength: 8 }),
    assetNumber: fc.string({ maxLength: 8 }),
    direction: fc.constantFrom('IN', 'OUT'),
    status: fc.constantFrom('Pending', 'Approved', 'Completed'),
    driver: fc.string({ maxLength: 8 }),
    destination: fc.string({ maxLength: 8 }),
    timestamp: ts,
    createdAt: ts,
    updatedAt: ts,
  })
  .map((r) => r as unknown as GateRecord);

const stateArb: fc.Arbitrary<GateStoreState> = fc.record({
  entries: fc.array(recordArb, { maxLength: 6 }),
  seedMarkers: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== '__proto__'),
    fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }),
  ),
  legacyImported: fc.boolean(),
});

// Feature: gate-in-qr-scan, Property 19: Gate state persistence round trip
// **Validates: Requirements 14.2, 14.6**
describe('Property 19: migrateGateState round trip', () => {
  it('returns an equal state after a JSON round trip', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(migrateGateState(JSON.parse(JSON.stringify(state)))).toEqual(state);
      }),
      { numRuns: 100 },
    );
  });
});
