// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import type { Quotation } from '@/types/quotation';
import type { TaxInvoice } from '@/types/taxinvoice';
import { toInvoicePrefill } from './crmRules';
import { QuotationDetail } from './CrmShared';

const ORG = 'org-test';

function quotation(over: Partial<Quotation> = {}): Quotation {
  return {
    id: 'q-1', orgId: ORG, number: 'QT-2026-0001', opportunity: 'ABC - Boom Lift Hire',
    hireAgreementNo: 'HA-2026-00001', customerId: 'c-1', customerName: 'ABC Company',
    amount: 5000, currency: 'AED', phase: 'Won', history: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as Quotation;
}

function invoice(over: Partial<TaxInvoice>): TaxInvoice {
  return {
    id: 'inv-1', orgId: ORG, quotationId: 'q-1', quotationNumber: 'QT-2026-0001',
    invoiceType: 'Continuous Hire', periodStart: '2026-11-01', periodEnd: '2026-11-15', sequence: 1,
    invoiceNo: 'QT-2026-0001/01', status: 'Sent', currency: 'AED', totalAmount: 1050,
    ...over,
  } as TaxInvoice;
}

function setOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId, name: 'Tester', email: 't@example.com', role: 'Managing Director' } as unknown as AuthUser,
    isAuthenticated: true,
  });
}

beforeEach(() => {
  setOrg(ORG);
  useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
});
afterEach(cleanup);

describe('toInvoicePrefill', () => {
  it('includes quotationId and keeps existing fields', () => {
    const q = quotation();
    expect(toInvoicePrefill(q)).toEqual({
      quotationId: 'q-1', customerId: 'c-1', customerName: 'ABC Company',
      amount: 5000, quotationNumber: 'QT-2026-0001',
    });
  });
});

describe('QuotationDetail invoices section', () => {
  it('shows "No invoices yet" when none are linked', () => {
    render(<QuotationDetail q={quotation()} onClose={() => {}} />);
    expect(screen.getByText('No invoices yet')).toBeTruthy();
  });

  it('lists only invoices linked to the quotation in the active org', () => {
    useTaxInvoiceStore.setState({
      invoices: [
        invoice({ id: 'a', invoiceNo: 'QT-2026-0001/01' }),
        invoice({ id: 'b', invoiceNo: 'QT-2026-0001/02', sequence: 2, status: 'Draft', periodStart: '2026-11-16', periodEnd: '2026-11-30' }),
        invoice({ id: 'c', invoiceNo: 'QT-2026-0002/01', quotationId: 'q-2' }),
        invoice({ id: 'd', invoiceNo: 'QT-2026-0001/09', orgId: 'other-org' }),
      ],
    });
    render(<QuotationDetail q={quotation()} onClose={() => {}} />);
    expect(screen.getByText('QT-2026-0001/01')).toBeTruthy();
    expect(screen.getByText('QT-2026-0001/02')).toBeTruthy();
    expect(screen.getByText(/2026-11-16 to 2026-11-30/)).toBeTruthy();
    expect(screen.queryByText('QT-2026-0002/01')).toBeNull();
    expect(screen.queryByText('QT-2026-0001/09')).toBeNull();
    expect(screen.queryByText('No invoices yet')).toBeNull();
  });
});
