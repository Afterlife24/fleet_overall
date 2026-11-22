// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { PHASES } from '@/types/quotation';
import { CRM_STORAGE_KEY, migrateCrmState, useCrmStore } from '@/store/crmStore';

const ORGS = ['org-ja', 'org-a', 'org-b'] as const;

const quotationArb: fc.Arbitrary<Quotation> = fc
  .record({
    n: fc.integer({ min: 1, max: 9999 }),
    orgId: fc.constantFrom(...ORGS),
    phase: fc.constantFrom<QuotationPhase>(...PHASES),
    name: fc.constantFrom('ABC Company', 'Arabtec Contracting', 'DEF Company LLC', 'Some Customer'),
    seed: fc.boolean(),
    reason: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map(({ n, orgId, phase, name, seed, reason }) => ({
    id: seed ? `qt-seed-${n}` : `qt-${n}`,
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

beforeEach(() => { localStorage.clear(); });

// Feature: rental-flow-integration, Property 18: Company isolation and persistence round trip
describe('Property 18: Company isolation and persistence round trip (crm store)', () => {
  /** **Validates: Requirements 3.12, 3.14, 9.1, 9.2, 9.3** */
  it('v3 to v4 migration keeps every record and only canonicalizes seed customer names', () => {
    fc.assert(
      fc.property(listArb, (qs) => {
        const out = migrateCrmState({ quotations: JSON.parse(JSON.stringify(qs)) }, 3).quotations;
        expect(out.map((q) => q.id)).toEqual(qs.map((q) => q.id));
        out.forEach((q, i) => {
          const before = qs[i];
          const isSeed = before.id.startsWith('qt-seed-');
          const fixable = before.customerName === 'ABC Company' || before.customerName === 'Arabtec Contracting';
          if (isSeed && fixable) {
            expect(q.customerName).toBe(before.customerName === 'ABC Company' ? 'ABC Company LLC' : 'Arabtec Construction LLC');
            expect(q.customerId).toMatch(/^CUST-\d{6}$/);
            expect({ ...q, customerName: '', customerId: '' }).toEqual({ ...before, customerName: '', customerId: '' });
          } else {
            expect(q).toEqual(before);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  it('migration of any input does not throw and is idempotent', () => {
    fc.assert(
      fc.property(fc.anything(), fc.integer({ min: 0, max: 4 }), (junk, version) => {
        const once = migrateCrmState(junk, version);
        expect(Array.isArray(once.quotations)).toBe(true);
        expect(migrateCrmState(once, 4)).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it('serialize and rehydrate keep phase history; a change for one company leaves the others equal', async () => {
    await fc.assert(
      fc.asyncProperty(listArb, fc.constantFrom(...ORGS), async (qs, org) => {
        localStorage.clear();
        const users = qs.map((q) => ({ ...q, customerName: 'Some Customer', customerId: 'CUS-1' }));
        useCrmStore.setState({ quotations: users });
        const target = users.find((q) => q.orgId === org && q.phase === 'Awaiting');
        const others = users.filter((q) => q.orgId !== org);
        if (target) {
          expect(useCrmStore.getState().changePhase(target.id, 'Tender', 'u').ok).toBe(true);
        }
        const after = useCrmStore.getState().quotations;
        for (const o of others) expect(after.find((q) => q.id === o.id)).toEqual(o);
        const stored = localStorage.getItem(CRM_STORAGE_KEY)!;
        useCrmStore.setState({ quotations: [] });
        localStorage.setItem(CRM_STORAGE_KEY, stored);
        await useCrmStore.persist.rehydrate();
        expect(useCrmStore.getState().quotations).toEqual(after);
      }),
      { numRuns: 100 },
    );
  });
});
