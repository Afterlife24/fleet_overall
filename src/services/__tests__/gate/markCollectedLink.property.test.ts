// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { useCollectionStore } from '@/store/collectionStore';
import { markCollectedForMachine } from '@/services/collectionDocs';
import type { CollectionNote } from '@/types/collection';

const ORG = 'org-a';
const MACHINE = 'm-1';
const STATUSES = ['Draft', 'Scheduled', 'Collected', 'Closed'] as const;
const isOpen = (n: CollectionNote) => n.status !== 'Collected' && n.status !== 'Closed';

const rowsArb = fc.array(
  fc.record({
    orgId: fc.constantFrom(ORG, 'org-b'),
    machineId: fc.constantFrom(MACHINE, 'm-2'),
    status: fc.constantFrom(...STATUSES),
    day: fc.integer({ min: 1, max: 5 }),
  }),
  { maxLength: 10 },
);

const gateArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  reference: fc.string({ minLength: 1, maxLength: 12 }),
  timestamp: fc
    .date({ min: new Date('2020-01-01'), max: new Date('2035-01-01'), noInvalidDate: true })
    .map((d) => d.toISOString()),
});

// Feature: gate-in-qr-scan, Property 25: Collecting stores the gate link on exactly one note
// **Validates: Requirements 11.1, 11.6, 11.7, 16.6**
describe('Property 25: markCollectedForMachine stores the gate link', () => {
  it('links exactly one picked note, or changes nothing', () => {
    fc.assert(
      fc.property(rowsArb, gateArb, (rows, gate) => {
        const notes = rows.map((r, i): CollectionNote => {
          const createdAt = new Date(Date.UTC(2026, 0, r.day)).toISOString();
          return {
            id: `n-${i}`, number: `CN-2026-${String(i + 1).padStart(4, '0')}`,
            orgId: r.orgId, machineId: r.machineId, status: r.status, createdAt, updatedAt: createdAt,
          } as unknown as CollectionNote;
        });
        useCollectionStore.setState({ notes, counters: {}, demoSeededOrgs: [ORG, 'org-b'] });
        const hasOpen = notes.some((n) => n.orgId === ORG && n.machineId === MACHINE && isOpen(n));

        const res = markCollectedForMachine(ORG, MACHINE, gate);
        const after = useCollectionStore.getState().notes;

        if (!hasOpen) {
          expect(res).toBeUndefined();
          expect(after).toBe(notes);
          return;
        }
        expect(res?.status).toBe('Collected');
        expect(res?.collectedByGateId).toBe(gate.id);
        expect(res?.collectedByGateRef).toBe(gate.reference);
        expect(res?.collectedAt).toBe(gate.timestamp);
        expect(after).toHaveLength(notes.length);
        const changed = after.filter((n, i) => n !== notes[i]);
        expect(changed).toHaveLength(1);
        expect(changed[0].id).toBe(res!.id);
        after.forEach((n, i) => {
          if (n.id !== res!.id) expect(n).toEqual(notes[i]);
        });
      }),
      { numRuns: 100 },
    );
  });
});
