// @vitest-environment jsdom
// Feature: offhire-collection-docs, Property 10: Migrate totality and counter floor
// **Validates: Requirements 2.5, 2.6**
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { migrateCollectionState } from '@/store/collectionStore';
import { migrateMqdState } from '@/store/mqdStore';
import { migrateThirdPartyState } from '@/store/thirdPartyStore';
import { counterKey, formatDocNumber, migrateCounters, parseDocNumber } from '@/services/collectionCore';

const NUM_RUNS = 100;

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const anyJson = fc.jsonValue();
const docType = fc.constantFrom('CN', 'MQD', 'TPS') as fc.Arbitrary<'CN' | 'MQD' | 'TPS'>;
const orgIdArb = fc.constantFrom('org-a', 'org-b', 'JA');

const numberArb = fc.oneof(
  fc
    .tuple(docType, fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 99999 }))
    .map(([t, y, s]) => formatDocNumber(t, y, s)),
  fc.string(),
  anyJson
);

const rowArb = fc.record(
  {
    id: fc.oneof(fc.string({ minLength: 1 }), anyJson),
    orgId: fc.oneof(orgIdArb, fc.constant(undefined), anyJson),
    number: numberArb,
  },
  { requiredKeys: [] }
);

const countersArb = fc.oneof(
  anyJson,
  fc.dictionary(
    fc.tuple(orgIdArb, docType, fc.integer({ min: 2000, max: 2099 })).map(([o, t, y]) => counterKey(o, t, y)),
    fc.oneof(fc.integer({ min: 0, max: 50000 }), fc.string(), fc.constant(null), fc.double())
  )
);

const stateArb = (listKey: string) =>
  fc.oneof(
    anyJson,
    fc.constant(undefined),
    fc.record(
      {
        [listKey]: fc.oneof(fc.array(fc.oneof(rowArb, anyJson), { maxLength: 15 }), anyJson),
        counters: countersArb,
        demoSeededOrgs: fc.oneof(fc.array(fc.oneof(fc.string(), anyJson)), anyJson),
      },
      { requiredKeys: [] }
    )
  );

function assertValid(
  result: { counters: Record<string, number>; demoSeededOrgs: string[] },
  rows: { orgId: string; number?: unknown }[]
) {
  expect(result.demoSeededOrgs.every((s) => typeof s === 'string')).toBe(true);
  for (const v of Object.values(result.counters)) {
    expect(Number.isInteger(v) && v >= 0).toBe(true);
  }
  for (const r of rows) {
    if (typeof r.number !== 'string') continue;
    const p = parseDocNumber(r.number);
    if (!p) continue;
    expect(result.counters[counterKey(r.orgId, p.type, p.year)] ?? 0).toBeGreaterThanOrEqual(p.seq);
  }
}

describe('Property 10: Migrate totality and counter floor', () => {
  it('migrateCollectionState is total and counters floor at stored sequences', () => {
    fc.assert(
      fc.property(stateArb('notes'), (input) => {
        const r = migrateCollectionState(input);
        expect(Array.isArray(r.notes)).toBe(true);
        assertValid(r, r.notes);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('migrateMqdState is total and counters floor at stored sequences', () => {
    fc.assert(
      fc.property(stateArb('records'), (input) => {
        const r = migrateMqdState(input);
        expect(Array.isArray(r.records)).toBe(true);
        assertValid(r, r.records);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('migrateThirdPartyState is total and counters floor at stored sequences', () => {
    fc.assert(
      fc.property(stateArb('documents'), (input) => {
        const r = migrateThirdPartyState(input);
        expect(Array.isArray(r.documents)).toBe(true);
        assertValid(r, r.documents);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('migrateCounters is total for any counter value and keeps stored maxima', () => {
    fc.assert(
      fc.property(
        fc.oneof(countersArb, fc.constant(undefined)),
        fc.array(fc.record({ orgId: orgIdArb, number: numberArb.filter((n) => typeof n === 'string') as fc.Arbitrary<string> })),
        (raw, docs) => {
          const out = migrateCounters(raw, docs);
          assertValid({ counters: out, demoSeededOrgs: [] }, docs);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
