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

import { toastError } from '@/lib/toast-helper';
import { HireAgreementPage } from './HireAgreementPage';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useBookingStore } from '@/store/bookingStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { hireAgreements as seedAgreements } from '@/services/mock/hireagreement';
import type { Quotation } from '@/types/quotation';
import type { Booking } from '@/types/booking';
import type { HireAgreement } from '@/types/hireagreement';

const ABC = 'ABC Company LLC';
const DEF = 'DEF Company LLC';
const AGREEMENT_NO = 'HA-TEST-001';

function quotation(id: string, customerName: string): Quotation {
  return {
    id,
    orgId: JA_ORG_ID,
    number: `QT-${id}`,
    opportunity: `${customerName} - Boom Lift`,
    hireAgreementNo: 'HA-0001',
    customerId: 'c',
    customerName,
    amount: 100,
    currency: 'AED',
    phase: 'Awaiting',
    history: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as Quotation;
}

function agreement(): HireAgreement {
  return {
    ...seedAgreements[0],
    id: 'ha-test-1',
    orgId: JA_ORG_ID,
    quotationId: '',
    agreementNo: AGREEMENT_NO,
    customerName: ABC,
  } as HireAgreement;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HireAgreementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function quotationSelect(): HTMLSelectElement {
  const label = screen.getByText('Quotation:');
  return label.parentElement!.querySelector('select') as HTMLSelectElement;
}

async function openSeededAgreement() {
  const cell = await screen.findByText(AGREEMENT_NO);
  const row = cell.closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  await screen.findByText(`Editing ${AGREEMENT_NO}`);
}

describe('HireAgreementPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(toastError).mockClear();
    useAuthStore.setState({ user: null } as never);
    useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
    useCrmStore.setState({ quotations: [quotation('qt-abc', ABC), quotation('qt-def', DEF)] });
    useBookingStore.setState({ userBookings: [] });
    useHireAgreementStore.setState({ agreements: [agreement()], seededOrgs: [JA_ORG_ID] });
  });

  afterEach(() => {
    cleanup();
  });

  it('disables the quotation select and shows a notice when CRM is inactive (2.5)', async () => {
    useOrgStore.getState().deactivateApp(JA_ORG_ID, 'crm');
    renderPage();
    await openSeededAgreement();

    await waitFor(() => expect(quotationSelect().disabled).toBe(true));
    expect(screen.getByText('CRM app is inactive')).toBeTruthy();
  });

  it('shows an error and saves nothing when the quotation belongs to another company (2.6)', async () => {
    renderPage();
    await openSeededAgreement();

    await waitFor(() => expect(within(quotationSelect()).getByText(/QT-qt-abc/)).toBeTruthy());
    fireEvent.change(quotationSelect(), { target: { value: 'qt-abc' } });

    // Switch the customer while the quotation stays selected.
    const customerSelect = screen.getByDisplayValue(ABC) as HTMLSelectElement;
    fireEvent.change(customerSelect, { target: { value: DEF } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Quotation belongs to a different company than this agreement'),
    );
    const stored = useHireAgreementStore.getState().getById('ha-test-1')!;
    expect(stored.quotationId).toBe('');
    expect(stored.customerName).toBe(ABC);
  });

  it('stores an empty quotationId when no quotation is selected (2.4)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Agreement/ }));
    await screen.findByText('New Agreement', { selector: 'span' });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(useHireAgreementStore.getState().agreements).toHaveLength(2));
    const created = useHireAgreementStore.getState().agreements.find((a) => a.id !== 'ha-test-1')!;
    expect(created.quotationId).toBe('');
    expect(created.orgId).toBe(JA_ORG_ID);
  });

  it('shows the referencing bookings and keeps the agreement when delete is blocked (3.4)', async () => {
    useBookingStore.setState({
      userBookings: [
        { id: 'bk-user-1', reference: 'BK-2025-0001', hireAgreementId: 'ha-test-1' } as Booking,
        { id: 'bk-user-2', reference: 'BK-2025-0002', hireAgreementId: 'ha-test-1' } as Booking,
      ],
    });
    renderPage();

    const cell = await screen.findByText(AGREEMENT_NO);
    const row = cell.closest('tr') as HTMLElement;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]); // trash button

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Cannot delete: used by bookings BK-2025-0001, BK-2025-0002'),
    );
    expect(useHireAgreementStore.getState().getById('ha-test-1')).toBeTruthy();
  });
});
