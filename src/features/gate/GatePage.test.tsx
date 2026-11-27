// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));

const api = vi.hoisted(() => ({
  gate: { list: vi.fn(), get: vi.fn(), create: vi.fn(), approve: vi.fn(), cancel: vi.fn(), complete: vi.fn(), resolveQr: vi.fn() },
  inspections: { list: vi.fn(), get: vi.fn() },
  bookings: { list: vi.fn(), get: vi.fn() },
  evidence: { list: vi.fn(), create: vi.fn() },
  machines: [] as unknown[],
}));
vi.mock('@/services/api/gate', () => ({ gateApi: api.gate, inspectionsApi: api.inspections }));
vi.mock('@/services/api/bookings', () => ({ bookingsApi: api.bookings }));
vi.mock('@/services/api/documents', () => ({
  documentsApi: { generate: vi.fn() },
  evidenceApi: api.evidence,
}));
vi.mock('@/services/api/files', () => ({ filesApi: { upload: vi.fn(), get: vi.fn() } }));
// The machine list is read through the retained fleet hook; the pdf/qr helpers need canvas and are not under test here.
vi.mock('@/hooks/useApiResources', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useApiResources')>()),
  useFleetMachines: () => ({ data: api.machines, isLoading: false }),
}));
vi.mock('@/services/collectionPdf', () => ({ qrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') }));
vi.mock('@/services/gatePassDocs', () => ({
  gatePassContext: () => ({ companyName: 'Test Org', links: {} }),
  downloadGateQrPng: vi.fn(),
  printGatePass: vi.fn(),
}));
vi.mock('@/services/gatePassPdf', () => ({ gatePassPdf: vi.fn() }));
vi.mock('./GatePassDialog', () => ({ GatePassDialog: () => null }));

import { useSessionStore } from '@/services/api/session';
import { ApiClientError } from '@/services/api/http';
import type { GatePassDto } from '@/services/api/gate';
import { page, renderScreen, setSessionReady, unavailableError } from '@/test-support/apiScreens';
import { GatePage, REOPEN_REQUIRED_MESSAGE } from './GatePage';

const TS = '2026-01-10T08:00:00.000Z';
const pass = (id: string, over: Partial<GatePassDto> = {}): GatePassDto => ({
  id, reference: `GP-2026-000${id}`, branchId: 'b-1', machineId: 'm-1', bookingId: null, transportJobId: null,
  collectionNoteId: null, direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', status: 'Pending', fleetNoSnapshot: `F-${id}`,
  driverName: `Driver ${id}`, truckPlate: 'ABC-1', destination: 'Site A', arrivingFrom: null, captureMethod: 'Manual',
  scannedAt: null, qrPayload: null, deviceCapturedAt: null, requestedAt: TS, approvedAt: null, approvedBy: null, notes: null,
  movement: null, createdAt: TS, updatedAt: TS, rowVersion: 2, ...over,
});

const completeResult = (p: GatePassDto) => ({ pass: { ...p, status: 'Completed' }, movement: null, inspection: null, booking: null, alreadyCompleted: false });

function setPermissions(permissions: string[]) {
  useSessionStore.setState((s) => ({ session: s.session ? { ...s.session, permissions } : s.session }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setSessionReady();
  setPermissions(['gate.read', 'gate.write', 'gate.approve']);
  api.machines = [];
  api.bookings.get.mockResolvedValue(undefined);
  api.evidence.list.mockResolvedValue({ items: [] });
  api.gate.list.mockResolvedValue(page([
    pass('1', { direction: 'OUT', status: 'Pending' }),
    pass('2', { direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', status: 'Approved', arrivingFrom: 'Dubai', destination: 'Yard' }),
  ]));
});
afterEach(cleanup);

describe('Gate page (API)', () => {
  it('lists the passes read from the API on the Gate Exit and Gate Entry tabs', async () => {
    renderScreen(<GatePage />);
    // The default tab is Gate Entry (IN).
    expect(await screen.findByText('GP-2026-0002')).toBeTruthy();
    expect(screen.queryByText('GP-2026-0001')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gate Exit' }));
    expect(screen.getByText('GP-2026-0001')).toBeTruthy();
    expect(screen.queryByText('GP-2026-0002')).toBeNull();
    expect(api.gate.list).toHaveBeenCalled();
  });

  it('opens the detail panel with the pass details when a row is clicked', async () => {
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByText('GP-2026-0002'));
    expect(await screen.findByText('Gate Entry Details (REF-06)')).toBeTruthy();
    expect(screen.getByText('Driver 2', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('Customer return (in)', { selector: 'span.rounded-md.bg-muted' })).toBeTruthy();
    expect(screen.getByTestId('gate-qr-fleet').textContent).toBe('F-2');
    expect(screen.getByTestId('gate-qr-payload').textContent).toContain('GP-2026-0002');
  });

  it('shows Approve only to a user with gate.approve', async () => {
    api.gate.list.mockResolvedValue(page([pass('1', { status: 'Pending' })]));
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gate Exit' }));
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    cleanup();

    setPermissions(['gate.read', 'gate.write']);
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gate Exit' }));
    await screen.findByText('GP-2026-0001');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('approves with the row version of the pass', async () => {
    api.gate.list.mockResolvedValue(page([pass('1', { status: 'Pending', rowVersion: 7 })]));
    api.gate.approve.mockResolvedValue(pass('1', { status: 'Approved', rowVersion: 8 }));
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gate Exit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.gate.approve).toHaveBeenCalledWith('1', 7));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it('completes an approved pass once and sends the same Idempotency-Key when the click is retried', async () => {
    const approved = pass('2', { direction: 'IN', status: 'Approved' });
    api.gate.list.mockResolvedValue(page([approved]));
    api.gate.complete
      .mockRejectedValueOnce(unavailableError())
      .mockResolvedValueOnce(completeResult(approved));
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    expect(await screen.findByTestId('api-error')).toBeTruthy();
    expect(toasts.success).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(api.gate.complete).toHaveBeenCalledTimes(2);
    const [firstId, firstKey] = api.gate.complete.mock.calls[0];
    const [secondId, secondKey] = api.gate.complete.mock.calls[1];
    expect(firstId).toBe('2');
    expect(secondId).toBe('2');
    expect(typeof firstKey).toBe('string');
    expect(secondKey).toBe(firstKey);
  });

  it('does not offer Complete for a Pending pass or to a user without gate.write', async () => {
    api.gate.list.mockResolvedValue(page([pass('1', { status: 'Pending' }), pass('2', { direction: 'OUT', status: 'Approved' })]));
    setPermissions(['gate.read']);
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gate Exit' }));
    await screen.findByText('GP-2026-0001');
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New Gate Pass' })).toBeNull();
  });

  it('requires a reason before a pass is cancelled', async () => {
    api.gate.list.mockResolvedValue(page([pass('1', { status: 'Pending', rowVersion: 5 })]));
    api.gate.cancel.mockResolvedValue(pass('1', { status: 'Cancelled' }));
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gate Exit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('button', { name: 'Cancel pass' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(api.gate.cancel).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Cancel pass' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'Wrong machine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel pass' }));
    await waitFor(() => expect(api.gate.cancel).toHaveBeenCalledWith('1', 5, 'Wrong machine'));
  });

  it('shows the REOPEN_REQUIRED banner when completing hits a Lost quotation, and no success toast', async () => {
    const approved = pass('2', { direction: 'IN', status: 'Approved' });
    api.gate.list.mockResolvedValue(page([approved]));
    api.gate.complete.mockRejectedValue(
      new ApiClientError({ code: 'REOPEN_REQUIRED', message: 'Quotation is Lost', status: 409, correlationId: 'corr-reopen' }),
    );
    renderScreen(<GatePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    const banner = await screen.findByTestId('reopen-required');
    expect(banner.textContent).toContain(REOPEN_REQUIRED_MESSAGE);
    expect(banner.textContent).toContain('corr-reopen');
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('shows the service-unavailable message and no passes when the API answers 503', async () => {
    api.gate.list.mockRejectedValue(unavailableError());
    renderScreen(<GatePage />);
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(screen.queryByText(/GP-2026/)).toBeNull();
    expect(screen.getByText('No entries found')).toBeTruthy();
  });
});
