export type DocType = 'CN' | 'MQD' | 'TPS';
export type CollectionStatus = 'Draft' | 'Scheduled' | 'Picked Up' | 'Collected' | 'Closed' | 'Cancelled';
export type ReportPhase = 'HIRE' | 'COLLECTION';
export type SignedStatus = 'Pending' | 'Signed';
export type ServiceType = 'Transport' | 'Crane' | 'Escort' | 'Inspection' | 'Cleaning' | 'Other';
export const SERVICE_TYPES: readonly ServiceType[] =
  ['Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other'];

export type MissingLink = 'BOOKING' | 'AGREEMENT' | 'QUOTATION' | 'INVOICE';

export interface ReferenceFields {
  machineId: string;
  fleetNo: string;
  machineDescription: string;        // "<make> <model>"
  serialNumber: string;
  customerName: string;
  customerId: string;
  bookingId: string;
  bookingRef: string;
  hireAgreementId: string;
  hireAgreementNo: string;
  quotationId: string;
  quotationNo: string;
  invoiceId: string;
  invoiceNo: string;
  site: string;
  missing: MissingLink[];            // links that could not be resolved
  refNotes: string[];                // human text for each missing link
}

export interface SignedFileRef {
  key: string;
  name: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

interface DocBase extends ReferenceFields {
  id: string;
  orgId: string;
  number: string;                    // CN-2026-0001
  cnId?: string;
  mqdId?: string;
  tpsId?: string;                    // ids of the set created together
  signedStatus: SignedStatus;
  signedFile?: SignedFileRef;
  createdAt: string;
  updatedAt: string;
  /** Server row version (If-Match). Absent on rows that were not read from the API. */
  rowVersion?: number;
}

export interface CollectionNote extends DocBase {
  status: CollectionStatus;
  date: string;
  collectionAddress: string;
  driver: string;
  vehicle: string;
  remarks: string;
  /** Gate_Record id that collected this note (set by Gate-In). */
  collectedByGateId?: string;
  /** Gate_Record reference, e.g. 'GP-0421'. */
  collectedByGateRef?: string;
  /** Gate_Record timestamp, ISO UTC. */
  collectedAt?: string;
  scheduledCollectionAt?: string;
  pickedUpAt?: string;
  relatedInvoiceId?: string;
}

export interface MqdRecord extends DocBase {
  date: string;
  hirer: string;
  fields: Record<string, string>;
  photoKeys: string[];
  phase?: ReportPhase;
}

export interface ServiceLine {
  id: string;
  provider: string;
  serviceType: ServiceType;
  description: string;
  date: string;
  reference: string;
  quantity: number;
  rate: number;
}

export interface TpsDocument extends DocBase {
  lines: ServiceLine[];
  notes: string;
  approvedBy: string;
  signature: string;
  phase?: ReportPhase;
  currencyCode?: string;
}

