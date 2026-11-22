import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveSourceAgreement,
  type AgreementLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

const ORG = 'org-a';
const QID = 'q-1';

function mkAgreement(i: number, orgId: string, quotationId: string, status: string): AgreementLite {
  return {
    id: `ag-${i}`, orgId, agreementNo: `HA-${String(i).padStart(4, '0')}`, quotationId, status,
    hireStartDate: '2026-01-01', hireEndDate: '2026-03-31',
    customerId: 'c', customerName: 'C', customerTrn: '', attn: '', contactNumber: '', customerEmail: '',
    billingAddress: '', deliveryLocation: '', paymentTerms: '', paymentMethod: '', securityDeposit: 0,
    equipmentName: '', equipmentModel: '', serialNumber: '', workingHeight: '', capacity: '',
    monthlyRental: 0, transportationCharges: 0,
  };
}

function snap(agreements: AgreementLite[]): InvoicingSnapshot {
  return {
    orgId: ORG, today: '2026-02-01', crmActive: true,
    quotations: [], agreements, invoices: [], sequenceByQuotation: {},
  };
}

const orgArb = fc.constantFrom(ORG, 'org-b');
const qArb = fc.constantFrom(QID, 'q-2', 'q-3');
const statusArb = fc.constantFrom('Draft', 'Active', 'Completed', 'Cancelled');

const agreementsArb = fc
  .array(fc.record({ orgId: orgArb, quotationId: qArb, status: statusArb }), { maxLength: 12 })
  .map((rows) => rows.map((r, i) => mkAgreement(i + 1, r.orgId, r.quotationId, r.status)));

const isCandidate = (a: AgreementLite) =>
  a.orgId === ORG && a.quotationId === QID && a.status !== 'Cancelled';

// Feature: won-quotation-invoicing, Property 2: Source agreement resolution is deterministic
describe('Property 2: Source agreement resolution is deterministic', () => {
  // **Validates: Requirements 2.1, 2.2, 2.3**
  it('returns the single candidate, NO_AGREEMENT, or AMBIGUOUS_AGREEMENT listing all candidates', () => {
    fc.assert(
      fc.property(agreementsArb, (agreements) => {
        const candidates = agreements.filter(isCandidate);
        const r = resolveSourceAgreement(snap(agreements), QID);
        if (candidates.length === 1) {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.value).toBe(candidates[0]);
        } else if (candidates.length === 0) {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('NO_AGREEMENT');
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.code).toBe('AMBIGUOUS_AGREEMENT');
            for (const c of candidates) expect(r.message).toContain(c.agreementNo);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('does not depend on the order of the agreements', () => {
    fc.assert(
      fc.property(
        agreementsArb.chain((a) => fc.tuple(fc.constant(a), fc.shuffledSubarray(a, { minLength: a.length, maxLength: a.length }))),
        ([agreements, shuffled]) => {
          const r1 = resolveSourceAgreement(snap(agreements), QID);
          const r2 = resolveSourceAgreement(snap(shuffled), QID);
          expect(r2).toEqual(r1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns NO_AGREEMENT for an empty quotation id', () => {
    fc.assert(
      fc.property(agreementsArb, (agreements) => {
        const r = resolveSourceAgreement(snap(agreements.map((a) => ({ ...a, quotationId: '' }))), '');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('NO_AGREEMENT');
      }),
      { numRuns: 100 },
    );
  });
});
