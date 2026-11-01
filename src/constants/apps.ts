import {
  Forklift, ArrowRightLeft, CalendarDays, Wrench, Truck as TruckIcon,
  ScanLine, ClipboardCheck, BarChart3, Building2, Gauge,
  FileText, AlertTriangle, ShieldCheck, PackageCheck, KanbanSquare,
  Map as MapIcon, Route as RouteIcon, TrendingUp,
  FileSignature, ShoppingCart, Send, Undo2, Receipt, FileSpreadsheet, BadgeDollarSign,
} from 'lucide-react';

/**
 * App registry — the AxleOps equivalent of Odoo's `ir.module.module`.
 *
 * Each "app" is a toggleable module a company can ACTIVATE or DEACTIVATE from
 * the Apps screen. An app groups one or more sidebar pages (`paths`), the first
 * of which is its landing page. Activating an app makes its pages appear in the
 * sidebar; deactivating hides them (data is kept, Odoo-style).
 *
 * `core` apps (Dashboard, Team, Settings, …) are always available and are not
 * shown on the Apps screen — like Odoo's `base`.
 *
 * `depends` lists app ids that must be active for this app to work. Activating
 * an app auto-activates its dependencies; you can't deactivate an app another
 * active app depends on.
 */
export interface AppDef {
  id: string;
  name: string;
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'Operations' | 'Inspections' | 'Documents' | 'Management';
  /** Sidebar routes this app owns. First entry = landing page. */
  paths: string[];
  /** Labels shown in the sidebar for each path (same order as `paths`). */
  labels: string[];
  depends?: string[];
  /** Core apps are always on and never shown on the Apps screen. */
  core?: boolean;
  color?: string;
}

export const APPS: AppDef[] = [
  // ── Dashboard (activatable like every other app) ──────────────────
  {
    id: 'dashboard', name: 'Dashboard', summary: 'Operations overview & KPIs',
    icon: BarChart3, category: 'Operations', color: '#6366f1',
    paths: ['/'], labels: ['Dashboard'],
  },

  // ── Operations apps (toggleable) ──────────────────────────────────
  {
    id: 'fleet', name: 'Fleet', summary: 'Manage machines, assets and availability',
    icon: Forklift, category: 'Operations', color: '#6366f1',
    paths: ['/fleet'], labels: ['Fleet'],
  },
  {
    id: 'cross_hire', name: 'Cross Hire', summary: 'Rent equipment in from suppliers and re-hire to clients',
    icon: ArrowRightLeft, category: 'Operations', color: '#0ea5e9', depends: ['fleet'],
    paths: ['/cross-hire'], labels: ['Cross Hire'],
  },
  {
    id: 'planner', name: 'Planner', summary: 'Bookings calendar and hire-desk planning',
    icon: CalendarDays, category: 'Operations', color: '#10b981', depends: ['fleet'],
    paths: ['/planner'], labels: ['Planner'],
  },
  {
    id: 'workshop', name: 'Workshop', summary: 'Repair bays, job queue and technician assignment',
    icon: Wrench, category: 'Operations', color: '#f59e0b', depends: ['fleet'],
    paths: ['/workshop'], labels: ['Workshop'],
  },
  {
    id: 'job_cards', name: 'Job Cards', summary: 'Workshop repair job cards',
    icon: FileText, category: 'Operations', color: '#eab308', depends: ['fleet'],
    paths: ['/job-cards'], labels: ['Job Cards'],
  },
  {
    id: 'breakdowns', name: 'Breakdowns', summary: 'On-site breakdown reports and dispatch',
    icon: AlertTriangle, category: 'Operations', color: '#ef4444', depends: ['fleet'],
    paths: ['/breakdowns'], labels: ['Breakdowns'],
  },
  {
    id: 'transport', name: 'Transport', summary: 'Delivery and collection scheduling',
    icon: TruckIcon, category: 'Operations', color: '#8b5cf6', depends: ['fleet'],
    paths: ['/transport'], labels: ['Transport'],
  },
  {
    id: 'truck_tracking', name: 'Truck Tracking', summary: 'Live truck locations and status',
    icon: TruckIcon, category: 'Operations', color: '#6366f1',
    paths: ['/trucks'], labels: ['Truck Tracking'],
  },
  {
    id: 'job_tracking', name: 'Job Tracking', summary: 'Track delivery/collection jobs end to end',
    icon: RouteIcon, category: 'Operations', color: '#0ea5e9',
    paths: ['/tracking'], labels: ['Job Tracking'],
  },
  {
    id: 'board', name: 'Operations Board', summary: 'Kanban board of operational jobs',
    icon: KanbanSquare, category: 'Operations', color: '#14b8a6',
    paths: ['/board'], labels: ['Operations Board'],
  },
  {
    id: 'map', name: 'Fleet Map', summary: 'Map view of fleet locations',
    icon: MapIcon, category: 'Operations', color: '#10b981', depends: ['fleet'],
    paths: ['/map'], labels: ['Fleet Map'],
  },
  {
    id: 'gate', name: 'Gate Operations', summary: 'Gate entry/exit passes and movement',
    icon: ScanLine, category: 'Operations', color: '#14b8a6',
    paths: ['/gate'], labels: ['Gate Operations'],
  },
  {
    id: 'branches', name: 'Branches', summary: 'Manage multiple branches/locations and filter data by branch',
    icon: Building2, category: 'Operations', color: '#64748b',
    paths: ['/branches'], labels: ['Branches'],
  },

  // ── Inspections apps (each standalone) ────────────────────────────
  {
    id: 'phi', name: 'PHI Inspection', summary: 'Post-hire inspections',
    icon: ClipboardCheck, category: 'Inspections', color: '#06b6d4', depends: ['fleet'],
    paths: ['/inspections/phi'], labels: ['PHI Inspection'],
  },
  {
    id: 'pdi', name: 'PDI Inspection', summary: 'Pre-despatch inspections',
    icon: ShieldCheck, category: 'Inspections', color: '#0ea5e9', depends: ['fleet'],
    paths: ['/inspections/pdi'], labels: ['PDI Inspection'],
  },
  {
    id: 'mandatory_checks', name: 'Mandatory Checks', summary: 'Mechanic mandatory checks',
    icon: Gauge, category: 'Inspections', color: '#8b5cf6', depends: ['fleet'],
    paths: ['/mandatory-checks'], labels: ['Mandatory Checks'],
  },
  {
    id: 'mqd', name: 'MQD', summary: 'Machine Quality Document',
    icon: PackageCheck, category: 'Inspections', color: '#14b8a6', depends: ['fleet'],
    paths: ['/mqd'], labels: ['MQD'],
  },

  // ── Documents apps (each standalone) ──────────────────────────────
  {
    id: 'quotation', name: 'Quotation / Hire Agreement', summary: 'Quotations and hire agreements',
    icon: FileSignature, category: 'Documents', color: '#6366f1',
    paths: ['/docs/quotation'], labels: ['Quotations'],
  },
  {
    id: 'lpo', name: 'LPO', summary: 'Local Purchase Orders',
    icon: ShoppingCart, category: 'Documents', color: '#0ea5e9',
    paths: ['/docs/lpo'], labels: ['LPO'],
  },
  {
    id: 'delivery_note', name: 'Delivery Note', summary: 'Delivery notes for despatched equipment',
    icon: Send, category: 'Documents', color: '#10b981',
    paths: ['/docs/delivery-note'], labels: ['Delivery Notes'],
  },
  {
    id: 'collection_note', name: 'Collection Note', summary: 'Collection notes for returned equipment',
    icon: Undo2, category: 'Documents', color: '#f59e0b',
    paths: ['/docs/collection-note'], labels: ['Collection Notes'],
  },
  {
    id: 'invoice', name: 'Invoice', summary: 'Customer invoices',
    icon: Receipt, category: 'Documents', color: '#8b5cf6',
    paths: ['/docs/invoice'], labels: ['Invoices'],
  },
  {
    id: 'soa', name: 'SOA', summary: 'Statement of Account',
    icon: FileSpreadsheet, category: 'Documents', color: '#14b8a6',
    paths: ['/docs/soa'], labels: ['Statement of Account'],
  },
  {
    id: 'payment_receipt', name: 'Payment Receipt', summary: 'Payment receipts',
    icon: BadgeDollarSign, category: 'Documents', color: '#22c55e',
    paths: ['/docs/payment-receipt'], labels: ['Payment Receipts'],
  },

  // ── Management apps (each standalone) ──────────────────────────────
  {
    id: 'reports', name: 'Reports', summary: 'Analytics and performance dashboards',
    icon: BarChart3, category: 'Management', color: '#f97316',
    paths: ['/reports'], labels: ['Reports'],
  },
  {
    id: 'tripbase', name: 'TRIPBASE', summary: 'Trip-based transport report',
    icon: TrendingUp, category: 'Management', color: '#f59e0b',
    paths: ['/reports/tripbase'], labels: ['TRIPBASE'],
  },
  {
    id: 'sales', name: 'Sales Portal', summary: 'Enquiries, funnel and sales performance',
    icon: Building2, category: 'Management', color: '#a855f7',
    paths: ['/sales-portal'], labels: ['Sales Portal'],
  },
  {
    id: 'six_sigma', name: 'Six Sigma', summary: 'Lean metrics, MTBF/MTTR and 5S workplace scoring',
    icon: Gauge, category: 'Management', color: '#ec4899', depends: ['fleet'],
    paths: ['/six-sigma'], labels: ['Six Sigma'],
  },
  {
    id: 'statistics', name: 'Statistics', summary: 'Fleet utilization, status mix and analytics',
    icon: BarChart3, category: 'Management', color: '#0ea5e9', depends: ['fleet'],
    paths: ['/statistics'], labels: ['Statistics'],
  },

];

/**
 * Fixed workspace items — always in the sidebar, never activatable, not shown
 * on the Apps screen. These are the company's admin basics (like Odoo's base
 * Settings/Users): Apps, Team, Roles & Users, Settings.
 */
export const WORKSPACE_PATHS = ['/apps', '/team', '/users', '/settings'];

/** Apps shown on the Apps screen (everything except core), A→Z by name. */
export const INSTALLABLE_APPS = APPS
  .filter((a) => !a.core)
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Default active apps for a brand-new company: NONE.
 * A fresh company sees only the Apps screen and activates what it needs,
 * exactly like a new Odoo database.
 */
export const DEFAULT_ACTIVE_APP_IDS: string[] = [];

/** All app ids — used to mark the Johnson Arabia demo as fully loaded. */
export const ALL_APP_IDS = APPS.map((a) => a.id);

const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));

export function getApp(id: string): AppDef | undefined {
  return APP_BY_ID[id];
}

/** Resolve an app id plus all of its (transitive) dependencies. */
export function withDependencies(id: string): string[] {
  const out = new Set<string>();
  const visit = (appId: string) => {
    if (out.has(appId)) return;
    out.add(appId);
    (getApp(appId)?.depends ?? []).forEach(visit);
  };
  visit(id);
  return [...out];
}

/** Which active apps depend on `id` (blockers for deactivation). */
export function dependentsOf(id: string, activeIds: string[]): string[] {
  return activeIds.filter((aid) => (getApp(aid)?.depends ?? []).includes(id));
}

/**
 * Where to land given the company's active apps:
 *  - no apps active        → the Apps screen
 *  - Dashboard active       → the Dashboard ('/')
 *  - otherwise              → the first activated app's landing page
 * Apps appear in registry order, so "first activated" follows that order.
 */
export function landingPathForActiveApps(activeIds: string[]): string {
  if (activeIds.includes('dashboard')) return '/';
  for (const app of APPS) {
    if (activeIds.includes(app.id) && app.paths.length > 0) {
      return app.paths[0];
    }
  }
  return '/apps';
}

/** Map a route path to the app that owns it (longest-prefix match). */
export function appForPath(path: string): AppDef | undefined {
  let best: AppDef | undefined;
  let bestLen = -1;
  for (const app of APPS) {
    for (const p of app.paths) {
      if ((path === p || path.startsWith(p + '/')) && p.length > bestLen) {
        best = app;
        bestLen = p.length;
      }
    }
  }
  return best;
}
