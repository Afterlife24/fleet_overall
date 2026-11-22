// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));

import { InvoicePage } from './InvoicePage';
import { useAuthStore, JA_ORG_ID, type AuthUser } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { seedQuotations } from '@/services/mock/quotations';
import { hireAgreements as seedAgreements } from '@/services/mock/hireagreement';
import { taxInvoices as seedInvoices } from '@/services/mock/taxinvoice';
import { RULE_MESSAGES } from '@/services/invoiceRulesCore';
import type { Quotation } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';
import type { TaxInvoice } from '@/types/taxinvoice';

// Requirements 2.6, 4.1, 5.2, 9.4, 9.9

const QID = 'qt-page-won';
const QID_NO_AGREEMENT = 'qt-page-noag';
const AGREEMENT_NO = 'HA-PAGE-001';
const HIRE_START = '2030-01-01';
const HIRE_END = '2030-03-31';
const LEGACY_NO = 'INV-LEGACY-777';

function quotation(id: string, number: string): Quotation {
  return { ...seedQuotations[0], id, orgId: JA_ORG_ID, number, phase: 'Won' };
}

function agreement(): HireAgreement {
  return {
    ...seedAgreements[0],
    id: 'ha-page-1',
    orgId: JA_ORG_ID,
    quotationId: QID,
    agreementNo: AGREEMENT_NO,
    status: 'Active',
    hireStartDate: HIRE_START,
    hireEndDate: HIRE_END,
  } as HireAgreement;
}

function legacyInvoice(): TaxInvoice {
  return {
    ...seedInvoices[0],
    id: 'inv-legacy-1',
    orgId: JA_ORG_ID,
    invoiceNo: LEGACY_NO,
    hireAgreementNo: '',
    hirePeriod: '',
    quotationId: undefined,
    quotationNumber: undefined,
    invoiceType: undefined,
    periodStart: undefined,
    periodEnd: undefined,
  } as TaxInvoice;
}

function renderPage(state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
        <InvoicePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

function quotationSelect(): HTMLSelectElement {
  return screen.getByText('Won quotation').parentElement!.querySelector('select') as HTMLSelectElement;
}

async function openNewAndChoose(id: string) {
  fireEvent.click(await screen.findByRole('button', { name: /New Invoice/ }));
  await screen.findByText('Create from Won quotation');
  await waitFor(() => expect(within(quotationSelect()).getAllByRole('option').length).toBeGreaterThan(1));
  fireEvent.change(quotationSelect(), { target: { value: id } });
}

describe('InvoicePage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      user: { orgId: JA_ORG_ID, name: 'Tester', email: 't@example.com', role: 'Admin' } as unknown as AuthUser,
      isAuthenticated: true,
    });
    useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
    useCrmStore.setState({
      quotations: [quotation(QID, 'QT-2030-0001'), quotation(QID_NO_AGREEMENT, 'QT-2030-0002')],
    });
    useHireAgreementStore.setState({ agreements: [agreement()], seededOrgs: [JA_ORG_ID] });
    useTaxInvoiceStore.setState({
      invoices: [legacyInvoice()],
      seededOrgs: [JA_ORG_ID],
      demoLinkedOrgs: [JA_ORG_ID],
      sequenceByQuotation: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the period end input only for Continuous Hire (4.1, 5.2)', async () => {
    renderPage();
    await openNewAndChoose(QID);

    const end = (await screen.findByLabelText('Period end')) as HTMLInputElement;
    // Continuous Hire bills monthly: default end = one month after the period start.
    await waitFor(() => expect(end.value).toBe('2030-01-31'));

    fireEvent.click(screen.getByRole('radio', { name: 'Off-Hire' }));
    await waitFor(() => expect(screen.queryByLabelText('Period end')).toBeNull());

    fireEvent.click(screen.getByRole('radio', { name: 'Continuous Hire' }));
    expect(await screen.findByLabelText('Period end')).toBeTruthy();
  });

  it('disables Save until a valid preview exists and shows the rule message otherwise (4.1)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Invoice/ }));
    await screen.findByText('Create from Won quotation');
    expect(saveButton().disabled).toBe(true);

    await waitFor(() => expect(within(quotationSelect()).getAllByRole('option').length).toBeGreaterThan(2));
    fireEvent.change(quotationSelect(), { target: { value: QID_NO_AGREEMENT } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(RULE_MESSAGES.NO_AGREEMENT);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(quotationSelect(), { target: { value: QID } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a legacy invoice as editable and pickAgreement fills it (9.4)', async () => {
    renderPage();
    const row = (await screen.findByText(LEGACY_NO)).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    await screen.findByText(`Editing ${LEGACY_NO}`);

    // Legacy form: no quotation panel, free-text agreement dropdown.
    expect(screen.queryByText('Create from Won quotation')).toBeNull();
    const option = await screen.findByRole('option', { name: new RegExp(AGREEMENT_NO) });
    const select = option.parentElement as HTMLSelectElement;
    fireEvent.change(select, { target: { value: AGREEMENT_NO } });

    await waitFor(() => expect(screen.getByDisplayValue(`${HIRE_START} – ${HIRE_END}`)).toBeTruthy());
    expect(select.value).toBe(AGREEMENT_NO);
  });

  it('asks to choose a Won quotation when the prefill has the old shape (2.6, 9.9)', async () => {
    renderPage({ prefill: { customerName: 'Someone', opportunity: 'Boom Lift' } });

    expect(await screen.findByText('Create from Won quotation')).toBeTruthy();
    expect(screen.getByText('Choose a Won quotation to create the invoice.')).toBeTruthy();
    expect(quotationSelect().value).toBe('');
    expect(saveButton().disabled).toBe(true);
  });
});
