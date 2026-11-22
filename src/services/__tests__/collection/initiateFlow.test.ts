// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/toast-helper', () => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(), toastInfo: vi.fn(), toastWarning: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import { initiateOffHire, type MachineResolver } from '@/services/collectionDocs';
import type { MachineLite } from '@/services/collectionCore';

// Requirements 1.8, 1.9, 1.10, 1.11

const machine: MachineLite = {
  orgId: JA_ORG_ID,
  id: 'm-flow-1',
  fleetNo: 'FL-900',
  assetNumber: 'AS-900',
  make: 'CAT',
  model: '320',
  serialNumber: 'SN-900',
};
const resolver: MachineResolver = {
  list: () => [machine],
  statusOf: () => 'On Hire',
};

const ALL = ['mqd', 'third_party_services', 'transport'];

function setApps(active: string[]) {
  const base = useOrgStore.getState().getActiveApps(JA_ORG_ID).filter((a) => !ALL.includes(a));
  useOrgStore.setState({
    installedApps: { ...useOrgStore.getState().installedApps, [JA_ORG_ID]: [...base, ...active] },
  });
}

const DATE = '2026-05-10';
const counts = () => ({
  cn: useCollectionStore.getState().notes.filter((n) => n.machineId === machine.id).length,
  mqd: useMqdStore.getState().records.filter((n) => n.machineId === machine.id).length,
  tps: useThirdPartyStore.getState().documents.filter((n) => n.machineId === machine.id).length,
});

describe('initiateOffHire flow', () => {
  beforeEach(() => {
    localStorage.clear();
    useCollectionStore.setState({ notes: [], counters: {}, demoSeededOrgs: [JA_ORG_ID] });
    useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [JA_ORG_ID] });
    useThirdPartyStore.setState({ documents: [], counters: {}, demoSeededOrgs: [JA_ORG_ID] });
    setApps(ALL);
  });

  it('creates documents and calls the transport callback on success', () => {
    const cb = vi.fn();
    const r = initiateOffHire({ machineId: machine.id, date: DATE, machines: resolver, createTransportJob: cb });
    expect(r.ok).toBe(true);
    expect(r.cn && r.mqd && r.tps).toBeTruthy();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(r.cn);
    expect(r.notices.filter((n) => n.level === 'error')).toEqual([]);
    expect(counts()).toEqual({ cn: 1, mqd: 1, tps: 1 });
  });

  it('keeps documents and returns an error notice when the transport callback throws', () => {
    const cb = vi.fn(() => {
      throw new Error('boom');
    });
    const r = initiateOffHire({ machineId: machine.id, date: DATE, machines: resolver, createTransportJob: cb });
    expect(r.ok).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(counts()).toEqual({ cn: 1, mqd: 1, tps: 1 });
    const err = r.notices.find((n) => n.level === 'error');
    expect(err?.message).toContain('boom');
  });

  it('does not call the transport callback when Transport is inactive', () => {
    setApps(['mqd', 'third_party_services']);
    const cb = vi.fn();
    const r = initiateOffHire({ machineId: machine.id, date: DATE, machines: resolver, createTransportJob: cb });
    expect(r.ok).toBe(true);
    expect(cb).not.toHaveBeenCalled();
    expect(counts()).toEqual({ cn: 1, mqd: 1, tps: 1 });
  });

  it('skips the MQD with a notice when MQD is inactive', () => {
    setApps(['third_party_services', 'transport']);
    const r = initiateOffHire({ machineId: machine.id, date: DATE, machines: resolver });
    expect(r.ok).toBe(true);
    expect(r.mqd).toBeUndefined();
    expect(r.tps).toBeDefined();
    expect(r.notices.some((n) => n.level === 'info' && /MQD/.test(n.message))).toBe(true);
    expect(counts()).toEqual({ cn: 1, mqd: 0, tps: 1 });
  });

  it('skips the TPS with a notice when Third-Party Services is inactive', () => {
    setApps(['mqd', 'transport']);
    const r = initiateOffHire({ machineId: machine.id, date: DATE, machines: resolver });
    expect(r.ok).toBe(true);
    expect(r.tps).toBeUndefined();
    expect(r.mqd).toBeDefined();
    expect(r.notices.some((n) => n.level === 'info' && /TPS|Third-Party/.test(n.message))).toBe(true);
    expect(counts()).toEqual({ cn: 1, mqd: 1, tps: 0 });
  });
});
