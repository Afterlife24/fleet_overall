// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { useGateStore } from '@/store/gateStore';
import { planGateSeeds } from '@/services/gateCore';
import { demoGateSeedsForOrg, gateSeedId } from '@/services/mock/demoGate';
import { demoMachineId } from '@/services/mock/demoHireLink';
import type { MachineLite } from '@/services/collectionCore';
import type { GateRecord } from '@/types/gate';

// Feature: gate-in-qr-scan, Property 22: Seeding respects markers, missing machines and user records
// **Validates: Requirements 15.9, 15.10, 15.11**

const FLEET = ['J101', 'J102', 'J103', 'J104', 'J105'];
const orgArb = fc.constantFrom('org-ja', 'org-a', 'org-test-xyz');
const SEED_MACHINE: Record<number, number> = { 1: 5, 2: 4, 3: 1 };

const machinesFor = (orgId: string, present: boolean[]): MachineLite[] =>
  FLEET.flatMap((f, i) => present[i]
    ? [{ orgId, id: demoMachineId(orgId, i + 1), fleetNo: f, assetNumber: f, make: 'CAT', model: '320' }]
    : []);

const userRecord = (orgId: string, n: number): GateRecord => ({
  id: `ge-user-${orgId}-${n}`, orgId, reference: `GP-${n}`, gatePass: `GP-${n}`, assetNumber: 'A', machineModel: '',
  direction: 'OUT', timestamp: '2026-01-01T00:00:00.000Z', driver: '', destination: '', status: 'Pending',
  branchId: 'b', branchName: 'B', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('Property 22: Seeding respects markers, missing machines and user records', () => {
  it('inserts exactly the unmarked seeds that have a machine and leaves earlier rows unchanged', () => {
    fc.assert(
      fc.property(
        orgArb,
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        fc.subarray([1, 2, 3]),
        fc.integer({ min: 0, max: 3 }),
        (orgId, present, marked, users) => {
          const earlier = Array.from({ length: users }, (_, i) => userRecord(orgId, i));
          const markers = marked.map((n) => gateSeedId(orgId, n));
          useGateStore.setState({ entries: earlier, seedMarkers: markers.length ? { [orgId]: markers } : {} });

          const machines = machinesFor(orgId, present);
          const gs = useGateStore.getState();
          const seeds = demoGateSeedsForOrg(orgId, { machines, booking: { id: 'bk', startDate: '2026-12-10' } });
          gs.seedOrg(orgId, planGateSeeds(gs.seedMarkers[orgId] ?? [], new Set(gs.entries.map((r) => r.id)), seeds));

          const expected = [1, 2, 3].filter((n) => !marked.includes(n) && present[SEED_MACHINE[n] - 1]);
          const st = useGateStore.getState();
          const inserted = st.entries.slice(earlier.length).map((r) => r.id);
          expect(inserted).toEqual(expected.map((n) => gateSeedId(orgId, n)));
          expect(st.entries.slice(0, earlier.length)).toEqual(earlier);

          // Skipped seeds (machine missing) never get a marker; marked ones keep theirs.
          const m = st.seedMarkers[orgId] ?? [];
          for (const n of [1, 2, 3]) {
            const id = gateSeedId(orgId, n);
            const has = marked.includes(n) || expected.includes(n);
            expect(m.includes(id)).toBe(has);
          }
          // A marked seed is never re-created, even though its row is absent.
          for (const n of marked) expect(st.entries.some((r) => r.id === gateSeedId(orgId, n))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
