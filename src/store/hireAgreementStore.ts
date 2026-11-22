import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HireAgreement } from '@/types/hireagreement';
import { hireAgreements as seedAgreements } from '@/services/mock/hireagreement';
import { JA_ORG_ID } from '@/store/authStore';
import { demoQuotationForAgreement } from '@/services/mock/demoHireLink';

interface HireAgreementState {
  agreements: HireAgreement[]; // all orgs
  seededOrgs: string[]; // orgs whose seed rows were already inserted
  ensureSeeded: (orgId: string) => void;
  forOrg: (orgId: string) => HireAgreement[];
  getById: (id: string) => HireAgreement | undefined;
  insert: (a: HireAgreement) => void;
  patch: (id: string, data: Partial<HireAgreement>) => HireAgreement;
  remove: (id: string) => void;
  newId: () => string;
}

/** Fills defaults on rows persisted before orgId/quotationId existed. */
function normalizeAgreement(raw: Partial<HireAgreement> & { id: string }): HireAgreement {
  return {
    ...(raw as HireAgreement),
    quotationId: raw.quotationId ?? '',
    orgId: raw.orgId ?? JA_ORG_ID,
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export const useHireAgreementStore = create<HireAgreementState>()(
  persist(
    (set, get) => ({
      agreements: [],
      seededOrgs: [],

      ensureSeeded: (orgId) => {
        if (get().seededOrgs.includes(orgId)) return;
        const now = new Date().toISOString();
        const rows: HireAgreement[] = seedAgreements.map((s, i) => ({
          ...s,
          id: `ha-seed-${orgId}-${i + 1}`,
          orgId,
          // Demo data: the Johnson Arabia seed agreements are linked to their CRM quotations.
          quotationId: demoQuotationForAgreement(`ha-seed-${orgId}-${i + 1}`),
          createdAt: s.createdAt ?? now,
          updatedAt: s.updatedAt ?? now,
        }));
        set((state) => {
          if (state.seededOrgs.includes(orgId)) return state;
          const existing = new Set(state.agreements.map((a) => a.id));
          return {
            agreements: [...state.agreements, ...rows.filter((r) => !existing.has(r.id))],
            seededOrgs: [...state.seededOrgs, orgId],
          };
        });
      },

      forOrg: (orgId) => get().agreements.filter((a) => a.orgId === orgId),

      getById: (id) => get().agreements.find((a) => a.id === id),

      insert: (a) => set((state) => ({ agreements: [...state.agreements, a] })),

      patch: (id, data) => {
        const existing = get().agreements.find((a) => a.id === id);
        if (!existing) throw new Error('Hire agreement not found');
        // Identity and ownership fields are immutable.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, orgId: _orgId, createdAt: _createdAt, ...rest } = data;
        const updated: HireAgreement = { ...existing, ...rest };
        set((state) => ({
          agreements: state.agreements.map((a) => (a.id === id ? updated : a)),
        }));
        return updated;
      },

      remove: (id) =>
        set((state) => ({ agreements: state.agreements.filter((a) => a.id !== id) })),

      newId: () => {
        const taken = new Set(get().agreements.map((a) => a.id));
        let id: string;
        do {
          id = `ha-${Date.now().toString(36)}-${randomSuffix()}`;
        } while (taken.has(id));
        return id;
      },
    }),
    {
      name: 'fleet-hire-agreements-v1',
      version: 2,
      partialize: (state) => ({ agreements: state.agreements, seededOrgs: state.seededOrgs }),
      migrate: (persisted) => {
        const p = persisted as { agreements?: unknown; seededOrgs?: unknown } | null;
        if (!p || !Array.isArray(p.agreements)) {
          console.warn('[hireAgreementStore] malformed persisted state; resetting');
          return { agreements: [], seededOrgs: [] };
        }
        return {
          agreements: (p.agreements as Array<Partial<HireAgreement> & { id: string }>)
            .map(normalizeAgreement)
            // v1 -> v2: link the demo seed agreements to their quotations when not linked yet.
            .map((a) => (a.quotationId ? a : { ...a, quotationId: demoQuotationForAgreement(a.id) })),
          seededOrgs: Array.isArray(p.seededOrgs) ? (p.seededOrgs as string[]) : [],
        };
      },
    }
  )
);
