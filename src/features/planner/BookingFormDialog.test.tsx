// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/services/api/http';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/toast-helper', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/hooks/useApiResources', () => ({
  useApiBranches: () => ({ data: [{ id: 'b1', name: 'Dubai' }] }),
  useFleetMachines: () => ({
    data: [{ id: 'm1', assetNumber: 'A-1', make: 'CAT', model: '320', status: 'Available', branchId: 'b1' }],
  }),
  useLpos: () => ({ data: [{ id: 'l1', customerId: 'c1', lpoNo: 'LPO-1', validUntil: '2030-01-01' }] }),
}));
vi.mock('@/hooks/api/usePlannerApi', () => ({
  usePlannerCustomers: () => ({ data: [{ id: 'c1', name: 'Acme LLC' }] }),
  usePlannerAgreements: () => ({
    data: [{ id: 'ha1', customerId: 'c1', agreementNo: 'HA-001', status: 'Active', sentAt: '2026-01-01', receivedAt: '2026-01-02' }],
  }),
  useCreateBooking: () => ({ mutateAsync: h.create }),
  useUpdateBooking: () => ({ mutateAsync: h.update }),
  useSubmission: () => ({ id: () => 'sub-1', renew: () => undefined }),
  fetchBooking: vi.fn(),
}));

import { BookingFormDialog } from './BookingFormDialog';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

function fill() {
  change(screen.getByLabelText(/Customer/), 'c1');
  change(screen.getByLabelText(/^Machine/), 'm1');
  change(screen.getByLabelText(/Start Date/), '2026-03-01');
  change(screen.getByLabelText(/End Date/), '2026-03-05');
  change(screen.getByLabelText(/Daily Rate/), '100');
  change(screen.getByLabelText(/Delivery Address/), '1 Test Road, Dubai');
  change(screen.getByLabelText(/Site Contact Phone/), '+971 50 123 4567');
}

describe('BookingFormDialog', () => {
  beforeEach(() => { h.create.mockReset(); h.update.mockReset(); });
  afterEach(() => cleanup());

  it('saves an incomplete booking as Reserved through the API', async () => {
    h.create.mockResolvedValue({ id: 'b1' });
    const onClose = vi.fn();
    render(<BookingFormDialog open onClose={onClose} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Save as Reserved/ }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toMatchObject({
      submissionId: 'sub-1',
      body: { machineId: 'm1', customerId: 'c1', status: 'Reserved', dailyRate: '100' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the booking conflict message and keeps the entered values', async () => {
    h.create.mockRejectedValue(new ApiClientError({ code: 'BOOKING_CONFLICT', message: 'x', status: 409, correlationId: 'corr-1' }));
    const onClose = vi.fn();
    render(<BookingFormDialog open onClose={onClose} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Save as Reserved/ }));
    expect(await screen.findByText(/already booked for these dates/)).toBeTruthy();
    expect(screen.getByText('corr-1')).toBeTruthy();
    expect((screen.getByLabelText(/Delivery Address/) as HTMLInputElement).value).toBe('1 Test Road, Dubai');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('links an LPO and an agreement from the customer records', async () => {
    h.create.mockResolvedValue({ id: 'b1' });
    render(<BookingFormDialog open onClose={vi.fn()} />);
    fill();
    change(screen.getByLabelText(/Hire Agreement/), 'ha1');
    change(screen.getByLabelText(/LPO Number/), 'l1');
    fireEvent.click(screen.getByRole('checkbox', { name: /QT'd/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create Booking/ }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0].body).toMatchObject({
      hireAgreementId: 'ha1', lpoId: 'l1', status: 'Allocated', quoted: true, haSent: true, haReceived: true,
    });
  });
});
