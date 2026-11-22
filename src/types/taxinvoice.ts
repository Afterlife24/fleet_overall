export type InvoiceStatus = 'Draft' | 'Sent' | 'Paid' | 'Overdue' | 'Cancelled';

export type InvoiceType = 'Continuous Hire' | 'Off-Hire';

export interface TaxInvoice {
  id: string;
  // Quotation link (all optional; undefined quotationId = legacy invoice)
  orgId?: string;
  quotationId?: string;
  quotationNumber?: string;
  invoiceType?: InvoiceType;
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string; // YYYY-MM-DD
  sequence?: number; // 1..99
  hireAgreementId?: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  status: InvoiceStatus;
  // Issuer (company)
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerEmail: string;
  issuerTradeLicense: string;
  issuerTrn: string;
  // Customer (Bill To)
  customerId: string;
  customerName: string;
  customerTrn: string;
  attn: string;
  contactNumber: string;
  customerEmail: string;
  billingAddress: string;
  // Invoice Details
  hireAgreementNo: string;
  hirePeriod: string;
  deliveryLocation: string;
  paymentTerms: string;
  // Items
  equipmentDescription: string;
  equipmentQty: number;
  equipmentRate: number;
  equipmentAmount: number;
  transportationQty: number;
  transportationRate: number;
  transportationAmount: number;
  // Totals
  subtotal: number;
  vat: number;
  totalAmount: number;
  // Payment
  paymentMethod: string;
  securityDeposit: number;
  amountDue: number;
  // Notes
  notes: string;
  createdAt: string;
  updatedAt: string;
}
