// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import type { HireAgreement } from '@/types/hireagreement';

// The hire agreement store is an in-memory read copy of the API data (backend-foundation-crm Requirements 15.5,
// 15.8 and 15.14). Identity, ownership and uniqueness of agreements are enforced by the API (see the server tests),
// so the old create/update/seed properties of this store no longer exist.

const orgIdArb = fc.constantFrom('org-ja', 'org-a', 'org-b', 'org-c');

const agreementArb = fc
  .record({ n: fc.nat(10_000), orgId: orgIdArb })
  .map(({ n, orgId }) => ({ id: `ha-${n}`, orgId, agreementNo: `HA-${n}` }) as unknown as HireAgreement);

const uniqueArb = fc.array(agreementArb, { maxLength: 15 }).map((rows) => {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
});

describe('hireAgreementStore (in-memory read copy)', () => {
  beforeEach(() => {
    localStorage.clear();
    useHireAgreementStore.setState({ agreements: [] });
  });

  it('starts empty: no agreements are seeded and nothing is written to localStorage', () => {
    expect(useHireAgreementStore.getState().agreements).toEqual([]);
    useHireAgreementStore.setState({ agreements: [{ id: 'a' } as HireAgreement] });
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('forOrg returns exactly the rows of that organization and getById finds each row', () => {
    fc.assert(
      fc.property(uniqueArb, orgIdArb, (rows, org) => {
        useHireAgreementStore.setState({ agreements: rows });
        const mine = useHireAgreementStore.getState().forOrg(org);
        expect(mine).toEqual(rows.filter((r) => r.orgId === org));
        for (const r of rows) expect(useHireAgreementStore.getState().getById(r.id)).toEqual(r);
        expect(useHireAgreementStore.getState().getById('missing')).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
