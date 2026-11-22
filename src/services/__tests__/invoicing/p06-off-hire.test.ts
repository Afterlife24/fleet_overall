import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  validateInvoiceRequest,
  type AgreementLite,
  type InvoiceLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

const ORG = 'org-a';
const QID = 'q-1';
const BASE = '2026-01-01';

const agreement: Omit<AgreementLite, 'hireStartDate' | 'hireEndDate'> = {
  id: 'ag-1', orgId: ORG, agreementNo: 'HA-0001', quotationId: QID, status: 'Active',
  customerId: 'c', customerName: 'C', customerTrn: '', attn: '', contactNumber: '', customerEmail: '',
  billingAddress: '', deliveryLocation: '', paymentTerms: '', paymentMethod: '', securityDeposit: 0,
  equipmentName: '', equipmentModel: '', serialNumber: '', workingHeight: '', capacity: '',
  monthlyRental: 0, transportationCharges: 0,
};

function snap(hireStart: string, hireEnd: string, invoices: InvoiceLite[]): InvoicingSnapshot {
  return {
    orgId: ORG, today: '2099-12-31', crmActive: true, // after every hire end: Off-Hire is due
    quotations: [{ id: QID, orgId: ORG, number: 'QT-2026-0001', phase: 'Won', customerName: 'C', customerId: 'c', amount: 0 }],
    agreements: [{ ...agreement, hireStartDate: hireStart, hireEndDate: hireEnd }],
    invoices,
    sequenceByQuotation: {},
  };
}

/** Contiguous Continuous Hire invoices starting at hireStart, each covering `len` days. */
function chain(hireStart: string, lens: number[]): InvoiceLite[] {
  let start = hireStart;
  return lens.map((len, i) => {
    const end = addDays(start, len - 1);
    const inv: InvoiceLite = {
      id: `inv-${i + 1}`, orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire',
      status: 'Draft', periodStart: start, periodEnd: end, sequence: i + 1,
    };
    start = addDays(end, 1);
    return inv;
  });
}

const lensArb = fc.array(fc.integer({ min: 1, max: 40 }), { maxLength: 6 });
const spanArb = fc.integer({ min: 0, max: 400 }); // hireEnd = hireStart + span days

// Feature: won-quotation-invoicing, Property 6: Off-Hire uses the hire end date and is final
describe('Property 6: Off-Hire uses the hire end date and is final', () => {
  // **Validates: Requirements 5.1, 5.3, 5.4, 5.5, 5.6, 5.7**
  it('yields periodEnd = hire end when unbilled days remain, otherwise NOTHING_TO_BILL', () => {
    fc.assert(
      fc.property(spanArb, lensArb, fc.boolean(), (span, lens, supplyEnd) => {
        const hireEnd = addDays(BASE, span);
        const invoices = chain(BASE, lens);
        const latest = invoices.length ? invoices[invoices.length - 1].periodEnd! : undefined;
        const r = validateInvoiceRequest(snap(BASE, hireEnd, invoices), {
          quotationId: QID, invoiceType: 'Off-Hire', ...(supplyEnd ? { periodEnd: hireEnd } : {}),
        });
        if (latest === undefined || latest < hireEnd) {
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.value.periodEnd).toBe(hireEnd);
            expect(r.value.invoiceType).toBe('Off-Hire');
          }
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('NOTHING_TO_BILL');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a supplied end date that differs from the hire end with END_DATE_NOT_ALLOWED', () => {
    fc.assert(
      fc.property(
        spanArb.filter((s) => s >= 1), lensArb, fc.integer({ min: -30, max: 30 }).filter((d) => d !== 0),
        (span, lens, delta) => {
          const hireEnd = addDays(BASE, span);
          const invoices = chain(BASE, lens);
          const latest = invoices.length ? invoices[invoices.length - 1].periodEnd! : undefined;
          fc.pre(latest === undefined || latest < hireEnd);
          const r = validateInvoiceRequest(snap(BASE, hireEnd, invoices), {
            quotationId: QID, invoiceType: 'Off-Hire', periodEnd: addDays(hireEnd, delta),
          });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('END_DATE_NOT_ALLOWED');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects every request with ALREADY_OFF_HIRED while an Off-Hire is active, and accepts again once it is Cancelled', () => {
    const typeArb = fc.constantFrom('Continuous Hire', 'Off-Hire');
    const offStatusArb = fc.constantFrom<InvoiceLite['status']>('Draft', 'Sent', 'Paid');
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 400 }), fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 3 }),
        typeArb, offStatusArb, fc.option(fc.integer({ min: 0, max: 400 }), { nil: undefined }),
        (span, lens, invoiceType, offStatus, endOffset) => {
          const hireEnd = addDays(BASE, span);
          const prior = chain(BASE, lens); // total <= 30 days, so < hireEnd
          const offStart = addDays(prior.length ? prior[prior.length - 1].periodEnd! : addDays(BASE, -1), 1);
          const off: InvoiceLite = {
            id: 'inv-off', orgId: ORG, quotationId: QID, invoiceType: 'Off-Hire', status: offStatus,
            periodStart: offStart, periodEnd: hireEnd, sequence: prior.length + 1,
          };
          const req = {
            quotationId: QID, invoiceType,
            ...(endOffset !== undefined ? { periodEnd: addDays(BASE, endOffset) } : {}),
          };

          const blocked = validateInvoiceRequest(snap(BASE, hireEnd, [...prior, off]), req);
          expect(blocked.ok).toBe(false);
          if (!blocked.ok) expect(blocked.code).toBe('ALREADY_OFF_HIRED');

          const cancelled = validateInvoiceRequest(
            snap(BASE, hireEnd, [...prior, { ...off, status: 'Cancelled' }]),
            { quotationId: QID, invoiceType: 'Off-Hire' },
          );
          expect(cancelled.ok).toBe(true);
          if (cancelled.ok) {
            expect(cancelled.value.periodStart).toBe(offStart);
            expect(cancelled.value.periodEnd).toBe(hireEnd);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
