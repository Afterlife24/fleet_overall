import { create } from 'zustand';
import type { Quotation } from '@/types/quotation';
import { applyAutoWon, type AutoWonResult } from '@/features/crm/crmRules';

export type AutoWonOutcome =
  | { ok: true; result: AutoWonResult }
  | { ok: false; error: 'QUOTATION_NOT_FOUND' | 'QUOTATION_ORG_MISMATCH' };

interface CrmState {
  /**
   * In-memory read copy of the quotations for the retained browser screens (invoicing, collection, gate links).
   * The API is the authority: `readAdapters.mirrorRetainedData` fills this list and it is never persisted or seeded.
   * The CRM screens read and write through `quotationsApi`, not through this store.
   */
  quotations: Quotation[];
  /** Retained hire-link behavior: a machine going On Hire moves its quotation to Won in the browser copy. */
  autoWon: (orgId: string, id: string, user: string) => AutoWonOutcome;
}

export const useCrmStore = create<CrmState>()((set, get) => ({
  quotations: [],

  autoWon: (orgId, id, user) => {
    const q = get().quotations.find((x) => x.id === id);
    if (!q) return { ok: false, error: 'QUOTATION_NOT_FOUND' };
    if (q.orgId !== orgId) return { ok: false, error: 'QUOTATION_ORG_MISMATCH' };
    const result = applyAutoWon(q, user, new Date().toISOString());
    if (result.kind === 'changed') {
      const next = result.quotation;
      set((s) => ({ quotations: s.quotations.map((x) => (x.id === id ? next : x)) }));
    }
    return { ok: true, result };
  },
}));
