// Feature: won-quotation-invoicing, Property 1: Only Won quotations of the active organisation are invoiceable
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  listInvoiceableQuotations,
  validateInvoiceRequest,
  type InvoicingSnapshot,
  type QuotationLite,
  type AgreementLite,
} from '../../invoiceRulesCore';

type Phase = 'Awaiting' | 'Tender' | 'Lost' | 'Won';

const ACTIVE_ORG = 'org-a';
const phaseArb = fc.constantFrom<Phase>('Awaiting', 'Tender', 'Lost', 'Won');
const orgArb = fc.constantFrom(ACTIVE_ORG, 'org-b', 'org-c');

const quotationsArb = fc
  .array(fc.record({ phase: phaseArb, orgId: orgArb }), { minLength: 0, maxLength: 12 })
  .map((rows): QuotationLite[] =>
    rows.map((r, i) => ({
      id: `q${i}`,
      orgId: r.orgId,
      number: `QT-2026-${String(i + 1).padStart(4, '0')}`,
      phase: r.phase,
      customerName: `Customer ${i}`,
      customerId: `c${i}`,
      amount: 1000 + i,
    })),
  );

function agreementFor(q: QuotationLite): AgreementLite {
  return {
    id: `ha-${q.id}`, orgId: q.orgId, agreementNo: `HA-${q.id}`, quotationId: q.id, status: 'Active',
    hireStartDate: '2026-01-01', hireEndDate: '2026-12-31',
    customerId: q.customerId, customerName: q.customerName, customerTrn: '', attn: '', contactNumber: '',
    customerEmail: '', billingAddress: '', deliveryLocation: '', paymentTerms: '30', paymentMethod: 'Bank',
    securityDeposit: 0, equipmentName: 'Lift', equipmentModel: 'M1', serialNumber: 'S1', workingHeight: '10m',
    capacity: '200kg', monthlyRental: 1000, transportationCharges: 100,
  };
}

function snapshot(quotations: QuotationLite[]): InvoicingSnapshot {
  return {
    orgId: ACTIVE_ORG, today: '2026-01-01', crmActive: true,
    quotations, agreements: quotations.map(agreementFor), invoices: [], sequenceByQuotation: {},
  };
}

describe('Property 1: Won gate', () => {
  it('lists exactly the Won quotations of the active org', () => {
    fc.assert(
      fc.property(quotationsArb, (qs) => {
        const listed = listInvoiceableQuotations(snapshot(qs)).map((q) => q.id).sort();
        const expected = qs.filter((q) => q.orgId === ACTIVE_ORG && q.phase === 'Won').map((q) => q.id).sort();
        expect(listed).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects every non-Won quotation of the active org with NOT_WON', () => {
    fc.assert(
      fc.property(quotationsArb, fc.constantFrom('Continuous Hire', 'Off-Hire'), (qs, invoiceType) => {
        const s = snapshot(qs);
        for (const q of qs.filter((x) => x.orgId === ACTIVE_ORG && x.phase !== 'Won')) {
          const r = validateInvoiceRequest(s, { quotationId: q.id, invoiceType, periodEnd: '2026-01-31' });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('NOT_WON');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('never accepts quotations of another org, whatever their phase', () => {
    fc.assert(
      fc.property(quotationsArb, (qs) => {
        const s = snapshot(qs);
        for (const q of qs.filter((x) => x.orgId !== ACTIVE_ORG)) {
          const r = validateInvoiceRequest(s, { quotationId: q.id, invoiceType: 'Continuous Hire', periodEnd: '2026-01-31' });
          expect(r.ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('accepts a listed Won quotation that has a valid agreement', () => {
    fc.assert(
      fc.property(quotationsArb, (qs) => {
        const s = snapshot(qs);
        for (const q of listInvoiceableQuotations(s)) {
          const r = validateInvoiceRequest(s, { quotationId: q.id, invoiceType: 'Continuous Hire', periodEnd: '2026-01-31' });
          expect(r.ok).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
