import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  buildInvoiceDraft,
  formatInvoiceNo,
  type AgreementLite,
  type InvoicePlan,
  type InvoicingSnapshot,
  type QuotationLite,
} from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 8: Carry-over copies source data and links to the quotation
// **Validates: Requirements 3.6, 4.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9**

const text = fc.string({ minLength: 0, maxLength: 20 });
const money = fc.integer({ min: 0, max: 10_000_000 }).map((c) => c / 100);
const isoDate = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2090, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

const paymentTerms = fc.oneof(
  fc.integer({ min: 1, max: 365 }).map(String),
  fc.integer({ min: 1, max: 365 }).map((n) => `${n} days`),
  fc.constantFrom('', 'Cash', 'on receipt', 'N/A'),
);

const agreement: fc.Arbitrary<AgreementLite> = fc.record({
  id: fc.uuid(),
  orgId: fc.uuid(),
  agreementNo: fc.string({ minLength: 1, maxLength: 12 }),
  quotationId: fc.uuid(),
  status: fc.constant('Active'),
  hireStartDate: isoDate,
  hireEndDate: isoDate,
  customerId: fc.uuid(),
  customerName: text,
  customerTrn: text,
  attn: text,
  contactNumber: text,
  customerEmail: text,
  billingAddress: text,
  deliveryLocation: text,
  paymentTerms,
  paymentMethod: text,
  securityDeposit: money,
  equipmentName: text,
  equipmentModel: text,
  serialNumber: text,
  workingHeight: text,
  capacity: text,
  monthlyRental: money,
  transportationCharges: money,
});

const scenario = fc
  .record({
    ag: agreement,
    number: fc.string({ minLength: 1, maxLength: 14 }),
    quotationId: fc.uuid(),
    orgId: fc.uuid(),
    sequence: fc.integer({ min: 1, max: 99 }),
    type: fc.constantFrom<'Continuous Hire' | 'Off-Hire'>('Continuous Hire', 'Off-Hire'),
    start: isoDate,
    end: isoDate,
    today: isoDate,
  })
  .map((r) => {
    const quotation: QuotationLite = {
      id: r.quotationId,
      orgId: r.orgId,
      number: r.number,
      phase: 'Won',
      customerName: r.ag.customerName,
      customerId: r.ag.customerId,
      amount: 0,
    };
    const ag: AgreementLite = { ...r.ag, orgId: r.orgId, quotationId: r.quotationId };
    const plan: InvoicePlan = {
      quotation,
      agreement: ag,
      invoiceType: r.type,
      periodStart: r.start,
      periodEnd: r.end,
      sequence: r.sequence,
      invoiceNo: formatInvoiceNo(r.number, r.sequence),
    };
    const snapshot: InvoicingSnapshot = {
      orgId: r.orgId,
      today: r.today,
      crmActive: true,
      quotations: [quotation],
      agreements: [ag],
      invoices: [],
      sequenceByQuotation: {},
    };
    return { plan, snapshot };
  });

describe('Property 8: Carry-over copies source data and links to the quotation', () => {
  it('links, numbering, period and agreement data are carried over', () => {
    fc.assert(
      fc.property(scenario, ({ plan, snapshot }) => {
        const d = buildInvoiceDraft(plan, snapshot);
        const h = plan.agreement;
        expect(d.quotationId).toBe(plan.quotation.id);
        expect(d.quotationNumber).toBe(plan.quotation.number);
        expect(d.sequence).toBe(plan.sequence);
        expect(d.invoiceType).toBe(plan.invoiceType);
        expect(d.periodStart).toBe(plan.periodStart);
        expect(d.periodEnd).toBe(plan.periodEnd);
        expect(d.hireAgreementId).toBe(h.id);
        expect(d.orgId).toBe(snapshot.orgId);
        expect(d.invoiceNo).toBe(formatInvoiceNo(plan.quotation.number, plan.sequence));
        expect(d.customerId).toBe(h.customerId);
        expect(d.customerName).toBe(h.customerName);
        expect(d.hireAgreementNo).toBe(h.agreementNo);
        expect(d.deliveryLocation).toBe(h.deliveryLocation);
        expect(d.paymentTerms).toBe(h.paymentTerms);
        expect(d.paymentMethod).toBe(h.paymentMethod);
        expect(d.securityDeposit).toBe(h.securityDeposit);
        expect(d.equipmentQty).toBe(1);
        expect(d.equipmentRate).toBe(h.monthlyRental);
        expect(d.transportationQty).toBe(1);
        expect(d.transportationRate).toBe(h.transportationCharges);
        expect(d.hirePeriod).toBe(`${plan.periodStart} – ${plan.periodEnd}`);
        expect(d.status).toBe('Draft');
      }),
      { numRuns: 200 },
    );
  });

  it('dueDate is the invoice date plus numeric payment terms (30 when none)', () => {
    fc.assert(
      fc.property(scenario, ({ plan, snapshot }) => {
        const d = buildInvoiceDraft(plan, snapshot);
        expect(d.invoiceDate).toBe(snapshot.today);
        const n = parseInt(plan.agreement.paymentTerms, 10);
        const terms = Number.isFinite(n) && n > 0 ? n : 30;
        expect(d.dueDate).toBe(addDays(d.invoiceDate, terms));
      }),
      { numRuns: 200 },
    );
  });

  it('example: terms "45 days" and no terms', () => {
    const { plan, snapshot } = fc.sample(scenario, 1)[0];
    const withTerms = { ...plan, agreement: { ...plan.agreement, paymentTerms: '45 days' } };
    const none = { ...plan, agreement: { ...plan.agreement, paymentTerms: '' } };
    expect(buildInvoiceDraft(withTerms, snapshot).dueDate).toBe(addDays(snapshot.today, 45));
    expect(buildInvoiceDraft(none, snapshot).dueDate).toBe(addDays(snapshot.today, 30));
  });
});
