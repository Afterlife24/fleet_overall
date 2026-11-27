// Pure core (type-only imports): REF-13 validation, form to record mapping,
// record to view, list merge and order, counters and detail rows.
import type {
  JobOverride,
  TransportForm,
  TransportJob,
  TransportJobRecord,
  TransportJobView,
  TransportTypeCode,
} from '@/types/transport';

export const TRANSPORT_SHIFTS = ['Morning', 'Evening'] as const;
export const TRANSPORT_TYPES = ['D', 'T', 'O', 'T2'] as const;
export const TRANSPORT_SALES = ['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT', 'TS'] as const;
export const SR_NO_MIN = 1;
export const SR_NO_MAX = 9999;

export type FieldErrors = Partial<Record<keyof TransportForm, string>>;

const REQUIRED_TEXT: ReadonlyArray<readonly [keyof TransportForm, string]> = [
  ['plannerName', 'Planner name required'],
  ['date', 'Date required'],
  ['transportTeam', 'Transport team required'],
  ['fleet', 'Fleet number required'],
  ['from', 'Pickup location required'],
  ['to', 'Delivery destination required'],
  ['transport', 'Transport vehicle required'],
  ['contact', 'Contact required'],
  ['client', 'Client required'],
  ['time', 'Time required'],
];

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

export function validateTransportForm(
  input: unknown,
): { ok: true; form: TransportForm } | { ok: false; errors: FieldErrors } {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const errors: FieldErrors = {};
  for (const [k, msg] of REQUIRED_TEXT) if (!isText(o[k])) errors[k] = msg;
  if (!oneOf(TRANSPORT_SHIFTS, o.shift)) errors.shift = 'Shift must be Morning or Evening';
  if (!oneOf(TRANSPORT_TYPES, o.type)) errors.type = 'Type must be D, T, O or T2';
  if (!oneOf(TRANSPORT_SALES, o.sales)) errors.sales = 'Sales code required';
  const sr = o.srNo;
  if (typeof sr !== 'number' || !Number.isInteger(sr) || sr < SR_NO_MIN || sr > SR_NO_MAX) {
    errors.srNo = `Sr. No must be a whole number from ${SR_NO_MIN} to ${SR_NO_MAX}`;
  }
  if (o.remarks !== undefined && typeof o.remarks !== 'string') errors.remarks = 'Remarks must be text';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const form: TransportForm = {
    plannerName: o.plannerName as string,
    date: o.date as string,
    shift: o.shift as TransportForm['shift'],
    transportTeam: o.transportTeam as string,
    srNo: o.srNo as number,
    fleet: o.fleet as string,
    from: o.from as string,
    to: o.to as string,
    transport: o.transport as string,
    type: o.type as TransportTypeCode,
    contact: o.contact as string,
    sales: o.sales as string,
    client: o.client as string,
    time: o.time as string,
  };
  if (typeof o.remarks === 'string') form.remarks = o.remarks;
  return { ok: true, form };
}

export interface MachineRef {
  id: string;
  fleetNo?: string;
  assetNumber: string;
  make?: string;
  model?: string;
  branchId?: string;
  branchName?: string;
}

export interface ViewCtx {
  machines: readonly MachineRef[];
}

/** Machine whose fleet number equals `fleet` (fleetNo first, then asset number). */
export function matchMachine(machines: readonly MachineRef[], fleet: unknown): MachineRef | undefined {
  if (typeof fleet !== 'string' || fleet === '') return undefined;
  return (
    machines.find((m) => m.fleetNo === fleet) ?? machines.find((m) => m.assetNumber === fleet)
  );
}

export function mapFormToRecord(
  form: TransportForm,
  ctx: { orgId: string; id: string; ref: string; now: string; machines: readonly MachineRef[] },
): TransportJobRecord {
  const m = matchMachine(ctx.machines, form.fleet);
  const rec: TransportJobRecord = {
    ...form,
    id: ctx.id,
    orgId: ctx.orgId,
    reference: ctx.ref,
    status: 'Scheduled',
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  if (m) {
    rec.machineId = m.id;
    if (m.branchId) rec.branchId = m.branchId;
    if (m.branchName) rec.branchName = m.branchName;
  }
  return rec;
}

export const kindOfType = (t: TransportTypeCode): TransportJob['type'] =>
  t === 'D' ? 'Delivery' : t === 'O' ? 'Collection' : 'Transfer';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function scheduledOf(r: Partial<TransportJobRecord>): string {
  const date = str(r.date);
  if (!date) return str(r.createdAt);
  const time = str(r.time) || '00:00';
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

/** Total: never throws, whatever fields a record or legacy row lacks. */
export function toTransportJobView(r: TransportJobRecord, ctx: ViewCtx): TransportJobView {
  const rec = (r ?? {}) as Partial<TransportJobRecord>;
  const machines = Array.isArray(ctx?.machines) ? ctx.machines : [];
  const m = matchMachine(machines, rec.fleet);
  const type = oneOf(TRANSPORT_TYPES, rec.type) ? rec.type : 'D';
  const ref13: TransportForm = {
    plannerName: str(rec.plannerName),
    date: str(rec.date),
    shift: rec.shift === 'Evening' ? 'Evening' : 'Morning',
    transportTeam: str(rec.transportTeam),
    srNo: typeof rec.srNo === 'number' && Number.isFinite(rec.srNo) ? rec.srNo : 0,
    fleet: str(rec.fleet),
    from: str(rec.from),
    to: str(rec.to),
    transport: str(rec.transport),
    type,
    contact: str(rec.contact),
    sales: str(rec.sales),
    client: str(rec.client),
    time: str(rec.time),
    remarks: str(rec.remarks),
  };
  return {
    id: str(rec.id),
    createdAt: str(rec.createdAt),
    updatedAt: str(rec.updatedAt),
    orgId: str(rec.orgId),
    reference: str(rec.reference),
    machineId: str(rec.machineId) || m?.id || '',
    assetNumber: ref13.fleet,
    machineModel: m ? `${str(m.make)} ${str(m.model)}`.trim() : '',
    branchId: str(rec.branchId) || str(m?.branchId),
    branchName: str(rec.branchName) || str(m?.branchName),
    driverId: str(rec.driverId),
    driverName: str(rec.driverName),
    truckId: str(rec.truckId),
    truckRegistration: ref13.transport,
    origin: ref13.from,
    destination: ref13.to,
    scheduledTime: scheduledOf(rec),
    status: rec.status ?? 'Scheduled',
    distance: undefined,
    bookingRef: rec.sourceRef,
    type: kindOfType(type),
    notes: ref13.remarks,
    customerName: ref13.client,
    chargeToCustomer: 0,
    internalCost: 0,
    quotationId: rec.quotationId,
    collectionNoteId: rec.collectionNoteId,
    ref13,
  };
}

const ts = (s: string): number => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Newest first. Equal timestamps keep the later-inserted row first. Does not mutate. */
export function sortNewestFirst<T extends { createdAt: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const d = ts(b.row.createdAt) - ts(a.row.createdAt);
      if (d !== 0 && !Number.isNaN(d)) return d;
      return b.i - a.i;
    })
    .map((x) => x.row);
}

export const overrideKey = (orgId: string, id: string): string => `${orgId}|${id}`;

/** Persisted rows (newest first) followed by mock rows with overrides applied. */
export function mergeTransportList(
  persisted: readonly TransportJobRecord[],
  mock: readonly TransportJob[],
  orgId: string,
  overrides: Readonly<Record<string, JobOverride>>,
  ctx: ViewCtx,
): TransportJobView[] {
  const own = persisted.filter((r) => r.orgId === orgId);
  const ids = new Set(own.map((r) => r.id));
  const head = sortNewestFirst(own).map((r) => toTransportJobView(r, ctx));
  const tail: TransportJobView[] = [];
  for (const j of mock) {
    if (ids.has(j.id)) continue;
    const o = overrides[overrideKey(orgId, j.id)];
    tail.push({ ...j, ...(o ?? {}), orgId });
  }
  return [...head, ...tail];
}

export interface TransportCounters {
  active: number;
  scheduled: number;
  completed: number;
  deliveries: number;
  collections: number;
}

export function transportCounters(
  jobs: readonly Pick<TransportJob, 'status' | 'type'>[],
): TransportCounters {
  const c: TransportCounters = { active: 0, scheduled: 0, completed: 0, deliveries: 0, collections: 0 };
  for (const j of jobs) {
    if (j.status === 'In Transit' || j.status === 'Loading') c.active++;
    else if (j.status === 'Scheduled') c.scheduled++;
    else if (j.status === 'Completed' || j.status === 'Delivered') c.completed++;
    if (j.type === 'Delivery') c.deliveries++;
    else if (j.type === 'Collection') c.collections++;
  }
  return c;
}

export const REF13_LABELS = [
  'Planner Name', 'Date', 'Shift', 'Transport Team', 'Sr. No', 'Fleet', 'From', 'To',
  'Transport', 'Type', 'Contact', 'Sales', 'Client', 'Time', 'Remarks',
] as const;

/** The 15 labelled rows of the detail panel. Remarks is '' when absent. */
export function ref13Rows(v: TransportJobView): { label: string; value: string }[] {
  const f = v?.ref13;
  const dash = '—';
  const sched = str(v?.scheduledTime);
  const values: string[] = f
    ? [
        f.plannerName, f.date, f.shift, f.transportTeam, String(f.srNo), f.fleet, f.from, f.to,
        f.transport, f.type, f.contact, f.sales, f.client, f.time, f.remarks ?? '',
      ].map(str)
    : [
        dash, sched.slice(0, 10) || dash, dash, str(v?.truckRegistration) || dash, dash,
        str(v?.assetNumber) || dash, str(v?.origin) || dash, str(v?.destination) || dash,
        str(v?.truckRegistration) || dash, str(v?.type) || dash, dash, dash,
        str(v?.customerName) || dash, sched.slice(11, 16) || dash, str(v?.notes),
      ];
  return REF13_LABELS.map((label, i) => ({ label, value: values[i] }));
}

/** The fields of a collection note that a generated job needs. */
export interface CollectionNoteLite {
  id: string;
  orgId: string;
  number: string;
  date: string;
  fleetNo: string;
  machineId: string;
  customerName: string;
  collectionAddress?: string;
  site?: string;
  quotationId?: string;
  bookingId?: string;
}

export function transportJobFromCollection(
  cn: CollectionNoteLite,
  ref: string,
  id: string,
  now: string,
  machine?: MachineRef,
): TransportJobRecord {
  const rec: TransportJobRecord = {
    id,
    orgId: cn.orgId,
    reference: ref,
    plannerName: 'Off-Hire / Collection',
    date: cn.date,
    shift: 'Morning',
    transportTeam: '',
    srNo: 0,
    fleet: cn.fleetNo,
    from: cn.collectionAddress || cn.site || 'Customer site',
    to: 'Yard',
    transport: '',
    type: 'O',
    contact: '',
    sales: '',
    client: cn.customerName,
    time: '',
    remarks: `Collection ${cn.number}`,
    status: 'Scheduled',
    machineId: cn.machineId,
    collectionNoteId: cn.id,
    sourceRef: cn.number,
    autoGenerated: true,
    createdAt: now,
    updatedAt: now,
  };
  if (cn.quotationId) rec.quotationId = cn.quotationId;
  if (cn.bookingId) rec.bookingId = cn.bookingId;
  if (machine?.branchId) rec.branchId = machine.branchId;
  if (machine?.branchName) rec.branchName = machine.branchName;
  return rec;
}
