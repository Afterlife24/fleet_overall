import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mergeTransportList, ref13Rows, REF13_LABELS, toTransportJobView, transportCounters, overrideKey,
} from '../transportCore';
import { mockJobArb, recordArb } from './transportCore.arbs';

const ORG = 'org-a';

// Feature: rental-flow-integration, Property 4: Transport list order, completeness and counters
// **Validates: Requirements 1.4, 1.7, 1.8**
describe('Property 4: Transport list order, completeness and counters', () => {
  it('lists every job once, persisted newest first ahead of mock rows, counters match', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(recordArb(ORG), { selector: (r) => r.id, maxLength: 12 }),
        fc.uniqueArray(recordArb('org-b'), { selector: (r) => `b${r.id}`, maxLength: 4 }),
        fc.uniqueArray(mockJobArb, { selector: (r) => r.id, maxLength: 12 }),
        (own, other, mock) => {
          const list = mergeTransportList([...own, ...other], mock, ORG, {}, { machines: [] });
          expect(list).toHaveLength(own.length + mock.length);
          expect(new Set(list.map((j) => j.id)).size).toBe(list.length);

          const head = list.slice(0, own.length);
          const tail = list.slice(own.length);
          expect(head.map((j) => j.id).sort()).toEqual(own.map((j) => j.id).sort());
          for (let i = 1; i < head.length; i++) {
            expect(Date.parse(head[i - 1].createdAt)).toBeGreaterThanOrEqual(Date.parse(head[i].createdAt));
          }
          expect(tail.map((j) => j.id)).toEqual(mock.map((j) => j.id));
          expect(list.every((j) => j.orgId === ORG)).toBe(true);

          const c = transportCounters(list);
          const count = (f: (s: string, t: string) => boolean) => list.filter((j) => f(j.status, j.type)).length;
          expect(c.active).toBe(count((s) => s === 'In Transit' || s === 'Loading'));
          expect(c.scheduled).toBe(count((s) => s === 'Scheduled'));
          expect(c.completed).toBe(count((s) => s === 'Completed' || s === 'Delivered'));
          expect(c.deliveries).toBe(count((_, t) => t === 'Delivery'));
          expect(c.collections).toBe(count((_, t) => t === 'Collection'));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a persisted job created last is first, even with equal timestamps', () => {
    fc.assert(
      fc.property(fc.uniqueArray(recordArb(ORG), { selector: (r) => r.id, minLength: 2, maxLength: 8 }), (rows) => {
        const stamp = '2026-05-05T10:00:00.000Z';
        const same = rows.map((r) => ({ ...r, createdAt: stamp }));
        const list = mergeTransportList(same, [], ORG, {}, { machines: [] });
        expect(list[0].id).toBe(same[same.length - 1].id);
      }),
      { numRuns: 100 },
    );
  });

  it('drops a mock row that a persisted row replaced and applies overrides to the rest', () => {
    fc.assert(
      fc.property(mockJobArb, recordArb(ORG), (mock, rec) => {
        const same = { ...rec, id: mock.id };
        const merged = mergeTransportList([same], [mock], ORG, {}, { machines: [] });
        expect(merged).toHaveLength(1);
        const o = mergeTransportList([], [mock], ORG, { [overrideKey(ORG, mock.id)]: { status: 'Cancelled' } }, { machines: [] });
        expect(o[0].status).toBe('Cancelled');
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: rental-flow-integration, Property 5: REF-13 detail rows
// **Validates: Requirements 1.5**
describe('Property 5: REF-13 detail rows', () => {
  it('returns the 15 labelled rows with the entered values', () => {
    fc.assert(
      fc.property(recordArb(ORG), fc.boolean(), (rec, noRemarks) => {
        const r = noRemarks ? { ...rec, remarks: undefined } : rec;
        const rows = ref13Rows(toTransportJobView(r, { machines: [] }));
        expect(rows.map((x) => x.label)).toEqual([...REF13_LABELS]);
        const byLabel = Object.fromEntries(rows.map((x) => [x.label, x.value]));
        expect(byLabel['Planner Name']).toBe(r.plannerName);
        expect(byLabel['Date']).toBe(r.date);
        expect(byLabel['Shift']).toBe(r.shift);
        expect(byLabel['Transport Team']).toBe(r.transportTeam);
        expect(byLabel['Sr. No']).toBe(String(r.srNo));
        expect(byLabel['Fleet']).toBe(r.fleet);
        expect(byLabel['From']).toBe(r.from);
        expect(byLabel['To']).toBe(r.to);
        expect(byLabel['Transport']).toBe(r.transport);
        expect(byLabel['Type']).toBe(r.type);
        expect(byLabel['Contact']).toBe(r.contact);
        expect(byLabel['Sales']).toBe(r.sales);
        expect(byLabel['Client']).toBe(r.client);
        expect(byLabel['Time']).toBe(r.time);
        expect(byLabel['Remarks']).toBe(noRemarks ? '' : (r.remarks ?? ''));
      }),
      { numRuns: 100 },
    );
  });

  it('falls back to view fields for mock rows and never throws', () => {
    fc.assert(
      fc.property(mockJobArb, (mock) => {
        const [v] = mergeTransportList([], [mock], ORG, {}, { machines: [] });
        const rows = ref13Rows(v);
        expect(rows).toHaveLength(15);
        expect(rows.find((x) => x.label === 'From')?.value).toBe(mock.origin);
        expect(rows.find((x) => x.label === 'To')?.value).toBe(mock.destination);
        expect(() => ref13Rows({} as never)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
