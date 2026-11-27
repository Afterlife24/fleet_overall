// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));
const api = vi.hoisted(() => ({
  quotations: { list: vi.fn() },
  customers: { list: vi.fn() },
  agreements: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  branches: { list: vi.fn() },
}));
vi.mock('@/services/api/quotations', () => ({ quotationsApi: api.quotations }));
vi.mock('@/services/api/customers', () => ({ customersApi: api.customers }));
vi.mock('@/services/api/hireAgreements', () => ({ hireAgreementsApi: api.agreements }));
vi.mock('@/services/api/company', () => ({ branchesApi: api.branches }));

import { toastError, toastSuccess } from '@/lib/toast-helper';
import { HireAgreementPage } from './HireAgreementPage';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useBookingStore } from '@/store/bookingStore';
import { ApiClientError } from '@/services/api/http';
import type { Booking } from '@/types/booking';
import {
  agreementDto, branchDto, customerDto, page, quotationDto, renderScreen, setSessionReady, staleError, unavailableError,
} from '@/test-support/apiScreens';

const ABC = 'ABC Company LLC';
const AGREEMENT_NO = 'HA-2026-ha1';

function quotationSelect(): HTMLSelectElement {
  return screen.getByText('Quotation:').parentElement!.querySelector('select') as HTMLSelectElement;
}

async function openAgreement() {
  const cell = await screen.findByText(AGREEMENT_NO);
  fireEvent.click(within(cell.closest('tr') as HTMLElement).getByRole('button', { name: 'Edit' }));
  await screen.findByText(`Editing ${AGREEMENT_NO}`);
}

async function startNewAgreement() {
  fireEvent.click(await screen.findByRole('button', { name: /New Agreement/ }));
  await screen.findByText('New Agreement', { selector: 'span' });
  fireEvent.change(screen.getByDisplayValue('— Select Customer —'), { target: { value: ABC } });
  await waitFor(() => expect(within(quotationSelect()).getByText(/QT-2026-q1/)).toBeTruthy());
  fireEvent.change(quotationSelect(), { target: { value: 'q1' } });
}

describe('HireAgreementPage (API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null } as never);
    useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
    useBookingStore.setState({ userBookings: [] });
    setSessionReady();
    api.customers.list.mockResolvedValue(page([customerDto()]));
    api.quotations.list.mockResolvedValue(page([quotationDto('q1', 'WON'), quotationDto('q2', 'AWAITING')]));
    api.agreements.list.mockResolvedValue(page([agreementDto('ha1', 'q2')]));
    api.branches.list.mockResolvedValue(page([branchDto('b-1', 'Dubai HQ')]));
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a loading state while the agreements load', () => {
    api.agreements.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderScreen(<HireAgreementPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('lists the agreements read from the API', async () => {
    renderScreen(<HireAgreementPage />);
    expect(await screen.findByText(AGREEMENT_NO)).toBeTruthy();
    expect(screen.getByText('AED 1,260.00')).toBeTruthy();
  });

  it('disables the quotation select and shows a notice when CRM is inactive', async () => {
    useOrgStore.getState().deactivateApp(JA_ORG_ID, 'crm');
    renderScreen(<HireAgreementPage />);
    await openAgreement();
    await waitFor(() => expect(quotationSelect().disabled).toBe(true));
    expect(screen.getByText('CRM app is inactive')).toBeTruthy();
  });

  it('creates an agreement with the quotation and customer ids and shows the totals from the server response', async () => {
    api.agreements.create.mockResolvedValue(agreementDto('ha9', 'q1', { agreementNo: 'HA-2026-0009', subtotal: '1500.00', vatAmount: '75.00', totalAmount: '1575.00' }));
    renderScreen(<HireAgreementPage />);
    await startNewAgreement();
    expect(screen.getByTestId('agreement-total').textContent).toBe('—'); // no client-side calculation
    fireEvent.change(screen.getByPlaceholderText('Equipment Name'), { target: { value: 'Boom Lift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.agreements.create).toHaveBeenCalledTimes(1));
    const [body, submissionId] = api.agreements.create.mock.calls[0];
    expect(body).toMatchObject({ quotationId: 'q1', customerId: 'c-1', status: 'Active', equipmentName: 'Boom Lift' });
    expect(body).not.toHaveProperty('totalAmount');
    expect(body).not.toHaveProperty('subtotal');
    expect(typeof submissionId).toBe('string');
    await waitFor(() => expect(screen.getByTestId('agreement-total').textContent).toBe('1,575.00'));
    expect(screen.getByTestId('agreement-subtotal').textContent).toBe('1,500.00');
    expect(screen.getByTestId('agreement-vat').textContent).toBe('75.00');
    expect(toastSuccess).toHaveBeenCalledWith('Agreement created');
  });

  it('on AGREEMENT_EXISTS shows the server message, keeps the values and offers the existing agreement', async () => {
    api.agreements.list.mockResolvedValue(page([agreementDto('ha1', 'q1')]));
    api.agreements.create.mockRejectedValue(new ApiClientError({
      code: 'AGREEMENT_EXISTS', message: 'This quotation already has a hire agreement', status: 409, correlationId: 'corr-ae',
    }));
    renderScreen(<HireAgreementPage />);
    await startNewAgreement();
    fireEvent.change(screen.getByPlaceholderText('Equipment Name'), { target: { value: 'Keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('already has a hire agreement');
    expect(err.textContent).toContain('corr-ae');
    expect((screen.getByPlaceholderText('Equipment Name') as HTMLInputElement).value).toBe('Keep this');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Open existing agreement ${AGREEMENT_NO}`) }));
    await screen.findByText(`Editing ${AGREEMENT_NO}`);
  });

  it('sends the row version as the update precondition and shows the server totals after the save', async () => {
    api.agreements.update.mockResolvedValue(agreementDto('ha1', 'q2', { rowVersion: 3, totalAmount: '2100.00' }));
    renderScreen(<HireAgreementPage />);
    await openAgreement();
    fireEvent.change(screen.getByPlaceholderText('Equipment Name'), { target: { value: 'Scissor Lift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.agreements.update).toHaveBeenCalledTimes(1));
    const [id, rowVersion, patch] = api.agreements.update.mock.calls[0];
    expect([id, rowVersion]).toEqual(['ha1', 2]);
    expect(patch).toMatchObject({ equipmentName: 'Scissor Lift' });
    expect(patch).not.toHaveProperty('totalAmount');
    await waitFor(() => expect(screen.getByTestId('agreement-total').textContent).toBe('2,100.00'));
  });

  it('on 409 STALE_VERSION offers a reload that keeps what the user typed', async () => {
    api.agreements.update.mockRejectedValueOnce(staleError());
    api.agreements.get.mockResolvedValue(agreementDto('ha1', 'q2', { rowVersion: 7 }));
    renderScreen(<HireAgreementPage />);
    await openAgreement();
    fireEvent.change(screen.getByPlaceholderText('Equipment Name'), { target: { value: 'My edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/changed by someone else/i);
    fireEvent.click(screen.getByRole('button', { name: /reload latest/i }));
    await waitFor(() => expect(screen.queryByTestId('api-error')).toBeNull());
    expect((screen.getByPlaceholderText('Equipment Name') as HTMLInputElement).value).toBe('My edit');

    api.agreements.update.mockResolvedValue(agreementDto('ha1', 'q2', { rowVersion: 8 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.agreements.update).toHaveBeenCalledTimes(2));
    expect(api.agreements.update.mock.calls[1].slice(0, 2)).toEqual(['ha1', 7]);
  });

  it('cancels (never deletes) an agreement with If-Match', async () => {
    api.agreements.update.mockResolvedValue(agreementDto('ha1', 'q2', { status: 'Cancelled', rowVersion: 3 }));
    renderScreen(<HireAgreementPage />);
    const cell = await screen.findByText(AGREEMENT_NO);
    const buttons = within(cell.closest('tr') as HTMLElement).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.agreements.update).toHaveBeenCalledTimes(1));
    expect(api.agreements.update.mock.calls[0]).toEqual(['ha1', 2, { status: 'Cancelled' }]);
  });

  it('shows the referencing bookings and does not cancel when planner bookings use the agreement', async () => {
    useBookingStore.setState({
      userBookings: [
        { id: 'bk-user-1', reference: 'BK-2025-0001', hireAgreementId: 'ha1' } as Booking,
        { id: 'bk-user-2', reference: 'BK-2025-0002', hireAgreementId: 'ha1' } as Booking,
      ],
    });
    renderScreen(<HireAgreementPage />);
    const cell = await screen.findByText(AGREEMENT_NO);
    const buttons = within(cell.closest('tr') as HTMLElement).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Cannot delete: used by bookings BK-2025-0001, BK-2025-0002'),
    );
    expect(api.agreements.update).not.toHaveBeenCalled();
  });

  it('shows the service-unavailable message naming /api/v1 and no agreements on 503', async () => {
    api.agreements.list.mockRejectedValue(unavailableError());
    renderScreen(<HireAgreementPage />);
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(screen.queryByText(AGREEMENT_NO)).toBeNull();
  });
});
