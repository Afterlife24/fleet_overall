// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';

// Feature: offhire-collection-docs, Property 9: Numbers are never reused
// **Validates: Requirements 2.6**

type Kind = 'CN' | 'MQD' | 'TPS';

interface Adapter {
  issue: (orgId: string, year: number) => string;
  insert: (id: string, orgId: string, number: string) => void;
  remove: (id: string) => void;
  newId: () => string;
  reset: () => void;
}

const adapters: Record<Kind, Adapter> = {
  CN: {
    issue: (o, y) => useCollectionStore.getState().issueNumber(o, y),
    insert: (id, orgId, number) =>
      useCollectionStore.getState().insert({ id, orgId, number } as never),
    remove: (id) => useCollectionStore.getState().remove(id),
    newId: () => useCollectionStore.getState().newId(),
    reset: () => useCollectionStore.setState({ notes: [], counters: {}, demoSeededOrgs: [] }),
  },
  MQD: {
    issue: (o, y) => useMqdStore.getState().issueNumber(o, y),
    insert: (id, orgId, number) => useMqdStore.getState().insert({ id, orgId, number } as never),
    remove: (id) => useMqdStore.getState().remove(id),
    newId: () => useMqdStore.getState().newId(),
    reset: () => useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [] }),
  },
  TPS: {
    issue: (o, y) => useThirdPartyStore.getState().issueNumber(o, y),
    insert: (id, orgId, number) =>
      useThirdPartyStore.getState().insert({ id, orgId, number } as never),
    remove: (id) => useThirdPartyStore.getState().remove(id),
    newId: () => useThirdPartyStore.getState().newId(),
    reset: () => useThirdPartyStore.setState({ documents: [], counters: {}, demoSeededOrgs: [] }),
  },
};

const opArb = fc.oneof(
  fc.record({
    op: fc.constant<'issue'>('issue'),
    org: fc.constantFrom('org-a', 'org-b'),
    year: fc.constantFrom(2025, 2026),
  }),
  fc.record({ op: fc.constant<'delete'>('delete'), pick: fc.nat(1000) })
);

describe('Property 9: numbers are never reused', () => {
  beforeEach(() => {
    for (const a of Object.values(adapters)) a.reset();
  });

  for (const kind of ['CN', 'MQD', 'TPS'] as const) {
    it(`${kind}: every issued number is distinct, including after deletes`, () => {
      const a = adapters[kind];
      fc.assert(
        fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
          a.reset();
          const issuedByGroup = new Map<string, Set<string>>();
          const live: string[] = [];
          for (const o of ops) {
            if (o.op === 'issue') {
              const number = a.issue(o.org, o.year);
              const group = `${o.org}|${o.year}`;
              const seen = issuedByGroup.get(group) ?? new Set<string>();
              expect(seen.has(number)).toBe(false);
              seen.add(number);
              issuedByGroup.set(group, seen);
              const id = a.newId();
              a.insert(id, o.org, number);
              live.push(id);
            } else if (live.length > 0) {
              const [id] = live.splice(o.pick % live.length, 1);
              a.remove(id);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  }
});
