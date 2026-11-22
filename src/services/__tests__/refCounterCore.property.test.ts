import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_SEQ,
  REF_RE,
  counterKey,
  counterFloorFromRefs,
  issueRef,
  type RefCounters,
  type RefPrefix,
} from '../refCounterCore';

const prefixArb = fc.constantFrom<RefPrefix>('TJ', 'GP', 'DN', 'HMQD', 'HTPS');
const orgArb = fc.constantFrom('org-ja', 'org-a', 'org-b');
const yearArb = fc.constantFrom(2025, 2026, 2027);
const opArb = fc.record({ orgId: orgArb, prefix: prefixArb, year: yearArb });

// Feature: rental-flow-integration, Property 1: Reference issuance
describe('Property 1: Reference issuance', () => {
  it('issues well-formed, unique, consecutive references per company, prefix and year', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        let counters: RefCounters = {};
        const seen = new Map<string, Set<string>>();
        const expected = new Map<string, number>();
        for (const op of ops) {
          const before = counters;
          const r = issueRef(counters, op.orgId, op.prefix, op.year);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const key = counterKey(op.orgId, op.prefix, op.year);
          const next = (expected.get(key) ?? 0) + 1;
          expected.set(key, next);
          expect(r.seq).toBe(next);
          expect(REF_RE.test(r.ref)).toBe(true);
          expect(r.ref).toBe(`${op.prefix}-${op.year}-${String(next).padStart(4, '0')}`);
          const set = seen.get(op.orgId) ?? new Set<string>();
          expect(set.has(r.ref)).toBe(false);
          set.add(r.ref);
          seen.set(op.orgId, set);
          // never lowers any counter, input untouched
          for (const k of Object.keys(before)) expect(r.counters[k]).toBeGreaterThanOrEqual(before[k]);
          expect(before[key] ?? 0).toBe(next - 1);
          counters = r.counters;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns EXHAUSTED at 9999 and leaves counters unchanged', () => {
    fc.assert(
      fc.property(opArb, fc.integer({ min: 0, max: MAX_SEQ - 1 }), (op, other) => {
        const key = counterKey(op.orgId, op.prefix, op.year);
        const counters: RefCounters = { [key]: MAX_SEQ, 'x|TJ|2020': other };
        const snapshot = JSON.stringify(counters);
        const r = issueRef(counters, op.orgId, op.prefix, op.year);
        expect(r).toEqual({ ok: false, error: 'EXHAUSTED' });
        expect(JSON.stringify(counters)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it('counterFloorFromRefs yields the highest sequence per key, so issuing continues above it', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: opArb,
            seq: fc.integer({ min: 1, max: MAX_SEQ - 1 }),
          }),
          { maxLength: 30 },
        ),
        (items) => {
          const rows = items.map(({ op, seq }) => ({
            orgId: op.orgId,
            ref: `${op.prefix}-${op.year}-${String(seq).padStart(4, '0')}`,
          }));
          const floor = counterFloorFromRefs([...rows, { orgId: 'org-a', ref: 'junk' }]);
          for (const { op } of items) {
            const key = counterKey(op.orgId, op.prefix, op.year);
            const max = Math.max(
              ...items
                .filter((i) => counterKey(i.op.orgId, i.op.prefix, i.op.year) === key)
                .map((i) => i.seq),
            );
            expect(floor[key]).toBe(max);
            const r = issueRef(floor, op.orgId, op.prefix, op.year);
            expect(r.ok && r.seq).toBe(max + 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
