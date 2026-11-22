// @vitest-environment jsdom
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/services/hireLink', () => ({
  handleOnHire: vi.fn(),
}));
vi.mock('./QrScanner', () => ({ QrScanner: () => null }));
vi.mock('@/services/serverClock', () => ({
  serverNow: vi.fn().mockResolvedValue({ iso: '2025-01-15T08:30:00.000Z', source: 'server' }),
}));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/hooks/useQueries', () => ({
  useMachines: () => ({
    data: [{ id: 'm-test', assetNumber: 'A-1', make: 'CAT', model: '320', branchId: 'branch-dxb' }],
  }),
  // Calls the real service so the stored record can be checked.
  useCreateGateEntry: () => ({ mutateAsync: (d: unknown) => gateService.create(d), isPending: false }),
}));

// Radix Select cannot be driven in jsdom (pointer capture, portals). Replace it
// with a native <select> that keeps the same onValueChange contract.
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

import { handleOnHire } from '@/services/hireLink';
import { useAppStore } from '@/store/appStore';
import { useGateStore } from '@/store/gateStore';
import { gateService } from '@/services/services';
import { GatePassDialog } from './GatePassDialog';

async function submitGateEntry() {
  render(<GatePassDialog open onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enter fleet number manually' }));
  // First native select is the fleet number picker.
  fireEvent.change(screen.getAllByTestId('native-select')[0], { target: { value: 'm-test' } });
  fireEvent.change(screen.getByPlaceholderText('ABC-1234'), { target: { value: 'ABC-1234' } });
  fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
}

describe('GatePassDialog On Hire trigger', () => {
  beforeEach(() => {
    vi.mocked(handleOnHire).mockClear();
    useAppStore.setState({ machineOverrides: [] });
    useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: true });
  });
  afterEach(() => cleanup());

  it('Gate OUT (machine not On Hire) calls handleOnHire exactly once', async () => {
    useAppStore.getState().setMachineStatus('m-test', 'Available');
    await submitGateEntry();
    await waitFor(() =>
      expect(useAppStore.getState().getMachineCurrentStatus('m-test')).toBe('On Hire'),
    );
    expect(handleOnHire).toHaveBeenCalledTimes(1);
    expect(handleOnHire).toHaveBeenCalledWith({ source: 'machine', machineId: 'm-test' });
    const stored = useGateStore.getState().entries;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ machineId: 'm-test', orgId: 'org-ja', status: 'Pending', direction: 'OUT' });
    expect(stored[0].gatePass).toBe(stored[0].reference);
  });

  it('Gate IN (machine On Hire) moves to PHI and never calls handleOnHire again', async () => {
    useAppStore.getState().setMachineStatus('m-test', 'On Hire');
    vi.mocked(handleOnHire).mockClear();
    await submitGateEntry();
    await waitFor(() =>
      expect(useAppStore.getState().getMachineCurrentStatus('m-test')).toBe('PHI'),
    );
    expect(handleOnHire).not.toHaveBeenCalled();
  });
});
