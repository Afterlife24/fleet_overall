import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MqdRecord } from '@/types/collection';
import {
  counterKey,
  formatDocNumber,
  migrateCounters,
  nextSequence,
  type CounterKey,
} from '@/services/collectionCore';
import { JA_ORG_ID } from '@/store/authStore';

interface MqdData {
  records: MqdRecord[]; // all orgs
  counters: Record<CounterKey, number>;
  demoSeededOrgs: string[];
}

interface MqdState extends MqdData {
  forOrg: (orgId: string) => MqdRecord[];
  getById: (id: string) => MqdRecord | undefined;
  issueNumber: (orgId: string, year: number) => string;
  insert: (r: MqdRecord) => void;
  patch: (id: string, data: Partial<MqdRecord>) => MqdRecord;
  remove: (id: string) => void;
  newId: () => string;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizeRecord(raw: Partial<MqdRecord> & { id: string }): MqdRecord {
  return {
    ...(raw as MqdRecord),
    orgId: typeof raw.orgId === 'string' && raw.orgId !== '' ? raw.orgId : JA_ORG_ID,
    number: typeof raw.number === 'string' ? raw.number : '',
    missing: Array.isArray(raw.missing) ? raw.missing : [],
    refNotes: Array.isArray(raw.refNotes) ? raw.refNotes : [],
    photoKeys: Array.isArray(raw.photoKeys) ? raw.photoKeys : [],
    fields:
      raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields) ? raw.fields : {},
  };
}

/** Pure, total migration of persisted state. Resets on malformed data. */
export function migrateMqdState(persisted: unknown): MqdData {
  const p = persisted as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.records)) {
    console.warn('[mqdStore] malformed persisted state; resetting');
    return { records: [], counters: {}, demoSeededOrgs: [] };
  }
  const records = (p.records as unknown[])
    .filter(
      (r): r is Partial<MqdRecord> & { id: string } =>
        !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
    )
    .map(normalizeRecord);
  return {
    records,
    counters: migrateCounters(p.counters, records),
    demoSeededOrgs: stringArray(p.demoSeededOrgs),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export const useMqdStore = create<MqdState>()(
  persist(
    (set, get) => ({
      records: [],
      counters: {},
      demoSeededOrgs: [],

      forOrg: (orgId) => get().records.filter((r) => r.orgId === orgId),

      getById: (id) => get().records.find((r) => r.id === id),

      issueNumber: (orgId, year) => {
        const { seq, counters } = nextSequence(get().counters, counterKey(orgId, 'MQD', year));
        set({ counters });
        return formatDocNumber('MQD', year, seq);
      },

      insert: (r) => set((state) => ({ records: [...state.records, r] })),

      patch: (id, data) => {
        const existing = get().records.find((r) => r.id === id);
        if (!existing) throw new Error('MQD not found');
        // Identity, ownership and numbering fields are immutable.
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const { id: _id, orgId: _orgId, number: _number, createdAt: _createdAt, ...rest } = data;
        /* eslint-enable @typescript-eslint/no-unused-vars */
        const updated: MqdRecord = { ...existing, ...rest };
        set((state) => ({ records: state.records.map((r) => (r.id === id ? updated : r)) }));
        return updated;
      },

      // Counters are intentionally left unchanged so numbers are never reused.
      remove: (id) => set((state) => ({ records: state.records.filter((r) => r.id !== id) })),

      newId: () => {
        const taken = new Set(get().records.map((r) => r.id));
        let id: string;
        do {
          id = `mqd-${Date.now().toString(36)}-${randomSuffix()}`;
        } while (taken.has(id));
        return id;
      },
    }),
    {
      name: 'fleet-mqd-v1',
      version: 1,
      partialize: (state) => ({
        records: state.records,
        counters: state.counters,
        demoSeededOrgs: state.demoSeededOrgs,
      }),
      migrate: (persisted) => migrateMqdState(persisted),
    }
  )
);
