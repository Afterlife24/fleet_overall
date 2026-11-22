// Pure core for off-hire collection documents. Types-only imports; no stores,
// browser APIs, clock or randomness.
import type {
  CollectionNote,
  CollectionStatus,
  DocType,
  MissingLink,
  MqdRecord,
  ReferenceFields,
  ServiceLine,
  TpsDocument,
} from '@/types/collection';

export interface MachineLite {
  id: string;
  orgId: string;
  fleetNo?: string;
  assetNumber: string;
  make?: string;
  model?: string;
  serialNumber?: string;
}

// ---------------------------------------------------------------- Fleet numbers

export function fleetNumberOf(m: Pick<MachineLite, 'fleetNo' | 'assetNumber'>): string {
  const f = (m.fleetNo ?? '').trim();
  return f !== '' ? f : (m.assetNumber ?? '').trim();
}

export function normalizeFleetNo(s: string): string {
  return s.trim().toLowerCase();
}

export function findDuplicateFleetNo(
  machines: MachineLite[],
  candidate: { id?: string; orgId: string; fleetNo?: string; assetNumber: string },
): MachineLite | undefined {
  const target = normalizeFleetNo(fleetNumberOf(candidate));
  return machines.find(
    (m) =>
      m.orgId === candidate.orgId &&
      m.id !== candidate.id &&
      normalizeFleetNo(fleetNumberOf(m)) === target,
  );
}

// ---------------------------------------------------------------- QR

export const QR_PREFIX = 'AXLEOPS-FLEET';

export function buildQrPayload(m: MachineLite): string {
  return `${QR_PREFIX}:${m.orgId}:${m.id}:${fleetNumberOf(m)}`;
}

export type QrError = 'OTHER' | 'OTHER_ORG' | 'NOT_FOUND' | 'AMBIGUOUS' | 'MISMATCH';
export type QrResult = { ok: true; machine: MachineLite } | { ok: false; error: QrError };

export function parseQrPayload(
  raw: string,
): { orgId: string; machineId: string; fleetNo: string } | null {
  if (typeof raw !== 'string') return null;
  const head = `${QR_PREFIX}:`;
  if (!raw.startsWith(head)) return null;
  const rest = raw.slice(head.length);
  const i1 = rest.indexOf(':');
  if (i1 < 0) return null;
  const i2 = rest.indexOf(':', i1 + 1);
  if (i2 < 0) return null;
  const orgId = rest.slice(0, i1);
  const machineId = rest.slice(i1 + 1, i2);
  const fleetNo = rest.slice(i2 + 1);
  if (orgId === '' || machineId === '' || fleetNo.trim() === '') return null;
  return { orgId, machineId, fleetNo };
}

export function resolveQr(raw: string, currentOrgId: string, machines: MachineLite[]): QrResult {
  const p = parseQrPayload(raw);
  if (!p) return { ok: false, error: 'OTHER' };
  if (p.orgId !== currentOrgId) return { ok: false, error: 'OTHER_ORG' };

  const inOrg = machines.filter((m) => m.orgId === currentOrgId);
  const byId = inOrg.find((m) => m.id === p.machineId);
  const wanted = normalizeFleetNo(p.fleetNo);
  const byFleet = inOrg.filter((m) => normalizeFleetNo(fleetNumberOf(m)) === wanted);

  if (!byId && byFleet.length === 0) return { ok: false, error: 'NOT_FOUND' };
  if (byFleet.length > 1) return { ok: false, error: 'AMBIGUOUS' };
  if (byId && byFleet.length === 1 && byFleet[0].id === byId.id) return { ok: true, machine: byId };
  return { ok: false, error: 'MISMATCH' };
}

// ---------------------------------------------------------------- Deep links

export type DeepLinkResult = QrResult | { ok: false; error: 'DEEP_LINK_NOT_FOUND' };

export function resolveFleetQuery(
  params: { fleet?: string; id?: string; qr?: string },
  orgId: string,
  machines: MachineLite[],
): DeepLinkResult | null {
  const qr = params.qr ?? '';
  const fleet = params.fleet ?? '';
  const id = params.id ?? '';
  if (qr !== '') return resolveQr(qr, orgId, machines);
  if (fleet === '' && id === '') return null;
  const wanted = normalizeFleetNo(fleet);
  const hit = machines.find(
    (m) =>
      m.orgId === orgId &&
      m.id === id &&
      normalizeFleetNo(fleetNumberOf(m)) === wanted,
  );
  return hit ? { ok: true, machine: hit } : { ok: false, error: 'DEEP_LINK_NOT_FOUND' };
}

// ---------------------------------------------------------------- Note pick (Gate IN)

export interface NoteLite {
  id: string;
  orgId: string;
  machineId: string;
  status: string;
  createdAt: string;
}

/**
 * Picks the open Collection Note to mark Collected for a machine.
 * Open = status is neither 'Collected' nor 'Closed'. The latest `Date.parse(createdAt)` wins and the
 * first note in list order wins ties (replace only on a strictly greater value).
 * An unparseable `createdAt` counts as -Infinity: it loses to any parseable note, but is still
 * picked when it is the only open note.
 */
export function pickNoteToCollect<T extends NoteLite>(
  notes: readonly T[],
  orgId: string,
  machineId: string,
): T | undefined {
  let best: T | undefined;
  let bestTime = -Infinity;
  for (const n of notes) {
    if (n.orgId !== orgId || n.machineId !== machineId) continue;
    if (n.status === 'Collected' || n.status === 'Closed') continue;
    const parsed = Date.parse(n.createdAt);
    const t = Number.isNaN(parsed) ? -Infinity : parsed;
    if (best === undefined || t > bestTime) {
      best = n;
      bestTime = t;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Status control

export interface StatusControl {
  readOnly: boolean;
  options: CollectionStatus[];
}

/**
 * Collected is never an option: it is set only by Gate-In. A Collected note can only move to
 * Closed; a Closed note is read-only; Draft and Scheduled switch between themselves.
 */
export function collectionStatusControl(current: CollectionStatus): StatusControl {
  switch (current) {
    case 'Collected':
      return { readOnly: true, options: ['Closed'] };
    case 'Closed':
      return { readOnly: true, options: [] };
    default:
      return { readOnly: false, options: ['Draft', 'Scheduled'] };
  }
}

// ---------------------------------------------------------------- Numbering

export type CounterKey = string; // `${orgId}|${type}|${year}`

export const counterKey = (orgId: string, type: DocType, year: number): CounterKey =>
  `${orgId}|${type}|${year}`;

export function formatDocNumber(type: DocType, year: number, seq: number): string {
  return `${type}-${year}-${String(seq).padStart(4, '0')}`;
}

export function parseDocNumber(n: string): { type: DocType; year: number; seq: number } | null {
  const m = /^(CN|MQD|TPS)-(\d{4})-(\d{4,})$/.exec(n);
  if (!m) return null;
  return { type: m[1] as DocType, year: Number(m[2]), seq: Number(m[3]) };
}

export function nextSequence(
  counters: Record<CounterKey, number>,
  key: CounterKey,
): { seq: number; counters: Record<CounterKey, number> } {
  const seq = (counters[key] ?? 0) + 1;
  return { seq, counters: { ...counters, [key]: seq } };
}

// ---------------------------------------------------------------- References

export interface BookingLite {
  id: string;
  orgId?: string;
  reference: string;
  machineId: string;
  status: string;
  startDate: string;
  customerId?: string;
  customerName?: string;
  deliveryAddress?: string;
  hireAgreementId?: string;
}

export interface AgreementLite {
  id: string;
  orgId: string;
  agreementNo: string;
  quotationId?: string;
  customerId?: string;
  customerName?: string;
  deliveryLocation?: string;
}

export interface QuotationLite {
  id: string;
  orgId: string;
  number: string;
  customerId?: string;
  customerName?: string;
}

export interface InvoiceLite {
  id: string;
  orgId?: string;
  invoiceNo: string;
  quotationId?: string;
  hireAgreementId?: string;
  hireAgreementNo?: string;
  sequence?: number;
  status: string;
  createdAt: string;
}

export interface RefSnapshot {
  orgId: string;
  bookings: BookingLite[];
  agreements: AgreementLite[];
  quotations: QuotationLite[];
  invoices: InvoiceLite[];
}

const inOrg = (rowOrg: string | undefined, orgId: string): boolean =>
  rowOrg === undefined || rowOrg === '' || rowOrg === orgId;

const cmpDesc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

function bookingRank(status: string): number {
  if (status === 'On Hire') return 0;
  if (status === 'Allocated') return 1;
  return 2;
}

function pickBooking(machineId: string, snap: RefSnapshot): BookingLite | undefined {
  const mine = snap.bookings.filter(
    (b) => b.machineId === machineId && inOrg(b.orgId, snap.orgId),
  );
  if (mine.length === 0) return undefined;
  return [...mine].sort(
    (a, b) =>
      bookingRank(a.status) - bookingRank(b.status) ||
      cmpDesc(a.startDate, b.startDate) ||
      cmpDesc(a.id, b.id),
  )[0];
}

function pickLatestInvoice(candidates: InvoiceLite[]): InvoiceLite | undefined {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(
    (a, b) =>
      (b.sequence ?? 0) - (a.sequence ?? 0) ||
      cmpDesc(a.createdAt, b.createdAt) ||
      cmpDesc(a.id, b.id),
  )[0];
}

export function resolveReferences(
  machine: MachineLite,
  customerFallback: string | undefined,
  snap: RefSnapshot,
): ReferenceFields {
  const fleetNo = fleetNumberOf(machine);
  const refs: ReferenceFields = {
    machineId: machine.id,
    fleetNo,
    machineDescription: [machine.make, machine.model]
      .map((s) => (s ?? '').trim())
      .filter((s) => s !== '')
      .join(' '),
    serialNumber: machine.serialNumber ?? '',
    customerName: customerFallback ?? '',
    customerId: '',
    bookingId: '',
    bookingRef: '',
    hireAgreementId: '',
    hireAgreementNo: '',
    quotationId: '',
    quotationNo: '',
    invoiceId: '',
    invoiceNo: '',
    site: '',
    missing: [],
    refNotes: [],
  };
  const miss = (link: MissingLink, text: string): void => {
    refs.missing.push(link);
    refs.refNotes.push(text);
  };

  const booking = pickBooking(machine.id, snap);
  if (!booking) {
    miss('BOOKING', `No booking found for machine ${fleetNo}`);
    return refs;
  }
  refs.bookingId = booking.id;
  refs.bookingRef = booking.reference;
  refs.customerId = booking.customerId ?? '';
  refs.customerName = booking.customerName || customerFallback || '';
  refs.site = booking.deliveryAddress ?? '';

  const agreement = booking.hireAgreementId
    ? snap.agreements.find((a) => a.id === booking.hireAgreementId && a.orgId === snap.orgId)
    : undefined;
  if (!agreement) {
    miss('AGREEMENT', `Hire agreement not linked to booking ${booking.reference}`);
    return refs;
  }
  refs.hireAgreementId = agreement.id;
  refs.hireAgreementNo = agreement.agreementNo;
  if (agreement.customerId) refs.customerId = agreement.customerId;
  if (agreement.customerName) refs.customerName = agreement.customerName;
  if (refs.site === '') refs.site = agreement.deliveryLocation ?? '';

  const quotation = agreement.quotationId
    ? snap.quotations.find((q) => q.id === agreement.quotationId && q.orgId === snap.orgId)
    : undefined;
  let invoice: InvoiceLite | undefined;
  const live = snap.invoices.filter(
    (i) => inOrg(i.orgId, snap.orgId) && i.status !== 'Cancelled',
  );
  const byAgreement = (): InvoiceLite | undefined =>
    pickLatestInvoice(
      live.filter(
        (i) =>
          (i.hireAgreementId !== undefined && i.hireAgreementId === agreement.id) ||
          (i.hireAgreementNo !== undefined &&
            i.hireAgreementNo !== '' &&
            i.hireAgreementNo === agreement.agreementNo),
      ),
    );
  if (quotation) {
    refs.quotationId = quotation.id;
    refs.quotationNo = quotation.number;
    // Invoices raised before quotation linking carry only the agreement: fall back to those.
    invoice = pickLatestInvoice(live.filter((i) => i.quotationId === quotation.id)) ?? byAgreement();
  } else {
    miss('QUOTATION', `Quotation not linked to hire agreement ${agreement.agreementNo}`);
    invoice = byAgreement();
  }
  if (invoice) {
    refs.invoiceId = invoice.id;
    refs.invoiceNo = invoice.invoiceNo;
  } else {
    miss('INVOICE', `No active invoice found for ${quotation ? `quotation ${quotation.number}` : `hire agreement ${agreement.agreementNo}`}`);
  }
  return refs;
}

// ---------------------------------------------------------------- Initiate plan

export interface InitiateInput {
  orgId: string;
  machine: MachineLite;
  status: string;
  mqdActive: boolean;
  tpsActive: boolean;
  transportActive: boolean;
  date: string;
  year: number;
  ids: { cn: string; mqd: string; tps: string };
  refs: ReferenceFields;
}

export type InitiateError = 'NOT_ON_HIRE' | 'WRONG_ORG';
export type InitiatePlan =
  | { ok: false; error: InitiateError }
  | {
      ok: true;
      cn: CollectionNote;
      mqd?: MqdRecord;
      tps?: TpsDocument;
      skipped: ('MQD' | 'TPS')[];
      transport: boolean;
    };

export function canInitiate(status: string, collectionActive: boolean): boolean {
  return status === 'On Hire' && collectionActive;
}

export function pickerMachines<T extends MachineLite>(
  machines: T[],
  statusOf: (id: string) => string,
): T[] {
  return machines.filter((m) => statusOf(m.id) === 'On Hire');
}

export function planInitiate(
  input: InitiateInput,
  numbers: { cn: string; mqd?: string; tps?: string },
): InitiatePlan {
  if (input.machine.orgId !== input.orgId) return { ok: false, error: 'WRONG_ORG' };
  if (input.status !== 'On Hire') return { ok: false, error: 'NOT_ON_HIRE' };

  const makeMqd = input.mqdActive;
  const makeTps = input.tpsActive;
  const setIds = {
    cnId: input.ids.cn,
    mqdId: makeMqd ? input.ids.mqd : '',
    tpsId: makeTps ? input.ids.tps : '',
  };
  const base = {
    orgId: input.orgId,
    ...setIds,
    signedStatus: 'Pending' as const,
    createdAt: input.date,
    updatedAt: input.date,
  };
  const refsCopy = (): ReferenceFields => ({
    ...input.refs,
    missing: [...input.refs.missing],
    refNotes: [...input.refs.refNotes],
  });

  const cn: CollectionNote = {
    ...refsCopy(),
    ...base,
    id: input.ids.cn,
    number: numbers.cn,
    status: 'Draft',
    date: input.date,
    collectionAddress: input.refs.site,
    driver: '',
    vehicle: '',
    remarks: '',
  };
  const mqd: MqdRecord | undefined = makeMqd
    ? {
        ...refsCopy(),
        ...base,
        id: input.ids.mqd,
        number: numbers.mqd ?? '',
        date: input.date,
        hirer: input.refs.customerName,
        fields: {},
        photoKeys: [],
      }
    : undefined;
  const tps: TpsDocument | undefined = makeTps
    ? {
        ...refsCopy(),
        ...base,
        id: input.ids.tps,
        number: numbers.tps ?? '',
        lines: [],
        notes: '',
        approvedBy: '',
        signature: '',
      }
    : undefined;

  const skipped: ('MQD' | 'TPS')[] = [];
  if (!makeMqd) skipped.push('MQD');
  if (!makeTps) skipped.push('TPS');
  return { ok: true, cn, mqd, tps, skipped, transport: input.transportActive };
}

// ---------------------------------------------------------------- Service lines

export function validateServiceLine(l: {
  serviceType: string;
  quantity: unknown;
  rate: unknown;
}): { ok: true } | { ok: false; field: 'serviceType' | 'quantity' | 'rate'; message: string } {
  const types: readonly string[] = ['Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other'];
  if (!types.includes(l.serviceType)) {
    return { ok: false, field: 'serviceType', message: 'Select a valid service type' };
  }
  const bad = (v: unknown): boolean => typeof v !== 'number' || !Number.isFinite(v) || v < 0;
  if (bad(l.quantity)) {
    return { ok: false, field: 'quantity', message: 'Quantity must be a number of 0 or more' };
  }
  if (bad(l.rate)) {
    return { ok: false, field: 'rate', message: 'Rate must be a number of 0 or more' };
  }
  return { ok: true };
}

export function lineAmount(l: Pick<ServiceLine, 'quantity' | 'rate'>): number {
  return Math.round(l.quantity * l.rate * 100) / 100;
}

export function tpsTotal(lines: ServiceLine[]): number {
  const cents = lines.reduce((sum, l) => sum + Math.round(lineAmount(l) * 100), 0);
  return cents / 100;
}

// ---------------------------------------------------------------- Signed copies

export const ALLOWED_SIGNED_MIME: readonly string[] = ['application/pdf', 'image/*'];

export function validateSignedFile(f: {
  type: string;
  name: string;
}): { ok: true } | { ok: false; message: string } {
  const t = f.type;
  if (t === 'application/pdf' || (typeof t === 'string' && t.startsWith('image/'))) {
    return { ok: true };
  }
  return { ok: false, message: 'Only PDF or image files are allowed' };
}

// ---------------------------------------------------------------- Counter migration

export function migrateCounters(
  raw: unknown,
  docs: { orgId: string; number: string }[],
): Record<CounterKey, number> {
  const out: Record<CounterKey, number> = {};
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    }
  }
  for (const d of docs) {
    const p = parseDocNumber(d.number);
    if (!p) continue;
    const key = counterKey(d.orgId, p.type, p.year);
    if ((out[key] ?? 0) < p.seq) out[key] = p.seq;
  }
  return out;
}
