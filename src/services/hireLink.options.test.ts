// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper', () => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

import { useCrmStore } from '@/store/crmStore';
import { useOrgStore } from '@/store/orgStore';
import { useAuthStore } from '@/store/authStore';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { companyKey } from './hireLinkCore';
import {
  HireLinkValidationError,
  assertQuotationMatchesCompany,
  listQuotationOptions,
} from './hireLink';

// Feature: hire-agreement-planner-link, Property 3: Quotation options and company check
// **Validates: Requirements 2.2, 2.3, 2.4, 2.6**

const ORGS = ['org-a', 'org-b'] as const;
const phases: QuotationPhase[] = ['Awaiting', 'Tender', 'Lost', 'Won'];
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

const anyNameArb = fc.oneof(nameArb, nameArb, fc.string({ maxLength: 12 }));

const quotationsArb = fc
  .array(
    fc.record({
      orgId: fc.constantFrom(...ORGS),
      customerName: anyNameArb,
      phase: fc.constantFrom(...phases),
      opportunity: fc.string({ maxLength: 10 }),
    }),
    { maxLength: 12 },
  )
  .map((rows) =>
    rows.map(
      (r, i): Quotation => ({
        id: `q-${i}`,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        orgId: r.orgId,
        number: `QT-${i}`,
        opportunity: r.opportunity,
        hireAgreementNo: '',
        customerId: `c-${i}`,
        customerName: r.customerName,
        amount: 100,
        currency: 'AED',
        phase: r.phase,
        history: [],
      }),
    ),
  );

function setup(quotations: Quotation[], crmActiveFor: Record<string, boolean>): void {
  useCrmStore.setState({ quotations });
  useOrgStore.setState({
    installedApps: Object.fromEntries(
      ORGS.map((o) => [o, crmActiveFor[o] ? ['crm', 'quotation'] : ['quotation']]),
    ),
  });
}

beforeEach(() => {
  localStorage.clear();
  useCrmStore.setState(useCrmStore.getInitialState(), true);
  useOrgStore.setState(useOrgStore.getInitialState(), true);
  useAuthStore.setState(useAuthStore.getInitialState(), true);
});

describe('Property 3: listQuotationOptions', () => {
  it('returns exactly the same-org, same-company quotations when CRM is active', () => {
    fc.assert(
      fc.property(quotationsArb, fc.constantFrom(...ORGS), anyNameArb, (qs, orgId, company) => {
        setup(qs, { 'org-a': true, 'org-b': true });
        const res = listQuotationOptions(orgId, company);
        expect(res.active).toBe(true);
        const key = companyKey(company);
        const expected = key
          ? qs
              .filter((q) => q.orgId === orgId && companyKey(q.customerName) === key)
              .map((q) => ({ id: q.id, number: q.number, opportunity: q.opportunity, phase: q.phase }))
          : [];
        expect(res.options).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('returns inactive with no options when CRM is inactive for the org', () => {
    fc.assert(
      fc.property(quotationsArb, fc.constantFrom(...ORGS), anyNameArb, (qs, orgId, company) => {
        setup(qs, { 'org-a': false, 'org-b': false });
        expect(listQuotationOptions(orgId, company)).toEqual({ active: false, options: [] });
      }),
      { numRuns: 100 },
    );
  });

  it('matches name variants of the same company and never another org', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...baseNames),
        fc.constantFrom(...suffixes),
        fc.constantFrom(...suffixes),
        (base, s1, s2) => {
          const mk = (id: string, orgId: string, name: string): Quotation => ({
            id,
            createdAt: '',
            updatedAt: '',
            orgId,
            number: id,
            opportunity: 'o',
            hireAgreementNo: '',
            customerId: id,
            customerName: name,
            amount: 1,
            currency: 'AED',
            phase: 'Awaiting',
            history: [],
          });
          setup([mk('q1', 'org-a', base + s1), mk('q2', 'org-b', base + s1)], {
            'org-a': true,
            'org-b': true,
          });
          const ids = listQuotationOptions('org-a', (base + s2).toUpperCase()).options.map((o) => o.id);
          expect(ids).toEqual(['q1']);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: assertQuotationMatchesCompany', () => {
  it('companyKey is idempotent', () => {
    fc.assert(
      fc.property(fc.oneof(anyNameArb, fc.string()), (name) => {
        const k = companyKey(name);
        expect(companyKey(k)).toBe(k);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts an empty quotationId for any company and CRM state', () => {
    fc.assert(
      fc.property(
        quotationsArb,
        fc.constantFrom(...ORGS),
        anyNameArb,
        fc.boolean(),
        (qs, orgId, customerName, crmOn) => {
          setup(qs, { 'org-a': crmOn, 'org-b': crmOn });
          expect(() => assertQuotationMatchesCompany(orgId, { customerName, quotationId: '' })).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps any stored link when CRM is inactive', () => {
    fc.assert(
      fc.property(
        quotationsArb,
        fc.constantFrom(...ORGS),
        anyNameArb,
        fc.string({ minLength: 1, maxLength: 6 }),
        (qs, orgId, customerName, quotationId) => {
          setup(qs, { 'org-a': false, 'org-b': false });
          expect(() => assertQuotationMatchesCompany(orgId, { customerName, quotationId })).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('with CRM active, throws iff the quotation is missing in the org or of another company', () => {
    fc.assert(
      fc.property(
        quotationsArb,
        fc.constantFrom(...ORGS),
        anyNameArb,
        fc.integer({ min: 0, max: 14 }),
        (qs, orgId, customerName, idx) => {
          setup(qs, { 'org-a': true, 'org-b': true });
          const quotationId = `q-${idx}`;
          const q = qs.find((x) => x.id === quotationId && x.orgId === orgId);
          const shouldPass = !!q && companyKey(q.customerName) === companyKey(customerName);
          const run = () => assertQuotationMatchesCompany(orgId, { customerName, quotationId });
          if (shouldPass) {
            expect(run).not.toThrow();
          } else {
            expect(run).toThrow(HireLinkValidationError);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
