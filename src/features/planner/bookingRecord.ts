import type { BookingCreateDto, BookingPlanningStatus, BookingUpdateDto } from '@/services/api/bookings';
import type { Booking } from '@/types';

/**
 * Structural shape of the validated booking form values that the builders read.
 * Extra form fields (period, time, sales rep, ...) are ignored: the API stores none of them.
 */
export interface BookingRecordFormData {
  customerId: string;
  machineId: string;
  startDate: string;
  endDate: string;
  deliveryAddress: string;
  siteContactPhone: string;
  operatorRequired: boolean;
  dailyRate: number;
  remarks?: string;
  hireAgreementId?: string;
  lpoId?: string;
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  reserved?: boolean;
  [extra: string]: unknown;
}

const blank = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * The planning status to send. A booking with every gate done and no hold is `Allocated`; anything else only
 * holds the slot as `Reserved`. `On Hire`, `Returned` and `Cancelled` are never chosen here: they come from
 * Start Hire, the machine's return and Cancel.
 */
export function planningStatus(
  gates: { quoted?: boolean; haSent?: boolean; haReceived?: boolean; lpoId?: string; reserved?: boolean },
): BookingPlanningStatus {
  const complete = !!gates.quoted && !!gates.haSent && !!gates.haReceived && !!blank(gates.lpoId);
  return gates.reserved || !complete ? 'Reserved' : 'Allocated';
}

/** Body for `POST /bookings`. */
export function buildBookingCreate(data: BookingRecordFormData, status: BookingPlanningStatus): BookingCreateDto {
  return {
    machineId: data.machineId,
    customerId: data.customerId,
    hireAgreementId: blank(data.hireAgreementId),
    lpoId: blank(data.lpoId),
    startDate: data.startDate,
    endDate: data.endDate,
    status,
    deliveryAddress: data.deliveryAddress.trim(),
    contactPhone: data.siteContactPhone.trim(),
    operatorRequired: data.operatorRequired,
    dailyRate: String(data.dailyRate),
    quoted: !!data.quoted,
    haSent: !!data.haSent,
    haReceived: !!data.haReceived,
    reserved: !!data.reserved,
    notes: blank(data.remarks),
  };
}

/**
 * Body for `PATCH /bookings/:id`: only the fields that differ from the loaded booking. The status is left out for
 * a booking that is already On Hire (its status changes only by return).
 */
export function buildBookingUpdate(
  data: BookingRecordFormData,
  status: BookingPlanningStatus,
  existing: Booking,
): BookingUpdateDto {
  const patch: BookingUpdateDto = {};
  if (data.machineId !== existing.machineId) patch.machineId = data.machineId;
  const agreement = blank(data.hireAgreementId);
  if (agreement !== (existing.hireAgreementId ?? null)) patch.hireAgreementId = agreement;
  const lpo = blank(data.lpoId);
  if (lpo !== (existing.lpoId ?? null)) patch.lpoId = lpo;
  if (data.startDate !== existing.startDate) patch.startDate = data.startDate;
  if (data.endDate !== existing.endDate) patch.endDate = data.endDate;
  if (existing.status !== 'On Hire' && status !== existing.status) patch.status = status;
  if (data.deliveryAddress.trim() !== existing.deliveryAddress) patch.deliveryAddress = data.deliveryAddress.trim();
  if (data.siteContactPhone.trim() !== existing.contactPhone) patch.contactPhone = data.siteContactPhone.trim();
  if (data.operatorRequired !== existing.operatorRequired) patch.operatorRequired = data.operatorRequired;
  if (Number(data.dailyRate) !== existing.dailyRate) patch.dailyRate = String(data.dailyRate);
  if (!!data.quoted !== !!existing.quoted) patch.quoted = !!data.quoted;
  if (!!data.haSent !== !!existing.haSent) patch.haSent = !!data.haSent;
  if (!!data.haReceived !== !!existing.haReceived) patch.haReceived = !!data.haReceived;
  if (!!data.reserved !== !!existing.reserved) patch.reserved = !!data.reserved;
  const notes = blank(data.remarks);
  if (notes !== (existing.notes ?? null)) patch.notes = notes;
  return patch;
}

/** What the planner shows for a booking: the server status, with Returned only when the server says it returned. */
export function displayStatus(b: Pick<Booking, 'status' | 'returnedAt' | 'physicallyOccupied' | 'endDate'>, today: string): string {
  if (b.returnedAt) return 'Returned';
  if (b.status === 'On Hire' && b.physicallyOccupied && b.endDate < today) return 'On Hire (overdue)';
  return b.status;
}
