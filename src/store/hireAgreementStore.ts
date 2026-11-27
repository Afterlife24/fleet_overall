import { create } from 'zustand';
import type { HireAgreement } from '@/types/hireagreement';

interface HireAgreementState {
  /**
   * In-memory read copy of the hire agreements for the retained browser screens (invoicing, planner links,
   * collection). The API is the authority: `readAdapters.mirrorRetainedData` fills this list; it is never
   * persisted or seeded. The Hire Agreement screen reads and writes through `hireAgreementsApi`.
   */
  agreements: HireAgreement[];
  forOrg: (orgId: string) => HireAgreement[];
  getById: (id: string) => HireAgreement | undefined;
}

export const useHireAgreementStore = create<HireAgreementState>()((_set, get) => ({
  agreements: [],
  forOrg: (orgId) => get().agreements.filter((a) => a.orgId === orgId),
  getById: (id) => get().agreements.find((a) => a.id === id),
}));
