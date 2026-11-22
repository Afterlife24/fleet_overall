import type { Booking, BookingStatus } from '@/types';

/**
 * Structural shape of the validated booking form values that the builder reads.
 * Any additional form fields (gates, LPO, period, ...) are passed through to the record.
 * BookingFormDialog's inferred form type is assignable to this.
 */
export interface BookingRecordFormData {
  customerId: string;
  machineId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  deliveryAddress: string;
  siteContactPhone: string;
  operatorRequired: boolean;
  dailyRate: number;
  remarks?: string;
  hireAgreementId?: string;
  [extra: string]: unknown;
}

export interface BuildBookingRecordArgs {
  mode: 'create' | 'edit';
  data: BookingRecordFormData;
  /** Required when mode is 'edit'. */
  existing?: Booking;
  /** Active organisation. */
  orgId: string;
  /** ISO timestamp. */
  now: string;
  names: { customerName: string; assetNumber: string; machineModel: string; branchName: string };
  status: BookingStatus;
  totalValue: number;
  /** Numeric seed for the id and reference (Date.now() in the UI); used on create only. */
  idSeed: number;
}

/** Pure builder for the persisted booking record. */
export function buildBookingRecord(args: BuildBookingRecordArgs): Booking {
  const { mode, data, existing, orgId, now, names, status, totalValue, idSeed } = args;
  const seed = String(idSeed);

  // Drop identity keys that must never come from form data, and the agreement field (handled below).
  const {
    id: _id,
    reference: _reference,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    orgId: _orgId,
    hireAgreementId: rawAgreement,
    ...extra
  } = data as Record<string, unknown>;
  void _id; void _reference; void _createdAt; void _updatedAt; void _orgId;

  const identity =
    mode === 'edit' && existing
      ? {
          id: existing.id,
          reference: existing.reference,
          createdAt: existing.createdAt,
          orgId: existing.orgId ?? orgId,
        }
      : {
          id: `bk-user-${seed}`,
          reference: `BK-${new Date(now).getFullYear()}-${seed.slice(-4)}`,
          createdAt: now,
          orgId,
        };

  const record = {
    customerId: data.customerId,
    customerName: names.customerName,
    machineId: data.machineId,
    assetNumber: names.assetNumber,
    machineModel: names.machineModel,
    branchId: data.branchId,
    branchName: names.branchName,
    startDate: data.startDate,
    endDate: data.endDate,
    status,
    deliveryAddress: data.deliveryAddress,
    contactPhone: data.siteContactPhone,
    operatorRequired: data.operatorRequired,
    dailyRate: data.dailyRate,
    totalValue,
    notes: data.remarks ?? '',
    ...extra,
    ...identity,
    updatedAt: now,
  } as unknown as Booking;

  const agreementId = typeof rawAgreement === 'string' ? rawAgreement.trim() : '';
  if (agreementId) record.hireAgreementId = agreementId;
  else delete record.hireAgreementId;

  return record;
}
