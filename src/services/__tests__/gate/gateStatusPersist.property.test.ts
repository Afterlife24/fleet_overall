// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { gateService } from '@/services/services';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { migrateGateStoreState } from '@/store/gateStore';
import { gateEntriesForOrg } from '@/services/mock/orgData';
import type { GateRecord } from '@/types/gate';

async function run<T>(p: Promise<T> | T): Promise<T> {
  const result = Promise.resolve(p);
  await vi.advanceTimersByTimeAsync(1000); // delay() uses setTimeout
  return result;
}

const stored = (id: string, orgId: string): GateRecord =>
  ({
    id, orgId, reference: `GP-${id}`, assetNumber: 'A', machineModel: 'M', direction: 'IN',
    timestamp: '2026-01-01T00:00:00.000Z', driver: '', destination: '', status: 'Pending',
    branchId: 'b', branchName: 'B', gatePass: `GP-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }) as GateRecord;

let savedUser: unknown;
beforeEach(() => {
  vi.useFakeTimers();
  savedUser = useAuthStore.getState().user;
});
afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: savedUser as never });
});

// Feature: gate-in-qr-scan, Property 20: Status change persists and lists once
// **Validates: Requirements 14.6, 14.7**
describe('Property 20: gate status change persists and lists once', () => {
  it('approve or complete leaves one row with the new status, others unchanged, and survives a rebuild', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('org-ja', 'org-x', 'org-y'),
        fc.constantFrom('approve', 'complete'),
        fc.boolean(),
        fc.integer({ min: 0, max: 20 }),
        async (orgId, action, useMock, pick) => {
          useAuthStore.setState({ user: { orgId } as never });
          useGateStore.setState({
            entries: [stored('s-1', orgId), stored('s-2', orgId), stored('o-1', 'org-other')],
            seedMarkers: {},
            legacyImported: true,
          });
          const mockRows = gateEntriesForOrg(orgId);
          const before = (await run(gateService.list())) as GateRecord[];
          const pool = useMock && mockRows.length > 0 ? mockRows.map((m) => m.id) : ['s-1', 's-2'];
          const id = pool[pick % pool.length];
          const expected = action === 'approve' ? 'Approved' : 'Completed';

          const call = action === 'approve' ? gateService.approve : gateService.complete;
          await run(call(id));

          const check = async () => {
            const after = (await run(gateService.list())) as GateRecord[];
            expect(after.filter((r) => r.id === id)).toHaveLength(1);
            expect(after.find((r) => r.id === id)?.status).toBe(expected);
            expect(after).toHaveLength(before.length);
            for (const row of before.filter((r) => r.id !== id)) {
              expect(after.find((r) => r.id === row.id)).toEqual(row);
            }
            expect(after.every((r) => r.orgId === orgId)).toBe(true);
          };
          await check();

          const { entries, seedMarkers, legacyImported } = useGateStore.getState();
          const rebuilt = migrateGateStoreState(JSON.parse(JSON.stringify({ entries, seedMarkers, legacyImported })));
          useGateStore.setState({ ...rebuilt });
          await check();
        },
      ),
      { numRuns: 60 },
    );
  });
});
