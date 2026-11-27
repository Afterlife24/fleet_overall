import type { PageDto } from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import type { TransportJobDto } from './transport';

export type CollectionNoteStatus = 'Draft' | 'Scheduled' | 'Picked Up' | 'Collected' | 'Closed' | 'Cancelled';

export interface CollectionNoteDto {
  id: string; number: string; bookingId: string; machineId: string; branchId: string; relatedInvoiceId: string | null;
  noteDate: string; collectionAddress: string; driverName: string; vehicleText: string; status: CollectionNoteStatus;
  scheduledCollectionAt: string | null; pickedUpAt: string | null; collectedMovementId: string | null;
  collectedAt: string | null; closedAt: string | null; remarks: string | null; createdAt: string; updatedAt: string;
  rowVersion: number;
}
export interface CollectionMqdReportDto {
  id: string; number: string; bookingId: string; collectionNoteId: string; phase: string; reportDate: string;
  hirerName: string; formSchemaVersion: string; fields: Record<string, unknown>; notes: string | null;
  createdAt: string; updatedAt: string; rowVersion: number;
}
export interface CollectionServiceReportDto {
  id: string; number: string; bookingId: string; collectionNoteId: string; phase: string; currencyCode: string;
  notes: string | null; approvedBy: string | null; approvedName: string | null; signatureText: string | null;
  totalAmount: string; createdAt: string; updatedAt: string; rowVersion: number;
}
/** The collection note with the MQD/TPS reports and transport job created with it. */
export interface CollectionBundleDto {
  collectionNote: CollectionNoteDto;
  mqdReport: CollectionMqdReportDto | null;
  serviceReport: CollectionServiceReportDto | null;
  transportJob: TransportJobDto | null;
}
export interface CollectionInitiateInput {
  scheduledCollectionAt?: string; collectionAddress?: string; driverId?: string; vehicleId?: string;
  driverName?: string; vehicleText?: string; relatedInvoiceId?: string; remarks?: string | null;
}
export interface CollectionNoteUpdate {
  collectionAddress?: string; driverId?: string | null; vehicleId?: string | null; driverName?: string; vehicleText?: string;
  scheduledCollectionAt?: string | null; remarks?: string | null; relatedInvoiceId?: string | null;
}
export interface CollectionNoteFilters { bookingId?: string; machineId?: string; status?: CollectionNoteStatus; q?: string }

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** Collection initiation (`/bookings/:id/collection`) and `/api/v1/collection-notes`. */
export const collectionApi = {
  /** Idempotent: repeating it for a booking with an open collection note returns that note and its documents. */
  initiate: (bookingId: string, input: CollectionInitiateInput, submissionId: string, opts: Opts = {}) =>
    apiRequest<CollectionBundleDto>(`/bookings/${encodeURIComponent(bookingId)}/collection`, {
      method: 'POST', body: input, submissionId, ...opts,
    }),
  list: (params: { page?: number; pageSize?: number; sort?: string } & CollectionNoteFilters = {}, opts: Opts = {}) =>
    apiRequest<PageDto<CollectionNoteDto>>('/collection-notes', { query: params, ...opts }),
  get: (id: string, opts: Opts = {}) => apiRequest<CollectionBundleDto>(`/collection-notes/${encodeURIComponent(id)}`, opts),
  update: (id: string, rowVersion: number, patch: CollectionNoteUpdate, opts: Opts = {}) =>
    apiRequest<CollectionBundleDto>(`/collection-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, rowVersion, ...opts }),
  /** Records the truck pickup only; it is not a gate receipt and does not stop billing. */
  markPickedUp: (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<CollectionBundleDto>(`/collection-notes/${encodeURIComponent(id)}/picked-up`, { method: 'POST', body: {}, rowVersion, ...opts }),
  cancel: (id: string, rowVersion: number, reason: string, opts: Opts = {}) =>
    apiRequest<CollectionBundleDto>(`/collection-notes/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, rowVersion, ...opts }),
};
