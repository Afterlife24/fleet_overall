// Machine model, machine and machine document contracts (Requirement 11). Measures and hours are decimal strings.
export const OPERATIONAL_STATUSES = [
  'Available', 'Allocated', 'On Hire', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Transport', 'Breakdown', 'Offline',
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];
export const READINESS_STATUSES = ['READY', 'INTAKE_PENDING', 'BLOCKED'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];
/** Only settable through `POST /machines/:id/operational-status` with a reason. */
export const RESERVED_OPERATIONAL_STATUSES = ['Allocated', 'On Hire', 'Transport'] as const;
export const MACHINE_DOCUMENT_TYPES = ['Registration', 'Insurance', 'Certificate', 'Manual', 'Permit'] as const;
export type MachineDocumentType = (typeof MACHINE_DOCUMENT_TYPES)[number];

export interface MachineModelDto {
  id: string;
  make: string;
  model: string;
  category: string;
  powerSource: string | null;
  platformHeightM: string | null;
  workingHeightM: string | null;
  capacityKg: string | null;
  specifications: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface MachineDto {
  id: string;
  branchId: string;
  modelId: string;
  assetNo: string;
  fleetNo: string;
  serialNo: string;
  manufactureYear: number | null;
  powerSource: string | null;
  platformHeightM: string | null;
  workingHeightM: string | null;
  capacityKg: string | null;
  hoursOperated: string;
  operationalStatus: OperationalStatus;
  readinessStatus: ReadinessStatus;
  currentLocation: string;
  lastInspectionOn: string | null;
  nextInspectionOn: string | null;
  nextPhiOn: string | null;
  nextMandatoryOn: string | null;
  tpcExpiresOn: string | null;
  tpcSupplier: string | null;
  active: boolean;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface MachineDocumentDto {
  id: string;
  machineId: string;
  fileId: string;
  name: string;
  documentType: MachineDocumentType;
  uploadedAt: string;
  expiresOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** `POST /api/v1/machines/:id/operational-status` (requires `If-Match`; audited with the reason). */
export interface MachineManualStatusDto {
  operationalStatus: OperationalStatus;
  reason: string;
}
