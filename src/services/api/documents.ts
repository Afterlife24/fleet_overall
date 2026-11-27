import type { PageDto } from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { collectionApi, type ListParams } from './resource';

type Opts = Pick<ApiRequestOptions, 'signal'>;

export type ReportPhase = 'HIRE' | 'COLLECTION';
export type DocumentTypeCode =
  | 'QUOTATION' | 'HIRE_AGREEMENT' | 'LPO' | 'INVOICE' | 'DN' | 'CN' | 'HMQD' | 'MQD' | 'HTPS' | 'TPS' | 'GATE_PASS' | 'INSPECTION';
export type DocumentOwnerType =
  | 'quotation' | 'hire_agreement' | 'customer_lpo' | 'invoice' | 'delivery_note' | 'collection_note'
  | 'mqd_report' | 'service_report' | 'gate_pass' | 'inspection';
export type EvidenceOwnerType = 'mqd_report' | 'inspection' | 'inspection_result' | 'gate_pass';
export type ServiceType = 'Transport' | 'Crane' | 'Escort' | 'Inspection' | 'Cleaning' | 'Other';

// ---- Delivery notes
export interface DeliveryNoteDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  noteDate: string;
  deliveryAddress: string;
  deliveredAt: string | null;
  receivedByName: string | null;
  driverName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}
export interface DeliveryNoteCreateDto {
  bookingId: string;
  noteDate?: string;
  /** Defaults to the booking's delivery address. */
  deliveryAddress?: string;
  deliveredAt?: string | null;
  receivedByName?: string | null;
  driverName?: string | null;
  notes?: string | null;
}
export interface DeliveryNoteUpdateDto {
  deliveredAt?: string | null;
  receivedByName?: string | null;
  driverName?: string | null;
  notes?: string | null;
}
export interface DeliveryNoteFilters { bookingId?: string }

/** `/api/v1/delivery-notes`: one per booking (a second create is 409 DUPLICATE). */
export const deliveryNotesApi = collectionApi<DeliveryNoteDto, DeliveryNoteCreateDto, DeliveryNoteUpdateDto, DeliveryNoteFilters>('/delivery-notes');

// ---- MQD reports
export interface MqdReportDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  collectionNoteId: string | null;
  phase: ReportPhase;
  reportDate: string;
  hirerName: string;
  formSchemaVersion: string;
  fields: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}
export interface MqdReportCreateDto {
  bookingId: string;
  phase: ReportPhase;
  /** Required for COLLECTION, not allowed for HIRE. */
  collectionNoteId?: string | null;
  reportDate?: string;
  hirerName: string;
  formSchemaVersion: string;
  fields: Record<string, unknown>;
  notes?: string | null;
}
export interface MqdReportUpdateDto {
  fields?: Record<string, unknown>;
  notes?: string | null;
  hirerName?: string;
  reportDate?: string;
  formSchemaVersion?: string;
}
export interface ReportFilters { bookingId?: string; phase?: ReportPhase; collectionNoteId?: string }

/** `/api/v1/mqd-reports`: HIRE gets an HMQD number, COLLECTION an MQD number. */
export const mqdReportsApi = collectionApi<MqdReportDto, MqdReportCreateDto, MqdReportUpdateDto, ReportFilters>('/mqd-reports');

// ---- Third-party service reports
export interface ServiceLineDto {
  id: string;
  lineNo: number;
  provider: string;
  serviceType: ServiceType;
  description: string;
  serviceDate: string;
  externalReference: string;
  quantity: string;
  rate: string;
  amount: string;
}
export interface ServiceLineInputDto {
  provider: string;
  serviceType: ServiceType;
  description: string;
  serviceDate: string;
  externalReference?: string;
  quantity: string | number;
  rate: string | number;
}
export interface ServiceReportDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  collectionNoteId: string | null;
  phase: ReportPhase;
  currencyCode: string;
  notes: string | null;
  approvedBy: string | null;
  approvedName: string | null;
  signatureText: string | null;
  totalAmount: string;
  lines: ServiceLineDto[];
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}
export interface ServiceReportCreateDto {
  bookingId: string;
  phase: ReportPhase;
  collectionNoteId?: string | null;
  currencyCode?: string;
  notes?: string | null;
  approvedName?: string | null;
  signatureText?: string | null;
  lines?: ServiceLineInputDto[];
}
export interface ServiceReportUpdateDto {
  currencyCode?: string;
  notes?: string | null;
  approvedName?: string | null;
  signatureText?: string | null;
  /** Replaces all lines. Amounts and the total are computed by the server. */
  lines?: ServiceLineInputDto[];
}

/** `/api/v1/service-reports`: HIRE gets an HTPS number, COLLECTION a TPS number. */
export const serviceReportsApi = collectionApi<ServiceReportDto, ServiceReportCreateDto, ServiceReportUpdateDto, ReportFilters>('/service-reports');

// ---- Documents
export interface DocumentFileDto {
  id: string;
  fileId: string;
  fileRole: 'Generated PDF' | 'Signed Copy' | 'Original';
  active: boolean;
  uploadedBy: string;
  attachedAt: string;
  replacedAt: string | null;
  replacementReason: string | null;
  originalName: string;
  detectedMime: string | null;
  byteSize: number | null;
  sha256: string | null;
}
export interface DocumentVersionDto {
  id: string;
  versionNo: number;
  templateVersion: string;
  snapshotSchemaVersion: string;
  snapshotHash: string;
  generationStatus: 'Pending' | 'Generated' | 'Failed' | 'Uploaded Original';
  generatedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  /** Only on `documentsApi.get`. */
  dataSnapshot?: Record<string, unknown>;
  files: DocumentFileDto[];
}
export interface DocumentDto {
  id: string;
  documentType: DocumentTypeCode;
  documentNo: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  currentVersionId: string | null;
  status: 'Active' | 'Archived';
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  versions: DocumentVersionDto[];
}
export interface DocumentGenerateDto {
  documentType: DocumentTypeCode;
  ownerId: string;
  templateVersion: string;
  snapshotSchemaVersion: string;
  dataSnapshot: Record<string, unknown>;
  /** The verified PDF of the rendered bytes (uploaded through `filesApi`). Omit with `error` to record a failed render. */
  fileId?: string;
  error?: { code: string; message: string };
}
export interface DocumentAttachFileDto {
  fileId: string;
  fileRole: 'Signed Copy' | 'Original';
  /** Required when an active file of the same role is replaced. */
  replacementReason?: string;
}

/** `/api/v1/documents`. Generate and attach need a `submissionId` so a retry reuses the same Idempotency-Key. */
export const documentsApi = {
  listForOwner: (ownerType: DocumentOwnerType, ownerId: string, opts: Opts = {}) =>
    apiRequest<{ items: DocumentDto[]; total: number }>('/documents', { query: { ownerType, ownerId }, ...opts }),
  get: (id: string, opts: Opts = {}) => apiRequest<DocumentDto>(`/documents/${encodeURIComponent(id)}`, opts),
  generate: (body: DocumentGenerateDto, submissionId: string, opts: Opts = {}) =>
    apiRequest<DocumentDto>('/documents/generate', { method: 'POST', body, submissionId, ...opts }),
  attachFile: (documentId: string, versionId: string, body: DocumentAttachFileDto, submissionId: string, opts: Opts = {}) =>
    apiRequest<DocumentDto>(
      `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/files`,
      { method: 'POST', body, submissionId, ...opts },
    ),
};

// ---- Evidence
export interface EvidenceDto {
  id: string;
  fileId: string;
  ownerType: EvidenceOwnerType;
  ownerId: string;
  photoRole: string;
  caption: string | null;
  capturedAt: string | null;
  displayOrder: number;
  createdAt: string;
  originalName: string;
  detectedMime: string | null;
  byteSize: number | null;
}
/** Exactly one owner id must be set. */
export interface EvidenceCreateDto {
  fileId: string;
  mqdReportId?: string;
  inspectionId?: string;
  inspectionResultId?: string;
  gatePassId?: string;
  photoRole: string;
  caption?: string | null;
  capturedAt?: string;
  displayOrder?: number;
}

/** `/api/v1/evidence`: image evidence attached by file id. */
export const evidenceApi = {
  list: (ownerType: EvidenceOwnerType, ownerId: string, opts: Opts = {}) =>
    apiRequest<{ items: EvidenceDto[]; total: number }>('/evidence', { query: { ownerType, ownerId }, ...opts }),
  create: (body: EvidenceCreateDto, submissionId: string, opts: Opts = {}) =>
    apiRequest<EvidenceDto>('/evidence', { method: 'POST', body, submissionId, ...opts }),
};

export type { ListParams, PageDto };
