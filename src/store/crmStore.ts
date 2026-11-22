import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { Quotation, QuotationDraft, QuotationPhase } from '@/types/quotation';
import { seedQuotations } from '@/services/mock/quotations';
import {
  applyAutoWon,
  applyTransition,
  nextHireAgreementNo,
  type AutoWonResult,
  type TransitionResult,
} from '@/features/crm/crmRules';

import { DEMO_SPELLING_FIXES, canonicalCustomerByName } from '@/services/customerCore';
export type AutoWonOutcome =
  | { ok: true; result: AutoWonResult }
  | { ok: false; error: 'QUOTATION_NOT_FOUND' | 'QUOTATION_ORG_MISMATCH' };

export const CRM_STORAGE_KEY = 'fleet-crm-v1';

/** localStorage wrapper: unreadable data is dropped (seed is used) with a warning. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (raw === null) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.state || !Array.isArray(parsed.state.quotations)) throw new Error('bad shape');
      return raw;
    } catch {
      console.warn('[crm] persisted data unreadable, loading seed');
      return null;
    }
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, value); } catch { console.warn('[crm] could not persist quotations'); }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

const SEED_ID_RE = /^qt-(?:seed-|.+-seed-)\d+$/;

/** Rewrites seed quotations that still carry a non-canonical demo spelling. User quotations are never touched. */
export function canonicalizeSeedQuotations(qs: readonly Quotation[]): Quotation[] {
  return qs.map((q) => {
    if (!q || typeof q.id !== 'string' || !SEED_ID_RE.test(q.id)) return q;
    if (!Object.prototype.hasOwnProperty.call(DEMO_SPELLING_FIXES, q.customerName)) return q;
    const canonical = canonicalCustomerByName(DEMO_SPELLING_FIXES[q.customerName]);
    return canonical ? { ...q, customerName: canonical.name, customerId: canonical.customerId } : q;
  });
}

/** Pure and total. Keeps every persisted quotation; v4 only canonicalizes demo spellings of seed ids. */
export function migrateCrmState(persisted: unknown, version: number): { quotations: Quotation[] } {
  const p = persisted as { quotations?: Quotation[] } | undefined;
  if (version < 2 || !Array.isArray(p?.quotations)) return { quotations: canonicalizeSeedQuotations(seedQuotations) };
  let list = p.quotations;
  if (version < 3) {
    const have = new Set(list.map((q) => q?.id));
    list = [...list, ...seedQuotations.filter((s) => !have.has(s.id))];
  }
  return { quotations: canonicalizeSeedQuotations(list) };
}

interface CrmState {
  quotations: Quotation[];
  create: (orgId: string, draft: QuotationDraft, user: string) => Quotation;
  changePhase: (id: string, to: QuotationPhase, user: string, reason?: string) => TransitionResult;
  autoWon: (orgId: string, id: string, user: string) => AutoWonOutcome;
  resetToSeed: () => void;
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      quotations: seedQuotations,

      create: (orgId, draft, user) => {
        const now = new Date().toISOString();
        const mine = get().quotations.filter((q) => q.orgId === orgId);
        const seq = mine.length + 1;
        const q: Quotation = {
          id: `qt-${Date.now()}`,
          orgId,
          number: `QT-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
          currency: 'AED',
          customerId: `CUS-${Date.now().toString().slice(-4)}`,
          ...draft,
          // Existing company keeps its number; a new company gets the next one.
          hireAgreementNo: draft.hireAgreementNo || nextHireAgreementNo(mine),
          phase: 'Awaiting',
          salesRep: draft.salesRep ?? user,
          createdAt: now,
          updatedAt: now,
          history: [{ id: `ph-${Date.now()}`, timestamp: now, user, fromPhase: null, toPhase: 'Awaiting' }],
        };
        set((s) => ({ quotations: [...s.quotations, q] }));
        return q;
      },

      changePhase: (id, to, user, reason) => {
        const q = get().quotations.find((x) => x.id === id);
        if (!q) return { ok: false, error: 'Quotation not found' };
        const res = applyTransition(q, to, user, new Date().toISOString(), reason);
        if (res.ok) {
          set((s) => ({ quotations: s.quotations.map((x) => (x.id === id ? res.quotation : x)) }));
        }
        return res;
      },

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

      resetToSeed: () => set({ quotations: seedQuotations }),
    }),
    {
      name: CRM_STORAGE_KEY,
      version: 4,
      // v1 data had no opportunity / hire agreement fields: start from the seed.
      // v2 -> v3: keep the user's quotations and add any seed quotation they lack (demo data).
      // v3 -> v4: keep every quotation; canonicalize demo customer spellings of seed ids only.
      migrate: (persisted, version) => migrateCrmState(persisted, version) as unknown as CrmState,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ quotations: s.quotations }) as CrmState,
    },
  ),
);
