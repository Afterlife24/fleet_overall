import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays, compareDates, monthlyPeriodEnd, suggestContinuousEnd, validateInvoiceRequest,
  type AgreementLite, type InvoicingSnapshot,
} from '../../invoiceRulesCore';
import { taxInvoices } from '../../mock/taxinvoice';

const ORG = 'org-a';
const QID = 'q-1';
const agreementBase: Omit<AgreementLite, 'hireStartDate' | 'hireEndDate'> = {
  id: 'ag-1', orgId: ORG, agreementNo: 'HA-0001', quotationId: QID, status: 'Active',
  customerId: 'c', customerName: 'C', customerTrn: '', attn: '', contactNumber: '', customerEmail: '',
  billingAddress: '', deliveryLocation: '', paymentTerms: '', paymentMethod: '', securityDeposit: 0,
  equipmentName: '', equipmentModel: '', serialNumber: '', workingHeight: '', capacity: '',
  monthlyRental: 0, transportationCharges: 0,
};
const snap = (today: string, start: string, end: string): InvoicingSnapshot => ({
  orgId: ORG, today, crmActive: true,
  quotations: [{ id: QID, orgId: ORG, number: 'QT-1', phase: 'Won', customerName: 'C', customerId: 'c', amount: 0 }],
  agreements: [{ ...agreementBase, hireStartDate: start, hireEndDate: end }],
  invoices: [], sequenceByQuotation: {},
});

describe('Continuous Hire bills monthly', () => {
  it('examples', () => {
    expect(monthlyPeriodEnd('2026-11-15')).toBe('2026-12-14');
    expect(monthlyPeriodEnd('2026-12-01')).toBe('2026-12-31');
    expect(monthlyPeriodEnd('2026-01-31')).toBe('2026-02-27');
    expect(monthlyPeriodEnd('2028-01-30')).toBe('2028-02-28');
    expect(monthlyPeriodEnd('2026-11-15', '2026-12-01')).toBe('2026-12-01');
  });

  it('the monthly end is after the start, within ~31 days, and capped at the hire end', () => {
    const day = fc.integer({ min: 0, max: 3000 }).map((n) => addDays('2026-01-01', n));
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 400 }), (start, span) => {
        const hireEnd = addDays(start, span);
        const end = monthlyPeriodEnd(start, hireEnd);
        expect(compareDates(end, start)).toBeGreaterThanOrEqual(0);
        expect(compareDates(end, addDays(start, 30))).toBeLessThanOrEqual(0);
        expect(compareDates(end, hireEnd)).toBeLessThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it('suggests one month from the derived start', () => {
    expect(suggestContinuousEnd(snap('2026-01-01', '2026-11-15', '2027-05-14'), QID)).toBe('2026-12-14');
  });
});

describe('Off-Hire is generated on or after the hire end date', () => {
  it('is blocked before the hire end date and allowed from it', () => {
    const before = validateInvoiceRequest(snap('2026-12-13', '2026-11-14', '2026-12-14'), { quotationId: QID, invoiceType: 'Off-Hire' });
    expect(before.ok).toBe(false);
    if (!before.ok) {
      expect(before.code).toBe('OFF_HIRE_NOT_DUE');
      expect(before.message).toContain('2026-12-14');
    }
    for (const today of ['2026-12-14', '2027-01-10']) {
      const r = validateInvoiceRequest(snap(today, '2026-11-14', '2026-12-14'), { quotationId: QID, invoiceType: 'Off-Hire' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.periodEnd).toBe('2026-12-14');
    }
  });

  it('does not affect Continuous Hire', () => {
    const r = validateInvoiceRequest(snap('2026-01-01', '2026-11-14', '2026-12-14'), {
      quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2026-12-13',
    });
    expect(r.ok).toBe(true);
  });
});

describe('demo invoices', () => {
  it('every demo invoice has a type and a billing period', () => {
    expect(taxInvoices.length).toBeGreaterThan(0);
    for (const inv of taxInvoices) {
      expect(['Continuous Hire', 'Off-Hire']).toContain(inv.invoiceType);
      expect(inv.periodStart).toBeTruthy();
      expect(inv.periodEnd).toBeTruthy();
      expect(inv.hirePeriod).toBe(`${inv.periodStart} – ${inv.periodEnd}`);
      if (inv.invoiceType === 'Off-Hire') expect(inv.invoiceDate).toBe(inv.periodEnd);
    }
    expect(taxInvoices.some((i) => i.invoiceType === 'Off-Hire')).toBe(true);
    expect(taxInvoices.some((i) => i.hireAgreementNo === 'HA-2026-005')).toBe(false);
  });
});