import type { PageDto } from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { collectionApi } from './resource';

export type InvoiceStatusValue = 'Draft' | 'Sent' | 'Paid' | 'Overdue' | 'Cancelled';
export type InvoiceTypeValue = 'Continuous Hire' | 'Off-Hire';
export type ReportedPaymentStatus = 'Paid' | 'Overdue' | 'Sent';

export interface InvoiceLineDto {
  lineNo: number;
  lineType: 'EQUIPMENT' | 'TRANSPORT';
  description: string;
  quantity: string;
  unitRate: string;
  amount: string;
}

export interface InvoiceDto {
  id: string;
  quotationId: string;
  hireAgreementId: string;
  customerId: string;
  invoiceNo: string;
  quotationNo: string;
  agreementNo: string;
  sequenceNo: number;
  invoiceType: InvoiceTypeValue;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  status: InvoiceStatusValue;
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  hirePeriodText: string;
  deliveryLocation: string;
  paymentTerms: string;
  paymentTermDays: number;
  paymentMethod: string;
  securityDeposit: string;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  amountDue: string;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  notes: string | null;
  lines: InvoiceLineDto[];
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface InvoiceEquipmentInput { quantity: string; unitRate: string; amount: string }
export interface InvoiceTransportInput { amount: string }

/** Totals sent by a client are ignored; the server recomputes subtotal, VAT, total and amount due. */
export interface InvoiceCreateDto {
  quotationId: string;
  hireAgreementId: string;
  invoiceType: InvoiceTypeValue;
  periodStart: string;
  /** Required for Continuous Hire; for Off-Hire omit it or send the agreement end date. */
  periodEnd?: string;
  invoiceDate?: string;
  equipment: InvoiceEquipmentInput;
  /** Must be true: the period charge is entered by the employee, never prorated automatically. */
  periodChargeConfirmed: true;
  transport?: InvoiceTransportInput;
  /** Needed for a transport amount above 0 after the first active invoice (requires invoices.transport_repeat). */
  repeatTransportConfirmed?: boolean;
  notes?: string | null;
}

/** Financial fields are accepted for Draft invoices only; notes can always be edited. */
export interface InvoiceUpdateDto {
  equipment?: Partial<InvoiceEquipmentInput>;
  periodChargeConfirmed?: boolean;
  transport?: InvoiceTransportInput | null;
  repeatTransportConfirmed?: boolean;
  invoiceDate?: string;
  notes?: string | null;
}

export interface InvoiceFilters {
  quotationId?: string;
  customerId?: string;
  hireAgreementId?: string;
  status?: InvoiceStatusValue;
}

export interface InvoicePrefillDto {
  quotationId: string;
  hireAgreementId: string;
  agreementNo: string;
  invoiceType: InvoiceTypeValue;
  periodStart: string;
  /** Off-Hire: the agreement end (read-only). Continuous Hire: null, entered by the employee. */
  periodEnd: string | null;
  suggestedPeriodEnd: string;
  hireStartDate: string;
  hireEndDate: string;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  paymentTerms: string;
  paymentMethod: string;
  deliveryLocation: string;
  securityDeposit: string;
  currencyCode: string;
  vatRate: string;
  equipment: { description: string; quantity: string; unitRate: string; amount: string };
  transport: { description: string; amount: string; repeatRequiresConfirmation: boolean };
  issuerSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
}

export interface InvoicePaymentStatusDto {
  status: ReportedPaymentStatus;
  amountDue: string;
  reason: string;
}

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** `/api/v1/invoices`. Totals, numbers and snapshots are computed by the server. */
export const invoicesApi = {
  ...collectionApi<InvoiceDto, InvoiceCreateDto, InvoiceUpdateDto, InvoiceFilters>('/invoices'),
  prefill: (quotationId: string, type: InvoiceTypeValue, opts: Opts = {}) =>
    apiRequest<InvoicePrefillDto>(`/quotations/${encodeURIComponent(quotationId)}/invoice-prefill`, { query: { type }, ...opts }),
  issue: (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<InvoiceDto>(`/invoices/${encodeURIComponent(id)}/issue`, { method: 'POST', body: {}, rowVersion, ...opts }),
  cancel: (id: string, rowVersion: number, reason: string, opts: Opts = {}) =>
    apiRequest<InvoiceDto>(`/invoices/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, rowVersion, ...opts }),
  reportPaymentStatus: (id: string, rowVersion: number, body: InvoicePaymentStatusDto, opts: Opts = {}) =>
    apiRequest<InvoiceDto>(`/invoices/${encodeURIComponent(id)}/payment-status`, { method: 'POST', body, rowVersion, ...opts }),
};

export type InvoicePage = PageDto<InvoiceDto>;
