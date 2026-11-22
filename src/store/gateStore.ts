import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GateRecord, GateStoreState } from '@/types/gate';
import { migrateGateRecords, migrateGateState } from '@/services/gateCore';
import { counterFloorFromRefs, issueRef as issueRefCore, type RefCounters } from '@/services/refCounterCore';

export const GATE_STORE_KEY = 'fleet-gate-entries-v1';
const LEGACY_APP_STORE_KEY = 'fleet-app-store-v1';
const LEGACY_ORG_ID = 'org-ja';

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
  /** Insert or replace by id (copy-on-write of mock rows). */
  upsert: (r: GateRecord) => GateRecord;
  /** Inserts the planned seeds and their markers in one set(). */
  seedOrg: (orgId: string, seeds: GateRecord[]) => GateRecord[];
}

const isCounters = (v: unknown): v is RefCounters => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Counters from existing GP-YYYY-NNNN references, never below any persisted counter. */
function floorCounters(entries: readonly GateRecord[], persisted: unknown): RefCounters {
  const out: RefCounters = { ...counterFloorFromRefs(entries.map((r) => ({ orgId: r.orgId, ref: r.reference }))) };
  if (isCounters(persisted)) {
    for (const [k, v] of Object.entries(persisted)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = Math.floor(v);
    }
  }
  return out;
}

/** Pure, total migration of persisted state (v1 or v2). Warns and resets on malformed input. */
export function migrateGateStoreState(persisted: unknown): GateStoreState & { counters: RefCounters } {
  const ok = typeof persisted === 'object' && persisted !== null && Array.isArray((persisted as { entries?: unknown }).entries);
  if (!ok) console.warn('[gateStore] malformed persisted state; resetting');
  const state = migrateGateState(persisted);
  const raw = ok ? (persisted as { counters?: unknown }).counters : undefined;
  return { ...state, counters: floorCounters(state.entries, raw) };
}
export const useGateStore = create<GateState>()(
  persist(
    (set, get) => ({
      entries: [],
      seedMarkers: {},
      legacyImported: false,
      counters: {},

      issueRef: (orgId, year) => {
        const s = get();
        // Existing references floor the counter, so a ref is never reused even if state was set directly.
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
    }),
    {
      name: GATE_STORE_KEY,
      version: 2,
      partialize: (state) => ({
        entries: state.entries,
        seedMarkers: state.seedMarkers,
        legacyImported: state.legacyImported,
        counters: state.counters,
      }),
      migrate: (persisted) => migrateGateStoreState(persisted),
    },
  ),
);

/**
 * One-time copy of the legacy appStore gate rows into the gate store. Never writes to appStore
 * and never throws. An unreadable or malformed legacy value leaves legacyImported false.
 */
export function importLegacyGateEntries(): void {
  try {
    if (useGateStore.getState().legacyImported) return;
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LEGACY_APP_STORE_KEY);
    let legacyRows: unknown[] = [];
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      const state = (parsed as { state?: { gateEntries?: unknown } } | null)?.state;
      const rows = state?.gateEntries;
      if (rows !== undefined && !Array.isArray(rows)) return;
      legacyRows = (rows as unknown[] | undefined) ?? [];
    }
    const migrated = migrateGateRecords(legacyRows, LEGACY_ORG_ID);
    useGateStore.setState((s) => {
      const have = new Set(s.entries.map((r) => r.id));
      return {
        entries: [...s.entries, ...migrated.filter((r) => !have.has(r.id))],
        legacyImported: true,
      };
    });
  } catch {
    // unreadable legacy value: try again next load
  }
}

importLegacyGateEntries();
