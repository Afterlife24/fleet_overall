// Pure core (no value imports): seed planning, relative demo dates and
// referential-integrity checks over one company's records.

/** Seeds not marked for the company and not already present by id. */
export function planSeeds<T extends { id: string }>(
  markers: readonly string[],
  existingIds: ReadonlySet<string>,
  seeds: readonly T[],
): T[] {
  const marked = new Set(markers);
  return seeds.filter((s) => !marked.has(s.id) && !existingIds.has(s.id));
}

/** Local YYYY-MM-DD of `today` plus `offset` days. `today` is injected. */
export function demoDay(today: Date, offset: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${mm}-${dd}`;
}

/** A record of any app: company, optional customer link and optional reference ids. */
export interface IntegrityRecord {
  id: string;
  orgId: string;
  customerId?: string;
  customerName?: string;
  /** Registry customers carry their name here. */
  name?: string;
  quotationId?: string;
  agreementId?: string;
  bookingId?: string;
  machineId?: string;
  invoiceId?: string;
  driverId?: string;
  truckId?: string;
  collectionNoteId?: string;
}

export interface IntegritySnapshot {
  customers: readonly IntegrityRecord[];
  quotations: readonly IntegrityRecord[];
  agreements: readonly IntegrityRecord[];
  bookings: readonly IntegrityRecord[];
  machines: readonly IntegrityRecord[];
  invoices: readonly IntegrityRecord[];
  collectionNotes: readonly IntegrityRecord[];
  mqd: readonly IntegrityRecord[];
  tps: readonly IntegrityRecord[];
  transportJobs: readonly IntegrityRecord[];
  drivers: readonly IntegrityRecord[];
  trucks: readonly IntegrityRecord[];
  hireDocs: readonly IntegrityRecord[];
  gateRecords: readonly IntegrityRecord[];
}

type RefField =
  | 'quotationId'
  | 'agreementId'
  | 'bookingId'
  | 'machineId'
  | 'invoiceId'
  | 'driverId'
  | 'truckId'
  | 'collectionNoteId';

const REF_TARGETS: ReadonlyArray<readonly [RefField, keyof IntegritySnapshot]> = [
  ['quotationId', 'quotations'],
  ['agreementId', 'agreements'],
  ['bookingId', 'bookings'],
  ['machineId', 'machines'],
  ['invoiceId', 'invoices'],
  ['driverId', 'drivers'],
  ['truckId', 'trucks'],
  ['collectionNoteId', 'collectionNotes'],
];

const CUSTOMER_LISTS: ReadonlyArray<keyof IntegritySnapshot> = [
  'quotations',
  'agreements',
  'bookings',
  'invoices',
  'collectionNotes',
  'mqd',
  'tps',
  'hireDocs',
];

const CHAIN_LISTS: ReadonlyArray<keyof IntegritySnapshot> = [
  'agreements',
  'bookings',
  'invoices',
  'collectionNotes',
  'mqd',
  'tps',
  'transportJobs',
  'hireDocs',
  'gateRecords',
];

/** Dangling references and customer mismatches of one company, as readable strings. */
export function integrityViolations(orgId: string, s: IntegritySnapshot): string[] {
  const out: string[] = [];
  const own = (k: keyof IntegritySnapshot) => s[k].filter((r) => r.orgId === orgId);
  const registry = own('customers');
  const byId = new Map(registry.map((c) => [c.customerId ?? c.id, c]));

  for (const list of CUSTOMER_LISTS) {
    for (const r of own(list)) {
      if (r.customerId === undefined && r.customerName === undefined) continue;
      const c = r.customerId !== undefined ? byId.get(r.customerId) : undefined;
      if (!c) {
        out.push(`${list} ${r.id}: customerId ${r.customerId ?? '(none)'} not in registry of ${orgId}`);
      } else if (r.customerName !== (c.name ?? c.customerName)) {
        out.push(
          `${list} ${r.id}: customerName "${r.customerName ?? ''}" differs from registry "${c.name ?? c.customerName ?? ''}"`,
        );
      }
    }
  }

  const ids = new Map<keyof IntegritySnapshot, Set<string>>();
  for (const [, target] of REF_TARGETS) ids.set(target, new Set(own(target).map((r) => r.id)));
  for (const list of CHAIN_LISTS) {
    for (const r of own(list)) {
      for (const [field, target] of REF_TARGETS) {
        const v = r[field];
        if (v && !ids.get(target)?.has(v)) {
          out.push(`${list} ${r.id}: ${field} ${v} does not resolve in ${orgId}`);
        }
      }
    }
  }
  return out;
}
