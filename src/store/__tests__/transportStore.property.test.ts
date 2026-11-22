// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  importLegacyTransportJobs, migrateTransportState, TransportRefExhaustedError, useTransportStore,
} from '../transportStore';
import { useAppStore, type StoredTransportJob } from '../appStore';
import { recordArb } from '../../services/__tests__/transportCore.arbs';
import { transportJobFromCollection } from '../../services/transportCore';

const reset = () =>
  useTransportStore.setState({
    jobs: [], counters: {}, seedMarkers: {}, overrides: {}, legacyImported: true, migrationError: undefined,
  });

beforeEach(() => {
  localStorage.clear();
  reset();
});

const data = () => {
  const s = useTransportStore.getState();
  return { jobs: s.jobs, counters: s.counters, seedMarkers: s.seedMarkers, overrides: s.overrides, legacyImported: s.legacyImported };
};

// Feature: rental-flow-integration, Property 18: Company isolation and persistence round trip
// **Validates: Requirements 1.6, 1.12, 9.1, 9.2, 9.3**
describe('Property 18: transport store isolation and persistence', () => {
  it('forOrg returns only that company, and a change for A leaves B equal', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(recordArb('org-a'), { selector: (r) => r.id, maxLength: 6 }),
        fc.uniqueArray(recordArb('org-b'), { selector: (r) => r.id, maxLength: 6 }),
        (a, b) => {
          reset();
          const bIds = new Set(b.map((r) => r.id));
          const aOnly = a.filter((r) => !bIds.has(r.id));
          [...aOnly, ...b].forEach((r) => useTransportStore.getState().add(r));
          const st = useTransportStore.getState();
          expect(st.forOrg('org-a').every((r) => r.orgId === 'org-a')).toBe(true);
          expect(st.forOrg('org-b')).toEqual(b);
          st.issueRef('org-a', 2026);
          if (aOnly[0]) st.update('org-a', aOnly[0].id, { status: 'Cancelled' });
          expect(useTransportStore.getState().forOrg('org-b')).toEqual(b);
          expect(Object.keys(useTransportStore.getState().counters).every((k) => k.startsWith('org-a|'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('serialize then migrate returns the same records, counters, markers and overrides', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(recordArb('org-a'), { selector: (r) => r.id, maxLength: 6 }),
        fc.nat(5),
        (rows, extraRefs) => {
          reset();
          rows.forEach((r) => useTransportStore.getState().add(r));
          for (let i = 0; i < extraRefs; i++) useTransportStore.getState().issueRef('org-a', 2026);
          useTransportStore.getState().update('org-a', 'mock-1', { status: 'Completed' });
          useTransportStore.getState().seedOrg('org-a', []);
          const before = data();
          const round = migrateTransportState(JSON.parse(JSON.stringify(before)));
          expect(round.jobs).toEqual(before.jobs);
          expect(round.overrides).toEqual(before.overrides);
          expect(round.seedMarkers).toEqual(before.seedMarkers);
          for (const [k, v] of Object.entries(before.counters)) expect(round.counters[k]).toBeGreaterThanOrEqual(v);
          expect(round.migrationError).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('migrates previous-version state (jobs only) without losing a record or throwing', () => {
    fc.assert(
      fc.property(fc.uniqueArray(recordArb('org-a'), { selector: (r) => r.id, maxLength: 6 }), (rows) => {
        const out = migrateTransportState({ jobs: rows });
        expect(out.jobs).toEqual(rows);
        expect(out.migrationError).toBeUndefined();
        // counters are floored from existing references, so a new ref never repeats
        reset();
        useTransportStore.setState({ ...out, migrationError: undefined });
        const issued = useTransportStore.getState().issueRef('org-a', 2026);
        expect(rows.some((r) => r.reference === issued)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('malformed state yields an empty store with migrationError and never throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.string(), fc.integer(), fc.constant({ jobs: 'x' }), fc.constant([1])), (bad) => {
        const out = migrateTransportState(bad);
        expect(out.jobs).toEqual([]);
        expect(out.migrationError).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('transportStore behaviour', () => {
  it('issues sequential references per company and year and throws at 9999', () => {
    const s = useTransportStore.getState();
    expect(s.issueRef('org-a', 2026)).toBe('TJ-2026-0001');
    expect(s.issueRef('org-a', 2026)).toBe('TJ-2026-0002');
    expect(s.issueRef('org-b', 2026)).toBe('TJ-2026-0001');
    useTransportStore.setState({ counters: { 'org-a|TJ|2027': 9999 } });
    expect(() => useTransportStore.getState().issueRef('org-a', 2027)).toThrow(TransportRefExhaustedError);
    expect(useTransportStore.getState().counters['org-a|TJ|2027']).toBe(9999);
  });

  it('seedOrg does not re-add deleted or overwrite edited seeds and gives them a TJ- reference', () => {
    const base = fcSample('org-a');
    const seed = { ...base, id: 'tj-demo-org-a-1', reference: '', createdAt: '2026-02-01T00:00:00.000Z' };
    expect(useTransportStore.getState().seedOrg('org-a', [seed])).toHaveLength(1);
    const stored = useTransportStore.getState().forOrg('org-a')[0];
    expect(stored.reference).toBe('TJ-2026-0001');
    useTransportStore.getState().update('org-a', seed.id, { status: 'Completed' });
    expect(useTransportStore.getState().seedOrg('org-a', [seed])).toHaveLength(0);
    expect(useTransportStore.getState().forOrg('org-a')[0].status).toBe('Completed');
    useTransportStore.setState({ jobs: [] });
    expect(useTransportStore.getState().seedOrg('org-a', [seed])).toHaveLength(0);
  });

  it('imports legacy appStore transport jobs once and never writes appStore', () => {
    const legacy: StoredTransportJob = {
      id: 'tj-cn-1', reference: 'CN-2026-0001', plannerName: 'p', date: '2026-01-01', shift: 'Morning',
      transportTeam: '', srNo: 0, fleet: 'F1', machineId: 'm1', from: 'a', to: 'b', transport: '', type: 'O',
      contact: '', sales: '', client: 'c', time: '', status: 'Scheduled', autoGenerated: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    useAppStore.setState({ transportJobs: [legacy] });
    useTransportStore.setState({ legacyImported: false });
    importLegacyTransportJobs();
    importLegacyTransportJobs();
    const rows = useTransportStore.getState().forOrg('org-ja');
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe('TJ-2026-0001');
    expect(rows[0].sourceRef).toBe('CN-2026-0001');
    expect(useAppStore.getState().transportJobs).toEqual([legacy]);
    expect(useTransportStore.getState().legacyImported).toBe(true);
    useAppStore.setState({ transportJobs: [] });
  });

  it('a collection-generated record carries the note number and a TJ- reference', () => {
    const rec = transportJobFromCollection(
      { id: 'cn1', orgId: 'org-a', number: 'CN-2026-0007', date: '2026-04-01', fleetNo: 'F9', machineId: 'm9', customerName: 'X' },
      'TJ-2026-0003', 'tj-cn1', '2026-04-01T00:00:00.000Z',
    );
    expect(rec).toMatchObject({ reference: 'TJ-2026-0003', sourceRef: 'CN-2026-0007', type: 'O', autoGenerated: true, orgId: 'org-a' });
  });
});

function fcSample(orgId: string) {
  return fc.sample(recordArb(orgId), 1)[0];
}
