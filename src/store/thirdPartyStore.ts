import { create } from 'zustand';
import type { TpsDocument } from '@/types/collection';

/** Non-persisted, in-memory copy of the third-party service reports read from the API (see `useServiceReports`). */
interface ThirdPartyState {
  documents: TpsDocument[];
  setAll: (documents: TpsDocument[]) => void;
  forOrg: (orgId: string) => TpsDocument[];
  getById: (id: string) => TpsDocument | undefined;
  /** Local change to the mirror only (the next refresh replaces it). */
  patch: (id: string, data: Partial<TpsDocument>) => TpsDocument;
}

export const useThirdPartyStore = create<ThirdPartyState>()((set, get) => ({
  documents: [],
  setAll: (documents) => set({ documents }),
  forOrg: (orgId) => get().documents.filter((d) => d.orgId === orgId),
  getById: (id) => get().documents.find((d) => d.id === id),
  patch: (id, data) => {
    const existing = get().documents.find((d) => d.id === id);
    if (!existing) throw new Error('Third-party document not found');
    const updated: TpsDocument = { ...existing, ...data, id: existing.id, orgId: existing.orgId, number: existing.number };
    set((s) => ({ documents: s.documents.map((d) => (d.id === id ? updated : d)) }));
    return updated;
  },
}));
