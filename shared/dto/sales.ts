// Quotation, hire agreement and customer LPO contracts (Requirements 12 to 14). Money is a decimal string.
export const QUOTATION_PHASES = ['AWAITING', 'TENDER', 'LOST', 'WON'] as const;
export type QuotationPhase = (typeof QUOTATION_PHASES)[number];
export const AGREEMENT_STATUS_VALUES = ['Draft', 'Active', 'Completed', 'Cancelled'] as const;
export type AgreementStatusValue = (typeof AGREEMENT_STATUS_VALUES)[number];

export interface QuotationDto {
  id: string;
  branchId: string | null;
  customerId: string;
  quotationNo: string;
  opportunity: string;
  email: string | null;
  crmHaReference: string | null;
  amount: string;
  currencyCode: string;
  phase: QuotationPhase;
  salesUserId: string | null;
  validUntil: string | null;
  lostReason: string | null;
  lostAt: string | null;
  lostBy: string | null;
  wonAt: string | null;
  notes: string | null;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** `POST /api/v1/quotations` (requires `Idempotency-Key`). */
export interface QuotationCreateDto {
  customerId: string;
  opportunity: string;
  email?: string | null;
  crmHaReference?: string | null;
  amount: string | number;
  currencyCode?: string;
  branchId?: string | null;
  salesUserId?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  customAttributes?: Record<string, unknown>;
}

/** `PATCH /api/v1/quotations/:id` (requires `If-Match`). */
export type QuotationUpdateDto = Partial<QuotationCreateDto>;

export interface QuotationPhaseChangeDto {
  toPhase: QuotationPhase;
  reason?: string;
}

export interface PhaseHistoryDto {
  id: string;
  quotationId: string;
  fromPhase: QuotationPhase | null;
  toPhase: QuotationPhase;
  actorUserId: string | null;
  reason: string | null;
  source: string;
  occurredAt: string;
}

export interface HireAgreementDto {
  id: string;
  quotationId: string;
  customerId: string;
  agreementNo: string;
  agreementDate: string;
  status: AgreementStatusValue;
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  equipmentName: string;
  equipmentModel: string;
  serialNumber: string;
  quantity: number;
  capacity: string;
  workingHeight: string;
  deliveryLocation: string;
  hireStartDate: string;
  hireEndDate: string;
  hireDuration: string;
  monthlyRental: string;
  transportationCharges: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  paymentTerms: string;
  paymentTermDays: number;
  securityDeposit: string;
  paymentMethod: string;
  sentAt: string | null;
  receivedAt: string | null;
  crmHaReference: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** `POST /api/v1/hire-agreements` (requires `Idempotency-Key`). Totals and snapshots are computed by the server. */
export interface HireAgreementCreateDto {
  quotationId: string;
  customerId: string;
  agreementDate?: string;
  status?: AgreementStatusValue;
  equipmentName: string;
  equipmentModel: string;
  serialNumber: string;
  quantity?: number;
  capacity?: string;
  workingHeight?: string;
  deliveryLocation: string;
  hireStartDate: string;
  hireEndDate: string;
  hireDuration?: string;
  monthlyRental: string | number;
  transportationCharges?: string | number;
  paymentTerms: string;
  paymentTermDays?: number;
  securityDeposit?: string | number;
  paymentMethod: string;
}

/** `PATCH /api/v1/hire-agreements/:id` (requires `If-Match`). */
export type HireAgreementUpdateDto = Partial<Omit<HireAgreementCreateDto, 'quotationId' | 'customerId'>>;

export interface CustomerLpoDto {
  id: string;
  quotationId: string;
  hireAgreementId: string | null;
  customerId: string;
  lpoNo: string;
  receivedOn: string;
  validUntil: string | null;
  amount: string | null;
  currencyCode: string;
  fileId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** `POST /api/v1/customer-lpos` (requires `Idempotency-Key`). */
export interface CustomerLpoCreateDto {
  quotationId: string;
  customerId: string;
  hireAgreementId?: string | null;
  lpoNo: string;
  receivedOn: string;
  validUntil?: string | null;
  amount?: string | number | null;
  currencyCode?: string;
  fileId?: string | null;
  notes?: string | null;
}

/** `PATCH /api/v1/customer-lpos/:id` (requires `If-Match`). */
export type CustomerLpoUpdateDto = Partial<Omit<CustomerLpoCreateDto, 'quotationId' | 'customerId'>>;
