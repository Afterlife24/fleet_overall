import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateAgreementRef,
  VALIDATION_MESSAGES,
  type AgreementLite,
  type QuotationLite,
  type ValidationCode,
} from './hireLinkCore';

// Feature: hire-agreement-planner-link, Property 4: Hire agreement reference validation
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**

const ORGS = ['org-a', 'org-b', 'org-c'];
const idArb = fc.constantFrom('ha-1', 'ha-2', 'ha-3', 'ha-4', 'ha-5', 'ha-6');
const qIdArb = fc.constantFrom('q-1', 'q-2', 'q-3', 'q-4');
const orgArb = fc.constantFrom(...ORGS);

const scenarioArb = fc
  .record({
    agreementIds: fc.uniqueArray(idArb, { maxLength: 6 }),
    quotationIds: fc.uniqueArray(qIdArb, { maxLength: 4 }),
    activeOrg: orgArb,
    crmActive: fc.boolean(),
  })
  .chain(({ agreementIds, quotationIds, activeOrg, crmActive }) =>
    fc.record({
      activeOrg: fc.constant(activeOrg),
      crmActive: fc.constant(crmActive),
      agreements: fc.tuple(
        ...agreementIds.map((id) =>
          fc.record({
            id: fc.constant(id),
            orgId: orgArb,
            // agreementNo may equal another agreement's id
            agreementNo: fc.oneof(idArb, fc.constantFrom('AG-001', 'AG-002')),
            customerName: fc.constantFrom('X', 'Y'),
            // '' or a possibly dangling quotation id
            quotationId: fc.oneof(fc.constant(''), qIdArb),
          }),
        ),
      ) as fc.Arbitrary<AgreementLite[]>,
      quotations: fc.tuple(
        ...quotationIds.map((id) =>
          fc.record({
            id: fc.constant(id),
            orgId: orgArb,
            number: fc.constant('QT-' + id),
            phase: fc.constantFrom('Awaiting', 'Tender', 'Won', 'Lost') as fc.Arbitrary<QuotationLite['phase']>,
            customerName: fc.constantFrom('X', 'Y'),
          }),
        ),
      ) as fc.Arbitrary<QuotationLite[]>,
      pickedId: idArb,
      raw: fc.oneof(
        fc.constant(''),
        fc.stringMatching(/^[ \t\n]{0,3}$/),
        idArb,
        idArb.chain((id) =>
          fc
            .tuple(fc.stringMatching(/^[ \t\n]{0,3}$/), fc.stringMatching(/^[ \t\n]{0,3}$/))
            .map(([l, r]) => l + id + r),
        ),
        fc.constantFrom('AG-001', 'AG-002'),
        fc.string({ maxLength: 8 }),
      ),
    }),
  );

type Expected = { ok: true; agreementId?: string } | { ok: false; code: ValidationCode };

function oracle(
  raw: string,
  orgId: string,
  crmActive: boolean,
  agreements: AgreementLite[],
  quotations: QuotationLite[],
): Expected {
  const v = raw.trim();
  if (v === '') return { ok: true };
  const matches = agreements.filter((a) => a.id === v);
  if (matches.length === 0) return { ok: false, code: 'NOT_FOUND' };
  const a = matches[0];
  if (a.orgId !== orgId) return { ok: false, code: 'ORG_MISMATCH' };
  if (a.quotationId === '') return { ok: false, code: 'NO_QUOTATION' };
  if (crmActive && !quotations.some((q) => q.id === a.quotationId && q.orgId === orgId)) {
    return { ok: false, code: 'QUOTATION_NOT_FOUND' };
  }
  return { ok: true, agreementId: a.id };
}

describe('hireLinkCore.validateAgreementRef', () => {
  it('Property 4: matches the oracle and does not mutate inputs', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const snapshot = {
          orgId: sc.activeOrg,
          crmActive: sc.crmActive,
          agreements: sc.agreements,
          quotations: sc.quotations,
        };
        const before = JSON.stringify(snapshot);
        const actual = validateAgreementRef(sc.raw, snapshot);
        const expected = oracle(sc.raw, sc.activeOrg, sc.crmActive, sc.agreements, sc.quotations);

        expect(actual.ok).toBe(expected.ok);
        if (actual.ok && expected.ok) {
          expect(actual.agreementId).toBe(expected.agreementId);
        } else if (!actual.ok && !expected.ok) {
          expect(actual.code).toBe(expected.code);
          expect(actual.message).toBe(VALIDATION_MESSAGES[expected.code]);
        }
        expect(JSON.stringify(snapshot)).toBe(before);
      }),
      { numRuns: 300 },
    );
  });

  it('does not resolve an agreement by agreementNo', () => {
    const r = validateAgreementRef('AG-1', {
      orgId: 'org-a',
      crmActive: false,
      agreements: [
        { id: 'ha-1', orgId: 'org-a', agreementNo: 'AG-1', customerName: 'X', quotationId: 'q-1' },
      ],
      quotations: [],
    });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
