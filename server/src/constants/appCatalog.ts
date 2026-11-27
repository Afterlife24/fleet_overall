/**
 * Server-side copy of the app catalog in `src/constants/apps.ts` (ids, names, categories, dependencies).
 * The server cannot import from `src/` (it contains browser-only modules), so keep this list in step with it.
 * Icons, colors, paths and labels are UI concerns and are intentionally not copied.
 */
export interface CatalogApp {
  id: string;
  name: string;
  category: 'Operations' | 'Inspections' | 'Documents' | 'Management';
  /** App ids that must be active for this app to work. */
  depends: readonly string[];
}

const app = (id: string, name: string, category: CatalogApp['category'], depends: string[] = []): CatalogApp => ({
  id,
  name,
  category,
  depends,
});

export const APP_CATALOG: readonly CatalogApp[] = [
  app('dashboard', 'Dashboard', 'Operations'),
  app('fleet', 'Fleet', 'Operations'),
  app('cross_hire', 'Cross Hire', 'Operations', ['fleet']),
  app('planner', 'Planner', 'Operations', ['fleet']),
  app('workshop', 'Workshop', 'Operations', ['fleet']),
  app('job_cards', 'Job Cards', 'Operations', ['fleet']),
  app('breakdowns', 'Breakdowns', 'Operations', ['fleet']),
  app('transport', 'Transport', 'Operations', ['fleet']),
  app('truck_tracking', 'Truck Tracking', 'Operations'),
  app('job_tracking', 'Job Tracking', 'Operations'),
  app('board', 'Operations Board', 'Operations'),
  app('map', 'Fleet Map', 'Operations', ['fleet']),
  app('gate', 'Gate Operations', 'Operations'),
  app('branches', 'Branches', 'Operations'),
  app('phi', 'PHI Inspection', 'Inspections', ['fleet']),
  app('pdi', 'PDI Inspection', 'Inspections', ['fleet']),
  app('mandatory_checks', 'Mandatory Checks', 'Inspections', ['fleet']),
  app('mqd', 'MQD', 'Inspections', ['fleet']),
  app('quotation', 'Quotation / Hire Agreement', 'Documents'),
  app('lpo', 'LPO', 'Documents'),
  app('delivery_note', 'Delivery Note', 'Documents'),
  app('collection_note', 'Collection Note', 'Documents'),
  app('third_party_services', 'Third-Party Services', 'Documents'),
  app('invoice', 'Invoice', 'Documents'),
  app('soa', 'SOA', 'Documents'),
  app('payment_receipt', 'Payment Receipt', 'Documents'),
  app('customer_ani', 'Customer', 'Management'),
  app('crm', 'CRM', 'Management', ['customer_ani', 'invoice']),
  app('reports', 'Reports', 'Management'),
  app('tripbase', 'TRIPBASE', 'Management'),
  app('sales', 'Sales Portal', 'Management'),
  app('six_sigma', 'Six Sigma', 'Management', ['fleet']),
  app('statistics', 'Statistics', 'Management', ['fleet']),
];

const BY_ID: ReadonlyMap<string, CatalogApp> = new Map(APP_CATALOG.map((a) => [a.id, a]));

export const APP_CODES: readonly string[] = APP_CATALOG.map((a) => a.id);

export function getCatalogApp(id: string): CatalogApp | undefined {
  return BY_ID.get(id);
}

export function isAppCode(value: string): boolean {
  return BY_ID.has(value);
}

/** An app id plus all of its transitive dependencies (dependencies first is not guaranteed). */
export function withDependencies(id: string): string[] {
  const out = new Set<string>();
  const visit = (appId: string): void => {
    if (out.has(appId)) return;
    out.add(appId);
    (BY_ID.get(appId)?.depends ?? []).forEach(visit);
  };
  visit(id);
  return [...out];
}

/** Active apps that directly depend on `id` (blockers for deactivation). */
export function dependentsOf(id: string, activeIds: readonly string[]): string[] {
  return activeIds.filter((aid) => (BY_ID.get(aid)?.depends ?? []).includes(id));
}
