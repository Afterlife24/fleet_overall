import { randomUUID } from 'node:crypto';
import type { Principal } from '../../auth/principal.js';
import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { pgError } from '../shared/http.js';
import { bookingToDto, loadBooking, type BookingDto } from './model.js';

export interface StartHireOptions {
  source: 'PLANNER' | 'GATE_OUT';
  sourceKey: string;
  occurredAt?: Date;
  correlationId?: string;
  expectedVersion?: number;
}

export interface StartHireResult {
  booking: BookingDto;
  quotationWon: boolean;
  alreadyOnHire: boolean;
}

/** Operational states in which a machine may not be dispatched on hire. */
const BLOCKING_OPERATIONAL = new Set(['Offline', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Breakdown']);

interface IdsRow {
  hire_agreement_id: string | null;
  machine_id: string;
  customer_id: string;
}

/**
 * Takes the start-hire lock chain (quotation -> agreement -> booking -> machine) without validating or writing.
 * Gate OUT completion calls this before inserting its movement so both paths lock in the same order.
 */
export async function lockStartHireChain(tx: TxClient, bookingId: string): Promise<void> {
  const b = await tx.query<{ hire_agreement_id: string | null; machine_id: string }>(
    'SELECT hire_agreement_id, machine_id FROM bookings WHERE id = $1',
    [bookingId],
  );
  const row = b.rows[0];
  if (!row) return;
  if (row.hire_agreement_id) {
    const link = await tx.query<{ quotation_id: string }>('SELECT quotation_id FROM hire_agreements WHERE id = $1', [row.hire_agreement_id]);
    const quotationId = link.rows[0]?.quotation_id;
    if (quotationId) await tx.query('SELECT 1 FROM quotations WHERE id = $1 FOR UPDATE', [quotationId]);
    await tx.query('SELECT 1 FROM hire_agreements WHERE id = $1 FOR UPDATE', [row.hire_agreement_id]);
  }
  await tx.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
  await tx.query('SELECT 1 FROM machines WHERE id = $1 FOR UPDATE', [row.machine_id]);
}
/**
 * Starts hire for a booking inside the caller's transaction (the caller commits or rolls back).
 * Lock order follows DATABASE_DESIGN 5.2: quotation -> agreement -> booking -> machine, then everything is
 * re-validated. Throws before writing anything when a rule fails, so nothing is partially applied.
 */
export async function startHireInTx(
  tx: TxClient,
  principal: Principal,
  bookingId: string,
  opts: StartHireOptions,
): Promise<StartHireResult> {
  const action = 'bookings.start_hire';
  // 1. Read the immutable relationship ids (also proves tenant and branch scope).
  const first = await loadBooking(tx, principal, bookingId, { action });
  const ids: IdsRow = { hire_agreement_id: first.hire_agreement_id, machine_id: first.machine_id, customer_id: first.customer_id };

  // 2. Lock quotation -> agreement -> booking -> machine.
  let quotationId: string | null = null;
  if (ids.hire_agreement_id) {
    const link = await tx.query<{ quotation_id: string }>('SELECT quotation_id FROM hire_agreements WHERE id = $1', [ids.hire_agreement_id]);
    quotationId = link.rows[0]?.quotation_id ?? null;
  }
  interface QuotationLock { id: string; phase: string; quotation_no: string; row_version: string }
  let quotation: QuotationLock | undefined;
  if (quotationId) {
    const q = await tx.query<QuotationLock>(
      'SELECT id, phase, quotation_no, row_version FROM quotations WHERE id = $1 FOR UPDATE',
      [quotationId],
    );
    quotation = q.rows[0];
  }
  interface AgreementLock { id: string; customer_id: string; quotation_id: string; status: string }
  let agreement: AgreementLock | undefined;
  if (ids.hire_agreement_id) {
    const a = await tx.query<AgreementLock>(
      'SELECT id, customer_id, quotation_id, status FROM hire_agreements WHERE id = $1 FOR UPDATE',
      [ids.hire_agreement_id],
    );
    agreement = a.rows[0];
  }
  const booking = await loadBooking(tx, principal, bookingId, { lock: true, action });
  const machineRes = await tx.query<{ id: string; active: boolean; operational_status: string; readiness_status: string; asset_no: string }>(
    'SELECT id, active, operational_status, readiness_status, asset_no FROM machines WHERE id = $1 FOR UPDATE',
    [booking.machine_id],
  );
  const machine = machineRes.rows[0];
  if (!machine) throw new AppError('INTERNAL_ERROR', 'Booking machine could not be read');

  // 3. Re-validate after locking: the links must not have changed between the read and the locks.
  if (booking.hire_agreement_id !== ids.hire_agreement_id || booking.machine_id !== ids.machine_id) {
    throw new AppError('STALE_VERSION', 'The booking was changed by someone else; reload and retry');
  }

  // Idempotent repeat: already On Hire, no new writes.
  if (booking.status === 'On Hire') {
    return { booking: bookingToDto(booking), quotationWon: false, alreadyOnHire: true };
  }

  if (opts.expectedVersion !== undefined && Number(booking.row_version) !== opts.expectedVersion) {
    throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
  }
  if (booking.status === 'Returned' || booking.status === 'Cancelled') {
    throw new AppError('BUSINESS_RULE', `A ${booking.status} booking cannot be put on hire`, { status: 'invalid_for_start_hire' });
  }
  if (!agreement || !quotation) {
    throw new AppError('BUSINESS_RULE', 'A hire agreement must be linked to the booking before hire can start', { hireAgreementId: 'required' });
  }
  if (agreement.status === 'Cancelled') {
    throw new AppError('BUSINESS_RULE', 'The linked hire agreement is cancelled', { hireAgreementId: 'cancelled' });
  }
  if (agreement.customer_id !== booking.customer_id) {
    throw new AppError('BUSINESS_RULE', 'The hire agreement belongs to a different customer', { hireAgreementId: 'customer_mismatch' });
  }
  if (quotation.phase === 'LOST') {
    throw new AppError('REOPEN_REQUIRED', 'The linked quotation is Lost; reopen it before starting hire', { quotationId: 'lost' });
  }

  // Machine dispatch gates. Transport job status is deliberately not a condition.
  if (!machine.active) {
    throw new AppError('BUSINESS_RULE', 'The machine is archived', { machineId: 'archived' });
  }
  if (BLOCKING_OPERATIONAL.has(machine.operational_status)) {
    throw new AppError('BUSINESS_RULE', `The machine is ${machine.operational_status} and cannot be dispatched`, { machineId: 'not_dispatchable' });
  }
  if (machine.readiness_status !== 'READY') {
    throw new AppError('BUSINESS_RULE', `The machine readiness is ${machine.readiness_status}`, { machineId: 'not_ready' });
  }
  const occupied = await tx.query<{ reference: string }>(
    `SELECT reference FROM bookings WHERE machine_id = $1 AND id <> $2 AND returned_at IS NULL
        AND (departed_at IS NOT NULL OR status = 'On Hire') LIMIT 1`,
    [booking.machine_id, booking.id],
  );
  if (occupied.rows[0]) {
    throw new AppError('BOOKING_CONFLICT', `The machine is still out on booking ${occupied.rows[0].reference}`, { machineId: 'occupied' });
  }

  // 4. Write. Any failure below rolls back with the caller's transaction.
  const before = bookingToDto(booking);
  try {
    await tx.query(
      `UPDATE bookings
          SET status = 'On Hire',
              on_hire_at = COALESCE($3::timestamptz, now()),
              departed_at = COALESCE(departed_at, $3::timestamptz, now()),
              updated_at = now(), updated_by = $4, row_version = row_version + 1
        WHERE id = $1 AND org_id = $2`,
      [booking.id, principal.orgId, opts.occurredAt ?? null, principal.userId],
    );
  } catch (err) {
    const { code, constraint } = pgError(err);
    if (code === '23P01' && (constraint === 'ex_machine_planned_booking' || constraint === 'ex_machine_physical_booking')) {
      throw new AppError('BOOKING_CONFLICT', 'The machine is already booked or out on hire for these dates', { machineId: 'conflict' });
    }
    throw err;
  }
  await tx.query(
    `UPDATE machines SET operational_status = 'On Hire', updated_at = now(), updated_by = $2, row_version = row_version + 1 WHERE id = $1`,
    [machine.id, principal.userId],
  );

  const correlationId = opts.correlationId ?? randomUUID();
  let quotationWon = false;
  if (quotation.phase === 'AWAITING' || quotation.phase === 'TENDER') {
    await tx.query(
      `UPDATE quotations SET phase = 'WON', won_at = now(), updated_at = now(), updated_by = $2, row_version = row_version + 1 WHERE id = $1`,
      [quotation.id, principal.userId],
    );
    await tx.query(
      `INSERT INTO quotation_phase_history (org_id, quotation_id, from_phase, to_phase, actor_user_id, reason, source, source_key, created_by)
       VALUES ($1, $2, $3, 'WON', $4, $5, 'ON_HIRE', $6, $4)
       ON CONFLICT (org_id, source_key) DO NOTHING`,
      [
        principal.orgId, quotation.id, quotation.phase, principal.userId,
        `Automatic: hire started on booking ${booking.reference} (${opts.source})`, `on_hire:${opts.sourceKey}`,
      ],
    );
    quotationWon = true;
  }

  const after = bookingToDto(await loadBooking(tx, principal, bookingId, { action }));
  await recordAudit(tx, principal.orgId, {
    actorUserId: principal.userId,
    action: 'booking.hire_started',
    entityType: 'booking',
    entityId: booking.id,
    correlationId,
    reason: opts.source,
    before: { status: before.status, onHireAt: before.onHireAt, departedAt: before.departedAt },
    after: { status: after.status, onHireAt: after.onHireAt, departedAt: after.departedAt, machineStatus: 'On Hire' },
  });
  if (quotationWon) {
    await recordAudit(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: 'quotation.won_automatic',
      entityType: 'quotation',
      entityId: quotation.id,
      correlationId,
      reason: `Hire started on booking ${booking.reference} (${opts.source})`,
      before: { phase: quotation.phase },
      after: { phase: 'WON' },
    });
  }
  return { booking: after, quotationWon, alreadyOnHire: false };
}
