import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JobOverride, JobPatch, TransportJobRecord } from '@/types/transport';
import { counterFloorFromRefs, issueRef, REF_RE, type RefCounters } from '@/services/refCounterCore';
import { planSeeds } from '@/services/seedCore';
import { overrideKey } from '@/services/transportCore';
import { useAppStore, type StoredTransportJob } from '@/store/appStore';
import { useCollectionStore } from '@/store/collectionStore';

export const TRANSPORT_STORE_KEY = 'fleet-transport-jobs-v1';
const LEGACY_ORG_ID = 'org-ja';

export class TransportRefExhaustedError extends Error {
  constructor() {
    super('No further transport job references are available for this year');
    this.name = 'TransportRefExhaustedError';
  }
}

export interface TransportData {
  jobs: TransportJobRecord[];
  counters: RefCounters;
  seedMarkers: Record<string, string[]>;
  overrides: Record<string, JobOverride>;
  legacyImported: boolean;
  /** Set when persisted state could not be read. Not persisted. */
  migrationError?: boolean;
}

interface TransportState extends TransportData {
  forOrg: (orgId: string) => TransportJobRecord[];
  /** Throws TransportRefExhaustedError at 9999. */
  issueRef: (orgId: string, year: number) => string;
  add: (r: TransportJobRecord) => TransportJobRecord;
  /** Persisted rows are patched, other (mock) rows get an override. */
  update: (orgId: string, id: string, patch: JobPatch) => void;
  seedOrg: (orgId: string, seeds: TransportJobRecord[]) => TransportJobRecord[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const emptyData = (): TransportData => ({
  jobs: [], counters: {}, seedMarkers: {}, overrides: {}, legacyImported: false,
});

const isJob = (v: unknown): v is TransportJobRecord =>
  isObj(v) && typeof v.id === 'string' && typeof v.orgId === 'string';

/** Pure, total. Keeps every readable record unchanged; floors counters from existing references. */
export function migrateTransportState(persisted: unknown): TransportData {
  if (!isObj(persisted) || (persisted.jobs !== undefined && !Array.isArray(persisted.jobs))) {
    console.warn('[transportStore] malformed persisted state; starting empty');
    return { ...emptyData(), migrationError: true };
  }
  const jobs = ((persisted.jobs as unknown[] | undefined) ?? []).filter(isJob);
  const counters: RefCounters = {};
  if (isObj(persisted.counters)) {
    for (const [k, v] of Object.entries(persisted.counters)) {
      if (typeof v === 'number' && Number.isFinite(v)) counters[k] = v;
    }
  }
  const floor = counterFloorFromRefs(jobs.map((j) => ({ orgId: j.orgId, ref: String(j.reference ?? '') })));
  for (const [k, v] of Object.entries(floor)) counters[k] = Math.max(counters[k] ?? 0, v);
  const seedMarkers: Record<string, string[]> = {};
  if (isObj(persisted.seedMarkers)) {
    for (const [k, v] of Object.entries(persisted.seedMarkers)) {
      if (Array.isArray(v)) seedMarkers[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  const overrides: Record<string, JobOverride> = {};
  if (isObj(persisted.overrides)) {
    for (const [k, v] of Object.entries(persisted.overrides)) if (isObj(v)) overrides[k] = v as JobOverride;
  }
  return { jobs, counters, seedMarkers, overrides, legacyImported: persisted.legacyImported === true };
}

const yearOf = (iso: string): number => {
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? y : new Date().getFullYear();
};

export const useTransportStore = create<TransportState>()(
  persist(
    (set, get) => ({
      ...emptyData(),

      forOrg: (orgId) => get().jobs.filter((j) => j.orgId === orgId),

      issueRef: (orgId, year) => {
        const r = issueRef(get().counters, orgId, 'TJ', year);
        if (!r.ok) throw new TransportRefExhaustedError();
        set({ counters: r.counters });
        return r.ref;
      },

      add: (r) => {
        set((s) => ({ jobs: [...s.jobs, r] }));
        return r;
      },

      update: (orgId, id, patch) => {
        const now = new Date().toISOString();
        const has = get().jobs.some((j) => j.orgId === orgId && j.id === id);
        if (has) {
          set((s) => ({
            jobs: s.jobs.map((j) => (j.orgId === orgId && j.id === id ? { ...j, ...patch, updatedAt: now } : j)),
          }));
        } else {
          const key = overrideKey(orgId, id);
          const o: JobOverride = {};
          if (patch.status !== undefined) o.status = patch.status;
          if (patch.driverId !== undefined) o.driverId = patch.driverId;
          if (patch.driverName !== undefined) o.driverName = patch.driverName;
          set((s) => ({ overrides: { ...s.overrides, [key]: { ...s.overrides[key], ...o } } }));
        }
      },

      seedOrg: (orgId, seeds) => {
        const markers = get().seedMarkers[orgId] ?? [];
        const have = new Set(get().jobs.map((j) => j.id));
        const fresh = planSeeds(markers, have, seeds);
        set((s) => {
          let counters = s.counters;
          const added: TransportJobRecord[] = [];
          for (const seed of fresh) {
            let rec = seed;
            if (!REF_RE.test(rec.reference ?? '')) {
              const r = issueRef(counters, orgId, 'TJ', yearOf(rec.createdAt));
              if (!r.ok) continue;
              counters = r.counters;
              rec = { ...rec, reference: r.ref };
            }
            added.push(rec);
          }
          const floor = counterFloorFromRefs(added.map((j) => ({ orgId: j.orgId, ref: j.reference })));
          counters = { ...counters };
          for (const [k, v] of Object.entries(floor)) counters[k] = Math.max(counters[k] ?? 0, v);
          return {
            jobs: [...s.jobs, ...added],
            counters,
            seedMarkers: {
              ...s.seedMarkers,
              [orgId]: [...new Set([...markers, ...seeds.map((x) => x.id)])],
            },
          };
        });
        return get().jobs.filter((j) => fresh.some((f) => f.id === j.id));
      },
    }),
    {
      name: TRANSPORT_STORE_KEY,
      version: 1,
      partialize: (s) => ({
        jobs: s.jobs,
        counters: s.counters,
        seedMarkers: s.seedMarkers,
        overrides: s.overrides,
        legacyImported: s.legacyImported,
      }),
      migrate: (persisted) => migrateTransportState(persisted),
      merge: (persisted, current) => {
        if (persisted === undefined || persisted === null) return current;
        return { ...current, ...migrateTransportState(persisted) };
      },
    },
  ),
);

/**
 * One-time copy of the legacy appStore transport rows into this store. Never writes or
 * deletes appStore rows and never throws.
 */
export function importLegacyTransportJobs(): void {
  try {
    if (useTransportStore.getState().legacyImported) return;
    const legacy: StoredTransportJob[] = useAppStore.getState().transportJobs ?? [];
    const notes = useCollectionStore.getState().notes;
    const rows = [...legacy].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    useTransportStore.setState((s) => {
      const have = new Set(s.jobs.map((j) => j.id));
      let counters = s.counters;
      const added: TransportJobRecord[] = [];
      for (const l of rows) {
        if (!l || typeof l.id !== 'string' || have.has(l.id)) continue;
        const note = notes.find((n) => `tj-${n.id}` === l.id);
        const orgId = note?.orgId ?? LEGACY_ORG_ID;
        const createdAt = l.createdAt || new Date().toISOString();
        let reference = String(l.reference ?? '');
        if (!REF_RE.test(reference)) {
          const r = issueRef(counters, orgId, 'TJ', yearOf(createdAt));
          if (!r.ok) continue;
          counters = r.counters;
          reference = r.ref;
        }
        const rec: TransportJobRecord = {
          ...l,
          orgId,
          reference,
          machineId: l.machineId || undefined,
          sourceRef: l.reference !== reference ? l.reference : undefined,
          createdAt,
          updatedAt: l.updatedAt || createdAt,
        };
        if (note) rec.collectionNoteId = note.id;
        added.push(rec);
      }
      const floor = counterFloorFromRefs(added.map((j) => ({ orgId: j.orgId, ref: j.reference })));
      counters = { ...counters };
      for (const [k, v] of Object.entries(floor)) counters[k] = Math.max(counters[k] ?? 0, v);
      return { jobs: [...s.jobs, ...added], counters, legacyImported: true };
    });
  } catch {
    // unreadable legacy value: try again next load
  }
}

importLegacyTransportJobs();
