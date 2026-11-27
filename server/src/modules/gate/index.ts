import { Router } from 'express';
import { z } from 'zod';
import { authorize, type Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { lockStartHireChain, startHireInTx } from '../bookings/startHire.js';
import { recordAudit } from '../shared/audit.js';
import { assertInScope, assertWritableBranch, branchScopeClause } from '../shared/branchScope.js';
import { decimal, nullableText, text } from '../shared/fields.js';
import { parseQuery, principalWith, requireAction, setVersionHeader, uuidParam, type Page } from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';
import { RETURN_INTAKE_CHECKLIST, RETURN_INTAKE_TYPE, RETURN_INTAKE_VERSION } from './intakeChecklist.js';
import { normalizeFleetNo, parseQr, qrInvalid } from './qr.js';

const DIRECTIONS = ['IN', 'OUT'] as const;
const PURPOSES = ['CUSTOMER_HIRE', 'CUSTOMER_RETURN', 'TRANSFER'] as const;
const PASS_STATUSES = ['Pending', 'Approved', 'Completed', 'Cancelled'] as const;
const CAPTURE_METHODS = ['QR', 'Manual'] as const;
const INSPECTION_STATUSES = ['Pending', 'In Progress', 'Awaiting Approval', 'Passed', 'Failed', 'Cancelled'] as const;
type Direction = (typeof DIRECTIONS)[number];
type Purpose = (typeof PURPOSES)[number];
type PassStatus = (typeof PASS_STATUSES)[number];
type CaptureMethod = (typeof CAPTURE_METHODS)[number];
type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
type Answer = 'Pass' | 'Fail' | 'N/A' | 'Pending';

/** Operational statuses that block a machine from becoming READY when an intake hold is released. */
const BLOCKING_OPERATIONAL = ['Offline', 'Under Repair', 'In Workshop', 'Breakdown'] as const;
/** Operational status a returned machine goes back to; readiness stays INTAKE_PENDING until the hold is released. */
const YARD_STATUS = 'Available';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ---------------------------------------------------------------- gate passes

interface PassRow {
  id: string;
  reference: string;
  branch_id: string;
  machine_id: string;
  booking_id: string | null;
  transport_job_id: string | null;
  collection_note_id: string | null;
  direction: Direction;
  movement_purpose: Purpose;
  status: PassStatus;
  fleet_no_snapshot: string;
  driver_name: string;
  truck_plate: string | null;
  destination: string;
  arriving_from: string | null;
  capture_method: CaptureMethod;
  scanned_at: Date | null;
  qr_payload: string | null;
  device_captured_at: Date | null;
  requested_at: Date;
  approved_at: Date | null;
  approved_by: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
  movement_id: string | null;
  movement_occurred_at: Date | null;
  movement_time_source: string | null;
  movement_operator_user_id: string | null;
  movement_closes_id: string | null;
}

export interface GateMovementDto {
  id: string;
  occurredAt: string;
  timeSource: string;
  operatorUserId: string;
  closesMovementId: string | null;
}

export interface GatePassDto {
  id: string;
  reference: string;
  branchId: string;
  machineId: string;
  bookingId: string | null;
  transportJobId: string | null;
  collectionNoteId: string | null;
  direction: Direction;
  movementPurpose: Purpose;
  status: PassStatus;
  fleetNoSnapshot: string;
  driverName: string;
  truckPlate: string | null;
  destination: string;
  arrivingFrom: string | null;
  captureMethod: CaptureMethod;
  /** When the scan was received; kept separate from the physical crossing time (`movement.occurredAt`). */
  scannedAt: string | null;
  qrPayload: string | null;
  deviceCapturedAt: string | null;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  movement: GateMovementDto | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const PASS_SELECT = `gp.id, gp.reference, gp.branch_id, gp.machine_id, gp.booking_id, gp.transport_job_id, gp.collection_note_id,
  gp.direction, gp.movement_purpose, gp.status, gp.fleet_no_snapshot, gp.driver_name, gp.truck_plate, gp.destination,
  gp.arriving_from, gp.capture_method, gp.scanned_at, gp.qr_payload, gp.device_captured_at, gp.requested_at, gp.approved_at,
  gp.approved_by, gp.notes, gp.created_at, gp.updated_at, gp.row_version,
  gm.id AS movement_id, gm.occurred_at AS movement_occurred_at, gm.time_source AS movement_time_source,
  gm.operator_user_id AS movement_operator_user_id, gm.closes_movement_id AS movement_closes_id`;
const PASS_FROM = 'gate_passes gp LEFT JOIN gate_movements gm ON gm.org_id = gp.org_id AND gm.gate_pass_id = gp.id';

export function passToDto(r: PassRow): GatePassDto {
  return {
    id: r.id,
    reference: r.reference,
    branchId: r.branch_id,
    machineId: r.machine_id,
    bookingId: r.booking_id,
    transportJobId: r.transport_job_id,
    collectionNoteId: r.collection_note_id,
    direction: r.direction,
    movementPurpose: r.movement_purpose,
    status: r.status,
    fleetNoSnapshot: r.fleet_no_snapshot,
    driverName: r.driver_name,
    truckPlate: r.truck_plate,
    destination: r.destination,
    arrivingFrom: r.arriving_from,
    captureMethod: r.capture_method,
    scannedAt: iso(r.scanned_at),
    qrPayload: r.qr_payload,
    deviceCapturedAt: iso(r.device_captured_at),
    requestedAt: r.requested_at.toISOString(),
    approvedAt: iso(r.approved_at),
    approvedBy: r.approved_by,
    notes: r.notes,
    movement: r.movement_id && r.movement_occurred_at
      ? {
          id: r.movement_id,
          occurredAt: r.movement_occurred_at.toISOString(),
          timeSource: r.movement_time_source ?? 'DATABASE',
          operatorUserId: r.movement_operator_user_id as string,
          closesMovementId: r.movement_closes_id,
        }
      : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

async function loadPass(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: 'gate.read' | 'gate.write' | 'gate.approve' } = {},
): Promise<PassRow> {
  const res = await tx.query<PassRow>(
    `SELECT ${PASS_SELECT} FROM ${PASS_FROM} WHERE gp.id = $1${opts.lock ? ' FOR UPDATE OF gp' : ''}`,
    [id],
  );
  let row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Gate pass not found');
  if (opts.lock) {
    // The joined movement came from the pre-lock snapshot; re-read it now that the pass lock is held.
    const fresh = await tx.query<PassRow>(`SELECT ${PASS_SELECT} FROM ${PASS_FROM} WHERE gp.id = $1`, [id]);
    row = fresh.rows[0] ?? row;
  }
  assertInScope(principal, opts.action ?? 'gate.read', row.branch_id);
  return row;
}

async function loadPassesForMachine(tx: TxClient, machineId: string, statuses: readonly PassStatus[]): Promise<GatePassDto[]> {
  const res = await tx.query<PassRow>(
    `SELECT ${PASS_SELECT} FROM ${PASS_FROM} WHERE gp.machine_id = $1 AND gp.status = ANY($2::text[])
      ORDER BY gp.requested_at DESC, gp.id`,
    [machineId, statuses],
  );
  return res.rows.map(passToDto);
}

// ---------------------------------------------------------------- machine / booking / note summaries

interface MachineSummaryRow {
  id: string;
  branch_id: string;
  fleet_no: string;
  asset_no: string;
  operational_status: string;
  readiness_status: string;
  current_location: string;
  active: boolean;
  row_version: string;
}

export interface GateMachineDto {
  id: string;
  branchId: string;
  fleetNo: string;
  assetNo: string;
  operationalStatus: string;
  readinessStatus: string;
  currentLocation: string;
  active: boolean;
  rowVersion: number;
}

const MACHINE_SUMMARY = 'id, branch_id, fleet_no, asset_no, operational_status, readiness_status, current_location, active, row_version';

const machineSummary = (r: MachineSummaryRow): GateMachineDto => ({
  id: r.id,
  branchId: r.branch_id,
  fleetNo: r.fleet_no,
  assetNo: r.asset_no,
  operationalStatus: r.operational_status,
  readinessStatus: r.readiness_status,
  currentLocation: r.current_location,
  active: r.active,
  rowVersion: Number(r.row_version),
});

interface BookingRow {
  id: string;
  reference: string;
  machine_id: string;
  branch_id: string;
  customer_id: string;
  status: string;
  start_date: string;
  end_date: string;
  departed_at: Date | null;
  returned_at: Date | null;
  row_version: string;
}

export interface GateBookingDto {
  id: string;
  reference: string;
  machineId: string;
  branchId: string;
  customerId: string;
  status: string;
  startDate: string;
  endDate: string;
  departedAt: string | null;
  returnedAt: string | null;
  rowVersion: number;
}

const BOOKING_COLUMNS = `id, reference, machine_id, branch_id, customer_id, status, to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date, departed_at, returned_at, row_version`;

const bookingSummary = (r: BookingRow): GateBookingDto => ({
  id: r.id,
  reference: r.reference,
  machineId: r.machine_id,
  branchId: r.branch_id,
  customerId: r.customer_id,
  status: r.status,
  startDate: r.start_date,
  endDate: r.end_date,
  departedAt: iso(r.departed_at),
  returnedAt: iso(r.returned_at),
  rowVersion: Number(r.row_version),
});

interface NoteRow {
  id: string;
  number: string;
  booking_id: string;
  machine_id: string;
  status: string;
  scheduled_collection_at: Date | null;
  row_version: string;
}

export interface GateCollectionNoteDto {
  id: string;
  number: string;
  bookingId: string;
  machineId: string;
  status: string;
  scheduledCollectionAt: string | null;
  rowVersion: number;
}

const NOTE_COLUMNS = 'id, number, booking_id, machine_id, status, scheduled_collection_at, row_version';
/** Collection notes that can still be collected by a Gate IN. */
const OPEN_NOTE_STATUSES = ['Draft', 'Scheduled', 'Picked Up'];

const noteSummary = (r: NoteRow): GateCollectionNoteDto => ({
  id: r.id,
  number: r.number,
  bookingId: r.booking_id,
  machineId: r.machine_id,
  status: r.status,
  scheduledCollectionAt: iso(r.scheduled_collection_at),
  rowVersion: Number(r.row_version),
});

async function loadMachineSummary(tx: TxClient, principal: Principal, id: string, lock = false): Promise<MachineSummaryRow | undefined> {
  const res = await tx.query<MachineSummaryRow>(`SELECT ${MACHINE_SUMMARY} FROM machines WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) return undefined;
  return authorize(principal, 'gate.read', { orgId: principal.orgId, branchId: row.branch_id }) === 'allow' ? row : undefined;
}

// ---------------------------------------------------------------- inspections

interface InspectionRow {
  id: string;
  reference: string;
  machine_id: string;
  fleet_no: string;
  branch_id: string;
  booking_id: string | null;
  gate_movement_id: string | null;
  inspector_user_id: string | null;
  inspection_type: string;
  checklist_version: string;
  status: InspectionStatus;
  scheduled_on: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  overall_result: 'Pass' | 'Fail' | null;
  machine_hours: string | null;
  fuel_percent: string | null;
  notes: string | null;
  hold_released_by: string | null;
  hold_released_at: Date | null;
  hold_release_reason: string | null;
  evidence_count: number;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface InspectionResultDto {
  id: string;
  itemKey: string;
  section: string;
  question: string;
  result: Answer;
  critical: boolean;
  required: boolean;
  notes: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  rowVersion: number;
}

export interface InspectionDto {
  id: string;
  reference: string;
  machineId: string;
  fleetNo: string;
  branchId: string;
  bookingId: string | null;
  gateMovementId: string | null;
  inspectorUserId: string | null;
  inspectionType: string;
  checklistVersion: string;
  status: InspectionStatus;
  scheduledOn: string | null;
  startedAt: string | null;
  completedAt: string | null;
  overallResult: 'Pass' | 'Fail' | null;
  machineHours: string | null;
  fuelPercent: string | null;
  notes: string | null;
  holdReleasedBy: string | null;
  holdReleasedAt: string | null;
  holdReleaseReason: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  results?: InspectionResultDto[];
}

const INSPECTION_SELECT = `i.id, i.reference, i.machine_id, m.fleet_no, i.branch_id, i.booking_id, i.gate_movement_id,
  i.inspector_user_id, i.inspection_type, i.checklist_version, i.status, to_char(i.scheduled_on, 'YYYY-MM-DD') AS scheduled_on,
  i.started_at, i.completed_at, i.overall_result, i.machine_hours, i.fuel_percent, i.notes, i.hold_released_by,
  i.hold_released_at, i.hold_release_reason, i.created_at, i.updated_at, i.row_version,
  (SELECT count(*) FROM evidence_attachments e
    WHERE e.inspection_id = i.id
       OR e.inspection_result_id IN (SELECT r.id FROM inspection_results r WHERE r.inspection_id = i.id))::int AS evidence_count`;
const INSPECTION_FROM = 'inspections i JOIN machines m ON m.org_id = i.org_id AND m.id = i.machine_id';

export function inspectionToDto(r: InspectionRow): InspectionDto {
  return {
    id: r.id,
    reference: r.reference,
    machineId: r.machine_id,
    fleetNo: r.fleet_no,
    branchId: r.branch_id,
    bookingId: r.booking_id,
    gateMovementId: r.gate_movement_id,
    inspectorUserId: r.inspector_user_id,
    inspectionType: r.inspection_type,
    checklistVersion: r.checklist_version,
    status: r.status,
    scheduledOn: r.scheduled_on,
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    overallResult: r.overall_result,
    machineHours: r.machine_hours,
    fuelPercent: r.fuel_percent,
    notes: r.notes,
    holdReleasedBy: r.hold_released_by,
    holdReleasedAt: iso(r.hold_released_at),
    holdReleaseReason: r.hold_release_reason,
    evidenceCount: Number(r.evidence_count),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

interface ResultRow {
  id: string;
  item_key: string;
  section: string;
  question_snapshot: string;
  result: Answer;
  critical: boolean;
  required: boolean;
  notes: string | null;
  answered_by: string | null;
  answered_at: Date | null;
  row_version: string;
}

const RESULT_COLUMNS = 'id, item_key, section, question_snapshot, result, critical, required, notes, answered_by, answered_at, row_version';

const resultToDto = (r: ResultRow): InspectionResultDto => ({
  id: r.id,
  itemKey: r.item_key,
  section: r.section,
  question: r.question_snapshot,
  result: r.result,
  critical: r.critical,
  required: r.required,
  notes: r.notes,
  answeredBy: r.answered_by,
  answeredAt: iso(r.answered_at),
  rowVersion: Number(r.row_version),
});

async function loadInspection(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: 'inspections.read' | 'inspections.write' | 'inspections.release_hold'; skipScope?: boolean } = {},
): Promise<InspectionRow> {
  const res = await tx.query<InspectionRow>(
    `SELECT ${INSPECTION_SELECT} FROM ${INSPECTION_FROM} WHERE i.id = $1${opts.lock ? ' FOR UPDATE OF i' : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Inspection not found');
  // Gate completion (already scoped by gate.write on the pass) may report the inspection it created without inspections.read.
  if (!opts.skipScope) assertInScope(principal, opts.action ?? 'inspections.read', row.branch_id);
  return row;
}

async function loadResults(tx: TxClient, inspectionId: string, lock = false): Promise<ResultRow[]> {
  const res = await tx.query<ResultRow>(
    `SELECT ${RESULT_COLUMNS} FROM inspection_results WHERE inspection_id = $1 ORDER BY created_at, item_key${lock ? ' FOR UPDATE' : ''}`,
    [inspectionId],
  );
  return res.rows;
}

async function inspectionWithResults(tx: TxClient, principal: Principal, id: string): Promise<InspectionDto> {
  const row = await loadInspection(tx, principal, id);
  const results = await loadResults(tx, id);
  // Checklist order is the order of the versioned definition, not insertion time (all rows share a timestamp).
  const order = new Map(RETURN_INTAKE_CHECKLIST.map((c, i) => [c.key, i]));
  results.sort((a, b) => (order.get(a.item_key) ?? 1e6) - (order.get(b.item_key) ?? 1e6));
  return { ...inspectionToDto(row), results: results.map(resultToDto) };
}

// ---------------------------------------------------------------- schemas

const optionalTimestamp = z.iso.datetime({ offset: true });

const createPassSchema = z
  .object({
    direction: z.enum(DIRECTIONS),
    movementPurpose: z.enum(PURPOSES),
    machineId: z.uuid(),
    bookingId: z.union([z.uuid(), z.null()]).optional(),
    transportJobId: z.union([z.uuid(), z.null()]).optional(),
    collectionNoteId: z.union([z.uuid(), z.null()]).optional(),
    captureMethod: z.enum(CAPTURE_METHODS),
    qrPayload: z.union([z.string().max(512), z.null()]).optional(),
    scannedAt: z.union([optionalTimestamp, z.null()]).optional(),
    deviceCapturedAt: z.union([optionalTimestamp, z.null()]).optional(),
    driverName: text(200),
    truckPlate: nullableText(50).optional(),
    destination: text(200),
    arrivingFrom: nullableText(200).optional(),
    notes: nullableText(4000).optional(),
  })
  .strict();

const passListSchema = z.object({
  status: z.enum(PASS_STATUSES).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  machineId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const PASS_SORTS = { requestedAt: 'gp.requested_at', reference: 'gp.reference', status: 'gp.status', createdAt: 'gp.created_at' };

const resolveSchema = z.object({ payload: z.string().max(512) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const completeSchema = z.object({ notes: nullableText(4000).optional() }).strict();

const inspectionListSchema = z.object({
  status: z.enum(INSPECTION_STATUSES).optional(),
  machineId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const INSPECTION_SORTS = { createdAt: 'i.created_at', reference: 'i.reference', status: 'i.status' };

const resultsPatchSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            itemKey: z.string().trim().min(1).max(50),
            result: z.enum(['Pass', 'Fail', 'N/A']),
            notes: nullableText(4000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const inspectionPatchSchema = z
  .object({
    machineHours: z.union([decimal(15, 3), z.null()]).optional(),
    fuelPercent: z.union([decimal(3, 2), z.null()]).optional(),
    notes: nullableText(4000).optional(),
    start: z.boolean().optional(),
  })
  .strict();

const releaseSchema = z
  .object({ reason: z.string().trim().min(1).max(500), evidenceReviewed: z.boolean().optional() })
  .strict();

const fieldError = (field: string, code: string, message: string): AppError =>
  new AppError('VALIDATION_ERROR', message, { [field]: code });

const requireVersion = (actual: string | number, expected: number): void => {
  if (Number(actual) !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
};

// ---------------------------------------------------------------- router

/**
 * Gate passes, gate movements, QR resolution, return-intake inspections and hold release.
 * A pass (Pending/Approved) has no physical effect. `complete` records the single movement with database time and,
 * in the same transaction, applies the booking / collection note / machine / inspection effects.
 */
export function gateRouter(): Router {
  const router = Router();

  // ------------------------------------------------------------ QR resolution

  router.post('/gate/resolve-qr', async (req, res) => {
    const principal = principalWith(req, 'gate.read');
    const input = resolveSchema.parse(req.body ?? {});
    const parsed = parseQr(input.payload);
    if (parsed.orgId !== principal.orgId) throw qrInvalid();
    const body = await withTransaction(principal.orgId, async (tx) => {
      let machineId: string;
      let pass: PassRow | undefined;
      if (parsed.kind === 'GATE_PASS') {
        const found = await tx.query<PassRow>(`SELECT ${PASS_SELECT} FROM ${PASS_FROM} WHERE gp.id = $1`, [parsed.passId]);
        pass = found.rows[0];
        if (!pass || pass.reference !== parsed.reference) throw qrInvalid();
        machineId = pass.machine_id;
      } else {
        machineId = parsed.machineId;
      }
      const machine = await loadMachineSummary(tx, principal, machineId);
      if (!machine) throw qrInvalid();
      if (parsed.kind === 'FLEET' && normalizeFleetNo(machine.fleet_no) !== normalizeFleetNo(parsed.fleetNo)) throw qrInvalid();
      if (pass && authorize(principal, 'gate.read', { orgId: principal.orgId, branchId: pass.branch_id }) !== 'allow') throw qrInvalid();

      const openPasses = await loadPassesForMachine(tx, machine.id, ['Pending', 'Approved']);
      let booking: GateBookingDto | null = null;
      let note: GateCollectionNoteDto | null = null;
      let manualSelectionRequired = false;

      if (pass) {
        // A pass QR carries its own exact context.
        if (pass.booking_id) {
          const b = await tx.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`, [pass.booking_id]);
          booking = b.rows[0] ? bookingSummary(b.rows[0]) : null;
        }
        if (pass.collection_note_id) {
          const n = await tx.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM collection_notes WHERE id = $1`, [pass.collection_note_id]);
          note = n.rows[0] ? noteSummary(n.rows[0]) : null;
        }
      } else {
        // Fleet QR: the return candidate is the one booking that left and has not come back. Never "latest booking".
        const b = await tx.query<BookingRow>(
          `SELECT ${BOOKING_COLUMNS} FROM bookings
            WHERE machine_id = $1 AND departed_at IS NOT NULL AND returned_at IS NULL AND status <> 'Cancelled'
            ORDER BY departed_at, id LIMIT 2`,
          [machine.id],
        );
        if (b.rows.length === 1) {
          booking = bookingSummary(b.rows[0]);
          const n = await tx.query<NoteRow>(
            `SELECT ${NOTE_COLUMNS} FROM collection_notes WHERE booking_id = $1 AND machine_id = $2 AND status = ANY($3::text[]) LIMIT 2`,
            [booking.id, machine.id, OPEN_NOTE_STATUSES],
          );
          note = n.rows.length === 1 ? noteSummary(n.rows[0]) : null;
        } else {
          manualSelectionRequired = true;
        }
      }
      return {
        kind: parsed.kind,
        machine: machineSummary(machine),
        pass: pass ? passToDto(pass) : null,
        openPasses,
        candidateBooking: booking,
        candidateCollectionNote: note,
        manualSelectionRequired,
      };
    });
    res.json(body);
  });

  // ------------------------------------------------------------ gate pass reads

  router.get('/gate-passes', async (req, res) => {
    const principal = principalWith(req, 'gate.read');
    const query = parseQuery(req, passListSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, PASS_SORTS, { column: 'gp.requested_at', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'gp.branch_id', params, false);
    if (scope) where.push(scope);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('gp.status', query.status);
    eq('gp.direction', query.direction);
    eq('gp.machine_id', query.machineId);
    eq('gp.booking_id', query.bookingId);
    eq('gp.branch_id', query.branchId);
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM gate_passes gp ${clause}`, params);
      const rows = await tx.query<PassRow>(
        `SELECT ${PASS_SELECT} FROM ${PASS_FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, gp.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(passToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<GatePassDto>;
    });
    res.json(body);
  });

  router.get('/gate-passes/:id', async (req, res) => {
    const principal = principalWith(req, 'gate.read');
    const id = uuidParam(req);
    const dto = passToDto(await withTransaction(principal.orgId, (tx) => loadPass(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------------------------------------ create (Pending, no physical side effects)

  router.post('/gate-passes', requireAction('gate.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'gate.write');
    const input = createPassSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);

    const purposeOk =
      input.movementPurpose === 'TRANSFER' ||
      (input.movementPurpose === 'CUSTOMER_HIRE' && input.direction === 'OUT') ||
      (input.movementPurpose === 'CUSTOMER_RETURN' && input.direction === 'IN');
    if (!purposeOk) throw fieldError('direction', 'purpose_mismatch', 'Direction does not match the movement purpose');
    const customer = input.movementPurpose !== 'TRANSFER';
    const bookingId = input.bookingId ?? null;
    const noteId = input.collectionNoteId ?? null;
    const jobId = input.transportJobId ?? null;
    if (customer && !bookingId) throw fieldError('bookingId', 'required', 'A customer movement needs the exact booking');
    if (!customer && (bookingId || noteId)) {
      throw fieldError('bookingId', 'not_allowed', 'A transfer cannot reference a booking or collection note');
    }
    if (noteId && input.movementPurpose !== 'CUSTOMER_RETURN') {
      throw fieldError('collectionNoteId', 'not_allowed', 'A collection note applies to a customer return only');
    }
    if (input.captureMethod === 'QR' && !input.qrPayload) throw fieldError('qrPayload', 'required', 'A QR capture needs the scanned payload');
    if (input.captureMethod === 'Manual' && input.qrPayload) throw fieldError('qrPayload', 'not_allowed', 'A manual capture has no QR payload');
    // Strict parse before any database work: a bad or foreign QR creates nothing.
    const qr = input.captureMethod === 'QR' ? parseQr(input.qrPayload) : null;
    if (qr) {
      if (qr.orgId !== principal.orgId || qr.kind !== 'FLEET' || qr.machineId !== input.machineId.toLowerCase()) throw qrInvalid();
    }

    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'gate_passes.create', ctx, async () => {
        const machine = await loadMachineSummary(tx, principal, input.machineId, true);
        if (!machine) throw fieldError('machineId', 'not_found', 'Machine not found');
        if (!machine.active) throw fieldError('machineId', 'inactive', 'Machine is archived');
        assertWritableBranch(principal, 'gate.write', machine.branch_id);
        if (qr?.kind === 'FLEET' && normalizeFleetNo(machine.fleet_no) !== normalizeFleetNo(qr.fleetNo)) throw qrInvalid();

        if (bookingId) {
          const b = await tx.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`, [bookingId]);
          const booking = b.rows[0];
          if (!booking) throw fieldError('bookingId', 'not_found', 'Booking not found');
          if (booking.machine_id !== machine.id) throw fieldError('machineId', 'booking_machine_mismatch', 'The machine is not the booking machine');
          if (input.movementPurpose === 'CUSTOMER_RETURN') {
            if (booking.status !== 'On Hire' || !booking.departed_at || booking.returned_at) {
              throw new AppError('BUSINESS_RULE', 'The booking is not currently out on hire', { bookingId: 'not_on_hire' });
            }
          } else if (['Cancelled', 'Returned', 'Draft'].includes(booking.status) || booking.departed_at) {
            throw new AppError('BUSINESS_RULE', 'The booking cannot be dispatched', { bookingId: 'not_dispatchable' });
          }
        }
        if (noteId) {
          const n = await tx.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM collection_notes WHERE id = $1`, [noteId]);
          const note = n.rows[0];
          if (!note) throw fieldError('collectionNoteId', 'not_found', 'Collection note not found');
          if (note.booking_id !== bookingId || note.machine_id !== machine.id) {
            throw fieldError('collectionNoteId', 'booking_mismatch', 'The collection note is not for this booking');
          }
          if (!OPEN_NOTE_STATUSES.includes(note.status)) {
            throw new AppError('BUSINESS_RULE', `The collection note is ${note.status}`, { collectionNoteId: 'not_open' });
          }
        }
        if (jobId) {
          const j = await tx.query<{ machine_id: string; booking_id: string | null }>(
            'SELECT machine_id, booking_id FROM transport_jobs WHERE id = $1',
            [jobId],
          );
          const job = j.rows[0];
          if (!job) throw fieldError('transportJobId', 'not_found', 'Transport job not found');
          if (job.machine_id !== machine.id || (bookingId && job.booking_id !== bookingId)) {
            throw fieldError('transportJobId', 'mismatch', 'The transport job does not match the machine and booking');
          }
        }
        const open = await tx.query(
          `SELECT 1 FROM gate_passes WHERE machine_id = $1 AND direction = $2 AND status IN ('Pending', 'Approved') LIMIT 1`,
          [machine.id, input.direction],
        );
        if ((open.rowCount ?? 0) > 0) {
          throw new AppError('DUPLICATE', 'An open gate pass already exists for this machine and direction', { machineId: 'open_pass_exists' });
        }

        const reference = await allocateNumber(tx, principal.orgId, 'GATE');
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO gate_passes (org_id, reference, branch_id, machine_id, booking_id, transport_job_id, collection_note_id,
                                    direction, movement_purpose, status, fleet_no_snapshot, driver_name, truck_plate, destination,
                                    arriving_from, capture_method, scanned_at, qr_payload, device_captured_at, notes,
                                    created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', $10, $11, $12, $13, $14, $15,
                   COALESCE($16::timestamptz, CASE WHEN $15 = 'QR' THEN now() END), $17, $18, $19, $20, $20)
           RETURNING id`,
          [
            principal.orgId, reference, machine.branch_id, machine.id, bookingId, jobId, noteId, input.direction,
            input.movementPurpose, machine.fleet_no, input.driverName, input.truckPlate ?? null, input.destination,
            input.arrivingFrom ?? null, input.captureMethod, input.scannedAt ?? null, input.qrPayload ?? null,
            input.deviceCapturedAt ?? null, input.notes ?? null, principal.userId,
          ],
        );
        const dto = passToDto(await loadPass(tx, principal, ins.rows[0].id));
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'gate_pass.created',
          entityType: 'gate_pass',
          entityId: dto.id,
          correlationId: req.correlationId,
          after: dto,
        });
        return { status: 201, body: dto };
      }),
    );
    const body = result.body as GatePassDto;
    if (typeof body.rowVersion === 'number') setVersionHeader(res, body.rowVersion);
    res.status(result.status).json(body);
  });

  // ------------------------------------------------------------ approve / cancel

  router.post('/gate-passes/:id/approve', async (req, res) => {
    const principal = principalWith(req, 'gate.approve');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadPass(tx, principal, id, { lock: true, action: 'gate.approve' });
      requireVersion(before.row_version, expected);
      if (before.status !== 'Pending') throw new AppError('INVALID_TRANSITION', `Cannot approve a ${before.status} gate pass`);
      await versionedUpdate(tx, {
        table: 'gate_passes', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Approved', approved_at: new Date(), approved_by: principal.userId, updated_at: new Date(), updated_by: principal.userId },
      });
      const after = passToDto(await loadPass(tx, principal, id));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'gate_pass.approved',
        entityType: 'gate_pass',
        entityId: id,
        correlationId: req.correlationId,
        before: { status: before.status },
        after: { status: after.status, approvedAt: after.approvedAt, approvedBy: after.approvedBy },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/gate-passes/:id/cancel', async (req, res) => {
    const principal = principalWith(req, 'gate.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = reasonSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadPass(tx, principal, id, { lock: true, action: 'gate.write' });
      requireVersion(before.row_version, expected);
      if (before.status !== 'Pending' && before.status !== 'Approved') {
        throw new AppError('INVALID_TRANSITION', `Cannot cancel a ${before.status} gate pass`);
      }
      // An approved pass was released by a supervisor, so withdrawing it needs the approval permission too.
      if (before.status === 'Approved') principalWith(req, 'gate.approve');
      await versionedUpdate(tx, {
        table: 'gate_passes', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Cancelled', updated_at: new Date(), updated_by: principal.userId },
      });
      const after = passToDto(await loadPass(tx, principal, id));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'gate_pass.cancelled',
        entityType: 'gate_pass',
        entityId: id,
        correlationId: req.correlationId,
        reason: input.reason,
        before: { status: before.status },
        after: { status: after.status },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------------------------------------ complete (the physical crossing)

  /**
   * One transaction: lock the pass; a second completion returns the existing result unchanged. The pass must be
   * Approved, or Pending when the caller also holds gate.approve (the completion then records the approval as well).
   */
  router.post('/gate-passes/:id/complete', requireAction('gate.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'gate.write');
    const id = uuidParam(req);
    const input = completeSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const canApprove = authorize(principal, 'gate.approve') === 'allow';

    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'gate_passes.complete', ctx, async () => {
        const locked = await loadPass(tx, principal, id, { lock: true, action: 'gate.write' });

        const existingInspection = async (movementId: string): Promise<InspectionDto | null> => {
          const r = await tx.query<{ id: string }>('SELECT id FROM inspections WHERE gate_movement_id = $1', [movementId]);
          return r.rows[0] ? inspectionToDto(await loadInspection(tx, principal, r.rows[0].id, { skipScope: true })) : null;
        };
        // Already crossed: return the recorded result, no new movement and no second set of side effects.
        if (locked.movement_id) {
          return {
            status: 200,
            body: {
              pass: passToDto(locked),
              movement: passToDto(locked).movement,
              inspection: await existingInspection(locked.movement_id),
              booking: null as unknown,
              alreadyCompleted: true,
            },
          };
        }
        if (locked.status === 'Cancelled' || locked.status === 'Completed') {
          throw new AppError('INVALID_TRANSITION', `Cannot complete a ${locked.status} gate pass`);
        }
        if (locked.status === 'Pending' && !canApprove) {
          throw new AppError('BUSINESS_RULE', 'The gate pass must be approved before the machine crosses the gate', { status: 'approval_required' });
        }
        const pass = locked;
        const correlationId = req.correlationId;

        // Lock order: pass, booking, machine (startHireInTx takes its own locks after the pass).
        let booking: BookingRow | undefined;
        if (pass.booking_id && pass.direction === 'IN') {
          const b = await tx.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1 FOR UPDATE`, [pass.booking_id]);
          booking = b.rows[0];
          if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
          if (booking.status !== 'On Hire' || !booking.departed_at || booking.returned_at) {
            throw new AppError('BUSINESS_RULE', 'The booking is not currently out on hire', { bookingId: 'not_on_hire' });
          }
        }
        let closes: string | null = null;
        if (pass.direction === 'IN' && pass.booking_id) {
          const out = await tx.query<{ id: string }>(
            `SELECT g.id FROM gate_movements g
              WHERE g.booking_id = $1 AND g.machine_id = $2 AND g.direction = 'OUT'
                AND NOT EXISTS (SELECT 1 FROM gate_movements c WHERE c.closes_movement_id = g.id)
              ORDER BY g.occurred_at DESC, g.id LIMIT 1`,
            [pass.booking_id, pass.machine_id],
          );
          closes = out.rows[0]?.id ?? null;
        }

        // Same lock order as the planner Start Hire (quotation -> agreement -> booking -> machine) before any FK-locking insert.
        if (pass.movement_purpose === 'CUSTOMER_HIRE' && pass.booking_id) await lockStartHireChain(tx, pass.booking_id);

        const mv = await tx.query<{ id: string; occurred_at: Date }>(
          `INSERT INTO gate_movements (org_id, gate_pass_id, machine_id, booking_id, direction, operator_user_id, capture_method,
                                       time_source, closes_movement_id, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'DATABASE', $8, $9, $6)
           RETURNING id, occurred_at`,
          [principal.orgId, pass.id, pass.machine_id, pass.booking_id, pass.direction, principal.userId, pass.capture_method, closes, input.notes ?? null],
        );
        const movementId = mv.rows[0].id;
        const occurredAt = mv.rows[0].occurred_at;

        let bookingResult: unknown = null;
        let inspection: InspectionDto | null = null;

        if (pass.movement_purpose === 'CUSTOMER_HIRE') {
          const started = await startHireInTx(tx, principal, pass.booking_id as string, {
            source: 'GATE_OUT',
            sourceKey: `gate:${pass.id}`,
            occurredAt,
            correlationId,
          });
          bookingResult = started.booking;
        } else if (pass.movement_purpose === 'CUSTOMER_RETURN') {
          const bk = booking as BookingRow;
          await tx.query(
            `UPDATE bookings SET status = 'Returned', returned_at = $2,
                    collected_at = CASE WHEN $4::boolean THEN COALESCE(collected_at, $2) ELSE collected_at END,
                    updated_at = now(), updated_by = $3, row_version = row_version + 1
              WHERE id = $1`,
            [bk.id, occurredAt, principal.userId, pass.collection_note_id !== null],
          );
          if (pass.collection_note_id) {
            const cn = await tx.query<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM collection_notes WHERE id = $1 FOR UPDATE`, [pass.collection_note_id]);
            const note = cn.rows[0];
            if (!note || note.booking_id !== bk.id || !OPEN_NOTE_STATUSES.includes(note.status)) {
              throw new AppError('BUSINESS_RULE', 'The collection note can no longer be collected', { collectionNoteId: 'not_open' });
            }
            await tx.query(
              `UPDATE collection_notes SET status = 'Collected', collected_movement_id = $2, collected_at = $3,
                      updated_at = now(), updated_by = $4, row_version = row_version + 1
                WHERE id = $1`,
              [note.id, movementId, occurredAt, principal.userId],
            );
          }
          // The machine is back: every other open note of this booking is collected too, and its open auto job is done.
          const others = await tx.query<{ id: string }>(
            `UPDATE collection_notes SET status = 'Collected', collected_movement_id = $2, collected_at = $3,
                    updated_at = now(), updated_by = $4, row_version = row_version + 1
              WHERE booking_id = $1 AND status = ANY($5::text[])
              RETURNING id`,
            [bk.id, movementId, occurredAt, principal.userId, OPEN_NOTE_STATUSES],
          );
          const collectedIds = [...others.rows.map((r) => r.id), ...(pass.collection_note_id ? [pass.collection_note_id] : [])];
          if (collectedIds.length > 0) {
            await tx.query(
              `UPDATE transport_jobs SET status = 'Completed', updated_at = now(), updated_by = $2, row_version = row_version + 1
                WHERE collection_note_id = ANY($1::uuid[]) AND status NOT IN ('Completed', 'Cancelled')`,
              [collectedIds, principal.userId],
            );
          }
          const machine = await loadMachineSummary(tx, principal, pass.machine_id, true);
          if (!machine) throw new AppError('NOT_FOUND', 'Machine not found');
          const branch = await tx.query<{ name: string }>('SELECT name FROM branches WHERE id = $1', [pass.branch_id]);
          await tx.query(
            `UPDATE machines SET operational_status = $2, readiness_status = 'INTAKE_PENDING', current_location = $3,
                    updated_at = now(), updated_by = $4, row_version = row_version + 1
              WHERE id = $1`,
            [machine.id, YARD_STATUS, (branch.rows[0]?.name ?? machine.current_location).slice(0, 200), principal.userId],
          );
          const reference = await allocateNumber(tx, principal.orgId, 'INSPECTION');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO inspections (org_id, reference, machine_id, branch_id, booking_id, gate_movement_id, inspection_type,
                                      checklist_version, status, scheduled_on, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', CURRENT_DATE, $9, $9)
             RETURNING id`,
            [principal.orgId, reference, pass.machine_id, pass.branch_id, bk.id, movementId, RETURN_INTAKE_TYPE, RETURN_INTAKE_VERSION, principal.userId],
          );
          const items = RETURN_INTAKE_CHECKLIST;
          await tx.query(
            `INSERT INTO inspection_results (org_id, inspection_id, item_key, section, question_snapshot, result, critical, required, created_by, updated_by)
             SELECT $1, $2, t.item_key, t.section, t.question, 'Pending', t.critical, t.required, $8, $8
               FROM unnest($3::text[], $4::text[], $5::text[], $6::boolean[], $7::boolean[])
                    AS t(item_key, section, question, critical, required)`,
            [
              principal.orgId, ins.rows[0].id, items.map((i) => i.key), items.map((i) => i.section), items.map((i) => i.question),
              items.map((i) => i.critical), items.map((i) => i.required), principal.userId,
            ],
          );
          inspection = inspectionToDto(await loadInspection(tx, principal, ins.rows[0].id, { skipScope: true }));
          const b2 = await tx.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`, [bk.id]);
          bookingResult = b2.rows[0] ? bookingSummary(b2.rows[0]) : null;
        } else {
          // TRANSFER: movement only. Quotations and bookings are never touched. An OUT transfer records where the machine went.
          if (pass.direction === 'OUT') {
            await tx.query(
              `UPDATE machines SET current_location = $2, updated_at = now(), updated_by = $3, row_version = row_version + 1 WHERE id = $1`,
              [pass.machine_id, pass.destination.slice(0, 200), principal.userId],
            );
          } else {
            const branch = await tx.query<{ name: string }>('SELECT name FROM branches WHERE id = $1', [pass.branch_id]);
            if (branch.rows[0]) {
              await tx.query(
                `UPDATE machines SET current_location = $2, updated_at = now(), updated_by = $3, row_version = row_version + 1 WHERE id = $1`,
                [pass.machine_id, branch.rows[0].name.slice(0, 200), principal.userId],
              );
            }
          }
        }

        await versionedUpdate(tx, {
          table: 'gate_passes', orgId: principal.orgId, id: pass.id, expectedVersion: Number(pass.row_version),
          set: {
            status: 'Completed',
            ...(pass.status === 'Pending' ? { approved_at: new Date(), approved_by: principal.userId } : {}),
            updated_at: new Date(),
            updated_by: principal.userId,
          },
        });
        const after = passToDto(await loadPass(tx, principal, pass.id));
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'gate_pass.completed',
          entityType: 'gate_pass',
          entityId: pass.id,
          correlationId,
          before: { status: pass.status },
          after: {
            status: after.status,
            movementId,
            direction: pass.direction,
            movementPurpose: pass.movement_purpose,
            bookingId: pass.booking_id,
            occurredAt: occurredAt.toISOString(),
            inspectionId: inspection?.id ?? null,
          },
        });
        return { status: 200, body: { pass: after, movement: after.movement, inspection, booking: bookingResult, alreadyCompleted: false } };
      }),
    );
    res.status(result.status).json(result.body);
  });

  // ------------------------------------------------------------ inspections

  router.get('/inspections', async (req, res) => {
    const principal = principalWith(req, 'inspections.read');
    const query = parseQuery(req, inspectionListSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, INSPECTION_SORTS, { column: 'i.created_at', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'i.branch_id', params, false);
    if (scope) where.push(scope);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('i.status', query.status);
    eq('i.machine_id', query.machineId);
    eq('i.booking_id', query.bookingId);
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM inspections i ${clause}`, params);
      const rows = await tx.query<InspectionRow>(
        `SELECT ${INSPECTION_SELECT} FROM ${INSPECTION_FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, i.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(inspectionToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<InspectionDto>;
    });
    res.json(body);
  });

  router.get('/inspections/:id', async (req, res) => {
    const principal = principalWith(req, 'inspections.read');
    const id = uuidParam(req);
    const dto = await withTransaction(principal.orgId, (tx) => inspectionWithResults(tx, principal, id));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  /** Inspection fields that may change only while the intake is open. */
  const assertOpen = (row: InspectionRow): void => {
    if (row.status !== 'Pending' && row.status !== 'In Progress') {
      throw new AppError('INVALID_TRANSITION', `The inspection is ${row.status} and can no longer be edited`);
    }
  };

  router.patch('/inspections/:id/results', async (req, res) => {
    const principal = principalWith(req, 'inspections.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = resultsPatchSchema.parse(req.body ?? {});
    const keys = input.results.map((r) => r.itemKey);
    if (new Set(keys).size !== keys.length) throw fieldError('results', 'duplicate_item', 'An item is answered more than once');
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadInspection(tx, principal, id, { lock: true, action: 'inspections.write' });
      requireVersion(before.row_version, expected);
      assertOpen(before);
      const existing = new Map((await loadResults(tx, id, true)).map((r) => [r.item_key, r]));
      const errors: Record<string, string> = {};
      for (const a of input.results) {
        const row = existing.get(a.itemKey);
        if (!row) errors[a.itemKey] = 'unknown_item';
        else if (a.result === 'N/A' && row.critical) errors[a.itemKey] = 'not_applicable_not_allowed';
      }
      if (Object.keys(errors).length > 0) throw new AppError('VALIDATION_ERROR', 'Some answers are not valid for this checklist', errors);
      for (const a of input.results) {
        await tx.query(
          `UPDATE inspection_results SET result = $3, notes = $4, answered_by = $5, answered_at = now(),
                  updated_at = now(), updated_by = $5, row_version = row_version + 1
            WHERE inspection_id = $1 AND item_key = $2`,
          [id, a.itemKey, a.result, a.notes ?? null, principal.userId],
        );
      }
      await versionedUpdate(tx, {
        table: 'inspections', orgId: principal.orgId, id, expectedVersion: expected,
        set: {
          status: 'In Progress',
          started_at: before.started_at ?? new Date(),
          inspector_user_id: before.inspector_user_id ?? principal.userId,
          updated_at: new Date(),
          updated_by: principal.userId,
        },
      });
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'inspection.results_updated',
        entityType: 'inspection',
        entityId: id,
        correlationId: req.correlationId,
        after: { answers: input.results.map((r) => ({ itemKey: r.itemKey, result: r.result })) },
      });
      return inspectionWithResults(tx, principal, id);
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.patch('/inspections/:id', async (req, res) => {
    const principal = principalWith(req, 'inspections.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = inspectionPatchSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    if (typeof patch.fuelPercent === 'string' && Number(patch.fuelPercent) > 100) {
      throw fieldError('fuelPercent', 'too_big', 'Fuel percent must be between 0 and 100');
    }
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadInspection(tx, principal, id, { lock: true, action: 'inspections.write' });
      requireVersion(before.row_version, expected);
      assertOpen(before);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      if (patch.machineHours !== undefined) set.machine_hours = patch.machineHours;
      if (patch.fuelPercent !== undefined) set.fuel_percent = patch.fuelPercent;
      if (patch.notes !== undefined) set.notes = patch.notes;
      if (patch.start === true) {
        set.status = 'In Progress';
        set.started_at = before.started_at ?? new Date();
        set.inspector_user_id = before.inspector_user_id ?? principal.userId;
      }
      await versionedUpdate(tx, { table: 'inspections', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = await inspectionWithResults(tx, principal, id);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'inspection.updated',
        entityType: 'inspection',
        entityId: id,
        correlationId: req.correlationId,
        before: { status: before.status, machineHours: before.machine_hours, fuelPercent: before.fuel_percent, notes: before.notes },
        after: { status: after.status, machineHours: after.machineHours, fuelPercent: after.fuelPercent, notes: after.notes },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/inspections/:id/submit', async (req, res) => {
    const principal = principalWith(req, 'inspections.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const body = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadInspection(tx, principal, id, { lock: true, action: 'inspections.write' });
      requireVersion(before.row_version, expected);
      assertOpen(before);
      const results = await loadResults(tx, id, true);
      // Required and critical items must be answered. A Fail on either fails the intake.
      const unanswered: Record<string, string> = {};
      let failed = false;
      for (const r of results) {
        const mustAnswer = r.required || r.critical;
        if (mustAnswer && r.result === 'Pending') unanswered[r.item_key] = 'required';
        if (mustAnswer && r.result === 'Fail') failed = true;
      }
      if (Object.keys(unanswered).length > 0) {
        throw new AppError('VALIDATION_ERROR', 'All required checklist items must be answered before submitting', unanswered);
      }
      const now = new Date();
      await versionedUpdate(tx, {
        table: 'inspections', orgId: principal.orgId, id, expectedVersion: expected,
        set: {
          status: failed ? 'Failed' : 'Passed',
          overall_result: failed ? 'Fail' : 'Pass',
          started_at: before.started_at ?? now,
          completed_at: now,
          inspector_user_id: before.inspector_user_id ?? principal.userId,
          updated_at: now,
          updated_by: principal.userId,
        },
      });
      // A pass does not release the hold and starts no workshop or final-ready step; only a failure changes the machine.
      if (failed) {
        await tx.query(
          `UPDATE machines SET readiness_status = 'BLOCKED', updated_at = now(), updated_by = $2, row_version = row_version + 1 WHERE id = $1`,
          [before.machine_id, principal.userId],
        );
      }
      const after = await inspectionWithResults(tx, principal, id);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'inspection.submitted',
        entityType: 'inspection',
        entityId: id,
        correlationId: req.correlationId,
        before: { status: before.status },
        after: { status: after.status, overallResult: after.overallResult, machineReadiness: failed ? 'BLOCKED' : 'unchanged' },
      });
      return after;
    });
    setVersionHeader(res, body.rowVersion);
    res.json(body);
  });

  router.post('/inspections/:id/release-hold', async (req, res) => {
    const principal = principalWith(req, 'inspections.release_hold');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = releaseSchema.parse(req.body ?? {});
    const out = await withTransaction(principal.orgId, async (tx) => {
      const before = await loadInspection(tx, principal, id, { lock: true, action: 'inspections.release_hold' });
      requireVersion(before.row_version, expected);
      if (before.hold_released_at) throw new AppError('BUSINESS_RULE', 'The hold was already released', { status: 'already_released' });
      if (before.status !== 'Passed' && before.status !== 'Failed') {
        throw new AppError('BUSINESS_RULE', 'The intake inspection must be submitted before its hold can be released', { status: 'not_submitted' });
      }
      // A Passed inspection is its own evidence; a Failed one needs attached photos or an explicit review confirmation.
      if (before.status === 'Failed' && before.evidence_count < 1 && input.evidenceReviewed !== true) {
        throw new AppError('BUSINESS_RULE', 'Reviewed evidence is required to release a failed intake hold', { evidence: 'required' });
      }
      const now = new Date();
      await versionedUpdate(tx, {
        table: 'inspections', orgId: principal.orgId, id, expectedVersion: expected,
        set: {
          hold_released_by: principal.userId,
          hold_released_at: now,
          hold_release_reason: input.reason,
          updated_at: now,
          updated_by: principal.userId,
        },
      });
      const m = await tx.query<{ operational_status: string; readiness_status: string }>(
        'SELECT operational_status, readiness_status FROM machines WHERE id = $1 FOR UPDATE',
        [before.machine_id],
      );
      const machine = m.rows[0];
      if (!machine) throw new AppError('NOT_FOUND', 'Machine not found');
      const blockers: string[] = [];
      if ((BLOCKING_OPERATIONAL as readonly string[]).includes(machine.operational_status)) {
        blockers.push(`operational_status:${machine.operational_status}`);
      }
      const others = await tx.query<{ reference: string; status: string }>(
        `SELECT reference, status FROM inspections
          WHERE machine_id = $1 AND id <> $2
            AND ((status = 'Failed' AND hold_released_at IS NULL) OR status IN ('Pending', 'In Progress', 'Awaiting Approval'))`,
        [before.machine_id, id],
      );
      for (const o of others.rows) blockers.push(`inspection:${o.reference}:${o.status}`);
      let readiness = machine.readiness_status;
      const holdsMachine = readiness === 'INTAKE_PENDING' || readiness === 'BLOCKED';
      if (blockers.length === 0 && holdsMachine) {
        await tx.query(
          `UPDATE machines SET readiness_status = 'READY', updated_at = now(), updated_by = $2, row_version = row_version + 1 WHERE id = $1`,
          [before.machine_id, principal.userId],
        );
        readiness = 'READY';
      }
      const after = await inspectionWithResults(tx, principal, id);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'inspection.hold_released',
        entityType: 'inspection',
        entityId: id,
        correlationId: req.correlationId,
        reason: input.reason,
        before: { status: before.status, machineReadiness: machine.readiness_status },
        after: { machineReadiness: readiness, blockers, evidenceCount: before.evidence_count, evidenceReviewed: input.evidenceReviewed === true },
      });
      return { inspection: after, machine: { id: before.machine_id, readinessStatus: readiness, released: readiness === 'READY' && holdsMachine, blockers } };
    });
    setVersionHeader(res, out.inspection.rowVersion);
    res.json(out);
  });

  return router;
}
