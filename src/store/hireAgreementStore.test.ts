// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useAuthStore } from '@/store/authStore';
import { hireAgreementService } from '@/services/services';
import type { HireAgreement } from '@/types/hireagreement';

// Feature: hire-agreement-planner-link, Property 1: Agreement identity and ownership are stable and unique
// **Validates: Requirements 1.2, 1.3, 1.4, 2.7**

function resetAll() {
  localStorage.clear();
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [] });
  useAuthStore.setState({ user: null, isAuthenticated: false });
}

function setActiveOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId } as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>,
    isAuthenticated: true,
  });
}

/** Runs a service call and flushes its simulated latency timer. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  const p = fn();
  await vi.advanceTimersByTimeAsync(500);
  return p;
}

const orgIdArb = fc.constantFrom('org-ja', 'org-a', 'org-b', 'org-c');
const textArb = fc.string({ maxLength: 12 });

const patchArb = fc.record(
  {
    id: fc.constant('ha-hijack'),
    orgId: orgIdArb,
    createdAt: fc.constant('1999-01-01T00:00:00.000Z'),
    agreementNo: textArb,
    // Only the empty id is valid without a CRM quotation; other ids are rejected by assertQuotationMatchesCompany.
    quotationId: fc.constant(''),
    customerName: textArb,
  },
  { requiredKeys: [] }
);

type Op =
  | { kind: 'seed'; org: string }
  | { kind: 'create'; org: string; data: Partial<HireAgreement> }
  | { kind: 'update'; pick: number; patch: Partial<HireAgreement> };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('seed' as const), org: orgIdArb }),
  fc.record({
    kind: fc.constant('create' as const),
    org: orgIdArb,
    data: patchArb,
  }),
  fc.record({
    kind: fc.constant('update' as const),
    pick: fc.nat(1000),
    patch: patchArb,
  })
);

describe('hireAgreementStore / hireAgreementService identity and ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAll();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAll();
  });

  it('Property 1: ids are unique, id/orgId/createdAt immutable on update, created orgId is the active org, re-seeding adds nothing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
        resetAll();
        const store = () => useHireAgreementStore.getState();

        for (const op of ops) {
          if (op.kind === 'seed') {
            const before = store().agreements.length;
            const already = store().seededOrgs.includes(op.org);
            store().ensureSeeded(op.org);
            if (already) expect(store().agreements.length).toBe(before);
            // Seeding again is always a no-op.
            const afterFirst = store().agreements.length;
            store().ensureSeeded(op.org);
            expect(store().agreements.length).toBe(afterFirst);
          } else if (op.kind === 'create') {
            setActiveOrg(op.org);
            const created = await run(() => hireAgreementService.create(op.data));
            expect(created.orgId).toBe(op.org);
            expect(store().getById(created.id)?.orgId).toBe(op.org);
          } else {
            const rows = store().agreements;
            if (rows.length === 0) continue;
            const target = rows[op.pick % rows.length];
            setActiveOrg(target.orgId);
            const before = { ...target };
            // A linked agreement (demo seed) keeps its company: changing it is rejected by design.
            const patch = { ...op.patch };
            if (target.quotationId) delete patch.customerName;
            const updated = await run(() => hireAgreementService.update(target.id, patch));
            expect(updated.id).toBe(before.id);
            expect(updated.orgId).toBe(before.orgId);
            expect(updated.createdAt).toBe(before.createdAt);
            const stored = store().getById(before.id)!;
            expect(stored.id).toBe(before.id);
            expect(stored.orgId).toBe(before.orgId);
            expect(stored.createdAt).toBe(before.createdAt);
            if (patch.agreementNo !== undefined) expect(stored.agreementNo).toBe(patch.agreementNo);
            if (patch.quotationId !== undefined) expect(stored.quotationId).toBe(patch.quotationId);
          }

          const ids = store().agreements.map((a) => a.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('seeds two orgs with distinct ids and seeding the same org twice adds no rows', () => {
    const s = useHireAgreementStore.getState();
    s.ensureSeeded('org-a');
    s.ensureSeeded('org-b');
    const n = useHireAgreementStore.getState().agreements.length;
    s.ensureSeeded('org-a');
    const rows = useHireAgreementStore.getState().agreements;
    expect(rows.length).toBe(n);
    expect(new Set(rows.map((r) => r.id)).size).toBe(n);
  });
});
