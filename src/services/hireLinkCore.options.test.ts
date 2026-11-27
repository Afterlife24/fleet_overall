import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { companyKey, orderAgreementOptions, type AgreementLite } from './hireLinkCore';

// Feature: hire-agreement-planner-link, Property 5: Agreement option list content and order
// **Validates: Requirements 4.2, 4.3, 4.4**

const baseNames = ['ABC Company', 'Gulf Cranes', 'Delta Hire', 'Acme', 'Zed Plant'];
const suffixes = ['', ' LLC', ' L.L.C.', ' Ltd', ' PJSC', ' FZE', ' Co.', ' Limited', ' Inc'];

const nameArb = fc
  .tuple(
    fc.constantFrom(...baseNames),
    fc.constantFrom(...suffixes),
    fc.constantFrom<(s: string) => string>(
      (s) => s,
      (s) => s.toUpperCase(),
      (s) => s.toLowerCase(),
      (s) => `  ${s}  `,
    ),
  )
  .map(([b, s, f]) => f(b + s));

const arbAgreements = fc
  .array(
    fc.record({
      orgId: fc.constantFrom('org-a', 'org-b', 'org-c'),
      agreementNo: fc.string({ maxLength: 8 }),
      customerName: fc.oneof(nameArb, fc.string({ maxLength: 12 })),
      quotationId: fc.string({ maxLength: 5 }),
    }),
    { maxLength: 30 },
  )
  .map((rows): AgreementLite[] => rows.map((r, i) => ({ ...r, id: `ha-${i}` })));

const optionalName = fc.option(fc.oneof(nameArb, fc.string({ maxLength: 12 })), { nil: undefined });

describe('Property 5: agreement option list content and order', () => {
  it('result is a permutation, grouped by companyKey, stable within groups', () => {
    fc.assert(
      fc.property(arbAgreements, fc.constantFrom('org-a', 'org-b', 'org-c'), optionalName, (all, org, company) => {
        const active = all.filter((a) => a.orgId === org);
        const out = orderAgreementOptions(active, company);

        // permutation of the active org's agreements (no cross-org leakage)
        expect(out.map((a) => a.id).sort()).toEqual(active.map((a) => a.id).sort());
        expect(out.every((a) => a.orgId === org)).toBe(true);

        const key = company ? companyKey(company) : '';
        if (!key) {
          expect(out).toEqual(active);
          return;
        }
        const matches = (a: AgreementLite) => companyKey(a.customerName) === key;
        const firstGroup = active.filter(matches);
        const restGroup = active.filter((a) => !matches(a));
        // matching first, rest after, input order kept in each group
        expect(out).toEqual([...firstGroup, ...restGroup]);
      }),
      { numRuns: 200 },
    );
  });

  it('does not mutate its input', () => {
    fc.assert(
      fc.property(arbAgreements, optionalName, (all, company) => {
        const copy = all.map((a) => ({ ...a }));
        orderAgreementOptions(all, company);
        expect(all).toEqual(copy);
      }),
      { numRuns: 100 },
    );
  });

  it('companyKey is idempotent and ignores legal-form suffixes', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        expect(companyKey(companyKey(s))).toBe(companyKey(s));
      }),
      { numRuns: 200 },
    );
    expect(companyKey('ABC Company LLC')).toBe(companyKey('ABC Company'));
    expect(companyKey('ABC Company L.L.C.')).toBe('abc company');
  });
});
