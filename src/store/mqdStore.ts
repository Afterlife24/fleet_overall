import { create } from 'zustand';
import type { MqdRecord } from '@/types/collection';

/** Non-persisted, in-memory copy of the MQD reports read from the API (see `useMqdReports`). */
interface MqdState {
  records: MqdRecord[];
  setAll: (records: MqdRecord[]) => void;
  forOrg: (orgId: string) => MqdRecord[];
  getById: (id: string) => MqdRecord | undefined;
  /** Local change to the mirror only (the next refresh replaces it). */
  patch: (id: string, data: Partial<MqdRecord>) => MqdRecord;
}

export const useMqdStore = create<MqdState>()((set, get) => ({
  records: [],
  setAll: (records) => set({ records }),
  forOrg: (orgId) => get().records.filter((r) => r.orgId === orgId),
  getById: (id) => get().records.find((r) => r.id === id),
  patch: (id, data) => {
    const existing = get().records.find((r) => r.id === id);
    if (!existing) throw new Error('MQD not found');
    const updated: MqdRecord = { ...existing, ...data, id: existing.id, orgId: existing.orgId, number: existing.number };
    set((s) => ({ records: s.records.map((r) => (r.id === id ? updated : r)) }));
    return updated;
  },
}));
