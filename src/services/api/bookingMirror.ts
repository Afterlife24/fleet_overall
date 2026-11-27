// Bookings read from `/api/v1/bookings`, shaped for the planner and for the retained screens that still read
// `useBookingStore` (invoices, collection, gate, transport). The store is an in-memory, non-persisted mirror:
// `mirrorBookings` replaces it on every refresh and the API stays the authority.
import { useBookingStore } from '@/store/bookingStore';
import type { Booking } from '@/types/booking';
import { bookingsApi, type BookingDto } from './bookings';
import { ApiClientError } from './http';
import type { QueryScope } from './queryKeys';
import { browserOrgId, listAll } from './readAdapters';
import { ensureSession, useSessionStore } from './session';

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Maps an API booking to the browser shape. Money becomes a number for display only. */
export function bookingFromDto(dto: BookingDto, orgId: string = browserOrgId()): Booking {
  return {
    id: dto.id,
    reference: dto.reference,
    customerId: dto.customerId,
    customerName: dto.customerName,
    machineId: dto.machineId,
    assetNumber: dto.assetNo,
    fleetNo: dto.fleetNo,
    machineModel: dto.machineModel,
    branchId: dto.branchId,
    branchName: dto.branchName,
    startDate: dto.startDate,
    endDate: dto.endDate,
    status: dto.status,
    deliveryAddress: dto.deliveryAddress,
    contactPhone: dto.contactPhone,
    operatorRequired: dto.operatorRequired,
    dailyRate: num(dto.dailyRate),
    totalValue: num(dto.totalValue),
    notes: dto.notes ?? undefined,
    orgId,
    hireAgreementId: dto.hireAgreementId ?? undefined,
    agreementNo: dto.agreementNo ?? undefined,
    lpoId: dto.lpoId ?? undefined,
    quoted: dto.quoted,
    haSent: dto.haSent,
    haReceived: dto.haReceived,
    reserved: dto.reserved,
    onHireAt: dto.onHireAt,
    departedAt: dto.departedAt,
    offHireRequestedAt: dto.offHireRequestedAt,
    collectedAt: dto.collectedAt,
    returnedAt: dto.returnedAt,
    physicallyOccupied: dto.physicallyOccupied,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
  };
}

/** Query key of the full booking list (shared by the planner hooks and the retained mirror). */
export const bookingsListKey = (scope: QueryScope) => ['bookings', scope.orgId, scope.branch, 'list', { view: 'all' }] as const;
export const bookingsAllKey = (scope: QueryScope) => ['bookings', scope.orgId, scope.branch] as const;

export async function loadBookingDtos(): Promise<BookingDto[]> {
  if (!(await ensureSession())) {
    throw new ApiClientError({
      code: 'UNAUTHENTICATED', message: useSessionStore.getState().error ?? 'There is no API session.', status: 401,
    });
  }
  return listAll((page, pageSize) => bookingsApi.list({ page, pageSize, sort: 'startDate' }));
}

/** Replaces the in-memory copy read by the retained screens. Never persisted. */
export function mirrorBookings(bookings: Booking[]): void {
  useBookingStore.setState({ userBookings: bookings });
}
