import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mergeGateList } from '@/services/gateCore';
import type { GateEntry, GateRecord } from '@/types/gate';

const ORG = 'org-a';
const pool = Array.from({ length: 8 }, (_, i) => `id-${i}`);
const CREATED = [
  '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'bad-date',
];

const rec = fc.record({
  id: fc.constantFrom(...pool),
  createdAt: fc.constantFrom(...CREATED),
  seeded: fc.boolean(),
});
const recordsArb = fc.uniqueArray(rec, { selector: (r) => r.id, maxLength: 8 }).map((rows) =>
  rows.map((r) => ({
    id: r.id, orgId: ORG, createdAt: r.createdAt, reference: r.id, ...(r.seeded ? { seedKey: r.id } : {}),
  }) as unknown as GateRecord),
);
const mockArb = fc
  .array(fc.constantFrom(...pool), { maxLength: 8 })
  .map((ids) => ids.map((id) => ({ id, reference: 'MOCK', createdAt: '2020-01-01T00:00:00.000Z' }) as unknown as GateEntry));

const ms = (s: string) => (Number.isNaN(Date.parse(s)) ? -Infinity : Date.parse(s));

// Feature: gate-in-qr-scan, Property 17: Gate list order and shadowing
// **Validates: Requirements 14.3, 14.7**
describe('Property 17: mergeGateList order and shadowing', () => {
  it('orders user, seed, then mock rows; ids are unique; persisted shadows mock', () => {
    fc.assert(
      fc.property(recordsArb, mockArb, (records, mock) => {
        const out = mergeGateList(records, mock, ORG);
        const ids = out.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);

        const users = records.filter((r) => !r.seedKey);
        const seeds = records.filter((r) => !!r.seedKey);
        const expectedUsers = users
          .map((r, i) => ({ r, i }))
          .sort((a, b) => (ms(a.r.createdAt) === ms(b.r.createdAt) ? a.i - b.i : ms(b.r.createdAt) - ms(a.r.createdAt) > 0 ? 1 : -1))
          .map((x) => x.r.id);
        expect(ids.slice(0, users.length)).toEqual(expectedUsers);
        expect(ids.slice(users.length, users.length + seeds.length)).toEqual(seeds.map((r) => r.id));

        const persistedIds = new Set(records.map((r) => r.id));
        const tail = out.slice(users.length + seeds.length);
        const expectedTail: string[] = [];
        for (const m of mock) if (!persistedIds.has(m.id) && !expectedTail.includes(m.id)) expectedTail.push(m.id);
        expect(tail.map((r) => r.id)).toEqual(expectedTail);
        for (const t of tail) expect(t.reference).toBe('MOCK');
        for (const r of records) expect(out.find((o) => o.id === r.id)).toBe(r);
      }),
      { numRuns: 100 },
    );
  });
});
