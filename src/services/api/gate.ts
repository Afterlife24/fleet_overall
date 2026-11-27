import { apiRequest, type ApiRequestOptions } from './http';

type Opts = Pick<ApiRequestOptions, 'signal'>;

export interface PageResult<T> { items: T[]; page: number; pageSize: number; total: number }
export interface ListParams { page?: number; pageSize?: number; sort?: string }

export type GateDirection = 'IN' | 'OUT';
export type GatePurpose = 'CUSTOMER_HIRE' | 'CUSTOMER_RETURN' | 'TRANSFER';
export type GatePassStatus = 'Pending' | 'Approved' | 'Completed' | 'Cancelled';
export type GateCaptureMethod = 'QR' | 'Manual';
export type InspectionStatusValue = 'Pending' | 'In Progress' | 'Awaiting Approval' | 'Passed' | 'Failed' | 'Cancelled';
export type InspectionAnswer = 'Pass' | 'Fail' | 'N/A' | 'Pending';

export interface GateMovementDto {
  id: string;
  occurredAt: string;
  timeSource: string;
  operatorUserId: string;
  closesMovementId: string | null;
}

export interface GatePassDto {
  id: string;
  reference: string;
  branchId: string;
  machineId: string;
  bookingId: string | null;
  transportJobId: string | null;
  collectionNoteId: string | null;
  direction: GateDirection;
  movementPurpose: GatePurpose;
  status: GatePassStatus;
  fleetNoSnapshot: string;
  driverName: string;
  truckPlate: string | null;
  destination: string;
  arrivingFrom: string | null;
  captureMethod: GateCaptureMethod;
  scannedAt: string | null;
  qrPayload: string | null;
  deviceCapturedAt: string | null;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  movement: GateMovementDto | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface GatePassCreateDto {
  direction: GateDirection;
  movementPurpose: GatePurpose;
  machineId: string;
  bookingId?: string | null;
  transportJobId?: string | null;
  collectionNoteId?: string | null;
  captureMethod: GateCaptureMethod;
  /** Required for `QR` (canonical fleet QR), not allowed for `Manual`. */
  qrPayload?: string | null;
  scannedAt?: string | null;
  deviceCapturedAt?: string | null;
  driverName: string;
  truckPlate?: string | null;
  destination: string;
  arrivingFrom?: string | null;
  notes?: string | null;
}

export interface GatePassFilters {
  status?: GatePassStatus;
  direction?: GateDirection;
  machineId?: string;
  bookingId?: string;
  branchId?: string;
}

export interface GateMachineDto {
  id: string;
  branchId: string;
  fleetNo: string;
  assetNo: string;
  operationalStatus: string;
  readinessStatus: string;
  currentLocation: string;
  active: boolean;
  rowVersion: number;
}

export interface GateBookingDto {
  id: string;
  reference: string;
  machineId: string;
  branchId: string;
  customerId: string;
  status: string;
  startDate: string;
  endDate: string;
  departedAt: string | null;
  returnedAt: string | null;
  rowVersion: number;
}

export interface GateCollectionNoteDto {
  id: string;
  number: string;
  bookingId: string;
  machineId: string;
  status: string;
  scheduledCollectionAt: string | null;
  rowVersion: number;
}

export interface ResolveQrDto {
  kind: 'FLEET' | 'GATE_PASS';
  machine: GateMachineDto;
  pass: GatePassDto | null;
  openPasses: GatePassDto[];
  candidateBooking: GateBookingDto | null;
  candidateCollectionNote: GateCollectionNoteDto | null;
  /** True when no single return candidate exists; the operator must pick the booking. */
  manualSelectionRequired: boolean;
}

export interface GateCompleteDto {
  pass: GatePassDto;
  movement: GateMovementDto | null;
  inspection: InspectionDto | null;
  booking: unknown;
  alreadyCompleted: boolean;
}

export interface InspectionResultDto {
  id: string;
  itemKey: string;
  section: string;
  question: string;
  result: InspectionAnswer;
  critical: boolean;
  required: boolean;
  notes: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  rowVersion: number;
}

export interface InspectionDto {
  id: string;
  reference: string;
  machineId: string;
  fleetNo: string;
  branchId: string;
  bookingId: string | null;
  gateMovementId: string | null;
  inspectorUserId: string | null;
  inspectionType: string;
  checklistVersion: string;
  status: InspectionStatusValue;
  scheduledOn: string | null;
  startedAt: string | null;
  completedAt: string | null;
  overallResult: 'Pass' | 'Fail' | null;
  machineHours: string | null;
  fuelPercent: string | null;
  notes: string | null;
  holdReleasedBy: string | null;
  holdReleasedAt: string | null;
  holdReleaseReason: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  /** Present on the detail, results, patch, submit and release responses. */
  results?: InspectionResultDto[];
}

export interface InspectionFilters {
  status?: InspectionStatusValue;
  machineId?: string;
  bookingId?: string;
}

export interface InspectionAnswerInput {
  itemKey: string;
  result: 'Pass' | 'Fail' | 'N/A';
  notes?: string | null;
}

export interface InspectionPatchDto {
  machineHours?: string | number | null;
  fuelPercent?: string | number | null;
  notes?: string | null;
  start?: boolean;
}

export interface ReleaseHoldResultDto {
  inspection: InspectionDto;
  machine: { id: string; readinessStatus: string; released: boolean; blockers: string[] };
}

const passPath = (id: string) => `/gate-passes/${encodeURIComponent(id)}`;
const inspectionPath = (id: string) => `/inspections/${encodeURIComponent(id)}`;

/** `/api/v1/gate-passes` and `/api/v1/gate/resolve-qr`. Pending and Approved passes have no physical effect; `complete` records the movement. */
export const gateApi = {
  resolveQr: (payload: string, opts: Opts = {}) =>
    apiRequest<ResolveQrDto>('/gate/resolve-qr', { method: 'POST', body: { payload }, ...opts }),
  list: (params: ListParams & GatePassFilters = {}, opts: Opts = {}) =>
    apiRequest<PageResult<GatePassDto>>('/gate-passes', { query: params, ...opts }),
  get: (id: string, opts: Opts = {}) => apiRequest<GatePassDto>(passPath(id), opts),
  /** `submissionId` fixes the Idempotency-Key: reuse the same id when retrying one submission. */
  create: (body: GatePassCreateDto, submissionId: string, opts: Opts = {}) =>
    apiRequest<GatePassDto>('/gate-passes', { method: 'POST', body, submissionId, ...opts }),
  approve: (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<GatePassDto>(`${passPath(id)}/approve`, { method: 'POST', body: {}, rowVersion, ...opts }),
  cancel: (id: string, rowVersion: number, reason: string, opts: Opts = {}) =>
    apiRequest<GatePassDto>(`${passPath(id)}/cancel`, { method: 'POST', body: { reason }, rowVersion, ...opts }),
  complete: (id: string, submissionId: string, notes?: string | null, opts: Opts = {}) =>
    apiRequest<GateCompleteDto>(`${passPath(id)}/complete`, { method: 'POST', body: notes ? { notes } : {}, submissionId, ...opts }),
};

/** `/api/v1/inspections`: return-intake checklist, submit and hold release. Photos go through the documents evidence endpoint. */
export const inspectionsApi = {
  list: (params: ListParams & InspectionFilters = {}, opts: Opts = {}) =>
    apiRequest<PageResult<InspectionDto>>('/inspections', { query: params, ...opts }),
  get: (id: string, opts: Opts = {}) => apiRequest<InspectionDto>(inspectionPath(id), opts),
  saveResults: (id: string, rowVersion: number, results: InspectionAnswerInput[], opts: Opts = {}) =>
    apiRequest<InspectionDto>(`${inspectionPath(id)}/results`, { method: 'PATCH', body: { results }, rowVersion, ...opts }),
  update: (id: string, rowVersion: number, patch: InspectionPatchDto, opts: Opts = {}) =>
    apiRequest<InspectionDto>(inspectionPath(id), { method: 'PATCH', body: patch, rowVersion, ...opts }),
  submit: (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<InspectionDto>(`${inspectionPath(id)}/submit`, { method: 'POST', body: {}, rowVersion, ...opts }),
  releaseHold: (id: string, rowVersion: number, body: { reason: string; evidenceReviewed?: boolean }, opts: Opts = {}) =>
    apiRequest<ReleaseHoldResultDto>(`${inspectionPath(id)}/release-hold`, { method: 'POST', body, rowVersion, ...opts }),
};
