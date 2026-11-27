import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mergeGateList } from '@/services/gateCore';
import type { GateEntry, GateRecord } from '@/types/gate';

const ORGS = ['org-a', 'org-b', 'org-c'] as const;

const recordArb = (id: fc.Arbitrary<string>, seeded = false): fc.Arbitrary<GateRecord> =>
  fc.record({
    id,
    orgId: fc.constantFrom(...ORGS),
    createdAt: fc.constantFrom(
      '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'not-a-date',
    ),
  }).map((r) => ({
    ...r, reference: `GP-${r.id}`, assetNumber: 'A', machineModel: 'M', direction: 'IN', timestamp: r.createdAt,
    driver: '', destination: '', status: 'Pending', branchId: 'b', branchName: 'B', gatePass: `GP-${r.id}`,
    updatedAt: r.createdAt, ...(seeded ? { seedKey: r.id } : {}),
  }) as unknown as GateRecord);

const mockArb = (pool: string[]): fc.Arbitrary<GateEntry> =>
  fc.record({ id: fc.constantFrom(...pool), createdAt: fc.constant('2025-01-01T00:00:00.000Z') }).map(
    (r) => ({ ...r, reference: 'GP-M', assetNumber: 'A', timestamp: r.createdAt, status: 'Pending' }) as unknown as GateEntry,
  );

// Feature: gate-in-qr-scan, Property 16: Gate list isolation
// **Validates: Requirements 14.4, 14.10**
describe('Property 16: mergeGateList isolation', () => {
  it('returns no foreign rows and every persisted row of the org exactly once', () => {
    const pool = Array.from({ length: 8 }, (_, i) => `id-${i}`);
    fc.assert(
      fc.property(
        fc.uniqueArray(recordArb(fc.constantFrom(...pool)), { selector: (r) => r.id, maxLength: 8 }),
        fc.array(mockArb(pool.map((p) => `m-${p}`)), { maxLength: 5 }),
        fc.constantFrom(...ORGS),
        (records, mock, orgId) => {
          const out = mergeGateList(records, mock, orgId);
          expect(out.every((r) => r.orgId === orgId)).toBe(true);
          for (const r of records.filter((x) => x.orgId === orgId)) {
            expect(out.filter((o) => o.id === r.id)).toHaveLength(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
