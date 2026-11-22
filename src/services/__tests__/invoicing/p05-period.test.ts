import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  nextPeriodStart,
  validateInvoiceRequest,
  type AgreementLite,
  type InvoiceLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 5: Billing period is derived from the hire dates and previous periods
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.1**

const BASE = '2000-01-01';
const ORG = 'org-1';
const QID = 'q-1';

function agreement(hireStartDate: string, hireEndDate: string): AgreementLite {
  return {
    id: 'ha-1', orgId: ORG, agreementNo: 'HA-1', quotationId: QID, status: 'Active',
    hireStartDate, hireEndDate,
    customerId: 'c-1', customerName: 'Cust', customerTrn: '', attn: '', contactNumber: '',
    customerEmail: '', billingAddress: '', deliveryLocation: '', paymentTerms: '30',
    paymentMethod: '', securityDeposit: 0, equipmentName: '', equipmentModel: '',
    serialNumber: '', workingHeight: '', capacity: '', monthlyRental: 0, transportationCharges: 0,
  };
}

function snapshot(ag: AgreementLite, invoices: InvoiceLite[]): InvoicingSnapshot {
  return {
    orgId: ORG, today: BASE, crmActive: true,
    quotations: [{ id: QID, orgId: ORG, number: 'QT-2026-0001', phase: 'Won', customerName: 'Cust', customerId: 'c-1', amount: 0 }],
    agreements: [ag],
    invoices,
    sequenceByQuotation: { [QID]: invoices.length },
  };
}

interface Scenario {
  ag: AgreementLite;
  invoices: InvoiceLite[];
  start: string;
  span: number;
}

/** Valid agreement plus a contiguous chain of earlier Continuous Hire invoices (shuffled order). */
const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    startOffset: fc.integer({ min: 0, max: 40000 }),
    lengths: fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 5 }),
    span: fc.integer({ min: 0, max: 400 }),
    reverse: fc.boolean(),
  })
  .map(({ startOffset, lengths, span, reverse }) => {
    const hireStart = addDays(BASE, startOffset);
    let cursor = hireStart;
    let invoices: InvoiceLite[] = lengths.map((len, i) => {
      const periodStart = cursor;
      const periodEnd = addDays(periodStart, len - 1);
      cursor = addDays(periodEnd, 1);
      return {
        id: `inv-${i}`, orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire',
        status: 'Draft', periodStart, periodEnd, sequence: i + 1,
      };
    });
    if (reverse) invoices = [...invoices].reverse();
    const hireEnd = addDays(cursor, span);
    return { ag: agreement(hireStart, hireEnd), invoices, start: cursor, span };
  });

describe('Property 5: Billing period derivation', () => {
  it('derived start is hire start without invoices, else day after the latest periodEnd', () => {
    fc.assert(
      fc.property(scenario, ({ ag, invoices, start }) => {
        expect(nextPeriodStart(ag, invoices)).toBe(start);
        if (invoices.length === 0) expect(start).toBe(ag.hireStartDate);
      }),
      { numRuns: 200 },
    );
  });

  it('Continuous Hire: periodEnd accepted exactly when start <= end <= hireEnd, and stored unchanged', () => {
    fc.assert(
      fc.property(scenario, fc.integer({ min: -30, max: 440 }), (sc, delta) => {
        const end = addDays(sc.start, delta);
        const res = validateInvoiceRequest(snapshot(sc.ag, sc.invoices), {
          quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: end,
        });
        const inRange = end >= sc.start && end <= sc.ag.hireEndDate;
        expect(res.ok).toBe(inRange);
        if (res.ok) {
          expect(res.value.periodStart).toBe(sc.start);
          expect(res.value.periodEnd).toBe(end);
        } else if (end < sc.start) {
          expect(res.code).toBe('END_BEFORE_START');
        } else {
          expect(res.code).toBe('END_AFTER_HIRE_END');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Continuous Hire: missing or malformed periodEnd fails with END_DATE_REQUIRED / INVALID_DATE', () => {
    const bad = fc.constantFrom('2026-02-30', '2026-13-01', '2026-1-1', 'abc', '2026/01/01', '0000-00-00');
    fc.assert(
      fc.property(scenario, bad, (sc, text) => {
        const s = snapshot(sc.ag, sc.invoices);
        const missing = validateInvoiceRequest(s, { quotationId: QID, invoiceType: 'Continuous Hire' });
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.code).toBe('END_DATE_REQUIRED');
        const invalid = validateInvoiceRequest(s, { quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: text });
        expect(invalid.ok).toBe(false);
        if (!invalid.ok) expect(invalid.code).toBe('INVALID_DATE');
      }),
      { numRuns: 100 },
    );
  });

  it('supplied periodStart different from the derived start fails with OVERLAP (earlier) or GAP (later)', () => {
    fc.assert(
      fc.property(
        scenario,
        fc.integer({ min: -60, max: 60 }).filter((d) => d !== 0),
        (sc, delta) => {
          const periodStart = addDays(sc.start, delta);
          const res = validateInvoiceRequest(snapshot(sc.ag, sc.invoices), {
            quotationId: QID, invoiceType: 'Continuous Hire',
            periodStart, periodEnd: sc.ag.hireEndDate,
          });
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.code).toBe(delta < 0 ? 'OVERLAP' : 'GAP');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('supplied periodStart equal to the derived start is accepted', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const res = validateInvoiceRequest(snapshot(sc.ag, sc.invoices), {
          quotationId: QID, invoiceType: 'Continuous Hire',
          periodStart: sc.start, periodEnd: sc.ag.hireEndDate,
        });
        expect(res.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('example: no invoices, hire 2026-01-01..2026-03-31, end 2026-01-31', () => {
    const ag = agreement('2026-01-01', '2026-03-31');
    const res = validateInvoiceRequest(snapshot(ag, []), {
      quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2026-01-31',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect([res.value.periodStart, res.value.periodEnd]).toEqual(['2026-01-01', '2026-01-31']);
  });
});
