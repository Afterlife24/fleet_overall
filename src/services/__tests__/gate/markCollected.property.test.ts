// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { useCollectionStore } from '@/store/collectionStore';
import { markCollectedForMachine } from '@/services/collectionDocs';
import type { CollectionNote } from '@/types/collection';

const ORG = 'org-a';
const MACHINE = 'm-1';
const GATE = { id: 'ge-1', reference: 'GP-0001', timestamp: '2026-02-01T10:00:00.000Z' };
const STATUSES = ['Draft', 'Scheduled', 'Collected', 'Closed'] as const;
const isOpen = (n: CollectionNote) => n.status !== 'Collected' && n.status !== 'Closed';

function makeNote(i: number, orgId: string, machineId: string, status: CollectionNote['status'], day: number): CollectionNote {
  const createdAt = new Date(Date.UTC(2026, 0, day)).toISOString();
  return {
    id: `n-${i}`, number: `CN-2026-${String(i + 1).padStart(4, '0')}`, orgId, machineId, status, createdAt, updatedAt: createdAt,
  } as unknown as CollectionNote;
}

const rowsArb = fc.array(
  fc.record({
    orgId: fc.constantFrom(ORG, 'org-b'),
    machineId: fc.constantFrom(MACHINE, 'm-2'),
    status: fc.constantFrom(...STATUSES),
    day: fc.integer({ min: 1, max: 5 }),
  }),
  { maxLength: 10 },
);

function load(rows: { orgId: string; machineId: string; status: CollectionNote['status']; day: number }[]) {
  const notes = rows.map((r, i) => makeNote(i, r.orgId, r.machineId, r.status, r.day));
  useCollectionStore.setState({ notes, counters: {}, demoSeededOrgs: [ORG, 'org-b'] });
  return notes;
}

const openOf = () =>
  useCollectionStore.getState().notes.filter((n) => n.orgId === ORG && n.machineId === MACHINE && isOpen(n));

// Feature: gate-in-qr-scan, Property 15: Collecting is idempotent with at most one open note
// **Validates: Requirements 11.3, 11.6, 11.7, 11.9**
describe('Property 15: markCollectedForMachine', () => {
  it('collects one open note per call in descending createdAt order, idempotent when <= 1 open', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const initial = load(rows);
        const expectedOrder = initial
          .filter((n) => n.orgId === ORG && n.machineId === MACHINE && isOpen(n))
          .map((n, idx) => ({ n, idx }))
          .sort((a, b) => Date.parse(b.n.createdAt) - Date.parse(a.n.createdAt) || a.idx - b.idx)
          .map((x) => x.n.id);

        const k = expectedOrder.length;
        for (let step = 0; step < k; step++) {
          const before = useCollectionStore.getState().notes;
          const res = markCollectedForMachine(ORG, MACHINE, GATE);
          expect(res?.id).toBe(expectedOrder[step]);
          expect(res?.status).toBe('Collected');
          expect(res?.collectedByGateRef).toBe(GATE.reference);
          const after = useCollectionStore.getState().notes;
          expect(after).toHaveLength(before.length);
          expect(openOf()).toHaveLength(k - step - 1);
          after.forEach((n, i) => {
            if (n.id === expectedOrder[step]) {
              expect(n.status).toBe('Collected');
              expect(n.number).toBe(before[i].number);
              expect(n.createdAt).toBe(before[i].createdAt);
            } else {
              expect(n).toBe(before[i]);
            }
          });
        }

        // No open note left: further calls change nothing.
        const settled = useCollectionStore.getState().notes;
        expect(markCollectedForMachine(ORG, MACHINE, GATE)).toBeUndefined();
        expect(useCollectionStore.getState().notes).toBe(settled);
      }),
      { numRuns: 100 },
    );
  });
});

