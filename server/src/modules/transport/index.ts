import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertActiveBranch, assertInScope, assertWritableBranch, branchScopeClause } from '../shared/branchScope.js';
import { decimal, isoDate, nullableText, pick, text } from '../shared/fields.js';
import {
  likePattern, mapUniqueViolation, parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam,
  type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

// ---------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------

export const JOB_STATUSES = ['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed', 'Cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
const FORWARD: Readonly<Record<string, JobStatus>> = {
  Scheduled: 'Loading',
  Loading: 'In Transit',
  'In Transit': 'Delivered',
  Delivered: 'Returning',
  Returning: 'Completed',
};
const DRIVER_STATUSES = ['Available', 'On Delivery', 'Returning', 'Off Duty'] as const;
const VEHICLE_TYPES = ['Flatbed', 'Lowboy', 'Crane Truck', 'Recovery'] as const;
const VEHICLE_STATUSES = ['Available', 'On Route', 'Maintenance', 'Offline'] as const;
const SHIFTS = ['Morning', 'Evening'] as const;
const TYPE_CODES = ['D', 'O', 'T', 'T2'] as const;

/** Whether a job may move from `from` to `to`: one step forward, or Cancelled from any non-final status. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (to === 'Cancelled') return from !== 'Completed' && from !== 'Cancelled';
  return FORWARD[from] === to;
}

// ---------------------------------------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------------------------------------

interface DriverRow {
  id: string; branch_id: string; user_id: string | null; name: string; phone: string; license_no: string;
  license_expires_on: string; status: (typeof DRIVER_STATUSES)[number]; created_at: Date; updated_at: Date; row_version: string;
}
export interface DriverDto {
  id: string; branchId: string; userId: string | null; name: string; phone: string; licenseNo: string;
  licenseExpiresOn: string; status: (typeof DRIVER_STATUSES)[number]; createdAt: string; updatedAt: string; rowVersion: number;
}
const DRIVER_COLUMNS = `id, branch_id, user_id, name, phone, license_no, to_char(license_expires_on, 'YYYY-MM-DD') AS license_expires_on,
  status, created_at, updated_at, row_version`;
const driverToDto = (r: DriverRow): DriverDto => ({
  id: r.id, branchId: r.branch_id, userId: r.user_id, name: r.name, phone: r.phone, licenseNo: r.license_no,
  licenseExpiresOn: r.license_expires_on, status: r.status, createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
});
const driverFields = {
  branchId: z.uuid(),
  userId: z.union([z.uuid(), z.null()]),
  name: text(200),
  phone: text(50),
  licenseNo: text(100),
  licenseExpiresOn: isoDate,
  status: z.enum(DRIVER_STATUSES),
};
const driverCreateSchema = z.object({ ...driverFields, userId: driverFields.userId.optional(), status: driverFields.status.optional() }).strict();
const driverUpdateSchema = z.object(driverFields).partial().strict();
const DRIVER_COLUMN_BY_FIELD: Record<string, string> = {
  branchId: 'branch_id', userId: 'user_id', name: 'name', phone: 'phone', licenseNo: 'license_no',
  licenseExpiresOn: 'license_expires_on', status: 'status',
};

async function loadDriver(tx: TxClient, principal: Principal, id: string, opts: { lock?: boolean; action?: 'transport.read' | 'transport.write' } = {}): Promise<DriverRow> {
  const res = await tx.query<DriverRow>(`SELECT ${DRIVER_COLUMNS} FROM drivers WHERE id = $1${opts.lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Driver not found');
  assertInScope(principal, opts.action ?? 'transport.read', row.branch_id);
  return row;
}

async function requireUser(tx: TxClient, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const res = await tx.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (res.rowCount === 0) throw new AppError('VALIDATION_ERROR', 'User not found', { userId: 'not_found' });
}

// ---------------------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------------------

interface VehicleRow {
  id: string; branch_id: string; registration_no: string; vehicle_type: (typeof VEHICLE_TYPES)[number]; capacity_kg: string;
  status: (typeof VEHICLE_STATUSES)[number]; created_at: Date; updated_at: Date; row_version: string;
}
export interface VehicleDto {
  id: string; branchId: string; registrationNo: string; vehicleType: (typeof VEHICLE_TYPES)[number]; capacityKg: string;
  status: (typeof VEHICLE_STATUSES)[number]; createdAt: string; updatedAt: string; rowVersion: number;
}
const VEHICLE_COLUMNS = 'id, branch_id, registration_no, vehicle_type, capacity_kg, status, created_at, updated_at, row_version';
const vehicleToDto = (r: VehicleRow): VehicleDto => ({
  id: r.id, branchId: r.branch_id, registrationNo: r.registration_no, vehicleType: r.vehicle_type, capacityKg: r.capacity_kg,
  status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
});
const vehicleFields = {
  branchId: z.uuid(),
  registrationNo: text(50),
  vehicleType: z.enum(VEHICLE_TYPES),
  capacityKg: decimal(11, 3),
  status: z.enum(VEHICLE_STATUSES),
};
const vehicleCreateSchema = z.object({ ...vehicleFields, status: vehicleFields.status.optional() }).strict();
const vehicleUpdateSchema = z.object(vehicleFields).partial().strict();
const VEHICLE_COLUMN_BY_FIELD: Record<string, string> = {
  branchId: 'branch_id', registrationNo: 'registration_no', vehicleType: 'vehicle_type', capacityKg: 'capacity_kg', status: 'status',
};
const VEHICLE_UNIQUE = { uq_transport_vehicles_registration: 'registrationNo' };

async function loadVehicle(tx: TxClient, principal: Principal, id: string, opts: { lock?: boolean; action?: 'transport.read' | 'transport.write' } = {}): Promise<VehicleRow> {
  const res = await tx.query<VehicleRow>(`SELECT ${VEHICLE_COLUMNS} FROM transport_vehicles WHERE id = $1${opts.lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Vehicle not found');
  assertInScope(principal, opts.action ?? 'transport.read', row.branch_id);
  return row;
}

// ---------------------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------------------

export interface JobRow {
  id: string; reference: string; branch_id: string; machine_id: string; booking_id: string | null; quotation_id: string | null;
  collection_note_id: string | null; driver_id: string | null; vehicle_id: string | null; planner_name: string;
  schedule_date: string; shift: (typeof SHIFTS)[number]; transport_team: string; schedule_serial: number;
  fleet_no_snapshot: string; origin: string; destination: string; transport_text: string;
  type_code: (typeof TYPE_CODES)[number]; contact_text: string; salesperson_code: string; client_text: string;
  scheduled_at: Date; status: JobStatus; distance_km: string | null; charge_to_customer: string | null;
  internal_cost: string | null; currency_code: string; auto_generated: boolean; source_key: string | null;
  remarks: string | null; created_at: Date; updated_at: Date; row_version: string;
}
export interface TransportJobDto {
  id: string; reference: string; branchId: string; machineId: string; bookingId: string | null; quotationId: string | null;
  collectionNoteId: string | null; driverId: string | null; vehicleId: string | null; plannerName: string;
  scheduleDate: string; shift: (typeof SHIFTS)[number]; transportTeam: string; scheduleSerial: number;
  fleetNoSnapshot: string; origin: string; destination: string; transportText: string;
  typeCode: (typeof TYPE_CODES)[number]; contactText: string; salespersonCode: string; clientText: string;
  scheduledAt: string; status: JobStatus; distanceKm: string | null; chargeToCustomer: string | null;
  internalCost: string | null; currencyCode: string; autoGenerated: boolean; sourceKey: string | null;
  remarks: string | null; createdAt: string; updatedAt: string; rowVersion: number;
}
export const JOB_COLUMNS = `id, reference, branch_id, machine_id, booking_id, quotation_id, collection_note_id, driver_id, vehicle_id,
  planner_name, to_char(schedule_date, 'YYYY-MM-DD') AS schedule_date, shift, transport_team, schedule_serial, fleet_no_snapshot,
  origin, destination, transport_text, type_code, contact_text, salesperson_code, client_text, scheduled_at, status, distance_km,
  charge_to_customer, internal_cost, currency_code, auto_generated, source_key, remarks, created_at, updated_at, row_version`;
export function transportJobToDto(r: JobRow): TransportJobDto {
  return {
    id: r.id, reference: r.reference, branchId: r.branch_id, machineId: r.machine_id, bookingId: r.booking_id,
    quotationId: r.quotation_id, collectionNoteId: r.collection_note_id, driverId: r.driver_id, vehicleId: r.vehicle_id,
    plannerName: r.planner_name, scheduleDate: r.schedule_date, shift: r.shift, transportTeam: r.transport_team,
    scheduleSerial: r.schedule_serial, fleetNoSnapshot: r.fleet_no_snapshot, origin: r.origin, destination: r.destination,
    transportText: r.transport_text, typeCode: r.type_code, contactText: r.contact_text, salespersonCode: r.salesperson_code,
    clientText: r.client_text, scheduledAt: r.scheduled_at.toISOString(), status: r.status, distanceKm: r.distance_km,
    chargeToCustomer: r.charge_to_customer, internalCost: r.internal_cost, currencyCode: r.currency_code,
    autoGenerated: r.auto_generated, sourceKey: r.source_key, remarks: r.remarks, createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
  };
}

const dateTime = z.iso.datetime({ offset: true });
const nullableDecimal = (intDigits: number, scale: number) => z.union([decimal(intDigits, scale), z.null()]);
const jobPatchFields = {
  driverId: z.union([z.uuid(), z.null()]),
  vehicleId: z.union([z.uuid(), z.null()]),
  plannerName: text(200),
  scheduleDate: isoDate,
  shift: z.enum(SHIFTS),
  transportTeam: text(200),
  scheduleSerial: z.number().int().min(1).max(9999),
  origin: text(500),
  destination: text(500),
  transportText: text(500),
  typeCode: z.enum(TYPE_CODES),
  contactText: text(500),
  salespersonCode: text(100),
  clientText: text(300),
  scheduledAt: dateTime,
  distanceKm: nullableDecimal(9, 3),
  chargeToCustomer: nullableDecimal(14, 6),
  internalCost: nullableDecimal(14, 6),
  remarks: nullableText(4000),
};
const jobCreateSchema = z
  .object({
    machineId: z.uuid(),
    bookingId: z.union([z.uuid(), z.null()]).optional(),
    quotationId: z.union([z.uuid(), z.null()]).optional(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
    plannerName: jobPatchFields.plannerName,
    scheduleDate: jobPatchFields.scheduleDate,
    shift: jobPatchFields.shift,
    transportTeam: jobPatchFields.transportTeam,
    scheduleSerial: jobPatchFields.scheduleSerial,
    origin: jobPatchFields.origin,
    destination: jobPatchFields.destination,
    transportText: jobPatchFields.transportText,
    typeCode: jobPatchFields.typeCode,
    contactText: jobPatchFields.contactText,
    salespersonCode: jobPatchFields.salespersonCode,
    clientText: jobPatchFields.clientText,
    scheduledAt: jobPatchFields.scheduledAt,
    driverId: jobPatchFields.driverId.optional(),
    vehicleId: jobPatchFields.vehicleId.optional(),
    distanceKm: jobPatchFields.distanceKm.optional(),
    chargeToCustomer: jobPatchFields.chargeToCustomer.optional(),
    internalCost: jobPatchFields.internalCost.optional(),
    remarks: jobPatchFields.remarks.optional(),
  })
  .strict();
const jobUpdateSchema = z.object(jobPatchFields).partial().strict();
const jobStatusSchema = z.object({ status: z.enum(JOB_STATUSES), reason: z.string().trim().max(500).optional() }).strict();
const JOB_COLUMN_BY_FIELD: Record<string, string> = {
  driverId: 'driver_id', vehicleId: 'vehicle_id', plannerName: 'planner_name', scheduleDate: 'schedule_date', shift: 'shift',
  transportTeam: 'transport_team', scheduleSerial: 'schedule_serial', origin: 'origin', destination: 'destination',
  transportText: 'transport_text', typeCode: 'type_code', contactText: 'contact_text', salespersonCode: 'salesperson_code',
  clientText: 'client_text', scheduledAt: 'scheduled_at', distanceKm: 'distance_km', chargeToCustomer: 'charge_to_customer',
  internalCost: 'internal_cost', remarks: 'remarks',
};
const JOB_SORTS = { scheduleDate: 'schedule_date', scheduledAt: 'scheduled_at', reference: 'reference', status: 'status', createdAt: 'created_at' };

const jobListSchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  machineId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
  scheduleDate: isoDate.optional(),
  branchId: z.uuid().optional(),
  autoGenerated: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

export async function loadTransportJob(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: 'transport.read' | 'transport.write' | 'collection.read' | 'collection.write' } = {},
): Promise<JobRow> {
  const res = await tx.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM transport_jobs WHERE id = $1${opts.lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Transport job not found');
  assertInScope(principal, opts.action ?? 'transport.read', row.branch_id);
  return row;
}

/** Driver and vehicle, when given, must exist in the company; a driver or vehicle of another branch is not offered. */
async function requireDriverVehicle(tx: TxClient, principal: Principal, driverId: string | null | undefined, vehicleId: string | null | undefined): Promise<void> {
  if (driverId) {
    const res = await tx.query<{ branch_id: string }>('SELECT branch_id FROM drivers WHERE id = $1', [driverId]);
    if (!res.rows[0]) throw new AppError('VALIDATION_ERROR', 'Driver not found', { driverId: 'not_found' });
    if (!principal.allBranches && res.rows[0].branch_id !== principal.branchId) {
      throw new AppError('VALIDATION_ERROR', 'Driver not found', { driverId: 'not_found' });
    }
  }
  if (vehicleId) {
    const res = await tx.query<{ branch_id: string }>('SELECT branch_id FROM transport_vehicles WHERE id = $1', [vehicleId]);
    if (!res.rows[0]) throw new AppError('VALIDATION_ERROR', 'Vehicle not found', { vehicleId: 'not_found' });
    if (!principal.allBranches && res.rows[0].branch_id !== principal.branchId) {
      throw new AppError('VALIDATION_ERROR', 'Vehicle not found', { vehicleId: 'not_found' });
    }
  }
}

/** Maps the transport-job FK/trigger violations that mean "wrong machine/booking/quotation chain" to BUSINESS_RULE. */
function mapJobChainViolation(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23503' && constraint === 'fk_transport_jobs_booking_machine') {
    throw new AppError('BUSINESS_RULE', 'The booking is not for this machine', { bookingId: 'machine_mismatch' });
  }
  if (code === '23514' && (constraint === undefined || constraint === 'trg_transport_jobs_chain')) {
    throw new AppError('BUSINESS_RULE', 'The quotation is not the booking agreement quotation', { quotationId: 'chain_mismatch' });
  }
  throw err;
}

/** Transport: drivers, vehicles and jobs. Read: transport.read. Write: transport.write. Status changes never touch quotations. */
export function transportRouter(): Router {
  const router = Router();

  // ------------------------------- drivers -------------------------------
  router.get('/drivers', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const query = parseQuery(req, z.object({
      branchId: z.uuid().optional(), status: z.enum(DRIVER_STATUSES).optional(), q: z.string().trim().max(100).optional(),
      page: z.unknown().optional(), pageSize: z.unknown().optional(), sort: z.unknown().optional(),
    }));
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, { name: 'lower(name)', status: 'status', createdAt: 'created_at' }, { column: 'lower(name)', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, false);
    if (scope) where.push(scope);
    if (query.branchId) { params.push(query.branchId); where.push(`branch_id = $${params.length}`); }
    if (query.status) { params.push(query.status); where.push(`status = $${params.length}`); }
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`(name ILIKE $${params.length} ESCAPE '\\' OR license_no ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM drivers ${clause}`, params);
      const rows = await tx.query<DriverRow>(
        `SELECT ${DRIVER_COLUMNS} FROM drivers ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(driverToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<DriverDto>;
    });
    res.json(body);
  });

  router.get('/drivers/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const id = uuidParam(req);
    const dto = driverToDto(await withTransaction(principal.orgId, (tx) => loadDriver(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/drivers', requireAction('transport.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const input = driverCreateSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'transport.driver.create', ctx, async () => {
        assertWritableBranch(principal, 'transport.write', input.branchId);
        await assertActiveBranch(tx, input.branchId);
        await requireUser(tx, input.userId);
        const ins = await tx.query<DriverRow>(
          `INSERT INTO drivers (org_id, branch_id, user_id, name, phone, license_no, license_expires_on, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING ${DRIVER_COLUMNS}`,
          [principal.orgId, input.branchId, input.userId ?? null, input.name, input.phone, input.licenseNo, input.licenseExpiresOn,
            input.status ?? 'Available', principal.userId],
        );
        const dto = driverToDto(ins.rows[0]);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'driver.created', entityType: 'driver', entityId: dto.id,
          correlationId: req.correlationId, after: dto,
        });
        return { status: 201, body: dto };
      }),
    );
    res.status(result.status).json(result.body);
  });

  router.patch('/drivers/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = driverUpdateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = driverToDto(await loadDriver(tx, principal, id, { lock: true, action: 'transport.write' }));
      if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      if (patch.branchId !== undefined && patch.branchId !== before.branchId) {
        assertWritableBranch(principal, 'transport.write', patch.branchId);
        await assertActiveBranch(tx, patch.branchId);
      }
      if (patch.userId !== undefined && patch.userId !== before.userId) await requireUser(tx, patch.userId);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      for (const [field, value] of Object.entries(patch)) set[DRIVER_COLUMN_BY_FIELD[field]] = value;
      await versionedUpdate(tx, { table: 'drivers', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = driverToDto(await loadDriver(tx, principal, id, { action: 'transport.write' }));
      const keys = Object.keys(patch);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'driver.updated', entityType: 'driver', entityId: id,
        correlationId: req.correlationId, before: pick(before, keys), after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------- vehicles -------------------------------
  router.get('/transport-vehicles', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const query = parseQuery(req, z.object({
      branchId: z.uuid().optional(), status: z.enum(VEHICLE_STATUSES).optional(), vehicleType: z.enum(VEHICLE_TYPES).optional(),
      q: z.string().trim().max(100).optional(),
      page: z.unknown().optional(), pageSize: z.unknown().optional(), sort: z.unknown().optional(),
    }));
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, { registrationNo: 'lower(registration_no)', status: 'status', createdAt: 'created_at' }, { column: 'lower(registration_no)', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, false);
    if (scope) where.push(scope);
    if (query.branchId) { params.push(query.branchId); where.push(`branch_id = $${params.length}`); }
    if (query.status) { params.push(query.status); where.push(`status = $${params.length}`); }
    if (query.vehicleType) { params.push(query.vehicleType); where.push(`vehicle_type = $${params.length}`); }
    if (query.q) { params.push(likePattern(query.q)); where.push(`registration_no ILIKE $${params.length} ESCAPE '\\'`); }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM transport_vehicles ${clause}`, params);
      const rows = await tx.query<VehicleRow>(
        `SELECT ${VEHICLE_COLUMNS} FROM transport_vehicles ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(vehicleToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<VehicleDto>;
    });
    res.json(body);
  });

  router.get('/transport-vehicles/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const id = uuidParam(req);
    const dto = vehicleToDto(await withTransaction(principal.orgId, (tx) => loadVehicle(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/transport-vehicles', requireAction('transport.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const input = vehicleCreateSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'transport.vehicle.create', ctx, async () => {
          assertWritableBranch(principal, 'transport.write', input.branchId);
          await assertActiveBranch(tx, input.branchId);
          const ins = await tx.query<VehicleRow>(
            `INSERT INTO transport_vehicles (org_id, branch_id, registration_no, vehicle_type, capacity_kg, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING ${VEHICLE_COLUMNS}`,
            [principal.orgId, input.branchId, input.registrationNo, input.vehicleType, input.capacityKg, input.status ?? 'Available', principal.userId],
          );
          const dto = vehicleToDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'transport_vehicle.created', entityType: 'transport_vehicle', entityId: dto.id,
            correlationId: req.correlationId, after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, VEHICLE_UNIQUE, 'A vehicle with this registration already exists');
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/transport-vehicles/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = vehicleUpdateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    let dto: VehicleDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const before = vehicleToDto(await loadVehicle(tx, principal, id, { lock: true, action: 'transport.write' }));
        if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        if (patch.branchId !== undefined && patch.branchId !== before.branchId) {
          assertWritableBranch(principal, 'transport.write', patch.branchId);
          await assertActiveBranch(tx, patch.branchId);
        }
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        for (const [field, value] of Object.entries(patch)) set[VEHICLE_COLUMN_BY_FIELD[field]] = value;
        await versionedUpdate(tx, { table: 'transport_vehicles', orgId: principal.orgId, id, expectedVersion: expected, set });
        const after = vehicleToDto(await loadVehicle(tx, principal, id, { action: 'transport.write' }));
        const keys = Object.keys(patch);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'transport_vehicle.updated', entityType: 'transport_vehicle', entityId: id,
          correlationId: req.correlationId, before: pick(before, keys), after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      mapUniqueViolation(err, VEHICLE_UNIQUE, 'A vehicle with this registration already exists');
    }
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------- jobs -------------------------------
  router.get('/transport-jobs', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const query = parseQuery(req, jobListSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, JOB_SORTS, { column: 'scheduled_at', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, false);
    if (scope) where.push(scope);
    const eq = (column: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('status', query.status);
    eq('machine_id', query.machineId);
    eq('booking_id', query.bookingId);
    eq('schedule_date', query.scheduleDate);
    eq('branch_id', query.branchId);
    if (query.autoGenerated !== undefined) eq('auto_generated', query.autoGenerated === 'true');
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`(reference ILIKE $${params.length} ESCAPE '\\' OR fleet_no_snapshot ILIKE $${params.length} ESCAPE '\\' OR client_text ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM transport_jobs ${clause}`, params);
      const rows = await tx.query<JobRow>(
        `SELECT ${JOB_COLUMNS} FROM transport_jobs ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(transportJobToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<TransportJobDto>;
    });
    res.json(body);
  });

  router.get('/transport-jobs/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.read');
    const id = uuidParam(req);
    const dto = transportJobToDto(await withTransaction(principal.orgId, (tx) => loadTransportJob(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/transport-jobs', requireAction('transport.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const input = jobCreateSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'transport.job.create', ctx, async () => {
          const machine = await tx.query<{ branch_id: string; fleet_no: string; active: boolean }>(
            'SELECT branch_id, fleet_no, active FROM machines WHERE id = $1', [input.machineId],
          );
          const m = machine.rows[0];
          if (!m || !m.active) throw new AppError('VALIDATION_ERROR', 'Machine not found', { machineId: 'not_found' });
          assertWritableBranch(principal, 'transport.write', m.branch_id);
          await assertActiveBranch(tx, m.branch_id);

          let quotationId = input.quotationId ?? null;
          const bookingId = input.bookingId ?? null;
          if (bookingId) {
            const b = await tx.query<{ machine_id: string; quotation_id: string | null }>(
              `SELECT b.machine_id, h.quotation_id FROM bookings b
                 LEFT JOIN hire_agreements h ON h.org_id = b.org_id AND h.id = b.hire_agreement_id
                WHERE b.id = $1`, [bookingId],
            );
            if (!b.rows[0]) throw new AppError('VALIDATION_ERROR', 'Booking not found', { bookingId: 'not_found' });
            if (b.rows[0].machine_id !== input.machineId) {
              throw new AppError('BUSINESS_RULE', 'The booking is not for this machine', { bookingId: 'machine_mismatch' });
            }
            if (quotationId && b.rows[0].quotation_id !== quotationId) {
              throw new AppError('BUSINESS_RULE', 'The quotation is not the booking agreement quotation', { quotationId: 'chain_mismatch' });
            }
          } else if (quotationId) {
            const q = await tx.query('SELECT 1 FROM quotations WHERE id = $1', [quotationId]);
            if (q.rowCount === 0) throw new AppError('VALIDATION_ERROR', 'Quotation not found', { quotationId: 'not_found' });
          }
          quotationId = quotationId ?? null;
          await requireDriverVehicle(tx, principal, input.driverId, input.vehicleId);

          let currency = input.currencyCode;
          if (!currency) {
            const org = await tx.query<{ currency_code: string }>('SELECT currency_code FROM organizations WHERE id = $1', [principal.orgId]);
            currency = org.rows[0].currency_code;
          }
          const reference = await allocateNumber(tx, principal.orgId, 'TRANSPORT');
          const ins = await tx.query<JobRow>(
            `INSERT INTO transport_jobs (org_id, reference, branch_id, machine_id, booking_id, quotation_id, driver_id, vehicle_id,
                planner_name, schedule_date, shift, transport_team, schedule_serial, fleet_no_snapshot, origin, destination,
                transport_text, type_code, contact_text, salesperson_code, client_text, scheduled_at, distance_km,
                charge_to_customer, internal_cost, currency_code, auto_generated, remarks, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,false,$27,$28,$28)
             RETURNING ${JOB_COLUMNS}`,
            [
              principal.orgId, reference, m.branch_id, input.machineId, bookingId, quotationId, input.driverId ?? null, input.vehicleId ?? null,
              input.plannerName, input.scheduleDate, input.shift, input.transportTeam, input.scheduleSerial, m.fleet_no, input.origin,
              input.destination, input.transportText, input.typeCode, input.contactText, input.salespersonCode, input.clientText,
              input.scheduledAt, input.distanceKm ?? null, input.chargeToCustomer ?? null, input.internalCost ?? null, currency,
              input.remarks ?? null, principal.userId,
            ],
          );
          const dto = transportJobToDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'transport_job.created', entityType: 'transport_job', entityId: dto.id,
            correlationId: req.correlationId, after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapJobChainViolation(err);
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/transport-jobs/:id', async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = jobUpdateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = transportJobToDto(await loadTransportJob(tx, principal, id, { lock: true, action: 'transport.write' }));
      if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      if (before.status === 'Completed' || before.status === 'Cancelled') {
        throw new AppError('BUSINESS_RULE', `A ${before.status.toLowerCase()} transport job cannot be edited`, { status: 'final' });
      }
      await requireDriverVehicle(tx, principal, patch.driverId, patch.vehicleId);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      for (const [field, value] of Object.entries(patch)) set[JOB_COLUMN_BY_FIELD[field]] = value;
      await versionedUpdate(tx, { table: 'transport_jobs', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = transportJobToDto(await loadTransportJob(tx, principal, id, { action: 'transport.write' }));
      const keys = Object.keys(patch);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'transport_job.updated', entityType: 'transport_job', entityId: id,
        correlationId: req.correlationId, before: pick(before, keys), after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/transport-jobs/:id/status', async (req, res) => {
    const principal = principalWith(req, 'transport.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = jobStatusSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = transportJobToDto(await loadTransportJob(tx, principal, id, { lock: true, action: 'transport.write' }));
      if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      if (!canTransition(before.status, input.status)) {
        throw new AppError('INVALID_TRANSITION', `Cannot move transport job from ${before.status} to ${input.status}`);
      }
      await versionedUpdate(tx, {
        table: 'transport_jobs', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: input.status, updated_at: new Date(), updated_by: principal.userId },
      });
      const after = transportJobToDto(await loadTransportJob(tx, principal, id, { action: 'transport.write' }));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'transport_job.status_changed', entityType: 'transport_job', entityId: id,
        correlationId: req.correlationId, reason: input.reason || undefined,
        before: { status: before.status }, after: { status: after.status },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
