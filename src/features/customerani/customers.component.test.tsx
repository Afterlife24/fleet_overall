// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));

import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useCrmStore } from '@/store/crmStore';
import { useCustomerStore } from '@/store/customerStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { registryCustomers } from '@/services/services';
import type { Quotation } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';
import type { TaxInvoice } from '@/types/taxinvoice';
import { CrmPage } from '@/features/crm/CrmPage';
import { CustomerLinksSection } from './CustomerLinksSection';
import { CustomerANIFormDialog } from './CustomerANIFormDialog';

const ORG = 'org-cust-test';
const ABC_ID = 'CUST-000125';

function setOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId, name: 'Tester', email: 't@example.com', role: 'Managing Director' } as unknown as AuthUser,
    isAuthenticated: true,
  });
}

const quotation = (over: Partial<Quotation>): Quotation => ({
  id: 'q-1', orgId: ORG, number: 'QT-2026-0001', opportunity: 'ABC - Boom Lift', hireAgreementNo: 'HA-2026-00001',
  customerId: ABC_ID, customerName: 'ABC Company LLC', amount: 5000, currency: 'AED', phase: 'Won', history: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
} as Quotation);

const agreement = (over: Partial<HireAgreement>): HireAgreement => ({
  id: 'ha-1', orgId: ORG, agreementNo: 'HA-2026-00001', customerId: ABC_ID, customerName: 'ABC Company LLC',
  status: 'On Hire', ...over,
} as unknown as HireAgreement);

const invoice = (over: Partial<TaxInvoice>): TaxInvoice => ({
  id: 'inv-1', orgId: ORG, quotationId: 'q-1', quotationNumber: 'QT-2026-0001', invoiceNo: 'QT-2026-0001/01',
  customerId: ABC_ID, status: 'Sent', currency: 'AED', totalAmount: 1050, ...over,
} as unknown as TaxInvoice);

beforeEach(() => {
  toasts.error.mockClear();
  toasts.success.mockClear();
  setOrg(ORG);
  useCustomerStore.setState({ customers: [], seedMarkers: {} });
  useCrmStore.setState({ quotations: [] });
  useHireAgreementStore.setState({ agreements: [] } as never);
  useTaxInvoiceStore.setState({ invoices: [] } as never);
});
afterEach(cleanup);

describe('Customer detail links', () => {
  it('lists the linked quotations, hire agreements and invoices of the customer in the company', () => {
    useCrmStore.setState({
      quotations: [
        quotation({}),
        quotation({ id: 'q-2', number: 'QT-2026-0002', phase: 'Awaiting' }),
        quotation({ id: 'q-3', number: 'QT-2026-0003', customerId: 'CUST-000248' }),
        quotation({ id: 'q-4', number: 'QT-2026-0004', orgId: 'other-org' }),
      ],
    });
    useHireAgreementStore.setState({
      agreements: [
        agreement({}),
        agreement({ id: 'ha-2', agreementNo: 'HA-2026-00002', customerId: 'CUST-000248' }),
      ],
    } as never);
    useTaxInvoiceStore.setState({
      invoices: [invoice({}), invoice({ id: 'inv-2', invoiceNo: 'QT-2026-0003/01', customerId: 'CUST-000248' })],
    } as never);

    render(<CustomerLinksSection customerId={ABC_ID} />);

    const q = within(screen.getByTestId('customer-links-quotations'));
    expect(q.getByText('QT-2026-0001')).toBeTruthy();
    expect(q.getByText('QT-2026-0002')).toBeTruthy();
    expect(q.queryByText('QT-2026-0003')).toBeNull();
    expect(q.queryByText('QT-2026-0004')).toBeNull();
    const a = within(screen.getByTestId('customer-links-hire-agreements'));
    expect(a.getByText('HA-2026-00001')).toBeTruthy();
    expect(a.queryByText('HA-2026-00002')).toBeNull();
    const i = within(screen.getByTestId('customer-links-invoices'));
    expect(i.getByText('QT-2026-0001/01')).toBeTruthy();
    expect(i.queryByText('QT-2026-0003/01')).toBeNull();
  });

  it('shows None in each section when the customer has no links', () => {
    render(<CustomerLinksSection customerId="CUST-000532" />);
    for (const id of ['quotations', 'hire-agreements', 'invoices']) {
      expect(within(screen.getByTestId(`customer-links-${id}`)).getByText('None')).toBeTruthy();
    }
  });
});

describe('CRM create with a variant customer name', () => {
  function createQuotation(customerName: string, opportunity: string) {
    fireEvent.click(screen.getByRole('button', { name: /new quotation/i }));
    fireEvent.change(screen.getByPlaceholderText(/ABC Company - Boom Lift Hire/), { target: { value: opportunity } });
    fireEvent.change(screen.getByPlaceholderText('Company / contact name'), { target: { value: customerName } });
    const amount = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  }

  it.each(['abc company', 'ABC Company LLC.', '  Abc  COMPANY l.l.c. '])(
    'reuses the existing customer for "%s" and creates no duplicate',
    async (variant) => {
      render(<MemoryRouter><CrmPage /></MemoryRouter>);
      const before = registryCustomers(ORG);
      const abc = before.find((c) => c.customerId === ABC_ID)!;
      expect(abc.customerName).toBe('ABC Company LLC');

      createQuotation(variant, 'Variant name test');

      await waitFor(() => expect(toasts.success).toHaveBeenCalled());
      expect(useCustomerStore.getState().forOrg(ORG)).toHaveLength(before.length);
      const created = useCrmStore.getState().quotations.find((q) => q.opportunity === 'Variant name test')!;
      expect(created.customerId).toBe(ABC_ID);
      expect(created.customerName).toBe('ABC Company LLC');
      expect(useCustomerStore.getState().forOrg(ORG).find((c) => c.id === abc.id)).toEqual(abc);
    },
  );

  it('creates exactly one customer for a name that matches none', async () => {
    render(<MemoryRouter><CrmPage /></MemoryRouter>);
    const before = registryCustomers(ORG).length;
    createQuotation('Brand New Holdings', 'New name test');
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const after = useCustomerStore.getState().forOrg(ORG);
    expect(after).toHaveLength(before + 1);
    const fresh = after.find((c) => c.customerName === 'Brand New Holdings')!;
    const created = useCrmStore.getState().quotations.find((q) => q.opportunity === 'New name test')!;
    expect(created.customerId).toBe(fresh.customerId);
  });
});

describe('Customers app duplicate create', () => {
  it('shows the duplicate error and adds no customer', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const before = registryCustomers(ORG).length;
    render(
      <QueryClientProvider client={qc}>
        <CustomerANIFormDialog open onClose={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByPlaceholderText(/Al Futtaim/), { target: { value: 'abc company' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 100412345600003'), { target: { value: '100000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Customer' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(String(toasts.error.mock.calls[0][0])).toMatch(/already exists/i);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(useCustomerStore.getState().forOrg(ORG)).toHaveLength(before);
  });
});
