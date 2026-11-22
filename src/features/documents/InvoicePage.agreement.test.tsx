// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(), toastError: vi.fn(), toastInfo: vi.fn(), toastWarning: vi.fn(),
}));

import { InvoicePage } from './InvoicePage';
import { useAuthStore, JA_ORG_ID, type AuthUser } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore, assignMissingTypes, pickInvoiceType } from '@/store/taxInvoiceStore';
import { seedQuotations } from '@/services/mock/quotations';
import { hireAgreements as seedAgreements } from '@/services/mock/hireagreement';
import { taxInvoices as seedInvoices } from '@/services/mock/taxinvoice';
import type { HireAgreement } from '@/types/hireagreement';
import type { TaxInvoice } from '@/types/taxinvoice';

const QID = 'qt-ag-won';
const agreement = (id: string, no: string, quotationId: string): HireAgreement => ({
  ...seedAgreements[0], id, orgId: JA_ORG_ID, quotationId, agreementNo: no, status: 'Active',
  customerName: `Customer ${no}`, hireStartDate: '2030-01-01', hireEndDate: '2030-06-30',
} as HireAgreement);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><InvoicePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Invoice Details: hire agreement dropdown on every invoice', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: { orgId: JA_ORG_ID, name: 'T' } as unknown as AuthUser, isAuthenticated: true });
    useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
    useCrmStore.setState({ quotations: [{ ...seedQuotations[0], id: QID, orgId: JA_ORG_ID, number: 'QT-2030-0007', phase: 'Won' }] });
    useHireAgreementStore.setState({
      agreements: [agreement('ha-a', 'HA-AG-WON', QID), agreement('ha-b', 'HA-AG-FREE', '')],
      seededOrgs: [JA_ORG_ID],
    });
    useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [JA_ORG_ID], demoLinkedOrgs: [JA_ORG_ID], sequenceByQuotation: {} });
  });
  afterEach(() => cleanup());

  it('new invoice: picking a hire agreement autofills the form, selects its Won quotation and the monthly period', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Invoice/ }));
    const select = (await screen.findByLabelText('Hire agreement')) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: 'HA-AG-WON' } });

    await waitFor(() => expect((screen.getByLabelText('Quotation') as HTMLSelectElement).value).toBe(QID));
    expect(screen.getByDisplayValue('Customer HA-AG-WON')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Billing period end') as HTMLInputElement).value).toBe('2030-01-31'));
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement).disabled).toBe(false));
  });

  it('new invoice: an agreement without a Won quotation is autofilled but cannot be saved', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Invoice/ }));
    const select = (await screen.findByLabelText('Hire agreement')) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: 'HA-AG-FREE' } });

    expect(await screen.findByText('This hire agreement is not linked to a quotation, so it cannot be invoiced.')).toBeTruthy();
    expect(screen.getByDisplayValue('Customer HA-AG-FREE')).toBeTruthy();
    expect((screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('existing invoices keep the hire agreement dropdown and show their invoice type', async () => {
    const legacy = { ...seedInvoices[0], id: 'inv-x', orgId: JA_ORG_ID, invoiceNo: 'INV-X', quotationId: undefined } as TaxInvoice;
    useTaxInvoiceStore.setState({ invoices: [legacy] });
    renderPage();
    fireEvent.click(await screen.findByText('INV-X'));
    const select = (await screen.findByLabelText('Hire agreement')) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect((screen.getByLabelText('Invoice type') as HTMLSelectElement).value).toBe(legacy.invoiceType);
  });
});

describe('every saved invoice gets an invoice type', () => {
  it('fills missing types from the id and the period from the hire period text', () => {
    const rows = [
      { ...seedInvoices[0], id: 'a1', invoiceType: undefined, periodStart: undefined, periodEnd: undefined, hirePeriod: '2026-01-01 – 2026-01-31' },
      { ...seedInvoices[0], id: 'b2', invoiceType: 'Off-Hire' as const },
    ] as TaxInvoice[];
    const out = assignMissingTypes({ invoices: rows, seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
    expect(out.invoices[0].invoiceType).toBe(pickInvoiceType('a1'));
    expect(out.invoices[0].periodStart).toBe('2026-01-01');
    expect(out.invoices[0].periodEnd).toBe('2026-01-31');
    expect(out.invoices[1]).toEqual(rows[1]);
    expect(new Set(['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map(pickInvoiceType)).size).toBe(2);
  });
});