// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineStatus } from '@/types/machine';

vi.mock('@/services/hireLink', () => ({
  handleOnHire: vi.fn(),
}));

import { handleOnHire } from '@/services/hireLink';
import { useAppStore } from '@/store/appStore';

describe('appStore.setMachineStatus On Hire trigger', () => {
  beforeEach(() => {
    vi.mocked(handleOnHire).mockClear();
    useAppStore.setState({ machineOverrides: [] });
  });

  it('calls handleOnHire once with the machine source when status is On Hire', () => {
    useAppStore.getState().setMachineStatus('m-1', 'On Hire', 'test');
    expect(handleOnHire).toHaveBeenCalledTimes(1);
    expect(handleOnHire).toHaveBeenCalledWith({ source: 'machine', machineId: 'm-1' });
    expect(useAppStore.getState().getMachineCurrentStatus('m-1')).toBe('On Hire');
  });

  it.each(['Available', 'PHI', 'PDI', 'Allocated', 'Maintenance'] as MachineStatus[])(
    'does not call handleOnHire for status %s',
    (status) => {
      useAppStore.getState().setMachineStatus('m-1', status);
      expect(handleOnHire).not.toHaveBeenCalled();
    },
  );
});
