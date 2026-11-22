// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { useGateStore } from '@/store/gateStore';
import { planGateSeeds } from '@/services/gateCore';
import { demoGateSeedsForOrg, gateSeedId } from '@/services/mock/demoGate';
import { demoMachineId } from '@/services/mock/demoHireLink';
import type { MachineLite } from '@/services/collectionCore';
import type { GateRecord } from '@/types/gate';

// Feature: gate-in-qr-scan, Property 21: Seeding is idempotent
// **Validates: Requirements 15.1, 15.8**

const FLEET = ['J101', 'J102', 'J103', 'J104', 'J105'];
const orgArb = fc.constantFrom('org-ja', 'org-a', 'org-test-xyz');

const machinesFor = (orgId: string, present: boolean[]): MachineLite[] =>
  FLEET.flatMap((f, i) => present[i]
    ? [{ orgId, id: demoMachineId(orgId, i + 1), fleetNo: f, assetNumber: f, make: 'CAT', model: '320' }]
    : []);

const userRecord = (orgId: string, n: number): GateRecord => ({
  id: `ge-user-${orgId}-${n}`, orgId, reference: `GP-${n}`, gatePass: `GP-${n}`, assetNumber: 'A', machineModel: '',
  direction: 'OUT', timestamp: '2026-01-01T00:00:00.000Z', driver: '', destination: '', status: 'Pending',
  branchId: 'b', branchName: 'B', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function apply(orgId: string, machines: MachineLite[]): void {
  const gs = useGateStore.getState();
  const seeds = demoGateSeedsForOrg(orgId, { machines, booking: { id: 'bk', startDate: '2026-12-10', customerName: 'MNO Company LLC' } });
  gs.seedOrg(orgId, planGateSeeds(gs.seedMarkers[orgId] ?? [], new Set(gs.entries.map((r) => r.id)), seeds));
}

const snap = () => JSON.stringify({ e: useGateStore.getState().entries, m: useGateStore.getState().seedMarkers });

describe('Property 21: Seeding is idempotent', () => {
  it('applying the seeder twice equals once, and inserted ids are marked', () => {
    fc.assert(
      fc.property(
        orgArb,
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        fc.subarray([1, 2, 3]),
        fc.integer({ min: 0, max: 3 }),
        (orgId, present, marked, users) => {
          useGateStore.setState({
            entries: Array.from({ length: users }, (_, i) => userRecord(orgId, i)),
            seedMarkers: marked.length ? { [orgId]: marked.map((n) => gateSeedId(orgId, n)) } : {},
          });
          const machines = machinesFor(orgId, present);
          const before = new Set(useGateStore.getState().entries.map((r) => r.id));
          apply(orgId, machines);
          const once = snap();
          apply(orgId, machines);
          expect(snap()).toBe(once);
          const st = useGateStore.getState();
          for (const r of st.entries) {
            if (!before.has(r.id)) expect(st.seedMarkers[orgId]).toContain(r.id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
