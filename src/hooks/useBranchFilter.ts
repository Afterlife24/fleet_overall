import { useBranchStore, UAE_BRANCH_IDS } from '@/store/branchStore';

// Filters any list of items by the selected branch.
// - 'all' → every branch (UAE + KSA)
// - 'uae' → all UAE emirates combined (excludes KSA)
// - specific branch id → that branch only
export function useBranchFilter<T extends { branchId?: string }>(items: T[] | undefined): T[] {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  if (!items) return [];
  if (branchId === 'all') return items;
  if (branchId === 'uae') return items.filter((i) => i.branchId && UAE_BRANCH_IDS.includes(i.branchId));
  return items.filter((i) => i.branchId === branchId);
}
