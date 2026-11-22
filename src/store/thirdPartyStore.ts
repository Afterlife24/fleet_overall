import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TpsDocument } from '@/types/collection';
import {
  counterKey,
  formatDocNumber,
  migrateCounters,
  nextSequence,
  type CounterKey,
} from '@/services/collectionCore';
import { JA_ORG_ID } from '@/store/authStore';

interface ThirdPartyData {
  documents: TpsDocument[]; // all orgs
  counters: Record<CounterKey, number>;
  demoSeededOrgs: string[];
}

interface ThirdPartyState extends ThirdPartyData {
  forOrg: (orgId: string) => TpsDocument[];
  getById: (id: string) => TpsDocument | undefined;
  /** Bumps the org/year counter and returns TPS-YYYY-NNNN. */
  issueNumber: (orgId: string, year: number) => string;
  insert: (d: TpsDocument) => void;
  patch: (id: string, data: Partial<TpsDocument>) => TpsDocument;
  remove: (id: string) => void;
  newId: () => string;
}

function normalizeDocument(raw: Partial<TpsDocument> & { id: string }): TpsDocument {
  return {
    ...(raw as TpsDocument),
    orgId: typeof raw.orgId === 'string' && raw.orgId !== '' ? raw.orgId : JA_ORG_ID,
    lines: Array.isArray(raw.lines) ? raw.lines : [],
  };
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Pure, total migration of persisted state. Resets on malformed data. */
export function migrateThirdPartyState(persisted: unknown): ThirdPartyData {
  const p = persisted as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.documents)) {
    console.warn('[thirdPartyStore] malformed persisted state; resetting');
    return { documents: [], counters: {}, demoSeededOrgs: [] };
  }
  const documents = (p.documents as unknown[])
    .filter(
      (r): r is Partial<TpsDocument> & { id: string } =>
        !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
    )
    .map(normalizeDocument);
  return {
    documents,
    counters: migrateCounters(
      p.counters,
      documents.map((d) => ({ orgId: d.orgId, number: String(d.number ?? '') }))
    ),
    demoSeededOrgs: stringArray(p.demoSeededOrgs),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export const useThirdPartyStore = create<ThirdPartyState>()(
  persist(
    (set, get) => ({
      documents: [],
      counters: {},
      demoSeededOrgs: [],

      forOrg: (orgId) => get().documents.filter((d) => d.orgId === orgId),

      getById: (id) => get().documents.find((d) => d.id === id),

      issueNumber: (orgId, year) => {
        const { seq, counters } = nextSequence(get().counters, counterKey(orgId, 'TPS', year));
        set({ counters });
        return formatDocNumber('TPS', year, seq);
      },

      insert: (d) => set((state) => ({ documents: [...state.documents, d] })),

      patch: (id, data) => {
        const existing = get().documents.find((d) => d.id === id);
        if (!existing) throw new Error('Third-party services document not found');
        // Identity, ownership and number are immutable.
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const { id: _id, orgId: _orgId, number: _number, createdAt: _createdAt, ...rest } = data;
        /* eslint-enable @typescript-eslint/no-unused-vars */
        const updated: TpsDocument = { ...existing, ...rest };
        set((state) => ({
          documents: state.documents.map((d) => (d.id === id ? updated : d)),
        }));
        return updated;
      },

      // Counters are intentionally left unchanged so numbers are never reused.
      remove: (id) => set((state) => ({ documents: state.documents.filter((d) => d.id !== id) })),

      newId: () => {
        const taken = new Set(get().documents.map((d) => d.id));
        let id: string;
        do {
          id = `tps-${Date.now().toString(36)}-${randomSuffix()}`;
        } while (taken.has(id));
        return id;
      },
    }),
    {
      name: 'fleet-third-party-v1',
      version: 1,
      partialize: (state) => ({
        documents: state.documents,
        counters: state.counters,
        demoSeededOrgs: state.demoSeededOrgs,
      }),
      migrate: (persisted) => migrateThirdPartyState(persisted),
    }
  )
);
