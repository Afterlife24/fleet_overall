// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));
const api = vi.hoisted(() => ({
  customers: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn() },
  quotations: { list: vi.fn(), history: vi.fn(), changePhase: vi.fn(), create: vi.fn() },
  agreements: { list: vi.fn() },
  branches: { list: vi.fn() },
}));
vi.mock('@/services/api/customers', () => ({ customersApi: api.customers }));
vi.mock('@/services/api/quotations', () => ({ quotationsApi: api.quotations }));
vi.mock('@/services/api/hireAgreements', () => ({ hireAgreementsApi: api.agreements }));
vi.mock('@/services/api/company', () => ({ branchesApi: api.branches }));

import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useCrmStore } from '@/store/crmStore';
import { useOrgStore } from '@/store/orgStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { ApiClientError } from '@/services/api/http';
import type { Quotation } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';
import type { TaxInvoice } from '@/types/taxinvoice';
import {
  customerDto, page, quotationDto, renderScreen, setSessionReady, staleError, unavailableError, branchDto,
} from '@/test-support/apiScreens';
import { CrmPage } from '@/features/crm/CrmPage';
import { CustomerLinksSection } from './CustomerLinksSection';
import { CustomerANIFormDialog } from './CustomerANIFormDialog';
import { CustomerANIPage } from './CustomerANIPage';

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
  vi.clearAllMocks();
  toasts.error.mockClear();
  toasts.success.mockClear();
  setOrg(ORG);
  setSessionReady();
  useOrgStore.getState().activateApp(ORG, 'customer_ani');
  useOrgStore.getState().markAppOnboarded(ORG, 'customer_ani');
  useCrmStore.setState({ quotations: [] });
  useHireAgreementStore.setState({ agreements: [] } as never);
  useTaxInvoiceStore.setState({ invoices: [] } as never);
  api.customers.list.mockResolvedValue(page([customerDto(), customerDto({ id: 'c-2', customerCode: 'CUST-000248', name: 'Arabtec Construction LLC' })]));
  api.quotations.list.mockResolvedValue(page([]));
  api.quotations.history.mockResolvedValue({ items: [] });
  api.agreements.list.mockResolvedValue(page([]));
  api.branches.list.mockResolvedValue(page([branchDto('b-1', 'Dubai HQ')]));
});
afterEach(cleanup);

describe('Customer detail links (read adapter copies)', () => {
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

describe('CRM create picks an existing API customer', () => {
  it('creates the quotation for the selected customer id with an idempotency submission id', async () => {
    api.quotations.create.mockImplementation(async (body: { opportunity: string }) => quotationDto('N1', 'AWAITING', { opportunity: body.opportunity }));
    renderScreen(<CrmPage />);
    fireEvent.click(await screen.findByRole('button', { name: /new quotation/i }));
    fireEvent.change(await screen.findByLabelText('Customer'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByPlaceholderText(/ABC Company - Boom Lift Hire/), { target: { value: 'Variant name test' } });
    fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const [body, submissionId] = api.quotations.create.mock.calls[0];
    expect(body).toMatchObject({ customerId: 'c-1', opportunity: 'Variant name test', amount: 1200 });
    expect(typeof submissionId).toBe('string');
    expect(api.customers.create).not.toHaveBeenCalled(); // no customer is invented by the browser
  });

  it('keeps the dialog and the entered values and shows the correlation id when the API rejects the create', async () => {
    api.quotations.create.mockRejectedValue(new ApiClientError({ code: 'VALIDATION_ERROR', message: 'Customer is not in your branch scope', status: 422, correlationId: 'corr-q1' }));
    renderScreen(<CrmPage />);
    fireEvent.click(await screen.findByRole('button', { name: /new quotation/i }));
    fireEvent.change(await screen.findByLabelText('Customer'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByPlaceholderText(/ABC Company - Boom Lift Hire/), { target: { value: 'Keep me' } });
    fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('Customer is not in your branch scope');
    expect(err.textContent).toContain('corr-q1');
    expect((screen.getByPlaceholderText(/ABC Company - Boom Lift Hire/) as HTMLInputElement).value).toBe('Keep me');
    expect((screen.getByLabelText('Customer') as HTMLSelectElement).value).toBe('c-1');
    expect(toasts.success).not.toHaveBeenCalled();
  });
});

describe('Customers screen (API)', () => {
  it('shows a loading state, then the customers from the API', async () => {
    api.customers.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderScreen(<CustomerANIPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    cleanup();

    api.customers.list.mockResolvedValue(page([customerDto(), customerDto({ id: 'c-2', customerCode: 'CUST-000248', name: 'Arabtec Construction LLC' })]));
    renderScreen(<CustomerANIPage />);
    expect(await screen.findByText('Arabtec Construction LLC')).toBeTruthy();
    expect(screen.getByText('ABC Company LLC')).toBeTruthy();
  });

  it('shows the service-unavailable message naming /api/v1 and no customers on 503', async () => {
    api.customers.list.mockRejectedValue(unavailableError());
    renderScreen(<CustomerANIPage />);
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(screen.queryByText('ABC Company LLC')).toBeNull();
  });
});

describe('Customer form (API)', () => {
  const openForm = (editRecord?: Parameters<typeof CustomerANIFormDialog>[0]['editRecord']) =>
    renderScreen(<CustomerANIFormDialog open onClose={() => {}} editRecord={editRecord} />);

  it('shows the duplicate error with the correlation id, keeps the entered values and creates nothing', async () => {
    api.customers.create.mockRejectedValue(new ApiClientError({
      code: 'DUPLICATE', message: 'A customer with this name already exists', status: 409, correlationId: 'corr-dup',
      fieldErrors: { name: 'duplicate' },
    }));
    openForm();
    fireEvent.change(await screen.findByPlaceholderText(/Al Futtaim/), { target: { value: 'abc company' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 100412345600003'), { target: { value: '100000000000001' } });
    fireEvent.change(screen.getByPlaceholderText('+971 50 1234567'), { target: { value: '+971500000000' } });
    fireEvent.change(screen.getByPlaceholderText(/42 Sheikh Zayed/), { target: { value: 'Dubai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Customer' }));

    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('already exists');
    expect(err.textContent).toContain('corr-dup');
    expect((screen.getByPlaceholderText(/Al Futtaim/) as HTMLInputElement).value).toBe('abc company');
    expect((screen.getByPlaceholderText('e.g. 100412345600003') as HTMLInputElement).value).toBe('100000000000001');
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('on 409 STALE_VERSION offers a reload that refreshes the row version and keeps the entered values', async () => {
    api.customers.update.mockRejectedValueOnce(staleError());
    api.customers.get.mockResolvedValue(customerDto({ rowVersion: 9, name: 'Changed by someone else' }));
    openForm({
      id: 'c-1', fleetLogId: '', aniRavaliActive: false, customerId: ABC_ID, customerName: 'ABC Company LLC', trn: '1',
      address: 'Dubai', attl: 0, contactNumber: '+971', status: 'Active', branchName: '', rowVersion: 3,
      createdAt: '', updatedAt: '',
    });
    const name = await screen.findByPlaceholderText(/Al Futtaim/);
    fireEvent.change(name, { target: { value: 'My edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await screen.findByText(/changed by someone else since you opened it/i);
    expect(api.customers.update.mock.calls[0].slice(0, 2)).toEqual(['c-1', 3]);
    fireEvent.click(screen.getByRole('button', { name: /reload latest/i }));
    await waitFor(() => expect(api.customers.get).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(screen.queryByTestId('api-error')).toBeNull());
    expect((screen.getByPlaceholderText(/Al Futtaim/) as HTMLInputElement).value).toBe('My edit');

    api.customers.update.mockResolvedValue(customerDto({ rowVersion: 10 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.customers.update).toHaveBeenCalledTimes(2));
    expect(api.customers.update.mock.calls[1].slice(0, 2)).toEqual(['c-1', 9]);
  });

  it('names /api/v1 when the service is unavailable and keeps the values', async () => {
    api.customers.create.mockRejectedValue(unavailableError());
    openForm();
    fireEvent.change(await screen.findByPlaceholderText(/Al Futtaim/), { target: { value: 'Keep Me LLC' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 100412345600003'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('+971 50 1234567'), { target: { value: '+971500000000' } });
    fireEvent.change(screen.getByPlaceholderText(/42 Sheikh Zayed/), { target: { value: 'Dubai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Customer' }));
    expect((await screen.findByTestId('api-error')).textContent).toContain('/api/v1');
    expect((screen.getByPlaceholderText(/Al Futtaim/) as HTMLInputElement).value).toBe('Keep Me LLC');
  });
});
