import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertActiveBranch, assertInScope, assertWritableBranch, branchScopeClause, loadFieldDefs } from '../shared/branchScope.js';
import { validateCustomAttributes } from '../shared/customAttributes.js';
import { decimal, isoDate, nullableText, pick, text } from '../shared/fields.js';
import {
  likePattern, mapUniqueViolation, parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam,
  type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

export const OPERATIONAL_STATUSES = [
  'Available', 'Allocated', 'On Hire', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Transport', 'Breakdown', 'Offline',
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];
export const READINESS_STATUSES = ['READY', 'INTAKE_PENDING', 'BLOCKED'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];
/** Set by later-stage commands (booking, hire, transport); a direct edit needs the audited manual action with a reason. */
export const RESERVED_STATUSES: readonly OperationalStatus[] = ['Allocated', 'On Hire', 'Transport'];

/** Entity type of custom field definitions that apply to machines. */
export const MACHINE_ENTITY = 'machine';

// ---------------------------------------------------------------- machine models

type ModelRow = {
  id: string;
  make: string;
  model: string;
  category: string;
  power_source: string | null;
  platform_height_m: string | null;
  working_height_m: string | null;
  capacity_kg: string | null;
  specifications: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface MachineModelDto {
  id: string;
  make: string;
  model: string;
  category: string;
  powerSource: string | null;
  platformHeightM: string | null;
  workingHeightM: string | null;
  capacityKg: string | null;
  specifications: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const MODEL_COLUMNS =
  'id, make, model, category, power_source, platform_height_m, working_height_m, capacity_kg, specifications, created_at, updated_at, row_version';

export function modelToDto(r: ModelRow): MachineModelDto {
  return {
    id: r.id,
    make: r.make,
    model: r.model,
    category: r.category,
    powerSource: r.power_source,
    platformHeightM: r.platform_height_m,
    workingHeightM: r.working_height_m,
    capacityKg: r.capacity_kg,
    specifications: r.specifications,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const nullableDecimal = (intDigits: number, scale: number) => z.union([decimal(intDigits, scale), z.null()]);

const modelFields = {
  make: text(100),
  model: text(100),
  category: text(100),
  powerSource: nullableText(100),
  platformHeightM: nullableDecimal(9, 3),
  workingHeightM: nullableDecimal(9, 3),
  capacityKg: nullableDecimal(11, 3),
  specifications: z.record(z.string(), z.unknown()),
};

const modelCreateSchema = z
  .object({
    make: modelFields.make,
    model: modelFields.model,
    category: modelFields.category,
    powerSource: modelFields.powerSource.optional(),
    platformHeightM: modelFields.platformHeightM.optional(),
    workingHeightM: modelFields.workingHeightM.optional(),
    capacityKg: modelFields.capacityKg.optional(),
    specifications: modelFields.specifications.optional(),
  })
  .strict();

const modelUpdateSchema = z.object(modelFields).partial().strict();

const modelListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const MODEL_SORTS = { make: 'lower(make)', model: 'lower(model)', category: 'lower(category)', createdAt: 'created_at' };

const MODEL_COLUMN_BY_FIELD: Record<string, string> = {
  make: 'make',
  model: 'model',
  category: 'category',
  powerSource: 'power_source',
  platformHeightM: 'platform_height_m',
  workingHeightM: 'working_height_m',
  capacityKg: 'capacity_kg',
};

function mapModelDuplicate(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23505' && constraint === 'uq_machine_models_make_model') {
    throw new AppError('DUPLICATE', 'A model with this make and model already exists', { make: 'duplicate', model: 'duplicate' });
  }
  throw err;
}

async function loadModel(tx: TxClient, id: string, lock: boolean): Promise<ModelRow> {
  const res = await tx.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM machine_models WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Machine model not found');
  return res.rows[0];
}

// ---------------------------------------------------------------- machines

interface MachineRow {
  id: string;
  branch_id: string;
  model_id: string;
  asset_no: string;
  fleet_no: string;
  serial_no: string;
  manufacture_year: number | null;
  power_source: string | null;
  platform_height_m: string | null;
  working_height_m: string | null;
  capacity_kg: string | null;
  hours_operated: string;
  operational_status: OperationalStatus;
  readiness_status: ReadinessStatus;
  current_location: string;
  last_inspection_on: string | null;
  next_inspection_on: string | null;
  next_phi_on: string | null;
  next_mandatory_on: string | null;
  tpc_expires_on: string | null;
  tpc_supplier: string | null;
  active: boolean;
  custom_attributes: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface MachineDto {
  id: string;
  branchId: string;
  modelId: string;
  assetNo: string;
  fleetNo: string;
  serialNo: string;
  manufactureYear: number | null;
  powerSource: string | null;
  platformHeightM: string | null;
  workingHeightM: string | null;
  capacityKg: string | null;
  hoursOperated: string;
  operationalStatus: OperationalStatus;
  readinessStatus: ReadinessStatus;
  currentLocation: string;
  lastInspectionOn: string | null;
  nextInspectionOn: string | null;
  nextPhiOn: string | null;
  nextMandatoryOn: string | null;
  tpcExpiresOn: string | null;
  tpcSupplier: string | null;
  active: boolean;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const day = (c: string) => `to_char(${c}, 'YYYY-MM-DD') AS ${c}`;
const MACHINE_COLUMNS = `id, branch_id, model_id, asset_no, fleet_no, serial_no, manufacture_year, power_source, platform_height_m,
  working_height_m, capacity_kg, hours_operated, operational_status, readiness_status, current_location,
  ${day('last_inspection_on')}, ${day('next_inspection_on')}, ${day('next_phi_on')}, ${day('next_mandatory_on')}, ${day('tpc_expires_on')},
  tpc_supplier, active, custom_attributes, created_at, updated_at, row_version`;

export function machineToDto(r: MachineRow): MachineDto {
  return {
    id: r.id,
    branchId: r.branch_id,
    modelId: r.model_id,
    assetNo: r.asset_no,
    fleetNo: r.fleet_no,
    serialNo: r.serial_no,
    manufactureYear: r.manufacture_year,
    powerSource: r.power_source,
    platformHeightM: r.platform_height_m,
    workingHeightM: r.working_height_m,
    capacityKg: r.capacity_kg,
    hoursOperated: r.hours_operated,
    operationalStatus: r.operational_status,
    readinessStatus: r.readiness_status,
    currentLocation: r.current_location,
    lastInspectionOn: r.last_inspection_on,
    nextInspectionOn: r.next_inspection_on,
    nextPhiOn: r.next_phi_on,
    nextMandatoryOn: r.next_mandatory_on,
    tpcExpiresOn: r.tpc_expires_on,
    tpcSupplier: r.tpc_supplier,
    active: r.active,
    customAttributes: r.custom_attributes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const identifier = z.string().trim().min(1).max(100);
const nullableDate = z.union([isoDate, z.null()]);

const machineFields = {
  branchId: z.uuid(),
  modelId: z.uuid(),
  assetNo: identifier,
  fleetNo: identifier,
  serialNo: identifier,
  manufactureYear: z.union([z.number().int().min(1900).max(2200), z.null()]),
  powerSource: nullableText(100),
  platformHeightM: nullableDecimal(9, 3),
  workingHeightM: nullableDecimal(9, 3),
  capacityKg: nullableDecimal(11, 3),
  hoursOperated: decimal(15, 3),
  operationalStatus: z.enum(OPERATIONAL_STATUSES),
  readinessStatus: z.enum(READINESS_STATUSES),
  currentLocation: text(200),
  lastInspectionOn: nullableDate,
  nextInspectionOn: nullableDate,
  nextPhiOn: nullableDate,
  nextMandatoryOn: nullableDate,
  tpcExpiresOn: nullableDate,
  tpcSupplier: nullableText(200),
  active: z.boolean(),
  customAttributes: z.record(z.string(), z.unknown()),
};

const machineCreateSchema = z
  .object({
    branchId: machineFields.branchId,
    modelId: machineFields.modelId,
    assetNo: machineFields.assetNo,
    fleetNo: machineFields.fleetNo,
    serialNo: machineFields.serialNo,
    manufactureYear: machineFields.manufactureYear.optional(),
    powerSource: machineFields.powerSource.optional(),
    platformHeightM: machineFields.platformHeightM.optional(),
    workingHeightM: machineFields.workingHeightM.optional(),
    capacityKg: machineFields.capacityKg.optional(),
    hoursOperated: machineFields.hoursOperated.optional(),
    operationalStatus: machineFields.operationalStatus.optional(),
    readinessStatus: machineFields.readinessStatus.optional(),
    currentLocation: machineFields.currentLocation,
    lastInspectionOn: machineFields.lastInspectionOn.optional(),
    nextInspectionOn: machineFields.nextInspectionOn.optional(),
    nextPhiOn: machineFields.nextPhiOn.optional(),
    nextMandatoryOn: machineFields.nextMandatoryOn.optional(),
    tpcExpiresOn: machineFields.tpcExpiresOn.optional(),
    tpcSupplier: machineFields.tpcSupplier.optional(),
    customAttributes: machineFields.customAttributes.optional(),
  })
  .strict();

// `active` is changed only by archive (DELETE), not by PATCH, so a stale form cannot silently reactivate a machine.
const { active: _active, ...patchableFields } = machineFields;
void _active;
const machineUpdateSchema = z.object(patchableFields).partial().strict();

const manualStatusSchema = z
  .object({ operationalStatus: z.enum(OPERATIONAL_STATUSES), reason: z.string().trim().min(1).max(500) })
  .strict();

const machineListSchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(OPERATIONAL_STATUSES).optional(),
  readiness: z.enum(READINESS_STATUSES).optional(),
  modelId: z.uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const MACHINE_SORTS = {
  assetNo: 'asset_no', fleetNo: 'fleet_no', serialNo: 'serial_no', status: 'operational_status', createdAt: 'created_at',
};

const MACHINE_COLUMN_BY_FIELD: Record<string, string> = {
  branchId: 'branch_id',
  modelId: 'model_id',
  assetNo: 'asset_no',
  fleetNo: 'fleet_no',
  serialNo: 'serial_no',
  manufactureYear: 'manufacture_year',
  powerSource: 'power_source',
  platformHeightM: 'platform_height_m',
  workingHeightM: 'working_height_m',
  capacityKg: 'capacity_kg',
  hoursOperated: 'hours_operated',
  operationalStatus: 'operational_status',
  readinessStatus: 'readiness_status',
  currentLocation: 'current_location',
  lastInspectionOn: 'last_inspection_on',
  nextInspectionOn: 'next_inspection_on',
  nextPhiOn: 'next_phi_on',
  nextMandatoryOn: 'next_mandatory_on',
  tpcExpiresOn: 'tpc_expires_on',
  tpcSupplier: 'tpc_supplier',
  active: 'active',
};

const MACHINE_DUPLICATES = {
  uq_machines_asset_no: 'assetNo',
  uq_machines_fleet_no: 'fleetNo',
  uq_machines_serial_no: 'serialNo',
};
const MACHINE_DUPLICATE_MESSAGE = 'A machine with this asset, fleet or serial number already exists';

function assertNotReserved(status: OperationalStatus | undefined, current?: OperationalStatus): void {
  if (status !== undefined && status !== current && RESERVED_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_ERROR', `${status} can only be set by a later-stage command or the audited manual status action`, {
      operationalStatus: 'reserved_requires_manual_action',
    });
  }
}

async function assertModel(tx: TxClient, modelId: string): Promise<ModelRow> {
  const res = await tx.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM machine_models WHERE id = $1`, [modelId]);
  if (!res.rows[0]) throw new AppError('VALIDATION_ERROR', 'Machine model not found', { modelId: 'not_found' });
  return res.rows[0];
}

async function loadMachine(tx: TxClient, principal: Principal, id: string, lock: boolean): Promise<MachineRow> {
  const res = await tx.query<MachineRow>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Machine not found');
  assertInScope(principal, 'machines.read', row.branch_id);
  return row;
}

/** Machine models (machines.read / machines.write) and machines (machines.read / machines.write). */
export function machinesRouter(): Router {
  const router = Router();

  // ------------------------------------------------------------ models

  router.get('/machine-models', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const query = parseQuery(req, modelListSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, MODEL_SORTS, { column: 'lower(make)', direction: 'ASC' });
    const params: unknown[] = [];
    let clause = '';
    if (query.q) {
      params.push(likePattern(query.q));
      clause = `WHERE (make ILIKE $1 ESCAPE '\\' OR model ILIKE $1 ESCAPE '\\' OR category ILIKE $1 ESCAPE '\\')`;
    }
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM machine_models ${clause}`, params);
      const rows = await tx.query<ModelRow>(
        `SELECT ${MODEL_COLUMNS} FROM machine_models ${clause} ORDER BY ${sort.column} ${sort.direction}, lower(model), id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(modelToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<MachineModelDto>;
    });
    res.json(body);
  });

  router.get('/machine-models/:id', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const id = uuidParam(req);
    const dto = modelToDto(await withTransaction(principal.orgId, (tx) => loadModel(tx, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/machine-models', requireAction('machines.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const input = modelCreateSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'machine_models.create', ctx, async () => {
          const ins = await tx.query<ModelRow>(
            `INSERT INTO machine_models (org_id, make, model, category, power_source, platform_height_m, working_height_m,
                                         capacity_kg, specifications, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10) RETURNING ${MODEL_COLUMNS}`,
            [
              principal.orgId, input.make, input.model, input.category, input.powerSource ?? null, input.platformHeightM ?? null,
              input.workingHeightM ?? null, input.capacityKg ?? null, JSON.stringify(input.specifications ?? {}), principal.userId,
            ],
          );
          const dto = modelToDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'machine_model.created',
            entityType: 'machine_model',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapModelDuplicate(err);
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/machine-models/:id', async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = modelUpdateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    let dto: MachineModelDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const before = modelToDto(await loadModel(tx, id, true));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        for (const [field, value] of Object.entries(patch)) {
          if (field === 'specifications') set.specifications = JSON.stringify(value);
          else set[MODEL_COLUMN_BY_FIELD[field]] = value;
        }
        // Model changes never touch machines: each machine keeps the characteristics it was saved with.
        const { row } = await versionedUpdate<ModelRow>(tx, {
          table: 'machine_models', orgId: principal.orgId, id, expectedVersion: expected, set,
        });
        const after = modelToDto(row);
        const keys = Object.keys(patch);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'machine_model.updated',
          entityType: 'machine_model',
          entityId: id,
          correlationId: req.correlationId,
          before: pick(before, keys),
          after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      mapModelDuplicate(err);
    }
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------------------------------------ machines

  router.get('/machines', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const query = parseQuery(req, machineListSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, MACHINE_SORTS, { column: 'asset_no', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, false);
    if (scope) where.push(scope);
    const eq = (column: string, value: unknown): void => {
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    if (query.branchId) eq('branch_id', query.branchId);
    if (query.status) eq('operational_status', query.status);
    if (query.readiness) eq('readiness_status', query.readiness);
    if (query.modelId) eq('model_id', query.modelId);
    if (query.active) eq('active', query.active === 'true');
    if (query.q) {
      params.push(likePattern(query.q));
      const p = `$${params.length}`;
      where.push(`(asset_no ILIKE ${p} ESCAPE '\\' OR fleet_no ILIKE ${p} ESCAPE '\\' OR serial_no ILIKE ${p} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM machines ${clause}`, params);
      const rows = await tx.query<MachineRow>(
        `SELECT ${MACHINE_COLUMNS} FROM machines ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(machineToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<MachineDto>;
    });
    res.json(body);
  });

  router.get('/machines/:id', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const id = uuidParam(req);
    const dto = machineToDto(await withTransaction(principal.orgId, (tx) => loadMachine(tx, principal, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/machines', requireAction('machines.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const input = machineCreateSchema.parse(req.body ?? {});
    assertNotReserved(input.operationalStatus);
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'machines.create', ctx, async () => {
          assertWritableBranch(principal, 'machines.write', input.branchId);
          await assertActiveBranch(tx, input.branchId);
          const model = await assertModel(tx, input.modelId);
          const attrs = validateCustomAttributes(await loadFieldDefs(tx, MACHINE_ENTITY), input.customAttributes);
          // Model values are only a starting point for characteristics the user did not send; they are never applied later.
          const orModel = <T>(own: T | undefined, fromModel: T): T => (own === undefined ? fromModel : own);
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO machines (org_id, branch_id, model_id, asset_no, fleet_no, serial_no, manufacture_year, power_source,
                                   platform_height_m, working_height_m, capacity_kg, hours_operated, operational_status,
                                   readiness_status, current_location, last_inspection_on, next_inspection_on, next_phi_on,
                                   next_mandatory_on, tpc_expires_on, tpc_supplier, custom_attributes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23, $23)
             RETURNING id`,
            [
              principal.orgId, input.branchId, input.modelId, input.assetNo, input.fleetNo, input.serialNo,
              input.manufactureYear ?? null, orModel(input.powerSource, model.power_source),
              orModel(input.platformHeightM, model.platform_height_m), orModel(input.workingHeightM, model.working_height_m),
              orModel(input.capacityKg, model.capacity_kg), input.hoursOperated ?? '0', input.operationalStatus ?? 'Available',
              input.readinessStatus ?? 'READY', input.currentLocation, input.lastInspectionOn ?? null,
              input.nextInspectionOn ?? null, input.nextPhiOn ?? null, input.nextMandatoryOn ?? null,
              input.tpcExpiresOn ?? null, input.tpcSupplier ?? null, JSON.stringify(attrs), principal.userId,
            ],
          );
          const dto = machineToDto(await loadMachine(tx, principal, ins.rows[0].id, false));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'machine.created',
            entityType: 'machine',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, MACHINE_DUPLICATES, MACHINE_DUPLICATE_MESSAGE);
    }
    res.status(result.status).json(result.body);
  });

  /**
   * Shared update path. `change` returns column values and the audit action; it runs after the version check,
   * inside the same transaction as the update and the audit event.
   */
  const changeMachine = async (
    principal: Principal,
    id: string,
    expected: number,
    correlationId: string,
    change: (tx: TxClient, before: MachineDto) => Promise<{
      set: Record<string, unknown>;
      keys: string[];
      action: string;
      reason?: string;
    }>,
  ): Promise<MachineDto> => {
    try {
      return await withTransaction(principal.orgId, async (tx) => {
        const before = machineToDto(await loadMachine(tx, principal, id, true));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        const { set, keys, action, reason } = await change(tx, before);
        await versionedUpdate(tx, {
          table: 'machines', orgId: principal.orgId, id, expectedVersion: expected,
          set: { ...set, updated_at: new Date(), updated_by: principal.userId },
        });
        const after = machineToDto(await loadMachine(tx, principal, id, false));
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action,
          entityType: 'machine',
          entityId: id,
          correlationId,
          reason,
          before: pick(before, keys),
          after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      return mapUniqueViolation(err, MACHINE_DUPLICATES, MACHINE_DUPLICATE_MESSAGE);
    }
  };

  router.patch('/machines/:id', async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = machineUpdateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const dto = await changeMachine(principal, id, expected, req.correlationId, async (tx, before) => {
      assertNotReserved(patch.operationalStatus, before.operationalStatus);
      if (patch.branchId !== undefined && patch.branchId !== before.branchId) {
        assertWritableBranch(principal, 'machines.write', patch.branchId);
        await assertActiveBranch(tx, patch.branchId);
      }
      if (patch.modelId !== undefined && patch.modelId !== before.modelId) await assertModel(tx, patch.modelId);
      const set: Record<string, unknown> = {};
      const keys: string[] = [];
      for (const [field, value] of Object.entries(patch)) {
        keys.push(field);
        if (field === 'customAttributes') {
          set.custom_attributes = JSON.stringify(validateCustomAttributes(await loadFieldDefs(tx, MACHINE_ENTITY), value));
        } else {
          set[MACHINE_COLUMN_BY_FIELD[field]] = value;
        }
      }
      return { set, keys, action: 'machine.updated' };
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // Audited manual override: the only way to set Allocated, On Hire or Transport directly.
  router.post('/machines/:id/operational-status', async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = manualStatusSchema.parse(req.body ?? {});
    const dto = await changeMachine(principal, id, expected, req.correlationId, async () => ({
      set: { operational_status: input.operationalStatus },
      keys: ['operationalStatus'],
      action: 'machine.operational_status_manual',
      reason: input.reason,
    }));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // Machines are archived (active = false), never hard-deleted: bookings, gate passes and inspections reference them.
  router.delete('/machines/:id', async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await changeMachine(principal, id, expected, req.correlationId, async () => ({
      set: { active: false },
      keys: ['active'],
      action: 'machine.archived',
    }));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
