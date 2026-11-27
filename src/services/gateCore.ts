// Pure core for Gate-In QR scanning. Values are imported only from the pure
// collectionCore module; everything else is type-only. No stores, DOM/window,
// navigator, fetch, clock, randomness or default time zone.
import { fleetNumberOf, resolveQr } from '@/services/collectionCore';
import type { MachineLite, QrError, QrResult } from '@/services/collectionCore';
import type {
  CaptureMethod,
  GateDirection,
  GateEntry,
  GateRecord,
  GateStoreState,
  TimeSource,
} from '@/types/gate';

// ---------------------------------------------------------------- Scan

/** Thin wrapper over resolveQr, unchanged (Req 2.9). */
export function resolveGateScan(raw: string, orgId: string, machines: MachineLite[]): QrResult {
  return resolveQr(raw, orgId, machines);
}

export const GATE_SCAN_MESSAGES: Record<QrError, string> = {
  OTHER: 'This is not an AxleOps fleet QR code.',
  OTHER_ORG: 'This QR code belongs to another company.',
  NOT_FOUND: 'No machine in your fleet matches this QR code.',
  AMBIGUOUS:
    'More than one machine has this fleet number. Fix the fleet records or use Manual entry.',
  MISMATCH: 'The QR code does not match the fleet record (machine and fleet number differ).',
};

// ---------------------------------------------------------------- Camera

export type CameraErrorCode = 'INSECURE' | 'UNSUPPORTED' | 'DENIED' | 'NOT_FOUND' | 'OTHER';

export const CAMERA_MESSAGES: Record<CameraErrorCode, string> = {
  INSECURE: 'The camera needs HTTPS or localhost. Use Manual entry instead.',
  UNSUPPORTED: 'Scanning is not supported in this browser. Use Manual entry instead.',
  DENIED: 'Camera permission was denied. Use Manual entry instead.',
  NOT_FOUND: 'No camera was found on this device. Use Manual entry instead.',
  OTHER: 'The camera could not be used. Use Manual entry instead.',
};

/** Req 5.6 precedence: insecure, missing getUserMedia, then error name. */
export function mapCameraError(
  env: { isSecureContext: boolean; hasGetUserMedia: boolean },
  err?: { name?: string } | null,
): CameraErrorCode {
  if (!env.isSecureContext) return 'INSECURE';
  if (!env.hasGetUserMedia) return 'UNSUPPORTED';
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'DENIED';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'NOT_FOUND';
  return 'OTHER';
}

// ---------------------------------------------------------------- Direction

/** On Hire -> IN, anything else -> OUT (Req 10.1, 10.2). */
export function directionFor(currentStatus: string): GateDirection {
  return currentStatus === 'On Hire' ? 'IN' : 'OUT';
}

// ---------------------------------------------------------------- Record fields

export interface GateRecordFields {
  fleetNo: string;
  timestamp: string;
  gateDate: string;
  gateTime: string;
  gateTimeZone: string;
  captureMethod: CaptureMethod;
  timeSource: TimeSource;
  qrPayload?: string;
}

interface LocalParts {
  date: string;
  time: string;
}

/** Local date/time of an instant in an explicit zone. Throws RangeError for a bad zone. */
function localParts(d: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  const pad = (s: string, n: number): string => s.padStart(n, '0');
  return {
    date: `${pad(get('year'), 4)}-${pad(get('month'), 2)}-${pad(get('day'), 2)}`,
    time: `${pad(get('hour'), 2)}:${pad(get('minute'), 2)}:${pad(get('second'), 2)}`,
  };
}

/** Pure. Throws RangeError for an invalid instant or time zone. */
export function buildGateRecordFields(
  captureIso: string,
  timeZone: string,
  machine: Pick<MachineLite, 'fleetNo' | 'assetNumber'>,
  method: CaptureMethod,
  source: TimeSource,
  qrPayload?: string,
): GateRecordFields {
  const d = new Date(captureIso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid capture time: ${captureIso}`);
  const { date, time } = localParts(d, timeZone);
  const fields: GateRecordFields = {
    fleetNo: fleetNumberOf(machine),
    timestamp: d.toISOString(),
    gateDate: date,
    gateTime: time,
    gateTimeZone: timeZone,
    captureMethod: method,
    timeSource: source,
  };
  if (method === 'QR' && qrPayload !== undefined) fields.qrPayload = qrPayload;
  return fields;
}

// ---------------------------------------------------------------- Display

export interface GateWhen {
  available: boolean;
  date?: string;
  time?: string;
  zone?: string;
}

function isRecognisedZone(tz: string | undefined | null): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseInstant(v: string | undefined | null): Date | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const present = (v: string | undefined | null): v is string => typeof v === 'string' && v !== '';

export function formatGateWhen(e: {
  gateDate?: string;
  gateTime?: string;
  gateTimeZone?: string;
  timestamp?: string;
  createdAt?: string;
}): GateWhen {
  const zoneOk = isRecognisedZone(e.gateTimeZone);
  const hasStored = present(e.gateDate) && present(e.gateTime);

  if (hasStored && zoneOk) {
    return { available: true, date: e.gateDate, time: e.gateTime, zone: e.gateTimeZone };
  }

  const instant = parseInstant(e.timestamp) ?? parseInstant(e.createdAt);
  if (instant) {
    const zone = zoneOk ? (e.gateTimeZone as string) : 'UTC';
    const { date, time } = localParts(instant, zone);
    return { available: true, date, time, zone };
  }

  if (hasStored) {
    return { available: true, date: e.gateDate, time: e.gateTime, zone: 'Unknown' };
  }
  return { available: false };
}

/** Returns '-' for undefined, null or empty, otherwise the value unchanged. */
export function dashIfMissing(v: string | undefined | null): string {
  return v === undefined || v === null || v === '' ? '-' : v;
}

// ---------------------------------------------------------------- List, migration, seeding

const DEFAULT_ORG_ID = 'org-ja';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const createdMs = (r: { createdAt?: string }): number => {
  const ms = Date.parse(r.createdAt ?? '');
  return Number.isNaN(ms) ? -Infinity : ms;
};

/**
 * persisted: all companies' rows. mock: the in-memory rows of one company.
 * Order: user records (createdAt descending, ties in input order), then seed records
 * in input order, then mock rows whose id is not present yet. Each id appears once.
 */
export function mergeGateList(
  persisted: readonly GateRecord[],
  mock: readonly GateEntry[],
  orgId: string,
): GateRecord[] {
  const seen = new Set<string>();
  const own: GateRecord[] = [];
  for (const r of persisted) {
    if (r.orgId !== orgId || seen.has(r.id)) continue;
    seen.add(r.id);
    own.push(r);
  }
  const users = own
    .filter((r) => !r.seedKey)
    .map((r, i) => ({ r, i, t: createdMs(r) }))
    .sort((a, b) => {
      if (a.t !== b.t) return a.t > b.t ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
  const seeds = own.filter((r) => !!r.seedKey);
  const out: GateRecord[] = [...users, ...seeds];
  for (const m of mock) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ ...m, orgId });
  }
  return out;
}

/**
 * Total over arbitrary input. Keeps objects with a non-empty string id. A missing or empty
 * orgId becomes defaultOrgId. Fills driver, destination, timestamp, createdAt and updatedAt
 * only when absent; every other field is left as is. Idempotent.
 */
export function migrateGateRecords(rows: unknown, defaultOrgId: string = DEFAULT_ORG_ID): GateRecord[] {
  if (!Array.isArray(rows)) return [];
  const out: GateRecord[] = [];
  for (const row of rows) {
    if (!isObject(row)) continue;
    if (typeof row.id !== 'string' || row.id === '') continue;
    const r: Record<string, unknown> = { ...row };
    if (typeof r.orgId !== 'string' || r.orgId === '') r.orgId = defaultOrgId;
    if (r.driver === undefined) r.driver = '';
    if (r.destination === undefined) {
      r.destination = typeof r.arrivingFrom === 'string' ? r.arrivingFrom : '';
    }
    if (r.timestamp === undefined && r.createdAt !== undefined) r.timestamp = r.createdAt;
    if (r.createdAt === undefined && r.timestamp !== undefined) r.createdAt = r.timestamp;
    if (r.updatedAt === undefined && r.createdAt !== undefined) r.updatedAt = r.createdAt;
    out.push(r as unknown as GateRecord);
  }
  return out;
}

/** Total. Resets to an empty state on malformed input, keeps valid fields otherwise. */
export function migrateGateState(raw: unknown): GateStoreState {
  const state: GateStoreState = { entries: [], seedMarkers: {}, legacyImported: false };
  if (!isObject(raw)) return state;
  state.entries = migrateGateRecords(raw.entries);
  if (isObject(raw.seedMarkers)) {
    for (const [org, ids] of Object.entries(raw.seedMarkers)) {
      if (Array.isArray(ids)) state.seedMarkers[org] = ids.filter((x): x is string => typeof x === 'string');
    }
  }
  state.legacyImported = raw.legacyImported === true;
  return state;
}

/** Seeds to insert: not marked for the company and not already present by id. */
export function planGateSeeds(
  markers: readonly string[],
  existingIds: ReadonlySet<string>,
  seeds: readonly GateRecord[],
): GateRecord[] {
  return seeds.filter((s) => !markers.includes(s.id) && !existingIds.has(s.id));
}

/** The gate link fields for a note, only when the note has no link yet. Never overwrites. */
export function linkNoteToGate(
  note: { collectedByGateId?: string },
  gate: { id: string; reference: string; timestamp: string },
): { collectedByGateId?: string; collectedByGateRef?: string; collectedAt?: string } {
  if (note.collectedByGateId) return {};
  return {
    collectedByGateId: gate.id,
    collectedByGateRef: gate.reference,
    collectedAt: gate.timestamp,
  };
}
