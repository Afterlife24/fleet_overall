import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pickNoteToCollect, type NoteLite } from '../../collectionCore';

const STATUSES = ['Draft', 'Scheduled', 'Collected', 'Closed'] as const;
const isOpen = (n: NoteLite) => n.status !== 'Collected' && n.status !== 'Closed';

// Few distinct instants so ties are frequent.
const createdAtArb = fc.constantFrom(
  '2026-01-01T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
  '2026-01-03T00:00:00.000Z',
  '2026-01-04T00:00:00.000Z',
);

const notesArb = fc
  .array(
    fc.record({
      orgId: fc.constantFrom('org-a', 'org-b'),
      machineId: fc.constantFrom('m-1', 'm-2'),
      status: fc.constantFrom(...STATUSES),
      createdAt: createdAtArb,
    }),
    { maxLength: 12 },
  )
  .map((rows) => rows.map((r, i): NoteLite => ({ ...r, id: `n-${i}` })));

// Feature: gate-in-qr-scan, Property 14: Picking and collecting a note
// **Validates: Requirements 11.1, 11.4, 11.6, 11.8**
describe('Property 14: pickNoteToCollect', () => {
  it('returns undefined without an open note, else the latest open note (first on ties)', () => {
    fc.assert(
      fc.property(
        notesArb,
        fc.constantFrom('org-a', 'org-b'),
        fc.constantFrom('m-1', 'm-2'),
        (notes, orgId, machineId) => {
          const candidates = notes.filter((n) => n.orgId === orgId && n.machineId === machineId && isOpen(n));
          const picked = pickNoteToCollect(notes, orgId, machineId);
          if (candidates.length === 0) {
            expect(picked).toBeUndefined();
            return;
          }
          expect(picked).toBeDefined();
          expect(isOpen(picked!)).toBe(true);
          expect(picked!.orgId).toBe(orgId);
          expect(picked!.machineId).toBe(machineId);
          const max = Math.max(...candidates.map((n) => Date.parse(n.createdAt)));
          expect(Date.parse(picked!.createdAt)).toBe(max);
          const firstAtMax = candidates.find((n) => Date.parse(n.createdAt) === max);
          expect(picked).toBe(firstAtMax);

          // Collecting the picked note changes only that note.
          const after = notes.map((n) => (n.id === picked!.id ? { ...n, status: 'Collected' } : n));
          after.forEach((n, i) => {
            if (n.id === picked!.id) expect(n.status).toBe('Collected');
            else expect(n).toBe(notes[i]);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('treats an unparseable createdAt as oldest but still picks it when it is the only open note', () => {
    const bad: NoteLite = { id: 'bad', orgId: 'o', machineId: 'm', status: 'Draft', createdAt: 'not-a-date' };
    const good: NoteLite = { id: 'good', orgId: 'o', machineId: 'm', status: 'Draft', createdAt: '2020-01-01T00:00:00Z' };
    expect(pickNoteToCollect([bad], 'o', 'm')).toBe(bad);
    expect(pickNoteToCollect([bad, good], 'o', 'm')).toBe(good);
    expect(pickNoteToCollect([good, bad], 'o', 'm')).toBe(good);
  });
});
