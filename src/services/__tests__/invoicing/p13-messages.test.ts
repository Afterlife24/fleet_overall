import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  RULE_MESSAGES,
  ruleFail,
  validateInvoiceRequest,
  type AgreementLite,
  type InvoiceLite,
  type InvoicingSnapshot,
  type QuotationLite,
  type RuleCode,
} from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 13: Every rule code has a reason message
// **Validates: Requirements 1.8**

const ALL_CODES = Object.keys(RULE_MESSAGES) as RuleCode[];
const codeArb = fc.constantFrom(...ALL_CODES);

const ORG = 'org-a';
const dateArb = fc
  .integer({ min: 0, max: 120 })
  .map((n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10));
const maybeDate = fc.oneof(dateArb, fc.constant(''), fc.constant('2026-02-30'), fc.constant('garbage'));

const quotationArb: fc.Arbitrary<QuotationLite> = fc.record({
  id: fc.constantFrom('q1', 'q2'),
  orgId: fc.constantFrom(ORG, 'org-b'),
  number: fc.constantFrom('QT-2026-0001', 'QT-2026-0002'),
  phase: fc.constantFrom('Won', 'Lead', 'Lost', 'Draft') as fc.Arbitrary<QuotationLite['phase']>,
  customerName: fc.constant('Cust'),
  customerId: fc.constant('c1'),
  amount: fc.constant(100),
});

const agreementArb: fc.Arbitrary<AgreementLite> = fc
  .record({
    id: fc.uuid(),
    orgId: fc.constantFrom(ORG, 'org-b'),
    agreementNo: fc.constantFrom('HA-1', 'HA-2', 'HA-3'),
    quotationId: fc.constantFrom('q1', 'q2'),
    status: fc.constantFrom('Active', 'Cancelled', 'Draft'),
    hireStartDate: maybeDate,
    hireEndDate: maybeDate,
  })
  .map((a) => ({
    ...a,
    customerId: 'c1', customerName: 'Cust', customerTrn: '', attn: '', contactNumber: '',
    customerEmail: '', billingAddress: '', deliveryLocation: '', paymentTerms: '30',
    paymentMethod: 'Bank', securityDeposit: 0, equipmentName: 'E', equipmentModel: 'M',
    serialNumber: 'S', workingHeight: '10m', capacity: '200kg', monthlyRental: 100,
    transportationCharges: 10,
  }));

const invoiceArb: fc.Arbitrary<InvoiceLite> = fc.record({
  id: fc.uuid(),
  orgId: fc.constantFrom(ORG, 'org-b'),
  quotationId: fc.constantFrom('q1', 'q2'),
  invoiceType: fc.constantFrom('Continuous Hire', 'Off-Hire') as fc.Arbitrary<InvoiceLite['invoiceType']>,
  status: fc.constantFrom('Draft', 'Sent', 'Cancelled') as fc.Arbitrary<InvoiceLite['status']>,
  periodStart: dateArb,
  periodEnd: dateArb,
  sequence: fc.integer({ min: 1, max: 99 }),
});

const snapshotArb: fc.Arbitrary<InvoicingSnapshot> = fc.record({
  orgId: fc.constant(ORG),
  today: fc.constant('2026-03-01'),
  crmActive: fc.boolean(),
  quotations: fc.array(quotationArb, { maxLength: 3 }),
  agreements: fc.array(agreementArb, { maxLength: 3 }),
  invoices: fc.array(invoiceArb, { maxLength: 4 }),
  sequenceByQuotation: fc.dictionary(fc.constantFrom('q1', 'q2'), fc.integer({ min: 0, max: 99 })),
});

const requestArb = fc.record(
  {
    quotationId: fc.constantFrom('q1', 'q2', 'missing', ''),
    invoiceType: fc.constantFrom('Continuous Hire', 'Off-Hire', 'Other', ''),
    periodEnd: maybeDate,
    periodStart: maybeDate,
  },
  { requiredKeys: [] },
);

describe('Property 13: Every rule code has a reason message', () => {
  it('RULE_MESSAGES holds a non-empty message for every code', () => {
    fc.assert(
      fc.property(codeArb, (code) => {
        const msg = RULE_MESSAGES[code];
        expect(typeof msg).toBe('string');
        expect(msg.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('ruleFail carries the code and its message, with optional detail appended', () => {
    fc.assert(
      fc.property(codeArb, fc.option(fc.string({ minLength: 1 }), { nil: undefined }), (code, detail) => {
        const r = ruleFail(code, detail);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.code).toBe(code);
        expect(r.message.trim().length).toBeGreaterThan(0);
        expect(r.message.startsWith(RULE_MESSAGES[code])).toBe(true);
        if (detail === undefined) expect(r.message).toBe(RULE_MESSAGES[code]);
      }),
      { numRuns: 200 },
    );
  });

  it('every failed validateInvoiceRequest result carries the message of its code', () => {
    let failures = 0;
    fc.assert(
      fc.property(snapshotArb, requestArb, (snap, req) => {
        const r = validateInvoiceRequest(snap, req);
        if (r.ok) return;
        failures++;
        expect(ALL_CODES).toContain(r.code);
        expect(r.message.trim().length).toBeGreaterThan(0);
        expect(r.message.startsWith(RULE_MESSAGES[r.code])).toBe(true);
      }),
      { numRuns: 300 },
    );
    expect(failures).toBeGreaterThan(0);
  });
});
