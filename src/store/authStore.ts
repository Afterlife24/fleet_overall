import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useOrgStore } from './orgStore';
import { resetQueryCache } from '@/app/QueryProvider';
import { useBranchStore } from './branchStore';

// Reset the branch selector to "All Branches" so a stale branch id from a
// previous org doesn't filter the new org's data down to nothing.
function resetBranchSelection() {
  useBranchStore.getState().selectBranch('all', 'All Branches');
}

// Roles from overview.md §7 — ~46 named users + field-only drivers/operators
export type UserRole =
  | 'Security'            // Gate capture screen ONLY (4 users)
  | 'Site Supervisor'     // Field: delivery/collection, MQD, meter, signatures (4 users)
  | 'Field Technician'    // Mobile: breakdown dispatch, arrival/fix scans (TBC)
  | 'PHI/PDI Checker'     // Inspection forms, intake queue (4 users)
  | 'Workshop Coordinator'// Bay board, job cards, repair queue, approvals (3 users)
  | 'Workshop Manager'    // All workshop + final approvals + repair-cost (1 user)
  | 'Procurement'         // Parts-waiting list ONLY — NO bay/technician data (2 users)
  | 'Ops Executive'       // Planner, bookings, allocation, transport, extensions (7 users)
  | 'Operations Manager'  // All ops + oversight + approvals (3 users)
  | 'Sales Executive'     // Own enquiries, funnel, own hires, availability (6 users)
  | 'Sales Manager'       // Team funnel, per-rep performance (2 users)
  | 'Finance'             // Credit-hold, claims/credits approval, cost views (2 users)
  | 'Executive Manager'   // Cross-department oversight, all dashboards (2 users)
  | 'Managing Director'   // Everything (1 user)
  | 'Driver'              // Mobile run-sheet only (5 users)
  | 'Operator';           // Mobile timesheet only (as needed)

// Pages each role can access (overview.md §7)
export const rolePageAccess: Record<UserRole, string[]> = {
  'Security': ['/gate'],
  'Site Supervisor': ['/mqd', '/transport'],
  'Field Technician': ['/breakdowns'],
  'PHI/PDI Checker': ['/inspections/phi', '/inspections/pdi', '/mandatory-checks', '/job-cards'],
  'Workshop Coordinator': ['/', '/fleet', '/workshop', '/board', '/map', '/tracking', '/trucks', '/job-cards', '/inspections/phi', '/inspections/pdi', '/mandatory-checks', '/breakdowns'],
  'Workshop Manager': ['/', '/fleet', '/workshop', '/board', '/map', '/tracking', '/trucks', '/job-cards', '/inspections/phi', '/inspections/pdi', '/mandatory-checks', '/mqd', '/breakdowns', '/reports', '/reports/tripbase'],
  'Procurement': ['/workshop'], // Parts-waiting list view ONLY — no bay/technician data
  'Ops Executive': ['/', '/fleet', '/cross-hire', '/planner', '/workshop', '/board', '/map', '/tracking', '/trucks', '/transport', '/gate', '/inspections/phi', '/inspections/pdi', '/job-cards', '/mandatory-checks', '/mqd', '/breakdowns', '/notifications'],
  'Operations Manager': ['/', '/fleet', '/cross-hire', '/planner', '/workshop', '/board', '/map', '/tracking', '/trucks', '/transport', '/gate', '/inspections/phi', '/inspections/pdi', '/job-cards', '/mandatory-checks', '/mqd', '/breakdowns', '/reports', '/reports/tripbase', '/sales-portal', '/notifications', '/rules', '/apps', '/six-sigma', '/statistics'],
  'Sales Executive': ['/', '/fleet', '/cross-hire', '/planner', '/map', '/breakdowns'],
  'Sales Manager': ['/', '/fleet', '/cross-hire', '/planner', '/map', '/breakdowns', '/reports'],
  'Finance': ['/', '/fleet', '/breakdowns', '/reports'],
  'Executive Manager': ['/', '/fleet', '/planner', '/workshop', '/board', '/map', '/tracking', '/trucks', '/transport', '/gate', '/inspections/phi', '/inspections/pdi', '/job-cards', '/mandatory-checks', '/mqd', '/breakdowns', '/reports', '/reports/tripbase', '/sales-portal', '/notifications', '/users', '/settings', '/rules'],
  'Managing Director': ['/', '/fleet', '/planner', '/workshop', '/board', '/map', '/tracking', '/trucks', '/transport', '/gate', '/inspections/phi', '/inspections/pdi', '/job-cards', '/mandatory-checks', '/mqd', '/breakdowns', '/reports', '/reports/tripbase', '/sales-portal', '/notifications', '/users', '/settings', '/rules'],
  'Driver': ['/transport'],
  'Operator': ['/transport'],
};

// Feature-level visibility restrictions
export const roleFeatureAccess: Record<string, UserRole[]> = {
  // Procurement CANNOT see bay board or technician data (§7)
  'workshop.bayBoard': ['Workshop Coordinator', 'Workshop Manager', 'Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director'],
  'workshop.technicians': ['Workshop Coordinator', 'Workshop Manager', 'Ops Executive', 'Operations Manager', 'Executive Manager', 'Managing Director'],
  // Only these roles can manage users
  'users.manage': ['Executive Manager', 'Managing Director'],
  // Only these can change settings
  'settings.manage': ['Operations Manager', 'Executive Manager', 'Managing Director'],
  // Approval queues
  'approvals.workshop': ['Workshop Manager'],
  'approvals.procurement': ['Procurement'],
  'approvals.finance': ['Finance'],
  'approvals.executive': ['Executive Manager', 'Managing Director'],
};

// ── Role-based dashboard configuration (which cards/sections each role sees) ──
// Keys reference dashboard "widgets". A role only renders the widgets listed here.
export type DashboardWidget =
  | 'kpi.available'
  | 'kpi.onHire'
  | 'kpi.workshop'
  | 'kpi.breakdowns'
  | 'kpi.transport'
  | 'kpi.pdi'
  | 'kpi.phi'
  | 'kpi.total'
  | 'section.todayOps'
  | 'section.quickActions'
  | 'chart.fleetStatus'
  | 'chart.fleetCategory'
  | 'chart.branchUtil'
  | 'chart.workshopPerf'
  | 'chart.utilTrend'
  | 'section.recentActivity';

const FULL_DASHBOARD: DashboardWidget[] = [
  'kpi.available', 'kpi.onHire', 'kpi.workshop', 'kpi.breakdowns',
  'kpi.transport', 'kpi.pdi', 'kpi.phi', 'kpi.total',
  'section.todayOps', 'section.quickActions',
  'chart.fleetStatus', 'chart.fleetCategory',
  'chart.branchUtil', 'chart.workshopPerf', 'chart.utilTrend',
  'section.recentActivity',
];

export const roleDashboard: Record<UserRole, DashboardWidget[]> = {
  // Full-oversight roles see everything
  'Managing Director': FULL_DASHBOARD,
  'Executive Manager': FULL_DASHBOARD,
  'Operations Manager': FULL_DASHBOARD,

  // Hire desk / ops — full fleet + operations, no exec-only extras (still broad)
  'Ops Executive': [
    'kpi.available', 'kpi.onHire', 'kpi.transport', 'kpi.breakdowns', 'kpi.total',
    'section.todayOps', 'section.quickActions',
    'chart.fleetStatus', 'chart.fleetCategory', 'chart.branchUtil',
    'section.recentActivity',
  ],

  // Workshop roles — repair-focused
  'Workshop Manager': [
    'kpi.workshop', 'kpi.breakdowns', 'kpi.pdi', 'kpi.phi', 'kpi.total',
    'section.quickActions',
    'chart.fleetStatus', 'chart.workshopPerf',
    'section.recentActivity',
  ],
  'Workshop Coordinator': [
    'kpi.workshop', 'kpi.breakdowns', 'kpi.pdi', 'kpi.phi',
    'section.quickActions',
    'chart.workshopPerf',
    'section.recentActivity',
  ],

  // Sales roles — availability & demand focus, no workshop internals
  'Sales Manager': [
    'kpi.available', 'kpi.onHire', 'kpi.total',
    'chart.fleetCategory', 'chart.branchUtil', 'chart.utilTrend',
    'section.recentActivity',
  ],
  'Sales Executive': [
    'kpi.available', 'kpi.onHire', 'kpi.total',
    'chart.fleetCategory',
    'section.recentActivity',
  ],

  // Finance — fleet size, on-hire (revenue), breakdowns (credits/cost)
  'Finance': [
    'kpi.onHire', 'kpi.breakdowns', 'kpi.total',
    'chart.branchUtil', 'chart.utilTrend',
  ],

  // Inspection checker — inspection queues + fleet status context so the page is full
  'PHI/PDI Checker': [
    'kpi.pdi', 'kpi.phi', 'kpi.workshop', 'kpi.available',
    'section.todayOps', 'section.quickActions',
    'chart.fleetStatus', 'chart.workshopPerf',
    'section.recentActivity',
  ],

  // Field/ops-light roles — minimal or no dashboard widgets (they work from their own page)
  'Site Supervisor': ['kpi.transport', 'section.quickActions', 'section.recentActivity'],
  'Field Technician': ['kpi.breakdowns', 'section.recentActivity'],
  'Procurement': ['kpi.workshop', 'section.recentActivity'],
  'Security': ['section.quickActions'],
  'Driver': ['kpi.transport'],
  'Operator': [],
};

// Roles that work from a single page — they skip the dashboard and land directly
// on their working page (no half-empty dashboard). Value = the page to land on.
export const roleLandingPage: Partial<Record<UserRole, string>> = {
  'Security': '/gate',
  'Driver': '/transport',
  'Operator': '/transport',
  'Field Technician': '/breakdowns',
  'Procurement': '/workshop',
};

/**
 * Where a role should land after login.
 * - Explicit single-page roles go straight to their page.
 * - Roles with dashboard access ('/') land on the dashboard.
 * - Otherwise, the first page they can access.
 */
export function getLandingPage(role: UserRole): string {
  if (roleLandingPage[role]) return roleLandingPage[role]!;
  const pages = rolePageAccess[role] ?? [];
  if (pages.includes('/')) return '/';
  return pages[0] ?? '/';
}

interface DemoAccount {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  branchName: string;
  avatarColor: string;
}

// Demo accounts matching overview.md §7 roles
export const demoAccounts: DemoAccount[] = [
  // Managing Director — sees everything
  { email: 'md@johnsonarabia.com', password: 'md123', name: 'James Anderson', role: 'Managing Director', branchName: 'Dubai HQ', avatarColor: '#0ea5e9' },
  // Executive Manager
  { email: 'exec@johnsonarabia.com', password: 'exec123', name: 'Ben Stokes', role: 'Executive Manager', branchName: 'Dubai Main', avatarColor: '#6366f1' },
  // Operations Manager
  { email: 'opsmgr@johnsonarabia.com', password: 'ops123', name: 'Steve Smith', role: 'Operations Manager', branchName: 'Abu Dhabi', avatarColor: '#10b981' },
  // Ops Executive (Hire Desk)
  { email: 'hiredesk@johnsonarabia.com', password: 'hire123', name: 'Virat Kohli', role: 'Ops Executive', branchName: 'Dubai Main', avatarColor: '#f97316' },
  // Workshop Manager
  { email: 'wsmanager@johnsonarabia.com', password: 'ws123', name: 'Kane Williamson', role: 'Workshop Manager', branchName: 'Dubai Main', avatarColor: '#f59e0b' },
  // Workshop Coordinator
  { email: 'wscoord@johnsonarabia.com', password: 'coord123', name: 'Jos Buttler', role: 'Workshop Coordinator', branchName: 'Dubai Main', avatarColor: '#84cc16' },
  // Procurement — restricted access (no bay/technician data)
  { email: 'procurement@johnsonarabia.com', password: 'proc123', name: 'David Warner', role: 'Procurement', branchName: 'Dubai Main', avatarColor: '#ec4899' },
  // Security (Gate ONLY)
  { email: 'gate@johnsonarabia.com', password: 'gate123', name: 'Mitchell Starc', role: 'Security', branchName: 'Dubai Main', avatarColor: '#64748b' },
  // PHI/PDI Checker
  { email: 'checker@johnsonarabia.com', password: 'check123', name: 'Jasprit Bumrah', role: 'PHI/PDI Checker', branchName: 'Dubai Main', avatarColor: '#14b8a6' },
  // Sales Executive
  { email: 'sales@johnsonarabia.com', password: 'sales123', name: 'Rohit Sharma', role: 'Sales Executive', branchName: 'Dubai Main', avatarColor: '#a855f7' },
  // Driver (run-sheet only)
  { email: 'driver@johnsonarabia.com', password: 'drive123', name: 'Pat Cummins', role: 'Driver', branchName: 'Dubai Main', avatarColor: '#06b6d4' },
  // Finance
  { email: 'finance@johnsonarabia.com', password: 'fin123', name: 'Joe Root', role: 'Finance', branchName: 'Dubai HQ', avatarColor: '#eab308' },
];

interface AuthUser {
  name: string;
  email: string;
  role: UserRole;
  branchName: string;
  avatarColor: string;
  orgId: string;
  orgName: string;
  isOwner: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
  hasPageAccess: (path: string) => boolean;
  hasFeatureAccess: (feature: string) => boolean;
}

// The built-in Johnson Arabia demo org id (mirrors orgStore.JA_ORG_ID).
// Defined here too so authStore has no import cycle with orgStore.
export const JA_ORG_ID = 'org-ja';

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      login: (email, password) => {
        const normEmail = email.trim().toLowerCase();

        // 1) Built-in Johnson Arabia demo accounts (unchanged behaviour)
        const demo = demoAccounts.find(
          (a) => a.email.toLowerCase() === normEmail && a.password === password
        );
        if (demo) {
          resetQueryCache();
          resetBranchSelection();
          set({
            user: {
              name: demo.name, email: demo.email, role: demo.role,
              branchName: demo.branchName, avatarColor: demo.avatarColor,
              orgId: JA_ORG_ID, orgName: 'Johnson Arabia LLC', isOwner: false,
            },
            isAuthenticated: true,
          });
          return { success: true };
        }

        // 2) Signed-up orgs + owner-created members (from the org store)
        const account = useOrgStore.getState().findAccount(normEmail, password);
        if (account) {
          resetQueryCache();
          resetBranchSelection();
          set({
            user: {
              name: account.name, email: account.email, role: account.role,
              branchName: account.branchName, avatarColor: account.avatarColor,
              orgId: account.orgId, orgName: account.orgName, isOwner: account.isOwner,
            },
            isAuthenticated: true,
          });
          return { success: true };
        }

        return { success: false, error: 'Invalid email or password' };
      },
      logout: () => { resetQueryCache(); set({ user: null, isAuthenticated: false }); },
      hasPageAccess: (path: string) => {
        const user = get().user;
        if (!user) return false;
        // Workspace basics are available to every signed-in user; the pages
        // themselves gate owner-only actions internally.
        if (path === '/apps' || path === '/team' || path === '/users' || path === '/settings') return true;
        // MD and Executive Manager have access to everything
        if (user.role === 'Managing Director' || user.role === 'Executive Manager') return true;
        const allowedPages = rolePageAccess[user.role] || [];
        return allowedPages.some(p => path === p || path.startsWith(p + '/'));
      },
      hasFeatureAccess: (feature: string) => {
        const user = get().user;
        if (!user) return false;
        // MD sees everything
        if (user.role === 'Managing Director') return true;
        const allowedRoles = roleFeatureAccess[feature];
        if (!allowedRoles) return true; // No restriction defined = accessible
        return allowedRoles.includes(user.role);
      },
    }),
    { name: 'fleet-auth-v2' }
  )
);
