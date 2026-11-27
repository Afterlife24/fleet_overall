import type { AuthMode } from './types.js';

/**
 * Action codes the server knows. Anything outside this list is denied (Requirement 6.14).
 * Grants are derived from the role grants in the frontend `src/store/authStore.ts`
 * (rolePageAccess and roleFeatureAccess), copied here because server code must not import browser stores.
 */
export const ACTION_CODES = [
  'company.read',
  'users.manage',
  'settings.manage',
  'customers.read',
  'customers.write',
  'machines.read',
  'machines.write',
  'quotations.read',
  'quotations.write',
  'quotations.reopen',
  'hire_agreements.read',
  'hire_agreements.write',
  'lpos.read',
  'lpos.write',
  'files.read',
  'files.write',
  // Stage 2+: planner, invoices, transport, collection, documents, gate and intake.
  'bookings.read',
  'bookings.write',
  'bookings.start_hire',
  'invoices.read',
  'invoices.write',
  'invoices.transport_repeat',
  'invoices.report_payment',
  'transport.read',
  'transport.write',
  'collection.read',
  'collection.write',
  'documents.read',
  'documents.write',
  'gate.read',
  'gate.write',
  'gate.approve',
  'inspections.read',
  'inspections.write',
  'inspections.release_hold',
] as const;

export type ActionCode = (typeof ACTION_CODES)[number];

const ACTION_SET: ReadonlySet<string> = new Set(ACTION_CODES);

export function isActionCode(value: string): value is ActionCode {
  return ACTION_SET.has(value);
}

/** Frontend role label -> stable role code, e.g. "PHI/PDI Checker" -> "phi-pdi-checker". */
export function roleCodeFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ALL_ROLES = [
  'Security', 'Site Supervisor', 'Field Technician', 'PHI/PDI Checker', 'Workshop Coordinator',
  'Workshop Manager', 'Procurement', 'Ops Executive', 'Operations Manager', 'Sales Executive',
  'Sales Manager', 'Finance', 'Executive Manager', 'Managing Director', 'Driver', 'Operator',
].map(roleCodeFromName);

// Roles whose rolePageAccess contains '/fleet' (Managing Director and Executive Manager have full access).
const FLEET_VIEW = [
  'Workshop Coordinator', 'Workshop Manager', 'Ops Executive', 'Operations Manager', 'Sales Executive',
  'Sales Manager', 'Finance', 'Executive Manager', 'Managing Director',
];
const FLEET_MANAGE = ['Workshop Manager', 'Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director'];
// Roles with the planner / cross-hire / sales-portal pages: the CRM chain users.
const CRM_VIEW = [
  'Ops Executive', 'Operations Manager', 'Sales Executive', 'Sales Manager', 'Finance',
  'Executive Manager', 'Managing Director',
];
const CRM_WRITE = [
  'Ops Executive', 'Operations Manager', 'Sales Executive', 'Sales Manager', 'Executive Manager', 'Managing Director',
];
// Reopening a Lost quotation is a manager decision. The frontend has no explicit grant for it.
const CRM_REOPEN = ['Sales Manager', 'Operations Manager', 'Executive Manager', 'Managing Director'];
// roleFeatureAccess 'users.manage' and 'settings.manage'.
const USERS_MANAGE = ['Executive Manager', 'Managing Director'];
const SETTINGS_MANAGE = ['Operations Manager', 'Executive Manager', 'Managing Director'];

// Planner, transport and collection: the CRM chain users plus the operations roles that move machines.
const OPS_VIEW = [...CRM_VIEW, 'Site Supervisor', 'Workshop Coordinator', 'Workshop Manager', 'Security'];
const OPS_WRITE = ['Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director'];
const PLANNER_WRITE = [...OPS_WRITE, 'Sales Executive', 'Sales Manager'];
const TRANSPORT_VIEW = [...OPS_VIEW, 'Driver'];
// Invoices: Finance issues; sales and managers prepare.
const INVOICE_VIEW = ['Finance', 'Sales Manager', 'Operations Manager', 'Ops Executive', 'Executive Manager', 'Managing Director'];
const INVOICE_WRITE = ['Finance', 'Sales Manager', 'Operations Manager', 'Executive Manager', 'Managing Director'];
const INVOICE_PRIVILEGED = ['Finance', 'Executive Manager', 'Managing Director'];
// Gate: security records movements; supervisors and managers approve.
const GATE_VIEW = ['Security', 'Site Supervisor', 'Ops Executive', 'Operations Manager', 'Workshop Manager', 'Executive Manager', 'Managing Director'];
const GATE_WRITE = ['Security', 'Site Supervisor', 'Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director'];
const GATE_APPROVE = ['Site Supervisor', 'Operations Manager', 'Executive Manager', 'Managing Director'];
// Return intake inspections.
const INSPECT_VIEW = [
  'PHI/PDI Checker', 'Field Technician', 'Workshop Coordinator', 'Workshop Manager', 'Site Supervisor',
  'Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director',
];
const INSPECT_WRITE = ['PHI/PDI Checker', 'Field Technician', 'Workshop Coordinator', 'Workshop Manager', 'Operations Manager', 'Executive Manager', 'Managing Director'];
const INSPECT_RELEASE = ['Workshop Manager', 'Operations Manager', 'Executive Manager', 'Managing Director'];
const DOCS_VIEW = [...new Set([...CRM_VIEW, ...OPS_VIEW, ...INVOICE_VIEW])];
const DOCS_WRITE = [...new Set([...PLANNER_WRITE, 'Site Supervisor', 'Finance'])];

const codes = (names: string[]): string[] => names.map(roleCodeFromName);

const GRANTS: Record<ActionCode, string[]> = {
  'company.read': ALL_ROLES,
  'users.manage': codes(USERS_MANAGE),
  'settings.manage': codes(SETTINGS_MANAGE),
  'customers.read': codes(CRM_VIEW),
  'customers.write': codes(CRM_WRITE),
  'machines.read': codes(FLEET_VIEW),
  'machines.write': codes(FLEET_MANAGE),
  'quotations.read': codes(CRM_VIEW),
  'quotations.write': codes(CRM_WRITE),
  'quotations.reopen': codes(CRM_REOPEN),
  'hire_agreements.read': codes(CRM_VIEW),
  'hire_agreements.write': codes(CRM_WRITE),
  'lpos.read': codes(CRM_VIEW),
  'lpos.write': codes(CRM_WRITE),
  'files.read': codes([...new Set([...CRM_VIEW, ...FLEET_VIEW, ...DOCS_VIEW, ...GATE_VIEW, ...INSPECT_VIEW])]),
  'files.write': codes([...new Set([...CRM_WRITE, ...FLEET_MANAGE, ...DOCS_WRITE, ...GATE_WRITE, ...INSPECT_WRITE])]),
  'bookings.read': codes([...new Set([...OPS_VIEW, ...GATE_VIEW, ...INSPECT_VIEW])]),
  'bookings.write': codes(PLANNER_WRITE),
  'bookings.start_hire': codes([...new Set([...PLANNER_WRITE, ...GATE_WRITE])]),
  'invoices.read': codes(INVOICE_VIEW),
  'invoices.write': codes(INVOICE_WRITE),
  'invoices.transport_repeat': codes(INVOICE_PRIVILEGED),
  'invoices.report_payment': codes(INVOICE_PRIVILEGED),
  'transport.read': codes(TRANSPORT_VIEW),
  'transport.write': codes(OPS_WRITE),
  'collection.read': codes(OPS_VIEW),
  'collection.write': codes(PLANNER_WRITE),
  'documents.read': codes(DOCS_VIEW),
  'documents.write': codes(DOCS_WRITE),
  'gate.read': codes(GATE_VIEW),
  'gate.write': codes(GATE_WRITE),
  'gate.approve': codes(GATE_APPROVE),
  'inspections.read': codes(INSPECT_VIEW),
  'inspections.write': codes(INSPECT_WRITE),
  'inspections.release_hold': codes(INSPECT_RELEASE),
};

/** Default actions of a role code (empty for unknown/custom role codes). */
export function defaultActionsForRole(roleCode: string): ActionCode[] {
  return ACTION_CODES.filter((a) => GRANTS[a].includes(roleCode));
}

/**
 * Effective actions of a role: the permission codes stored on the role row, restricted to the allowlist.
 * A role whose stored list is empty falls back to the defaults of its code, so a built-in role
 * is usable before an administrator edits it; a custom role code with no stored list has no actions.
 */
export function effectiveActions(roleCode: string, storedPermissions: readonly string[]): ActionCode[] {
  const stored = storedPermissions.filter(isActionCode);
  if (stored.length > 0) return [...new Set(stored)];
  return defaultActionsForRole(roleCode);
}

export interface Principal {
  userId: string;
  displayName: string;
  orgId: string;
  orgName: string;
  roleCode: string;
  /** The user's own branch; null when the user has no branch. */
  branchId: string | null;
  allBranches: boolean;
  permissions: ActionCode[];
  authMode: AuthMode;
}

export interface ResourceRef {
  orgId: string;
  branchId?: string | null;
}

/** allow; forbid -> 403 (known resource of the own company); hide -> 404 (another company). */
export type AuthDecision = 'allow' | 'forbid' | 'hide';

export function authorize(principal: Principal, action: string, resource?: ResourceRef): AuthDecision {
  if (!isActionCode(action)) return 'forbid';
  if (resource && resource.orgId !== principal.orgId) return 'hide';
  if (!principal.permissions.includes(action)) return 'forbid';
  if (resource && resource.branchId && !principal.allBranches && resource.branchId !== principal.branchId) {
    return 'forbid';
  }
  return 'allow';
}
