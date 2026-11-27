import { authorize, type ActionCode, type Principal } from '../../auth/principal.js';
import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';

export const BOOKING_STATUSES = [
  'Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned', 'Cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses a client may choose when creating or editing; hire, return and cancel are explicit commands. */
export const PLANNING_STATUSES = ['Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated'] as const;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];

/** Statuses that reserve the machine for the booking dates (mirrors ex_machine_planned_booking, excluding On Hire). */
export const RESERVING_STATUSES: readonly BookingStatus[] = ['Reserved', 'Pending Approval', 'Approved', 'Allocated'];

export interface BookingRow {
  id: string;
  reference: string;
  branch_id: string;
  branch_name: string;
  machine_id: string;
  asset_no: string;
  fleet_no: string;
  machine_model: string;
  customer_id: string;
  customer_name: string;
  hire_agreement_id: string | null;
  agreement_no: string | null;
  lpo_id: string | null;
  start_date: string;
  end_date: string;
  status: BookingStatus;
  delivery_address: string;
  contact_phone: string;
  operator_required: boolean;
  daily_rate: string;
  total_value: string;
  quoted: boolean;
  ha_sent: boolean;
  ha_received: boolean;
  reserved: boolean;
  on_hire_at: Date | null;
  departed_at: Date | null;
  off_hire_requested_at: Date | null;
  collected_at: Date | null;
  returned_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface BookingDto {
  id: string;
  reference: string;
  branchId: string;
  branchName: string;
  machineId: string;
  assetNo: string;
  fleetNo: string;
  machineModel: string;
  customerId: string;
  customerName: string;
  hireAgreementId: string | null;
  agreementNo: string | null;
  lpoId: string | null;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  deliveryAddress: string;
  contactPhone: string;
  operatorRequired: boolean;
  dailyRate: string;
  totalValue: string;
  quoted: boolean;
  haSent: boolean;
  haReceived: boolean;
  reserved: boolean;
  onHireAt: string | null;
  departedAt: string | null;
  offHireRequestedAt: string | null;
  collectedAt: string | null;
  returnedAt: string | null;
  /** True while the machine is physically out: departed and not returned, regardless of the planned end date. */
  physicallyOccupied: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const day = (c: string) => `to_char(b.${c}, 'YYYY-MM-DD') AS ${c}`;

export const BOOKING_COLUMNS = `b.id, b.reference, b.branch_id, br.name AS branch_name, b.machine_id, m.asset_no, m.fleet_no,
  (mm.make || ' ' || mm.model) AS machine_model, b.customer_id, c.name AS customer_name, b.hire_agreement_id,
  ha.agreement_no, b.lpo_id, ${day('start_date')}, ${day('end_date')}, b.status, b.delivery_address, b.contact_phone,
  b.operator_required, b.daily_rate, b.total_value, b.quoted, b.ha_sent, b.ha_received, b.reserved, b.on_hire_at,
  b.departed_at, b.off_hire_requested_at, b.collected_at, b.returned_at, b.notes, b.created_at, b.updated_at, b.row_version`;

export const BOOKING_FROM = `bookings b
  JOIN customers c ON c.id = b.customer_id AND c.org_id = b.org_id
  JOIN machines m ON m.id = b.machine_id AND m.org_id = b.org_id
  JOIN machine_models mm ON mm.id = m.model_id AND mm.org_id = m.org_id
  JOIN branches br ON br.id = b.branch_id AND br.org_id = b.org_id
  LEFT JOIN hire_agreements ha ON ha.id = b.hire_agreement_id AND ha.org_id = b.org_id`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function bookingToDto(r: BookingRow): BookingDto {
  return {
    id: r.id,
    reference: r.reference,
    branchId: r.branch_id,
    branchName: r.branch_name,
    machineId: r.machine_id,
    assetNo: r.asset_no,
    fleetNo: r.fleet_no,
    machineModel: r.machine_model,
    customerId: r.customer_id,
    customerName: r.customer_name,
    hireAgreementId: r.hire_agreement_id,
    agreementNo: r.agreement_no,
    lpoId: r.lpo_id,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    deliveryAddress: r.delivery_address,
    contactPhone: r.contact_phone,
    operatorRequired: r.operator_required,
    dailyRate: r.daily_rate,
    totalValue: r.total_value,
    quoted: r.quoted,
    haSent: r.ha_sent,
    haReceived: r.ha_received,
    reserved: r.reserved,
    onHireAt: iso(r.on_hire_at),
    departedAt: iso(r.departed_at),
    offHireRequestedAt: iso(r.off_hire_requested_at),
    collectedAt: iso(r.collected_at),
    returnedAt: iso(r.returned_at),
    physicallyOccupied: r.departed_at !== null && r.returned_at === null,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

/**
 * Loads a booking visible to the Principal. Another company's row is invisible (RLS); a row outside the
 * branch scope answers 404. With `lock` the booking row is locked FOR UPDATE (not the joined rows).
 */
export async function loadBooking(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: ActionCode } = {},
): Promise<BookingRow> {
  const res = await tx.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM} WHERE b.id = $1${opts.lock ? ' FOR UPDATE OF b' : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Booking not found');
  if (authorize(principal, opts.action ?? 'bookings.read', { orgId: principal.orgId, branchId: row.branch_id }) !== 'allow') {
    throw new AppError('NOT_FOUND', 'Booking not found');
  }
  return row;
}
