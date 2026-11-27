import { Decimal } from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertWritableBranch, branchScopeClause } from '../shared/branchScope.js';
import { decimal, isCalendarDate, isoDate, pick, text } from '../shared/fields.js';
import {
  parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';
import {
  BOOKING_COLUMNS, BOOKING_FROM, BOOKING_OWNER_SQL, BOOKING_STATUSES, PLANNING_STATUSES, RESERVING_STATUSES, bookingToDto, loadBooking,
  type BookingDto, type BookingRow, type BookingStatus,
} from './model.js';
import { ownRecordsOnly } from '../quotations/index.js';
import { startHireInTx } from './startHire.js';

export { bookingToDto, loadBooking, type BookingDto } from './model.js';
export { startHireInTx, type StartHireOptions, type StartHireResult } from './startHire.js';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Machine states that cannot be newly reserved: Offline and repair states. */
const UNBOOKABLE_OPERATIONAL = new Set(['Offline', 'Under Repair', 'Breakdown']);
const UNBOOKABLE_READINESS = new Set(['BLOCKED', 'INTAKE_PENDING']);

const notes = z.union([z.string().trim().max(4000).transform((v) => (v === '' ? null : v)), z.null()]);

const createSchema = z
  .object({
    machineId: z.uuid(),
    customerId: z.uuid(),
    hireAgreementId: z.union([z.uuid(), z.null()]).optional(),
    lpoId: z.union([z.uuid(), z.null()]).optional(),
    startDate: isoDate,
    endDate: isoDate,
    status: z.enum(PLANNING_STATUSES).optional(),
    deliveryAddress: text(500),
    contactPhone: text(50),
    operatorRequired: z.boolean().optional(),
    dailyRate: decimal(14, 6).optional(),
    totalValue: decimal(14, 6).optional(),
    quoted: z.boolean().optional(),
    haSent: z.boolean().optional(),
    haReceived: z.boolean().optional(),
    reserved: z.boolean().optional(),
    notes: notes.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    machineId: z.uuid(),
    hireAgreementId: z.union([z.uuid(), z.null()]),
    lpoId: z.union([z.uuid(), z.null()]),
    startDate: isoDate,
    endDate: isoDate,
    status: z.enum(BOOKING_STATUSES),
    deliveryAddress: text(500),
    contactPhone: text(50),
    operatorRequired: z.boolean(),
    dailyRate: decimal(14, 6),
    totalValue: decimal(14, 6),
    quoted: z.boolean(),
    haSent: z.boolean(),
    haReceived: z.boolean(),
    reserved: z.boolean(),
    notes,
  })
  .partial()
  .strict();

const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const emptySchema = z.object({}).strict();

const listSchema = z.object({
  machineId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  hireAgreementId: z.uuid().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = {
  createdAt: 'b.created_at', reference: 'b.reference', startDate: 'b.start_date', endDate: 'b.end_date', status: 'b.status',
};

const COLUMN_BY_FIELD: Record<string, string> = {
  machineId: 'machine_id',
  hireAgreementId: 'hire_agreement_id',
  lpoId: 'lpo_id',
  startDate: 'start_date',
  endDate: 'end_date',
  status: 'status',
  deliveryAddress: 'delivery_address',
  contactPhone: 'contact_phone',
  operatorRequired: 'operator_required',
  dailyRate: 'daily_rate',
  totalValue: 'total_value',
  quoted: 'quoted',
  haSent: 'ha_sent',
  haReceived: 'ha_received',
  reserved: 'reserved',
  notes: 'notes',
};

const isReserving = (s: BookingStatus): boolean => RESERVING_STATUSES.includes(s);
const isActive = (s: BookingStatus): boolean => isReserving(s) || s === 'On Hire';

function assertDateOrder(start: string, end: string): void {
  if (isCalendarDate(start) && isCalendarDate(end) && end < start) {
    throw new AppError('VALIDATION_ERROR', 'End date is before the start date', { endDate: 'before_start' });
  }
}

/** Inclusive number of rental days. */
function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function computeTotal(dailyRate: string, start: string, end: string): string {
  return new Money(dailyRate).times(inclusiveDays(start, end)).toDecimalPlaces(6).toFixed(6);
}

/** Maps exclusion violations of the booking overlap constraints to BOOKING_CONFLICT; rethrows anything else. */
function mapBookingErrors(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23P01' && (constraint === 'ex_machine_planned_booking' || constraint === 'ex_machine_physical_booking')) {
    throw new AppError('BOOKING_CONFLICT', 'The machine is already booked or out on hire for these dates', { machineId: 'conflict' });
  }
  if (code === '23505' && constraint === 'uq_bookings_reference') {
    throw new AppError('DUPLICATE', 'Booking reference already exists', { reference: 'duplicate' });
  }
  throw err;
}

interface MachineLock {
  id: string;
  branch_id: string;
  active: boolean;
  operational_status: string;
  readiness_status: string;
}

/** The machine must exist in the company and the Principal's branch scope; it is locked FOR UPDATE. */
async function lockMachine(tx: TxClient, principal: Principal, machineId: string): Promise<MachineLock> {
  const res = await tx.query<MachineLock>(
    'SELECT id, branch_id, active, operational_status, readiness_status FROM machines WHERE id = $1 FOR UPDATE',
    [machineId],
  );
  const row = res.rows[0];
  if (!row || (!principal.allBranches && row.branch_id !== principal.branchId)) {
    throw new AppError('VALIDATION_ERROR', 'Machine not found', { machineId: 'not_found' });
  }
  return row;
}

/** An active (reserving) booking needs a bookable machine: not archived, not Offline/under repair, ready. */
function assertMachineBookable(machine: MachineLock): void {
  if (!machine.active) throw new AppError('BUSINESS_RULE', 'The machine is archived', { machineId: 'archived' });
  if (UNBOOKABLE_OPERATIONAL.has(machine.operational_status)) {
    throw new AppError('BUSINESS_RULE', `The machine is ${machine.operational_status}`, { machineId: 'unavailable' });
  }
  if (UNBOOKABLE_READINESS.has(machine.readiness_status)) {
    throw new AppError('BUSINESS_RULE', `The machine readiness is ${machine.readiness_status}`, { machineId: 'not_ready' });
  }
}

async function requireCustomer(tx: TxClient, principal: Principal, customerId: string): Promise<void> {
  const res = await tx.query<{ branch_id: string | null }>('SELECT branch_id FROM customers WHERE id = $1', [customerId]);
  const row = res.rows[0];
  if (!row || (!principal.allBranches && row.branch_id !== null && row.branch_id !== principal.branchId)) {
    throw new AppError('VALIDATION_ERROR', 'Customer not found', { customerId: 'not_found' });
  }
}

interface AgreementRef {
  id: string;
  customer_id: string;
  status: string;
  quantity: number;
  sent_at: Date | null;
  received_at: Date | null;
}

/** The agreement must exist in the company, belong to the customer and not be cancelled (locked to serialize quantity checks). */
async function lockAgreement(tx: TxClient, id: string, customerId: string): Promise<AgreementRef> {
  const res = await tx.query<AgreementRef>(
    'SELECT id, customer_id, status, quantity, sent_at, received_at FROM hire_agreements WHERE id = $1 FOR UPDATE',
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('VALIDATION_ERROR', 'Hire agreement not found', { hireAgreementId: 'not_found' });
  if (row.customer_id !== customerId) {
    throw new AppError('VALIDATION_ERROR', 'The hire agreement belongs to a different customer', { hireAgreementId: 'customer_mismatch' });
  }
  if (row.status === 'Cancelled') {
    throw new AppError('VALIDATION_ERROR', 'The hire agreement is cancelled', { hireAgreementId: 'cancelled' });
  }
  return row;
}

async function requireLpo(tx: TxClient, id: string, customerId: string): Promise<void> {
  const res = await tx.query<{ customer_id: string }>('SELECT customer_id FROM customer_lpos WHERE id = $1', [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('VALIDATION_ERROR', 'LPO not found', { lpoId: 'not_found' });
  if (row.customer_id !== customerId) {
    throw new AppError('VALIDATION_ERROR', 'The LPO belongs to a different customer', { lpoId: 'customer_mismatch' });
  }
}

/** Within one agreement the number of live bookings cannot exceed the agreement's equipment quantity. */
async function assertAgreementCapacity(tx: TxClient, agreement: AgreementRef, excludeBookingId: string | null): Promise<void> {
  const res = await tx.query<{ n: string }>(
    `SELECT count(*) AS n FROM bookings
      WHERE hire_agreement_id = $1 AND status NOT IN ('Cancelled', 'Returned') AND ($2::uuid IS NULL OR id <> $2)`,
    [agreement.id, excludeBookingId],
  );
  if (Number(res.rows[0].n) + 1 > agreement.quantity) {
    throw new AppError('BUSINESS_RULE', 'The hire agreement has no unallocated equipment quantity left', { hireAgreementId: 'quantity_exceeded' });
  }
}

interface GateState {
  quoted: boolean;
  haSent: boolean;
  haReceived: boolean;
  reserved: boolean;
}

/** Checkbox gates are evidence flags: each true value must be backed by a persisted record. */
async function validateGates(
  tx: TxClient,
  customerId: string,
  agreement: AgreementRef | null,
  status: BookingStatus,
  gates: GateState,
): Promise<void> {
  const errors: Record<string, string> = {};
  if (gates.quoted && !agreement) {
    const q = await tx.query("SELECT 1 FROM quotations WHERE customer_id = $1 AND phase <> 'LOST' LIMIT 1", [customerId]);
    if ((q.rowCount ?? 0) === 0) errors.quoted = 'no_quotation';
  }
  if (gates.haSent && (!agreement || agreement.sent_at === null)) errors.haSent = agreement ? 'agreement_not_sent' : 'agreement_required';
  if (gates.haReceived && (!agreement || agreement.received_at === null)) {
    errors.haReceived = agreement ? 'agreement_not_received' : 'agreement_required';
  }
  if (gates.reserved && !isActive(status)) errors.reserved = 'status_not_reserved';
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'A gate is not backed by a saved record', errors);
  }
}

/** Planner bookings: read (bookings.read); create, update, cancel, off-hire request (bookings.write); start hire (bookings.start_hire). */
export function bookingsRouter(): Router {
  const router = Router();

  router.get('/bookings', async (req, res) => {
    const principal = principalWith(req, 'bookings.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'b.start_date', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'b.branch_id', params, false);
    if (scope) where.push(scope);
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    if (ownRecordsOnly(principal)) {
      params.push(principal.userId);
      where.push(`(${BOOKING_OWNER_SQL}) = $${params.length}`);
    }
    eq('b.machine_id', query.machineId);
    eq('b.customer_id', query.customerId);
    eq('b.branch_id', query.branchId);
    eq('b.hire_agreement_id', query.hireAgreementId);
    eq('b.status', query.status);
    if (query.from) {
      params.push(query.from);
      where.push(`b.end_date >= $${params.length}::date`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`b.start_date <= $${params.length}::date`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM bookings b ${clause}`, params);
      const rows = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, b.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(bookingToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<BookingDto>;
    });
    res.json(body);
  });

  router.get('/bookings/:id', async (req, res) => {
    const principal = principalWith(req, 'bookings.read');
    const id = uuidParam(req);
    const dto = bookingToDto(await withTransaction(principal.orgId, (tx) => loadBooking(tx, principal, id)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/bookings', requireAction('bookings.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'bookings.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'bookings.create', ctx, async () => {
          assertDateOrder(input.startDate, input.endDate);
          const status: BookingStatus = input.status ?? 'Draft';
          await requireCustomer(tx, principal, input.customerId);
          const machine = await lockMachine(tx, principal, input.machineId);
          assertWritableBranch(principal, 'bookings.write', machine.branch_id);
          if (isActive(status)) assertMachineBookable(machine);
          let agreement: AgreementRef | null = null;
          if (input.hireAgreementId) {
            agreement = await lockAgreement(tx, input.hireAgreementId, input.customerId);
            await assertAgreementCapacity(tx, agreement, null);
          }
          if (input.lpoId) await requireLpo(tx, input.lpoId, input.customerId);
          const gates: GateState = {
            quoted: input.quoted ?? false,
            haSent: input.haSent ?? false,
            haReceived: input.haReceived ?? false,
            reserved: input.reserved ?? false,
          };
          await validateGates(tx, input.customerId, agreement, status, gates);
          const dailyRate = input.dailyRate ?? '0';
          const totalValue = input.totalValue ?? computeTotal(dailyRate, input.startDate, input.endDate);
          const reference = await allocateNumber(tx, principal.orgId, 'BOOKING');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO bookings (org_id, reference, branch_id, machine_id, customer_id, hire_agreement_id, lpo_id, start_date, end_date,
                status, delivery_address, contact_phone, operator_required, daily_rate, total_value, quoted, ha_sent, ha_received,
                reserved, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)
             RETURNING id`,
            [
              principal.orgId, reference, machine.branch_id, machine.id, input.customerId, input.hireAgreementId ?? null,
              input.lpoId ?? null, input.startDate, input.endDate, status, input.deliveryAddress, input.contactPhone,
              input.operatorRequired ?? false, dailyRate, totalValue, gates.quoted, gates.haSent, gates.haReceived, gates.reserved,
              input.notes ?? null, principal.userId,
            ],
          );
          const dto = bookingToDto(await loadBooking(tx, principal, ins.rows[0].id));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'booking.created',
            entityType: 'booking',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapBookingErrors(err);
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/bookings/:id', async (req, res) => {
    const principal = principalWith(req, 'bookings.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    if (patch.status === 'On Hire' || patch.status === 'Returned') {
      throw new AppError('BUSINESS_RULE', `${patch.status} is set only by its explicit command`, { status: 'command_required' });
    }
    if (patch.status === 'Cancelled') {
      throw new AppError('BUSINESS_RULE', 'Use the cancel command to cancel a booking', { status: 'command_required' });
    }
    let dto: BookingDto;
    try {
      dto = await withTransaction(principal.orgId, async (tx) => {
        const row = await loadBooking(tx, principal, id, { lock: true, action: 'bookings.write' });
        const before = bookingToDto(row);
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        if (before.status === 'Returned' || before.status === 'Cancelled') {
          throw new AppError('BUSINESS_RULE', `A ${before.status} booking cannot be edited`, { status: 'closed' });
        }
        const onHire = before.status === 'On Hire';
        if (onHire && patch.status !== undefined && patch.status !== 'On Hire') {
          throw new AppError('BUSINESS_RULE', 'The status of a booking on hire changes only by return', { status: 'on_hire' });
        }
        if (onHire && patch.machineId !== undefined && patch.machineId !== before.machineId) {
          throw new AppError('BUSINESS_RULE', 'The machine of a booking on hire cannot be changed', { machineId: 'on_hire' });
        }
        if (onHire && patch.hireAgreementId === null) {
          throw new AppError('BUSINESS_RULE', 'A booking on hire must keep its hire agreement', { hireAgreementId: 'on_hire' });
        }
        const startDate = patch.startDate ?? before.startDate;
        const endDate = patch.endDate ?? before.endDate;
        assertDateOrder(startDate, endDate);
        const status = (patch.status ?? before.status) as BookingStatus;
        const machineId = patch.machineId ?? before.machineId;
        const agreementId = patch.hireAgreementId === undefined ? before.hireAgreementId : patch.hireAgreementId;
        const lpoId = patch.lpoId === undefined ? before.lpoId : patch.lpoId;

        const machine = await lockMachine(tx, principal, machineId);
        if (machineId !== before.machineId) assertWritableBranch(principal, 'bookings.write', machine.branch_id);
        const machineChanged = machineId !== before.machineId;
        if (!onHire && isActive(status) && (machineChanged || before.status !== status || patch.startDate || patch.endDate)) {
          assertMachineBookable(machine);
        }
        let agreement: AgreementRef | null = null;
        if (agreementId) {
          agreement = await lockAgreement(tx, agreementId, before.customerId);
          if (agreementId !== before.hireAgreementId) await assertAgreementCapacity(tx, agreement, id);
        }
        if (lpoId && lpoId !== before.lpoId) await requireLpo(tx, lpoId, before.customerId);
        await validateGates(tx, before.customerId, agreement, status, {
          quoted: patch.quoted ?? before.quoted,
          haSent: patch.haSent ?? before.haSent,
          haReceived: patch.haReceived ?? before.haReceived,
          reserved: patch.reserved ?? before.reserved,
        });

        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        const patchRecord = patch as Record<string, unknown>;
        for (const k of keys) set[COLUMN_BY_FIELD[k]] = patchRecord[k];
        if (machineChanged) set.branch_id = machine.branch_id;
        const ratesChanged = patch.dailyRate !== undefined || patch.startDate !== undefined || patch.endDate !== undefined;
        if (patch.totalValue === undefined && ratesChanged) {
          set.total_value = computeTotal(patch.dailyRate ?? before.dailyRate, startDate, endDate);
        }
        await versionedUpdate(tx, { table: 'bookings', orgId: principal.orgId, id, expectedVersion: expected, set });
        const after = bookingToDto(await loadBooking(tx, principal, id, { action: 'bookings.write' }));
        const auditKeys = [...keys, ...(set.total_value !== undefined && patch.totalValue === undefined ? ['totalValue'] : [])];
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: machineChanged ? 'booking.reallocated' : 'booking.updated',
          entityType: 'booking',
          entityId: id,
          correlationId: req.correlationId,
          before: pick(before, auditKeys),
          after: pick(after, auditKeys),
        });
        return after;
      });
    } catch (err) {
      mapBookingErrors(err);
    }
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/bookings/:id/cancel', async (req, res) => {
    const principal = principalWith(req, 'bookings.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = cancelSchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = bookingToDto(await loadBooking(tx, principal, id, { lock: true, action: 'bookings.write' }));
      if (before.rowVersion !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      if (before.status === 'On Hire' || before.status === 'Returned' || before.status === 'Cancelled') {
        throw new AppError('BUSINESS_RULE', `A ${before.status} booking cannot be cancelled`, { status: 'invalid_for_cancel' });
      }
      await versionedUpdate(tx, {
        table: 'bookings', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Cancelled', updated_at: new Date(), updated_by: principal.userId },
      });
      const after = bookingToDto(await loadBooking(tx, principal, id, { action: 'bookings.write' }));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'booking.cancelled',
        entityType: 'booking',
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

  router.post('/bookings/:id/off-hire-request', async (req, res) => {
    const principal = principalWith(req, 'bookings.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    emptySchema.parse(req.body ?? {});
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = bookingToDto(await loadBooking(tx, principal, id, { lock: true, action: 'bookings.write' }));
      if (before.rowVersion !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      if (before.status !== 'On Hire') {
        throw new AppError('BUSINESS_RULE', 'Only a booking on hire can be requested off hire', { status: 'not_on_hire' });
      }
      if (before.offHireRequestedAt !== null) return before;
      await versionedUpdate(tx, {
        table: 'bookings', orgId: principal.orgId, id, expectedVersion: expected,
        set: { off_hire_requested_at: new Date(), updated_at: new Date(), updated_by: principal.userId },
      });
      const after = bookingToDto(await loadBooking(tx, principal, id, { action: 'bookings.write' }));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'booking.off_hire_requested',
        entityType: 'booking',
        entityId: id,
        correlationId: req.correlationId,
        before: { offHireRequestedAt: null },
        after: { offHireRequestedAt: after.offHireRequestedAt },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post(
    '/bookings/:id/start-hire',
    requireAction('bookings.start_hire'),
    idempotencyMiddleware({ required: true }),
    async (req, res) => {
      const principal = principalWith(req, 'bookings.start_hire');
      const id = uuidParam(req);
      const expected = parseIfMatch(req.headers['if-match']);
      emptySchema.parse(req.body ?? {});
      const ctx = getIdempotency(res);
      const result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'bookings.start_hire', ctx, async () => {
          const out = await startHireInTx(tx, principal, id, {
            source: 'PLANNER',
            sourceKey: `planner:${id}`,
            correlationId: req.correlationId,
            expectedVersion: expected,
          });
          return { status: 200, body: out.booking };
        }),
      );
      const body = result.body as BookingDto;
      if (typeof body.rowVersion === 'number') setVersionHeader(res, body.rowVersion);
      res.status(result.status).json(body);
    },
  );

  return router;
}
