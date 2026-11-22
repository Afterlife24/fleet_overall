import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CollectionNote } from '@/types/collection';
import {
  counterKey,
  formatDocNumber,
  migrateCounters,
  nextSequence,
  type CounterKey,
} from '@/services/collectionCore';
import { JA_ORG_ID } from '@/store/authStore';

interface CollectionData {
  notes: CollectionNote[]; // all orgs
  counters: Record<CounterKey, number>;
  demoSeededOrgs: string[]; // once-per-org demo flag
}

interface CollectionState extends CollectionData {
  forOrg: (orgId: string) => CollectionNote[];
  getById: (id: string) => CollectionNote | undefined;
  issueNumber: (orgId: string, year: number) => string;
  insert: (n: CollectionNote) => void;
  patch: (id: string, data: Partial<CollectionNote>) => CollectionNote;
  remove: (id: string) => void;
  newId: () => string;
}

function normalizeNote(raw: Partial<CollectionNote> & { id: string }): CollectionNote {
  return { ...(raw as CollectionNote), orgId: raw.orgId ?? JA_ORG_ID };
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Pure, total migration of persisted state. Resets on malformed data, drops rows without a string id,
 * defaults a missing orgId, and rebuilds counters as the max of stored values and stored numbers.
 */
export function migrateCollectionState(persisted: unknown): CollectionData {
  const p = persisted as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.notes)) {
    console.warn('[collectionStore] malformed persisted state; resetting');
    return { notes: [], counters: {}, demoSeededOrgs: [] };
  }
  const notes = (p.notes as unknown[])
    .filter(
      (r): r is Partial<CollectionNote> & { id: string } =>
        !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
    )
    .map(normalizeNote);
  const docs = notes
    .filter((n) => typeof n.number === 'string')
    .map((n) => ({ orgId: n.orgId, number: n.number }));
  return {
    notes,
    counters: migrateCounters(p.counters, docs),
    demoSeededOrgs: stringArray(p.demoSeededOrgs),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      notes: [],
      counters: {},
      demoSeededOrgs: [],

      forOrg: (orgId) => get().notes.filter((n) => n.orgId === orgId),

      getById: (id) => get().notes.find((n) => n.id === id),

      issueNumber: (orgId, year) => {
        const { seq, counters } = nextSequence(get().counters, counterKey(orgId, 'CN', year));
        set({ counters });
        return formatDocNumber('CN', year, seq);
      },

      insert: (n) => set((state) => ({ notes: [...state.notes, n] })),

      patch: (id, data) => {
        const existing = get().notes.find((n) => n.id === id);
        if (!existing) throw new Error('Collection note not found');
        // Identity, ownership and numbering fields are immutable.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, orgId: _orgId, number: _number, createdAt: _createdAt, ...rest } = data;
        const updated: CollectionNote = { ...existing, ...rest };
        set((state) => ({ notes: state.notes.map((n) => (n.id === id ? updated : n)) }));
        return updated;
      },

      // Counters are intentionally left unchanged so numbers are never reused.
      remove: (id) => set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

      newId: () => {
        const taken = new Set(get().notes.map((n) => n.id));
        let id: string;
        do {
          id = `cn-${Date.now().toString(36)}-${randomSuffix()}`;
        } while (taken.has(id));
        return id;
      },
    }),
    {
      name: 'fleet-collection-notes-v1',
      version: 1,
      partialize: (state) => ({
        notes: state.notes,
        counters: state.counters,
        demoSeededOrgs: state.demoSeededOrgs,
      }),
      migrate: (persisted) => migrateCollectionState(persisted),
    }
  )
);
