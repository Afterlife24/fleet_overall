import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { branches as mockBranches } from '@/services/mock/branches';

interface BranchState {
  selectedBranchId: string;
  selectedBranchName: string;
  selectBranch: (id: string, name: string) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      selectedBranchId: 'all',
      selectedBranchName: 'All Branches',
      selectBranch: (id, name) => set({ selectedBranchId: id, selectedBranchName: name }),
    }),
    {
      name: 'fleet-branch-v2',   // bumped version — clears old persisted branch IDs
      onRehydrateStorage: () => (state) => {
        // If the persisted branchId no longer exists in the new branch list, reset to 'all'
        if (!state) return;
        const validIds = ['all', 'uae', 'br-dxb', 'br-auh', 'br-taw', 'br-oil', 'br-fuj', 'br-ksa'];
        if (!validIds.includes(state.selectedBranchId)) {
          state.selectedBranchId = 'all';
          state.selectedBranchName = 'All Branches';
        }
      },
    }
  )
);

// UAE branch IDs (everything except KSA) — used by the "UAE" combined filter
export const UAE_BRANCH_IDS = mockBranches
  .filter((b) => b.country === 'UAE')
  .map((b) => b.id);

export const branchOptions = [
  { id: 'all', name: 'All Branches', code: 'ALL', country: '' as const },
  { id: 'uae', name: 'UAE (All Emirates)', code: 'UAE', country: 'UAE' as const },
  ...mockBranches.map((b) => ({ id: b.id, name: b.name, code: b.code, country: b.country })),
];
