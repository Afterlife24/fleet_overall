// @vitest-environment jsdom
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastWarning: toasts.warning, toastInfo: vi.fn(),
}));

const state = vi.hoisted(() => ({ scanPayload: 'AXLEOPS-FLEET:org-1:m-1:F-1', machines: [] as unknown[] }));
const api = vi.hoisted(() => ({
  gate: { list: vi.fn(), get: vi.fn(), create: vi.fn(), approve: vi.fn(), cancel: vi.fn(), complete: vi.fn(), resolveQr: vi.fn() },
  inspections: { list: vi.fn(), get: vi.fn() },
  bookings: { list: vi.fn(), get: vi.fn() },
  evidence: { list: vi.fn(), create: vi.fn() },
}));
vi.mock('@/services/api/gate', () => ({ gateApi: api.gate, inspectionsApi: api.inspections }));
vi.mock('@/services/api/bookings', () => ({ bookingsApi: api.bookings }));
vi.mock('@/services/api/documents', () => ({ documentsApi: { generate: vi.fn() }, evidenceApi: api.evidence }));
vi.mock('@/services/api/files', () => ({ filesApi: { upload: vi.fn(), get: vi.fn() } }));
vi.mock('@/services/gatePassPdf', () => ({ gatePassPdf: vi.fn() }));
vi.mock('@/hooks/useApiResources', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useApiResources')>()),
  useFleetMachines: () => ({ data: state.machines, isLoading: false }),
}));

// The camera is not available in jsdom: the mock offers a button that "decodes" the current payload.
vi.mock('./QrScanner', () => ({
  QrScanner: ({ active, onDecode }: { active: boolean; onDecode: (text: string) => void }) =>
    active ? <button type="button" onClick={() => onDecode(state.scanPayload)}>Simulate scan</button> : null,
}));

// Radix Select cannot be driven in jsdom (pointer capture, portals). A native <select> keeps the same contract and
// the aria-label of the trigger.
vi.mock('@/components/ui/select', () => {
  type Props = { value?: string; onValueChange?: (v: string) => void; children?: ReactNode };
  const Trigger = (props: { 'aria-label'?: string; children?: ReactNode }) => (props.children ? null : null);
  const Content = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Item = ({ value, children, disabled }: { value: string; children?: ReactNode; disabled?: boolean }) => (
    <option value={value} disabled={disabled}>{children}</option>
  );
  const Select = ({ value, onValueChange, children }: Props) => {
    const parts = Children.toArray(children).filter(isValidElement) as ReactElement<{ 'aria-label'?: string; children?: ReactNode }>[];
    const trigger = parts.find((c) => c.type === Trigger);
    const content = parts.find((c) => c.type === Content);
    return (
      <select aria-label={trigger?.props['aria-label']} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="" />
        {content?.props.children}
      </select>
    );
  };
  return { Select, SelectTrigger: Trigger, SelectContent: Content, SelectItem: Item, SelectValue: () => null };
});

import { useSessionStore } from '@/services/api/session';
import { ApiClientError } from '@/services/api/http';
import type { GatePassDto, ResolveQrDto } from '@/services/api/gate';
import type { BookingDto } from '@/services/api/bookings';
import { page, renderScreen, setSessionReady, unavailableError } from '@/test-support/apiScreens';
import { GatePassDialog, QR_INVALID_MESSAGE } from './GatePassDialog';

const TS = '2026-01-10T08:00:00.000Z';
const machine = { id: 'm-1', fleetNo: 'F-1', assetNo: 'A-1', branchId: 'b-1', operationalStatus: 'Available', readinessStatus: 'READY', currentLocation: 'Yard', active: true, rowVersion: 1 };
const resolved = (over: Partial<ResolveQrDto> = {}): ResolveQrDto => ({
  kind: 'FLEET', machine, pass: null, openPasses: [], candidateBooking: null, candidateCollectionNote: null, manualSelectionRequired: false, ...over,
});
const createdPass = { id: 'gp-1', reference: 'GP-2026-0001' } as GatePassDto;
const booking = (id: string, over: Partial<BookingDto> = {}): BookingDto => ({
  id, reference: `BK-${id}`, branchId: 'b-1', branchName: 'Dubai', machineId: 'm-1', assetNo: 'A-1', fleetNo: 'F-1', machineModel: 'JLG',
  customerId: 'c-1', customerName: 'ABC Co', hireAgreementId: null, agreementNo: null, lpoId: null, startDate: '2026-01-01',
  endDate: '2026-02-01', status: 'On Hire', deliveryAddress: 'x', contactPhone: '', operatorRequired: false, dailyRate: '1', totalValue: '1',
  quoted: false, haSent: false, haReceived: false, reserved: false, onHireAt: TS, departedAt: TS, offHireRequestedAt: null,
  collectedAt: null, returnedAt: null, physicallyOccupied: true, notes: null, createdAt: TS, updatedAt: TS, rowVersion: 1, ...over,
});

function setPermissions(permissions: string[]) {
  useSessionStore.setState((s) => ({ session: s.session ? { ...s.session, permissions } : s.session }));
}
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const renderDialog = () => {
  const onClose = vi.fn();
  const onOpenPass = vi.fn();
  renderScreen(<GatePassDialog open onClose={onClose} onOpenPass={onOpenPass} />);
  return { onClose, onOpenPass };
};
async function scan() {
  fireEvent.click(await screen.findByRole('button', { name: 'Simulate scan' }));
  return screen.findByTestId('scan-result');
}
function fillDriverAndDestination(destination = 'Customer site') {
  fireEvent.change(screen.getByLabelText(/Driver/), { target: { value: 'Ali' } });
  fireEvent.change(screen.getByLabelText(/Destination/), { target: { value: destination } });
}
const createButton = () => screen.getByRole('button', { name: 'Create Gate Pass' }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  setSessionReady();
  setPermissions(['gate.read', 'gate.write']);
  state.scanPayload = 'AXLEOPS-FLEET:org-1:m-1:F-1';
  state.machines = [{ id: 'm-1', fleetNo: 'F-1', assetNumber: 'A-1', make: 'JLG', model: '660SJ' }];
  api.gate.resolveQr.mockResolvedValue(resolved());
  api.gate.create.mockResolvedValue(createdPass);
  api.bookings.list.mockResolvedValue(page([booking('1')]));
  api.evidence.list.mockResolvedValue({ items: [] });
});
afterEach(cleanup);

describe('GatePassDialog scan', () => {
  it('sends a scanned QR to resolveQr unmodified and shows the machine it resolved to', async () => {
    renderDialog();
    const result = await scan();
    expect(api.gate.resolveQr).toHaveBeenCalledTimes(1);
    expect(api.gate.resolveQr.mock.calls[0][0]).toBe('AXLEOPS-FLEET:org-1:m-1:F-1');
    expect(result.textContent).toContain('F-1');
    expect(api.gate.create).not.toHaveBeenCalled();
  });

  it('on QR_INVALID says no pass or movement was created and offers no form', async () => {
    api.gate.resolveQr.mockRejectedValue(new ApiClientError({ code: 'QR_INVALID', message: 'Unknown QR', status: 422, correlationId: 'c-1' }));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate scan' }));
    const panel = await screen.findByTestId('qr-invalid');
    expect(panel.textContent).toContain(QR_INVALID_MESSAGE);
    expect(QR_INVALID_MESSAGE).toMatch(/No gate pass was created and no movement was recorded/);
    expect(panel.textContent).toContain('QR_INVALID');
    expect(screen.queryByLabelText('Movement purpose')).toBeNull();
    expect(api.gate.create).not.toHaveBeenCalled();
  });

  it('creates a QR pass with the scanned payload for a customer return and pre-selects the single candidate booking', async () => {
    api.gate.resolveQr.mockResolvedValue(resolved({ candidateBooking: { id: '1', reference: 'BK-1', machineId: 'm-1', branchId: 'b-1', customerId: 'c-1', status: 'On Hire', startDate: '', endDate: '', departedAt: TS, returnedAt: null, rowVersion: 1 } }));
    const { onClose, onOpenPass } = renderDialog();
    await scan();
    select('Movement purpose', 'CUSTOMER_RETURN');
    expect(screen.getByText('IN', { selector: 'strong' })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Booking') as HTMLSelectElement).value).toBe('1'));
    fillDriverAndDestination('Yard');
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(1));
    const [body, submissionId] = api.gate.create.mock.calls[0];
    expect(body).toMatchObject({
      captureMethod: 'QR', qrPayload: 'AXLEOPS-FLEET:org-1:m-1:F-1', direction: 'IN', movementPurpose: 'CUSTOMER_RETURN',
      machineId: 'm-1', bookingId: '1', driverName: 'Ali',
    });
    expect(typeof submissionId).toBe('string');
    await waitFor(() => expect(onOpenPass).toHaveBeenCalledWith('gp-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('lets the user pick the booking when manualSelectionRequired is set', async () => {
    api.gate.resolveQr.mockResolvedValue(resolved({ manualSelectionRequired: true }));
    api.bookings.list.mockResolvedValue(page([booking('1'), booking('2')]));
    renderDialog();
    const result = await scan();
    expect(result.textContent).toContain('Choose the booking yourself');
    select('Movement purpose', 'CUSTOMER_RETURN');
    const booking2 = await screen.findByRole('option', { name: /BK-2/ });
    expect((screen.getByLabelText('Booking') as HTMLSelectElement).value).toBe('');
    fillDriverAndDestination('Yard');
    expect(createButton().disabled).toBe(true);
    select('Booking', (booking2 as HTMLOptionElement).value);
    expect(createButton().disabled).toBe(false);
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(1));
    expect(api.gate.create.mock.calls[0][0]).toMatchObject({ bookingId: '2', collectionNoteId: null, captureMethod: 'QR' });
  });
});

describe('GatePassDialog manual fallback', () => {
  it('is unavailable without gate.write', async () => {
    setPermissions(['gate.read']);
    renderDialog();
    const manual = await screen.findByRole('button', { name: 'Enter fleet number manually' });
    expect((manual as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Your role cannot create gate passes.')).toBeTruthy();
    expect(createButton().disabled).toBe(true);
  });

  it('sends capture Manual without a qrPayload', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Enter fleet number manually' }));
    select('Fleet number', 'm-1');
    select('Movement purpose', 'TRANSFER');
    select('Direction', 'OUT');
    fillDriverAndDestination('Workshop');
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(1));
    const body = api.gate.create.mock.calls[0][0];
    expect(body).toMatchObject({ captureMethod: 'Manual', direction: 'OUT', movementPurpose: 'TRANSFER', machineId: 'm-1', bookingId: null });
    expect('qrPayload' in body).toBe(false);
    expect(api.gate.resolveQr).not.toHaveBeenCalled();
  });
});

describe('GatePassDialog purpose and direction', () => {
  async function manualWithMachine() {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Enter fleet number manually' }));
    select('Fleet number', 'm-1');
  }

  it('maps CUSTOMER_HIRE to OUT and CUSTOMER_RETURN to IN without asking for a direction', async () => {
    await manualWithMachine();
    select('Movement purpose', 'CUSTOMER_HIRE');
    expect(screen.getByText('OUT', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByLabelText('Direction')).toBeNull();
    select('Movement purpose', 'CUSTOMER_RETURN');
    expect(screen.getByText('IN', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByLabelText('Direction')).toBeNull();
  });

  it('asks for the direction only for a transfer', async () => {
    await manualWithMachine();
    select('Movement purpose', 'TRANSFER');
    expect(screen.getByLabelText('Direction')).toBeTruthy();
    fillDriverAndDestination();
    expect(createButton().disabled).toBe(true);
    select('Direction', 'IN');
    expect(createButton().disabled).toBe(false);
  });

  it('sends direction OUT for a hire and requires a booking', async () => {
    api.bookings.list.mockResolvedValue(page([booking('3', { status: 'Approved', departedAt: null, onHireAt: null, physicallyOccupied: false })]));
    await manualWithMachine();
    select('Movement purpose', 'CUSTOMER_HIRE');
    fillDriverAndDestination();
    expect(createButton().disabled).toBe(true);
    const option = await screen.findByRole('option', { name: /BK-3/ });
    select('Booking', (option as HTMLOptionElement).value);
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(1));
    expect(api.gate.create.mock.calls[0][0]).toMatchObject({ direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: '3', captureMethod: 'Manual' });
  });
});

describe('GatePassDialog idempotency', () => {
  async function readyTransfer() {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Enter fleet number manually' }));
    select('Fleet number', 'm-1');
    select('Movement purpose', 'TRANSFER');
    select('Direction', 'OUT');
    fillDriverAndDestination('Workshop');
  }

  it('reuses the Idempotency-Key when the same submission is retried after a failure', async () => {
    api.gate.create.mockRejectedValueOnce(unavailableError()).mockResolvedValueOnce(createdPass);
    await readyTransfer();
    fireEvent.click(createButton());
    expect(await screen.findByTestId('api-error')).toBeTruthy();
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(2));
    const [firstBody, firstKey] = api.gate.create.mock.calls[0];
    const [secondBody, secondKey] = api.gate.create.mock.calls[1];
    expect(secondBody).toEqual(firstBody);
    expect(secondKey).toBe(firstKey);
  });

  it('uses a new Idempotency-Key when the form was edited between attempts', async () => {
    api.gate.create.mockRejectedValueOnce(unavailableError()).mockResolvedValueOnce(createdPass);
    await readyTransfer();
    fireEvent.click(createButton());
    await screen.findByTestId('api-error');
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Driver/), { target: { value: 'Omar' } });
    fireEvent.click(createButton());
    await waitFor(() => expect(api.gate.create).toHaveBeenCalledTimes(2));
    expect(api.gate.create.mock.calls[1][1]).not.toBe(api.gate.create.mock.calls[0][1]);
  });
});
