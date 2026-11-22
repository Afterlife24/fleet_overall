// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateRecord } from '@/types/gate';
import { importLegacyGateEntries, migrateGateStoreState, useGateStore } from './gateStore';

const LEGACY_KEY = 'fleet-app-store-v1';

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

describe('legacy import', () => {
  const legacy = (rows: unknown) =>
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ state: { gateEntries: rows } }));

  it('imports a row without orgId once as org-ja, leaving appStore data unchanged', () => {
    legacy([{ id: 'old-1', reference: 'GP-1', assetNumber: 'A-9' }]);
    const before = localStorage.getItem(LEGACY_KEY);
    importLegacyGateEntries();
    importLegacyGateEntries();
    const rows = useGateStore.getState().entries;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'old-1', orgId: 'org-ja' });
    expect(useGateStore.getState().legacyImported).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(before);
  });

  it('does not import again once the flag is set, even for new legacy rows', () => {
    legacy([{ id: 'old-1' }]);
    importLegacyGateEntries();
    legacy([{ id: 'old-1' }, { id: 'old-2' }]);
    importLegacyGateEntries();
    expect(useGateStore.getState().entries.map((r) => r.id)).toEqual(['old-1']);
  });

  it('keeps an existing orgId and skips ids already stored', () => {
    useGateStore.getState().add(rec('old-1', { orgId: 'org-a' }));
    legacy([{ id: 'old-1', orgId: 'org-z' }, { id: 'old-2', orgId: 'org-z' }]);
    importLegacyGateEntries();
    const rows = useGateStore.getState().entries;
    expect(rows.map((r) => `${r.id}:${r.orgId}`)).toEqual(['old-1:org-a', 'old-2:org-z']);
  });

  it.each([['not json'], [JSON.stringify({ state: { gateEntries: 'x' } })]])(
    'a malformed legacy value does not throw and leaves the flag false (%s)',
    (raw) => {
      localStorage.setItem(LEGACY_KEY, raw);
      expect(() => importLegacyGateEntries()).not.toThrow();
      expect(useGateStore.getState().legacyImported).toBe(false);
      expect(useGateStore.getState().entries).toEqual([]);
    },
  );
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
