import { User, Permission } from '@/types/user';
import { branches, makeEntity } from './branches';
import { pick, randInt, daysAgoISO, randName, randPhone, randEmail } from './_gen';

// overview.md §7 — exact 16 roles with counts and access
type UserRole =
  | 'Security'            // 4 users — Gate screen ONLY
  | 'Site Supervisor'     // 4 users — MQD, delivery/collection
  | 'Field Technician'    // TBC — breakdown dispatch
  | 'PHI/PDI Checker'     // 4 users — inspection forms
  | 'Workshop Coordinator'// 3 users — bay board, job cards
  | 'Workshop Manager'    // 1 user  — all workshop + approvals
  | 'Procurement'         // 2 users — parts-waiting list ONLY
  | 'Ops Executive'       // 7 users — planner, bookings, transport
  | 'Operations Manager'  // 3 users — all ops + oversight
  | 'Sales Executive'     // 6 users — own enquiries, funnel
  | 'Sales Manager'       // 2 users — team funnel, per-rep performance
  | 'Finance'             // 2 users — credit-hold, claims
  | 'Executive Manager'   // 2 users — cross-department, dashboards
  | 'Managing Director'   // 1 user  — everything
  | 'Driver'              // 5 users — run-sheet only
  | 'Operator';           // as needed — timesheet only

// Permissions per role (§7 restrictions)
const PERMISSIONS_BY_ROLE: Record<UserRole, Permission[]> = {
  'Security':             ['fleet.view'],
  'Site Supervisor':      ['transport.manage', 'inspections.conduct'],
  'Field Technician':     ['fleet.view', 'workshop.manage'],
  'PHI/PDI Checker':      ['fleet.view', 'inspections.conduct'],
  'Workshop Coordinator': ['fleet.view', 'workshop.manage', 'inspections.conduct'],
  'Workshop Manager':     ['fleet.view', 'fleet.edit', 'workshop.manage', 'inspections.conduct', 'reports.view'],
  'Procurement':          ['workshop.manage'],   // parts-waiting list ONLY — no bay/technician
  'Ops Executive':        ['fleet.view', 'fleet.edit', 'bookings.manage', 'transport.manage', 'inspections.conduct'],
  'Operations Manager':   ['fleet.view', 'fleet.edit', 'bookings.manage', 'workshop.manage', 'transport.manage', 'inspections.conduct', 'reports.view'],
  'Sales Executive':      ['fleet.view', 'bookings.manage'],
  'Sales Manager':        ['fleet.view', 'bookings.manage', 'reports.view'],
  'Finance':              ['fleet.view', 'reports.view'],
  'Executive Manager':    ['fleet.view', 'fleet.edit', 'bookings.manage', 'workshop.manage', 'transport.manage', 'inspections.conduct', 'reports.view', 'users.manage', 'settings.manage'],
  'Managing Director':    ['fleet.view', 'fleet.edit', 'bookings.manage', 'workshop.manage', 'transport.manage', 'inspections.conduct', 'reports.view', 'users.manage', 'settings.manage'],
  'Driver':               ['transport.manage'],
  'Operator':             ['fleet.view'],
};

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#a855f7', '#06b6d4', '#eab308'];

// Named demo users matching the demo accounts in authStore
const NAMED_USERS: Array<{ name: string; email: string; role: UserRole; branch: string }> = [
  { name: 'James Anderson',       email: 'md@johnsonarabia.com',          role: 'Managing Director',   branch: 'br-dxb' },
  { name: 'Ben Stokes',           email: 'exec@johnsonarabia.com',        role: 'Executive Manager',   branch: 'br-dxb' },
  { name: 'Steve Smith',          email: 'opsmgr@johnsonarabia.com',      role: 'Operations Manager',  branch: 'br-auh' },
  { name: 'Virat Kohli',          email: 'hiredesk@johnsonarabia.com',    role: 'Ops Executive',       branch: 'br-dxb' },
  { name: 'Kane Williamson',      email: 'wsmanager@johnsonarabia.com',   role: 'Workshop Manager',    branch: 'br-dxb' },
  { name: 'Jos Buttler',          email: 'wscoord@johnsonarabia.com',     role: 'Workshop Coordinator',branch: 'br-taw' },
  { name: 'David Warner',         email: 'procurement@johnsonarabia.com', role: 'Procurement',         branch: 'br-dxb' },
  { name: 'Mitchell Starc',       email: 'gate@johnsonarabia.com',        role: 'Security',            branch: 'br-dxb' },
  { name: 'Jasprit Bumrah',       email: 'checker@johnsonarabia.com',     role: 'PHI/PDI Checker',     branch: 'br-dxb' },
  { name: 'Rohit Sharma',         email: 'sales@johnsonarabia.com',       role: 'Sales Executive',     branch: 'br-dxb' },
  { name: 'Pat Cummins',          email: 'driver@johnsonarabia.com',      role: 'Driver',              branch: 'br-dxb' },
  { name: 'Joe Root',             email: 'finance@johnsonarabia.com',     role: 'Finance',             branch: 'br-dxb' },
];

// Generate named users first, then random extras
export const users: User[] = [
  // Named accounts (match authStore demo accounts)
  ...NAMED_USERS.map((u, i) => ({
    ...makeEntity(`usr-${i + 1}`),
    name:        u.name,
    email:       u.email,
    phone:       `+971 5${randInt(0, 9)} ${randInt(100, 999)} ${randInt(1000, 9999)}`,
    role:        u.role as any,
    branchId:    u.branch,
    branchName:  branches.find(b => b.id === u.branch)?.name ?? 'Dubai',
    status:      'Active' as const,
    avatarColor: COLORS[i % COLORS.length],
    lastActive:  daysAgoISO(randInt(0, 7)),
    permissions: PERMISSIONS_BY_ROLE[u.role],
  })),
  // Random additional users
  ...Array.from({ length: 10 }, (_, i) => {
    const name   = randName();
    const role   = pick(Object.keys(PERMISSIONS_BY_ROLE) as UserRole[]);
    const branch = pick(branches);
    return {
      ...makeEntity(`usr-${NAMED_USERS.length + i + 1}`),
      name,
      email:       randEmail(name),
      phone:       `+971 5${randInt(0, 9)} ${randInt(100, 999)} ${randInt(1000, 9999)}`,
      role:        role as any,
      branchId:    branch.id,
      branchName:  branch.name,
      status:      pick(['Active', 'Active', 'Active', 'Inactive']) as 'Active' | 'Inactive',
      avatarColor: COLORS[(NAMED_USERS.length + i) % COLORS.length],
      lastActive:  daysAgoISO(randInt(0, 30)),
      permissions: PERMISSIONS_BY_ROLE[role],
    };
  }),
];

export function getUserById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}
