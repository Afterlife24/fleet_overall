// Gate passes, movements and return-intake inspections live on the backend (`/api/v1/gate-passes`, `/inspections`).
// This store is a non-persisted, in-memory mirror kept only so retained code that still imports it compiles
// (old importers of the store). It holds no business records across reloads and nothing seeds it.
// The Gate screens read and write through `src/hooks/api/useGateApi.ts`.
import { create } from 'zustand';
import type { GateRecord, GateStoreState } from '@/types/gate';
import { migrateGateState } from '@/services/gateCore';
import { counterFloorFromRefs, issueRef as issueRefCore, type RefCounters } from '@/services/refCounterCore';

/** The key the gate store used to persist under. It is removed from the browser on load. */
export const GATE_STORE_KEY = 'fleet-gate-entries-v1';

/** Thrown when the 9999 references of a company and year are used. */
export class GateRefExhaustedError extends Error {
  constructor() {
    super('No further gate pass references available');
    this.name = 'GateRefExhaustedError';
  }
}

interface GateState extends GateStoreState {
  counters: RefCounters;
  /** Issues the next GP-<year>-<4 digits> reference. Throws GateRefExhaustedError at 9999. */
  issueRef: (orgId: string, year: number) => string;
  forOrg: (orgId: string) => GateRecord[];
  add: (r: GateRecord) => GateRecord;
  /** Throws when the id is unknown. Identity and ownership fields are kept. */
  update: (id: string, patch: Partial<GateRecord>) => GateRecord;
  /** Insert or replace by id. */
  upsert: (r: GateRecord) => GateRecord;
  /** Inserts the given records and their markers in one set(). */
  seedOrg: (orgId: string, seeds: GateRecord[]) => GateRecord[];
}

const isCounters = (v: unknown): v is RefCounters => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Counters from existing GP-YYYY-NNNN references, never below any given counter. */
function floorCounters(entries: readonly GateRecord[], persisted: unknown): RefCounters {
  const out: RefCounters = { ...counterFloorFromRefs(entries.map((r) => ({ orgId: r.orgId, ref: r.reference }))) };
  if (isCounters(persisted)) {
    for (const [k, v] of Object.entries(persisted)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = Math.floor(v);
    }
  }
  return out;
}

/** Pure, total migration of an old serialised state. Warns and resets on malformed input. */
export function migrateGateStoreState(persisted: unknown): GateStoreState & { counters: RefCounters } {
  const ok = typeof persisted === 'object' && persisted !== null && Array.isArray((persisted as { entries?: unknown }).entries);
  if (!ok) console.warn('[gateStore] malformed persisted state; resetting');
  const state = migrateGateState(persisted);
  const raw = ok ? (persisted as { counters?: unknown }).counters : undefined;
  return { ...state, counters: floorCounters(state.entries, raw) };
}

export const useGateStore = create<GateState>()((set, get) => ({
  entries: [],
  seedMarkers: {},
  legacyImported: true,
  counters: {},

  issueRef: (orgId, year) => {
    const s = get();
    const base = floorCounters(s.entries, s.counters);
    const r = issueRefCore(base, orgId, 'GP', year);
    if (!r.ok) throw new GateRefExhaustedError();
    set({ counters: r.counters });
    return r.ref;
  },

  forOrg: (orgId) => get().entries.filter((r) => r.orgId === orgId),

  add: (r) => {
    set((s) => ({ entries: [...s.entries, r] }));
    return r;
  },

  update: (id, patch) => {
    const existing = get().entries.find((r) => r.id === id);
    if (!existing) throw new Error('Gate entry not found');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, orgId: _orgId, ...rest } = patch;
    const updated: GateRecord = { ...existing, ...rest, updatedAt: new Date().toISOString() };
    set((s) => ({ entries: s.entries.map((r) => (r.id === id ? updated : r)) }));
    return updated;
  },

  upsert: (r) => {
    set((s) =>
      s.entries.some((x) => x.id === r.id)
        ? { entries: s.entries.map((x) => (x.id === r.id ? r : x)) }
        : { entries: [...s.entries, r] },
    );
    return r;
  },

  seedOrg: (orgId, seeds) => {
    const have = new Set(get().entries.map((r) => r.id));
    const fresh = seeds.filter((s) => !have.has(s.id));
    set((s) => ({
      entries: [...s.entries, ...fresh],
      seedMarkers: {
        ...s.seedMarkers,
        [orgId]: [...new Set([...(s.seedMarkers[orgId] ?? []), ...seeds.map((x) => x.id)])],
      },
    }));
    return fresh;
  },
}));

/** Removes the browser copy of the records this store used to persist. Never throws. */
export function purgeLegacyGateStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(GATE_STORE_KEY);
  } catch {
    // storage unavailable: nothing to remove
  }
}

/** Kept for importers: the legacy rows are no longer copied into the browser. Does nothing. */
export function importLegacyGateEntries(): void {
  // Gate records are owned by the backend; there is nothing to import.
}

purgeLegacyGateStorage();
