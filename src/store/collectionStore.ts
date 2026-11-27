import { create } from 'zustand';
import type { CollectionNote } from '@/types/collection';

/**
 * Non-persisted, in-memory copy of the collection notes read from the API. The API owns the records
 * and their numbers; this copy only lets the synchronous helpers (gate, signed copies) read them.
 * `useCollectionNotes` in `hooks/api/useCollectionApi.ts` replaces it on every refresh.
 */
interface CollectionState {
  notes: CollectionNote[];
  setAll: (notes: CollectionNote[]) => void;
  forOrg: (orgId: string) => CollectionNote[];
  getById: (id: string) => CollectionNote | undefined;
  /** Local change to the mirror only (the next refresh replaces it). */
  patch: (id: string, data: Partial<CollectionNote>) => CollectionNote;
}

export const useCollectionStore = create<CollectionState>()((set, get) => ({
  notes: [],
  setAll: (notes) => set({ notes }),
  forOrg: (orgId) => get().notes.filter((n) => n.orgId === orgId),
  getById: (id) => get().notes.find((n) => n.id === id),
  patch: (id, data) => {
    const existing = get().notes.find((n) => n.id === id);
    if (!existing) throw new Error('Collection note not found');
    const updated: CollectionNote = { ...existing, ...data, id: existing.id, orgId: existing.orgId, number: existing.number };
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? updated : n)) }));
    return updated;
  },
}));
