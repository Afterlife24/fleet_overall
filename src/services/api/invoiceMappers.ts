// Maps the invoice API shape to the browser `TaxInvoice` shape that the retained read-only screens use
// (customer links, collection references) and that the Invoice page renders. Numbers are parsed from decimal strings.
import type { TaxInvoice } from '@/types/taxinvoice';
import type { InvoiceDto } from './invoices';

const num = (s: string | null | undefined): number => {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function invoiceFromDto(dto: InvoiceDto, orgId: string): TaxInvoice {
  const eq = dto.lines.find((l) => l.lineType === 'EQUIPMENT');
  const tr = dto.lines.find((l) => l.lineType === 'TRANSPORT');
  const iss = dto.issuerSnapshot ?? {};
  const cus = dto.customerSnapshot ?? {};
  return {
    id: dto.id,
    orgId,
    quotationId: dto.quotationId,
    quotationNumber: dto.quotationNo,
    invoiceType: dto.invoiceType,
    periodStart: dto.periodStart,
    periodEnd: dto.periodEnd,
    sequence: dto.sequenceNo,
    hireAgreementId: dto.hireAgreementId,
    invoiceNo: dto.invoiceNo,
    invoiceDate: dto.invoiceDate,
    dueDate: dto.dueDate,
    currency: dto.currencyCode,
    status: dto.status,
    issuerName: str(iss.name),
    issuerAddress: str(iss.address),
    issuerPhone: str(iss.contact),
    issuerEmail: str(iss.email),
    issuerTradeLicense: str(iss.tradeLicense),
    issuerTrn: str(iss.taxRegistrationNo),
    // The browser's customer key is the business code (CUST-000123), not the uuid.
    customerId: str(cus.customerCode) || dto.customerId,
    customerName: str(cus.name),
    customerTrn: str(cus.taxRegistrationNo),
    attn: str(cus.attention),
    contactNumber: str(cus.contact),
    customerEmail: str(cus.email),
    billingAddress: str(cus.billingAddress) || str(cus.address),
    hireAgreementNo: dto.agreementNo,
    hirePeriod: dto.hirePeriodText,
    deliveryLocation: dto.deliveryLocation,
    paymentTerms: dto.paymentTerms,
    equipmentDescription: eq?.description ?? '',
    equipmentQty: num(eq?.quantity),
    equipmentRate: num(eq?.unitRate),
    equipmentAmount: num(eq?.amount),
    transportationQty: num(tr?.quantity),
    transportationRate: num(tr?.unitRate),
    transportationAmount: num(tr?.amount),
    subtotal: num(dto.subtotal),
    vat: num(dto.vatAmount),
    totalAmount: num(dto.totalAmount),
    paymentMethod: dto.paymentMethod,
    securityDeposit: num(dto.securityDeposit),
    amountDue: num(dto.amountDue),
    notes: dto.notes ?? '',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
