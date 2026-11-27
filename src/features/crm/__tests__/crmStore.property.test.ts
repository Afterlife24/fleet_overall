// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { PHASES } from '@/types/quotation';
import { useCrmStore } from '@/store/crmStore';

// The CRM store is an in-memory read copy of the API data (backend-foundation-crm Requirement 15.5 and 15.8):
// it is neither seeded nor persisted, so the old migration and persistence round trip properties no longer apply.

const ORGS = ['org-ja', 'org-a', 'org-b'] as const;

const quotationArb: fc.Arbitrary<Quotation> = fc
  .record({
    n: fc.integer({ min: 1, max: 9999 }),
    orgId: fc.constantFrom(...ORGS),
    phase: fc.constantFrom<QuotationPhase>(...PHASES),
    name: fc.constantFrom('ABC Company', 'Arabtec Contracting', 'DEF Company LLC', 'Some Customer'),
    reason: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map(({ n, orgId, phase, name, reason }) => ({
    id: `qt-${n}`,
    orgId,
    number: `QT-2026-${String(n).padStart(4, '0')}`,
    opportunity: `Opp ${n}`,
    hireAgreementNo: 'HA-2026-00001',
    customerId: `CUS-${n}`,
    customerName: name,
    amount: n,
    currency: 'AED',
    phase,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [
      { id: `h-${n}-0`, timestamp: '2026-01-01T00:00:00.000Z', user: 'u', fromPhase: null, toPhase: 'Awaiting' as const },
      { id: `h-${n}-1`, timestamp: '2026-01-02T00:00:00.000Z', user: 'u', fromPhase: 'Awaiting' as const, toPhase: phase, reason },
    ],
  }));

const listArb = fc.array(quotationArb, { maxLength: 12 }).map((qs) => {
  const seen = new Set<string>();
  return qs.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
});

beforeEach(() => { localStorage.clear(); useCrmStore.setState({ quotations: [] }); });

// Feature: rental-flow-integration, Property 18: Company isolation (crm store)
describe('Property 18: Company isolation (crm store read copy)', () => {
  /** **Validates: Requirements 3.12, 3.14, 9.1, 9.2, 9.3** */
  it('starts empty and never writes to localStorage', () => {
    expect(useCrmStore.getState().quotations).toEqual([]);
    useCrmStore.setState({ quotations: [{ id: 'q', orgId: 'org-a' } as Quotation] });
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('an automatic change for one company leaves the other companies equal', () => {
    fc.assert(
      fc.property(listArb, fc.constantFrom(...ORGS), (qs, org) => {
        useCrmStore.setState({ quotations: qs });
        const target = qs.find((q) => q.orgId === org && q.phase === 'Awaiting');
        const others = qs.filter((q) => q.orgId !== org);
        if (target) {
          expect(useCrmStore.getState().autoWon(org, target.id, 'System')).toMatchObject({ ok: true, result: { kind: 'changed' } });
        }
        const after = useCrmStore.getState().quotations;
        for (const o of others) expect(after.find((q) => q.id === o.id)).toEqual(o);
      }),
      { numRuns: 100 },
    );
  });
});
