// @vitest-environment jsdom
// Feature: offhire-collection-docs, Property 8: Sequences are independent and increment by one
// **Validates: Requirements 2.4, 2.5**
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  counterKey,
  formatDocNumber,
  nextSequence,
  parseDocNumber,
  type CounterKey,
} from '@/services/collectionCore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import type { DocType } from '@/types/collection';

const stores = {
  CN: useCollectionStore,
  MQD: useMqdStore,
  TPS: useThirdPartyStore,
} as const;

const resetStores = (): void => {
  useCollectionStore.setState({ notes: [], counters: {}, demoSeededOrgs: [] });
  useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [] });
  useThirdPartyStore.setState({ documents: [], counters: {}, demoSeededOrgs: [] });
};

const typeArb = fc.constantFrom<DocType>('CN', 'MQD', 'TPS');
const opArb = fc.record({
  type: typeArb,
  orgId: fc.constantFrom('org-a', 'org-b', 'org-ja', 'org-x'),
  year: fc.integer({ min: 2020, max: 2030 }),
});

describe('Property 8: sequences are independent and increment by one', () => {
  beforeEach(resetStores);

  it('store issueNumber: n-th number per (org, type, year) has sequence n and other keys are untouched', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        resetStores();
        const expected: Record<CounterKey, number> = {};
        for (const op of ops) {
          const store = stores[op.type];
          const before = { ...store.getState().counters };
          const num = store.getState().issueNumber(op.orgId, op.year);
          const key = counterKey(op.orgId, op.type, op.year);
          expected[key] = (expected[key] ?? 0) + 1;

          expect(num).toBe(formatDocNumber(op.type, op.year, expected[key]));
          expect(parseDocNumber(num)).toEqual({
            type: op.type,
            year: op.year,
            seq: expected[key],
          });

          const after = store.getState().counters;
          expect(after[key]).toBe(expected[key]);
          for (const k of Object.keys(before)) {
            if (k !== key) expect(after[k]).toBe(before[k]);
          }
          expect(Object.keys(after).length).toBe(
            Object.keys(before).length + (key in before ? 0 : 1),
          );
        }
        // Each store holds only its own type's counters, matching the model.
        for (const type of ['CN', 'MQD', 'TPS'] as const) {
          const want = Object.fromEntries(
            Object.entries(expected).filter(([k]) => k.split('|')[1] === type),
          );
          expect(stores[type].getState().counters).toEqual(want);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('nextSequence is pure: increments one key by one without mutating input or other keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom('a|CN|2025', 'a|MQD|2025', 'b|TPS|2026', 'c|CN|2027'), fc.integer({ min: 0, max: 9999 })),
        fc.constantFrom('a|CN|2025', 'a|MQD|2025', 'b|TPS|2026', 'z|CN|2030'),
        (counters, key) => {
          const snapshot = { ...counters };
          const r = nextSequence(counters, key);
          expect(counters).toEqual(snapshot);
          expect(r.seq).toBe((counters[key] ?? 0) + 1);
          expect(r.counters[key]).toBe(r.seq);
          for (const k of Object.keys(counters)) {
            if (k !== key) expect(r.counters[k]).toBe(counters[k]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
