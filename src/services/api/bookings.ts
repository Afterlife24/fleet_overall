import { apiRequest, type ApiRequestOptions } from './http';
import { collectionApi } from './resource';

export type BookingStatusValue =
  | 'Draft' | 'Reserved' | 'Pending Approval' | 'Approved' | 'Allocated' | 'On Hire' | 'Returned' | 'Cancelled';

/** Statuses a client may set when creating or editing a booking. */
export type BookingPlanningStatus = 'Draft' | 'Reserved' | 'Pending Approval' | 'Approved' | 'Allocated';

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
  status: BookingStatusValue;
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
  /** True while the machine is out and not returned, even after the planned end date. */
  physicallyOccupied: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface BookingCreateDto {
  machineId: string;
  customerId: string;
  hireAgreementId?: string | null;
  lpoId?: string | null;
  startDate: string;
  endDate: string;
  status?: BookingPlanningStatus;
  deliveryAddress: string;
  contactPhone: string;
  operatorRequired?: boolean;
  dailyRate?: string | number;
  /** Computed by the server (daily rate x inclusive days) when omitted. */
  totalValue?: string | number;
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  reserved?: boolean;
  notes?: string | null;
}

/** `On Hire`, `Returned` and `Cancelled` are set only by their commands, never by update. */
export interface BookingUpdateDto {
  machineId?: string;
  hireAgreementId?: string | null;
  lpoId?: string | null;
  startDate?: string;
  endDate?: string;
  status?: BookingPlanningStatus;
  deliveryAddress?: string;
  contactPhone?: string;
  operatorRequired?: boolean;
  dailyRate?: string | number;
  totalValue?: string | number;
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  reserved?: boolean;
  notes?: string | null;
}

export interface BookingFilters {
  machineId?: string;
  customerId?: string;
  branchId?: string;
  hireAgreementId?: string;
  status?: BookingStatusValue;
  /** Inclusive date overlap window, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** `/api/v1/bookings`. Start Hire is one server transaction that also moves an Awaiting/Tender quotation to Won. */
export const bookingsApi = {
  ...collectionApi<BookingDto, BookingCreateDto, BookingUpdateDto, BookingFilters>('/bookings'),
  cancel: (id: string, rowVersion: number, reason: string, opts: Opts = {}) =>
    apiRequest<BookingDto>(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, rowVersion, ...opts }),
  /** `submissionId` fixes the Idempotency-Key: reuse it when retrying one submission. */
  startHire: (id: string, rowVersion: number, submissionId: string, opts: Opts = {}) =>
    apiRequest<BookingDto>(`/bookings/${encodeURIComponent(id)}/start-hire`, {
      method: 'POST', body: {}, rowVersion, submissionId, ...opts,
    }),
  requestOffHire: (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<BookingDto>(`/bookings/${encodeURIComponent(id)}/off-hire-request`, { method: 'POST', body: {}, rowVersion, ...opts }),
};
