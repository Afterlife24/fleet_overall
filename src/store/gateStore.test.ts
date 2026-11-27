// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateRecord } from '@/types/gate';
import { GATE_STORE_KEY, migrateGateStoreState, useGateStore } from './gateStore';


const rec = (id: string, over: Partial<GateRecord> = {}): GateRecord =>
  ({
    id, orgId: 'org-a', reference: `GP-${id}`, assetNumber: 'A-1', machineModel: 'CAT',
    direction: 'IN', timestamp: '2025-01-01T00:00:00.000Z', driver: '', destination: '',
    status: 'Pending', branchId: 'b', branchName: 'B', gatePass: `GP-${id}`,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }) as GateRecord;

const reset = () => useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: false, counters: {} });

beforeEach(() => {
  localStorage.clear();
  reset();
});
afterEach(() => vi.restoreAllMocks());

describe('gateStore actions', () => {
  it('add and forOrg are scoped per company', () => {
    useGateStore.getState().add(rec('1', { orgId: 'org-a' }));
    useGateStore.getState().add(rec('2', { orgId: 'org-b' }));
    expect(useGateStore.getState().forOrg('org-a').map((r) => r.id)).toEqual(['1']);
  });

  it('update patches a record and throws for an unknown id', () => {
    useGateStore.getState().add(rec('1'));
    expect(useGateStore.getState().update('1', { status: 'Approved' }).status).toBe('Approved');
    expect(() => useGateStore.getState().update('nope', {})).toThrow('Gate entry not found');
  });

  it('upsert inserts then replaces by id', () => {
    useGateStore.getState().upsert(rec('1'));
    useGateStore.getState().upsert(rec('1', { status: 'Completed' }));
    expect(useGateStore.getState().entries).toHaveLength(1);
    expect(useGateStore.getState().entries[0].status).toBe('Completed');
  });

  it('seedOrg inserts the rows and the markers together', () => {
    useGateStore.getState().seedOrg('org-a', [rec('s1'), rec('s2')]);
    expect(useGateStore.getState().entries.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(useGateStore.getState().seedMarkers['org-a']).toEqual(['s1', 's2']);
  });
});

describe('persistence', () => {
  it('records and seed markers survive a rebuild from the serialised state', () => {
    useGateStore.getState().add(rec('1'));
    useGateStore.getState().seedOrg('org-a', [rec('s1', { seedKey: 's1' })]);
    const { entries, seedMarkers, legacyImported } = useGateStore.getState();
    const rebuilt = migrateGateStoreState(JSON.parse(JSON.stringify({ entries, seedMarkers, legacyImported })));
    expect(rebuilt.entries).toEqual(entries);
    expect(rebuilt.seedMarkers).toEqual(seedMarkers);
  });

  it('malformed persisted state resets with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(migrateGateStoreState('junk')).toEqual({ entries: [], seedMarkers: {}, legacyImported: false, counters: {} });
    expect(warn).toHaveBeenCalled();
  });
});

describe('not persisted', () => {
  it('mutations do not write to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useGateStore.getState().add(rec('1'));
    useGateStore.getState().upsert(rec('2'));
    useGateStore.getState().seedOrg('org-a', [rec('s1')]);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('removes the old fleet-gate-entries-v1 key when the store loads', async () => {
    expect(GATE_STORE_KEY).toBe('fleet-gate-entries-v1');
    localStorage.setItem('fleet-gate-entries-v1', JSON.stringify({ state: { entries: [rec('old')] } }));
    vi.resetModules();
    await import('./gateStore');
    expect(localStorage.getItem('fleet-gate-entries-v1')).toBeNull();
  });

  it('importLegacyGateEntries is a no-op', async () => {
    const { importLegacyGateEntries } = await import('./gateStore');
    localStorage.setItem('fleet-app-store-v1', JSON.stringify({ state: { gateEntries: [{ id: 'x' }] } }));
    importLegacyGateEntries();
    expect(useGateStore.getState().entries).toEqual([]);
  });
});
