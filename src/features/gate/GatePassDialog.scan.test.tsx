// @vitest-environment jsdom
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  payload: '',
  createSpy: vi.fn(),
  serverNow: vi.fn(),
}));

vi.mock('@/services/hireLink', () => ({ handleOnHire: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/services/serverClock', () => ({ serverNow: h.serverNow }));
vi.mock('./QrScanner', () => ({
  QrScanner: ({ active, onDecode, onError }: {
    active: boolean; onDecode: (t: string) => void; onError?: (c: string) => void;
  }) => active ? (
    <div>
      <button type="button" onClick={() => onDecode(h.payload)}>sim-decode</button>
      <button type="button" onClick={() => onError?.('DENIED')}>sim-camera-error</button>
    </div>
  ) : null,
}));
vi.mock('@/hooks/useQueries', () => ({
  useMachines: () => ({
    data: [{ id: 'm-test', assetNumber: 'A-1', make: 'CAT', model: '320', branchId: 'branch-dxb' }],
  }),
  useCreateGateEntry: () => ({ mutateAsync: h.createSpy, isPending: false }),
}));

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
        <select data-testid="native-select" defaultValue={defaultValue ?? ''}
          onChange={(e) => onValueChange?.(e.target.value)}>
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

import { toastError, toastSuccess } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useGateStore } from '@/store/gateStore';
import { gateService } from '@/services/services';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { buildQrPayload } from '@/services/collectionCore';
import { GATE_SCAN_MESSAGES, resolveGateScan } from '@/services/gateCore';
import { appMachineResolver } from '@/features/fleet/collectionWiring';
import type { CollectionNote } from '@/types/collection';
import { GatePassDialog } from './GatePassDialog';

const lites = appMachineResolver.list(JA_ORG_ID);
const target = lites.find((l) => resolveGateScan(buildQrPayload(l), JA_ORG_ID, lites).ok)!;
const TARGET_PAYLOAD = buildQrPayload(target);
const FIXED = { iso: '2025-01-15T08:30:00.000Z', source: 'server' as const };

const note = (over: Partial<CollectionNote> = {}): CollectionNote => ({
  id: 'cn-1', orgId: JA_ORG_ID, number: 'CN-2025-0001', machineId: target.id, status: 'Scheduled',
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  ...over,
} as CollectionNote);

const submitBtn = () => screen.getByRole('button', { name: /Submit/ });
const plate = () => screen.getByPlaceholderText('ABC-1234') as HTMLInputElement;
const fillPlate = () => fireEvent.change(plate(), { target: { value: 'ABC-1234' } });
const decode = (payload: string) => {
  h.payload = payload;
  fireEvent.click(screen.getByText('sim-decode'));
};
const scanValid = async () => {
  decode(TARGET_PAYLOAD);
  await screen.findByTestId('scan-result');
};

const realGetStatus = useAppStore.getState().getMachineCurrentStatus;

beforeEach(() => {
  useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: true });
  // The mocked mutation calls the real service, so the stored record can be checked.
  h.createSpy.mockReset().mockImplementation((d: unknown) => gateService.create(d));
  h.serverNow.mockReset().mockResolvedValue(FIXED);
  vi.mocked(toastSuccess).mockClear();
  vi.mocked(toastError).mockClear();
  useAppStore.setState({ machineOverrides: [], gateEntries: [], getMachineCurrentStatus: realGetStatus });
  useCollectionStore.setState({ notes: [] });
  useAppStore.getState().setMachineStatus(target.id, 'Available');
  render(<GatePassDialog open onClose={vi.fn()} />);
});
afterEach(() => cleanup());

describe('GatePassDialog scan mode', () => {
  it('valid scan shows fleet no, make, model and saves a QR record with the payload', async () => {
    await scanValid();
    const panel = screen.getByTestId('scan-result');
    expect(panel.textContent).toContain(target.fleetNo ?? target.assetNumber);
    if (target.make) expect(panel.textContent).toContain(target.make);
    expect(panel.textContent).toContain('Server time');
    expect(panel.textContent).toContain('not On Hire');
    fillPlate();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(h.createSpy).toHaveBeenCalledTimes(1));
    const sent = h.createSpy.mock.calls[0][0];
    expect(sent).toMatchObject({
      captureMethod: 'QR', qrPayload: TARGET_PAYLOAD, timeSource: 'server', timestamp: FIXED.iso,
    });
    expect(h.serverNow).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not a fleet QR', 'garbage', 'OTHER'],
    ['other org', 'AXLEOPS-FLEET:org-other:m1:F-1', 'OTHER_ORG'],
  ] as const)('%s shows mapped message and code, keeps submit disabled, saves nothing', async (_n, payload, code) => {
    decode(payload);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(GATE_SCAN_MESSAGES[code]);
    expect(alert.textContent).toContain(code);
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    fillPlate();
    fireEvent.submit(plate().closest('form')!);
    expect(h.createSpy).not.toHaveBeenCalled();
    expect(useGateStore.getState().entries).toHaveLength(0);
  });

  it('Enter-submit does nothing without a valid scan', () => {
    fillPlate();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(plate().closest('form')!);
    expect(h.createSpy).not.toHaveBeenCalled();
  });

  it('Scan again and mode switches clear scan state', async () => {
    await scanValid();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(screen.queryByTestId('scan-result')).toBeNull();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);

    await scanValid();
    fireEvent.click(screen.getByRole('button', { name: 'Enter fleet number manually' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan QR' }));
    expect(screen.queryByTestId('scan-result')).toBeNull();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it('camera error shows its message and manual mode stays available', () => {
    fireEvent.click(screen.getByText('sim-camera-error'));
    expect(screen.getByRole('alert').textContent).toMatch(/camera/i);
    expect((screen.getByRole('button', { name: 'Enter fleet number manually' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clock failure at scan blocks the scan', async () => {
    h.serverNow.mockRejectedValue(new Error('boom'));
    decode(TARGET_PAYLOAD);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not get the time');
    expect(screen.queryByTestId('scan-result')).toBeNull();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('GatePassDialog manual mode', () => {
  const goManual = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Enter fleet number manually' }));
  const pickManual = () => {
    goManual();
    fireEvent.change(screen.getAllByTestId('native-select')[0], { target: { value: 'm-test' } });
    fillPlate();
  };

  it('saves a Manual record with server time and shows no date or time fields', async () => {
    pickManual();
    expect(screen.queryByLabelText(/date|time/i)).toBeNull();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(h.createSpy).toHaveBeenCalledTimes(1));
    const sent = h.createSpy.mock.calls[0][0];
    expect(sent).toMatchObject({ captureMethod: 'Manual', timeSource: 'server', timestamp: FIXED.iso });
    expect(sent.qrPayload).toBeUndefined();
  });

  it.each([
    ['rejected clock', () => h.serverNow.mockRejectedValue(new Error('x')), 'Could not get the time'],
    ['invalid date', () => h.serverNow.mockResolvedValue({ iso: 'nope', source: 'server' }), 'Could not get the time'],
    ['status read throws', () => useAppStore.setState({
      getMachineCurrentStatus: () => { throw new Error('x'); },
    }), 'Machine status is unavailable'],
  ])('%s blocks the save and keeps entered data', async (_n, arrange, text) => {
    pickManual();
    act(() => { arrange(); });
    fireEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(h.createSpy).not.toHaveBeenCalled();
    expect(useGateStore.getState().entries).toHaveLength(0);
    expect(plate().value).toBe('ABC-1234');
  });
});

describe('GatePassDialog collection note and identity', () => {
  const submitScanned = async () => {
    await scanValid();
    fillPlate();
    fireEvent.click(submitBtn());
  };

  it('Gate IN marks the open note Collected and toasts its number', async () => {
    useAppStore.getState().setMachineStatus(target.id, 'On Hire');
    useCollectionStore.setState({ notes: [note()] });
    await submitScanned();
    await waitFor(() => expect(useCollectionStore.getState().notes[0].status).toBe('Collected'));
    const collected = useCollectionStore.getState().notes[0];
    const saved = h.createSpy.mock.calls[0][0];
    expect(collected.collectedByGateRef).toBe(saved.reference);
    expect(collected.collectedByGateId).toBe(saved.id);
    expect(collected.collectedAt).toBe(saved.timestamp);
    expect(toastSuccess).toHaveBeenCalledWith('Collection Note CN-2025-0001 marked Collected');
  });

  it('Gate IN with no open note shows no collection toast', async () => {
    useAppStore.getState().setMachineStatus(target.id, 'On Hire');
    await submitScanned();
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled());
    await waitFor(() => expect(useAppStore.getState().getMachineCurrentStatus(target.id)).toBe('PHI'));
    expect(vi.mocked(toastSuccess).mock.calls.some(([m]) => String(m).includes('Collection Note'))).toBe(false);
  });

  it('Gate OUT leaves the note open', async () => {
    useCollectionStore.setState({ notes: [note()] });
    await submitScanned();
    await waitFor(() => expect(h.createSpy).toHaveBeenCalled());
    await waitFor(() => expect(useAppStore.getState().getMachineCurrentStatus(target.id)).toBe('On Hire'));
    expect(useCollectionStore.getState().notes[0].status).toBe('Scheduled');
  });

  it('save failure skips the collection update and stores nothing', async () => {
    useAppStore.getState().setMachineStatus(target.id, 'On Hire');
    useCollectionStore.setState({ notes: [note()] });
    h.createSpy.mockRejectedValue(new Error('fail'));
    await submitScanned();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to log gate entry'));
    expect(useGateStore.getState().entries).toHaveLength(0);
    expect(useCollectionStore.getState().notes[0].status).toBe('Scheduled');
  });

  it('the same id and reference reach the service and the store, under the current company', async () => {
    await submitScanned();
    await waitFor(() => expect(useGateStore.getState().entries).toHaveLength(1));
    const sent = h.createSpy.mock.calls[0][0];
    const stored = useGateStore.getState().entries[0];
    expect(stored.id).toBe(sent.id);
    expect(stored.reference).toBe(sent.reference);
    expect(stored.gatePass).toBe(stored.reference);
    expect(stored.orgId).toBe(JA_ORG_ID);
    expect(stored).toMatchObject({
      machineId: target.id, truckPlate: 'ABC-1234', arrivingFrom: 'Yard', captureMethod: 'QR',
    });
    expect(useAppStore.getState().gateEntries).toHaveLength(0);
  });
});

describe('GatePassDialog demo flow in a new company', () => {
  const ORG = 'org-test-xyz';
  const savedUser = useAuthStore.getState().user;
  afterEach(() => useAuthStore.setState({ user: savedUser }));

  it('Gate IN scan of the J105 payload collects CN-2026-0001 and moves J105 to PHI', async () => {
    useAuthStore.setState({ user: { orgId: ORG, name: 'Tester', email: 't@example.com', role: 'Admin' } as never });
    useOrgStore.getState().activateApp(ORG, 'gate');
    const list = await gateService.list();
    expect(list.map((r) => r.reference)).toEqual(expect.arrayContaining(['GP-DEMO-1', 'GP-DEMO-2', 'GP-DEMO-3']));
    expect(list).toHaveLength(3);

    const machines = appMachineResolver.list(ORG);
    const j105 = machines.find((m) => m.fleetNo === 'J105')!;
    const r = resolveGateScan(buildQrPayload(j105), ORG, machines);
    expect(r.ok && r.machine.id).toBe(j105.id);

    const n1 = () => useCollectionStore.getState().notes.find((n) => n.orgId === ORG && n.number === 'CN-2026-0001')!;
    expect(n1().status).toBe('Scheduled');
    // J105 is On Hire in every company's demo data, with no manual status override.
    expect(useAppStore.getState().getMachineCurrentStatus(j105.id)).toBe('On Hire');

    cleanup();
    render(<GatePassDialog open onClose={vi.fn()} />);
    h.payload = buildQrPayload(j105);
    fireEvent.click(screen.getByText('sim-decode'));
    await screen.findByTestId('scan-result');
    fillPlate();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(n1().status).toBe('Collected'));
    const saved = h.createSpy.mock.calls[0][0];
    expect(saved).toMatchObject({ direction: 'IN', machineId: j105.id, orgId: ORG });
    expect(n1().collectedByGateId).toBe(saved.id);
    expect(n1().collectedByGateRef).toBe(saved.reference);
    expect(n1().collectedAt).toBe(saved.timestamp);
    expect(useAppStore.getState().getMachineCurrentStatus(j105.id)).toBe('PHI');
    expect(vi.mocked(toastSuccess)).toHaveBeenCalledWith('Collection Note CN-2026-0001 marked Collected');
    expect(useGateStore.getState().entries.filter((e) => e.orgId === ORG)).toHaveLength(4);
  });
});