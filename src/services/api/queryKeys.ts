import { useBranchStore } from '@/store/branchStore';
import { useSessionStore, type ApiSession } from './session';

/** Identifies whose data a query holds: the organization and the branch scope the user is looking at. */
export interface QueryScope {
  orgId: string | null;
  /** `'all'` for every branch the user may see, otherwise one branch id. */
  branch: string;
}

export function scopeFrom(session: ApiSession | null, selectedBranchId: string): QueryScope {
  if (!session) return { orgId: null, branch: 'all' };
  const { allBranches, branchId } = session.branchScope;
  return { orgId: session.organization.id, branch: allBranches ? selectedBranchId || 'all' : branchId ?? 'all' };
}

/** The scope right now, for non-React code. */
export function currentQueryScope(): QueryScope {
  return scopeFrom(useSessionStore.getState().session, useBranchStore.getState().selectedBranchId);
}

/** The scope as a hook; it changes when the session, organization or branch selection changes. */
export function useQueryScope(): QueryScope {
  const session = useSessionStore((s) => s.session);
  const selected = useBranchStore((s) => s.selectedBranchId);
  return scopeFrom(session, selected);
}

type Filters = Record<string, unknown> | undefined;

/** Keys for one resource: `[resource, orgId, branch, ...]`, so invalidating `all(scope)` clears every variant. */
function keysFor<R extends string>(resource: R) {
  return {
    all: (scope: QueryScope) => [resource, scope.orgId, scope.branch] as const,
    list: (scope: QueryScope, filters?: Filters) => [resource, scope.orgId, scope.branch, 'list', filters ?? {}] as const,
    detail: (scope: QueryScope, id: string) => [resource, scope.orgId, scope.branch, 'detail', id] as const,
    /** Keys for data owned by one record, such as `history` or `documents`. */
    child: (scope: QueryScope, id: string, name: string, filters?: Filters) =>
      [resource, scope.orgId, scope.branch, 'detail', id, name, filters ?? {}] as const,
  };
}

export const queryKeys = {
  company: keysFor('company'),
  branches: keysFor('branches'),
  roles: keysFor('roles'),
  users: keysFor('users'),
  apps: keysFor('apps'),
  customFields: keysFor('custom-fields'),
  customers: keysFor('customers'),
  machineModels: keysFor('machine-models'),
  machines: keysFor('machines'),
  machineDocuments: keysFor('machine-documents'),
  files: keysFor('files'),
  quotations: keysFor('quotations'),
  hireAgreements: keysFor('hire-agreements'),
  customerLpos: keysFor('customer-lpos'),
};
