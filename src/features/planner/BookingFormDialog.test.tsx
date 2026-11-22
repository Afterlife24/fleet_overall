// @vitest-environment jsdom
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  customers: [{ id: 'c1', name: 'Acme LLC' }],
  machines: [
    { id: 'm1', assetNumber: 'A-1', make: 'CAT', model: '320', status: 'Available', branchId: 'b1', workingHeight: 10 },
  ],
  branches: [{ id: 'b1', name: 'Dubai' }],
  agreementOptions: [
    { id: 'ha-valid', label: 'HA-001 · Acme LLC · ha-valid' },
    { id: 'ha-other', label: 'HA-002 · Beta LLC · ha-other' },
  ],
}));

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/hooks/useQueries', () => ({
  useCustomers: () => ({ data: h.customers }),
  useMachines: () => ({ data: h.machines }),
  useBranches: () => ({ data: h.branches }),
  useHireAgreementOptions: () => ({ data: h.agreementOptions }),
}));
vi.mock('@/services/hireLink', () => ({
  handleOnHire: vi.fn(),
  validateAgreementRef: vi.fn((raw: string) => {
    const v = raw.trim();
    if (!v) return { ok: true };
    if (v === 'ha-valid') return { ok: true, agreementId: 'ha-valid' };
    return { ok: false, code: 'NOT_FOUND', message: 'Hire agreement not found' };
  }),
  describeLink: vi.fn((id: string) =>
    id === 'ha-valid' ? { agreementId: 'ha-valid', agreementNo: 'HA-001', quotationNumber: 'QT-9' } : undefined,
  ),
}));

// Radix Select cannot be driven in jsdom; same native <select> approach as GatePassDialog.test.tsx.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<{ onValueChange?: (v: string) => void; defaultValue?: string }>({});
  return {
    Select: ({ onValueChange, defaultValue, children }: {
      onValueChange?: (v: string) => void; defaultValue?: string; children: ReactNode;
    }) => <Ctx.Provider value={{ onValueChange, defaultValue }}><div>{children}</div></Ctx.Provider>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => {
      const { onValueChange, defaultValue } = useContext(Ctx);
      return (
        <select
          data-testid="native-select"
          defaultValue={defaultValue ?? ''}
          onChange={(e) => onValueChange?.(e.target.value)}
        >
          <option value="" />
          {children}
        </select>
      );
    },
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

import * as hireLink from '@/services/hireLink';
import { useBookingStore } from '@/store/bookingStore';
import type { Booking } from '@/types';
import { BookingFormDialog } from './BookingFormDialog';

// Radix Checkbox measures its size with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function renderDialog(props: Partial<{ booking: Booking | null; onClose: () => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <BookingFormDialog open onClose={onClose} booking={props.booking} defaultBranchId="b1" />
    </QueryClientProvider>,
  );
  return onClose;
}

function change(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

function fillBasics(opts: { agreement?: string; gates?: boolean; start?: string; end?: string }) {
  const selects = screen.getAllByTestId('native-select');
  change(selects[0], 'c1');
  change(selects[1], 'm1');
  change(selects[4], 'b1');
  change(screen.getByLabelText(/Start Date/), opts.start ?? isoDay(-2));
  change(screen.getByLabelText(/End Date/), opts.end ?? isoDay(2));
  change(screen.getByLabelText(/Daily Rate/), '100');
  change(screen.getByPlaceholderText('Full site address'), '1 Test Road, Dubai');
  change(screen.getByPlaceholderText('Contact person'), 'Sam Site');
  change(screen.getByPlaceholderText('+971 50 123 4567'), '+971 50 123 4567');
  if (opts.agreement !== undefined) {
    change(screen.getByPlaceholderText('Hire agreement ID (optional)'), opts.agreement);
  }
  if (opts.gates) {
    fireEvent.click(screen.getByRole('checkbox', { name: /QT'd/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /HA Sent/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /HA Recd/ }));
    change(screen.getByPlaceholderText('LPO-123456'), 'LPO-1');
    change(screen.getByLabelText(/LPO Validity Date/), isoDay(30));
  }
}

function baseBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-user-1',
    reference: 'BK-2025-0001',
    orgId: 'org-ja',
    customerId: 'c1',
    customerName: 'Acme LLC',
    machineId: 'm1',
    assetNumber: 'A-1',
    machineModel: 'CAT 320',
    startDate: isoDay(-2),
    endDate: isoDay(2),
    dailyRate: 100,
    totalValue: 500,
    deliveryAddress: '1 Test Road, Dubai',
    branchId: 'b1',
    branchName: 'Dubai',
    operatorRequired: false,
    status: 'Reserved',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  } as unknown as Booking;
}

describe('BookingFormDialog hire agreement link', () => {
  beforeEach(() => {
    useBookingStore.setState({ userBookings: [] });
    vi.mocked(hireLink.handleOnHire).mockReset();
  });
  afterEach(() => cleanup());

  it('invalid agreement id keeps the dialog open and saves nothing', async () => {
    const onClose = renderDialog();
    fillBasics({ agreement: 'ha-bogus' });
    fireEvent.click(screen.getByRole('button', { name: /Save as Reserved/ }));
    expect(await screen.findByText('Hire agreement not found')).toBeTruthy();
    expect(useBookingStore.getState().userBookings).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(hireLink.handleOnHire).not.toHaveBeenCalled();
  });

  it('On Hire booking with a valid agreement calls handleOnHire after the store write', async () => {
    let countAtCall = -1;
    vi.mocked(hireLink.handleOnHire).mockImplementation(() => {
      countAtCall = useBookingStore.getState().userBookings.length;
      return { outcome: 'skipped', reason: 'NO_AGREEMENT' } as never;
    });
    const onClose = renderDialog();
    fillBasics({ agreement: 'ha-valid', gates: true });
    fireEvent.click(screen.getByRole('button', { name: /Create Booking/ }));
    await waitFor(() => expect(hireLink.handleOnHire).toHaveBeenCalledTimes(1));
    const saved = useBookingStore.getState().userBookings[0];
    expect(saved.status).toBe('On Hire');
    expect(saved.hireAgreementId).toBe('ha-valid');
    expect(countAtCall).toBe(1);
    expect(hireLink.handleOnHire).toHaveBeenCalledWith({ source: 'booking', allocationId: saved.id });
    expect(onClose).toHaveBeenCalled();
  });

  it('non-On Hire status (Reserved) with a valid agreement does not call handleOnHire', async () => {
    renderDialog();
    fillBasics({ agreement: 'ha-valid' });
    fireEvent.click(screen.getByRole('button', { name: /Save as Reserved/ }));
    await waitFor(() => expect(useBookingStore.getState().userBookings).toHaveLength(1));
    expect(useBookingStore.getState().userBookings[0].status).toBe('Reserved');
    expect(useBookingStore.getState().userBookings[0].hireAgreementId).toBe('ha-valid');
    expect(hireLink.handleOnHire).not.toHaveBeenCalled();
  });

  it('empty agreement field saves without a link and calls nothing', async () => {
    renderDialog();
    fillBasics({ gates: true });
    fireEvent.click(screen.getByRole('button', { name: /Create Booking/ }));
    await waitFor(() => expect(useBookingStore.getState().userBookings).toHaveLength(1));
    const saved = useBookingStore.getState().userBookings[0];
    expect(saved.status).toBe('On Hire');
    expect(saved.hireAgreementId).toBeUndefined();
    expect(hireLink.handleOnHire).not.toHaveBeenCalled();
  });

  it('edit pre-fills the stored agreement id and shows the link summary', () => {
    const b = baseBooking({ hireAgreementId: 'ha-valid' });
    useBookingStore.setState({ userBookings: [b] });
    renderDialog({ booking: b });
    const input = screen.getByPlaceholderText('Hire agreement ID (optional)') as HTMLInputElement;
    expect(input.value).toBe('ha-valid');
    expect(input.disabled).toBe(false);
    expect(screen.getByText(/HA-001 · ha-valid · QT-9/)).toBeTruthy();
  });

  it('demo booking (not in userBookings) disables the field with helper text', () => {
    renderDialog({ booking: baseBooking({ id: 'bk-demo-1' }) });
    const input = screen.getByPlaceholderText('Hire agreement ID (optional)') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText('Demo bookings cannot be linked')).toBeTruthy();
  });

  it('datalist shows agreement id as value and number, company and id as label', () => {
    renderDialog();
    const opts = Array.from(document.querySelectorAll('#hire-agreement-options option'));
    expect(opts.map((o) => (o as HTMLOptionElement).value)).toEqual(['ha-valid', 'ha-other']);
    expect(opts[0].textContent).toBe('HA-001 · Acme LLC · ha-valid');
  });
});
