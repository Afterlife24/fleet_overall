import type { TaxInvoice, InvoiceStatus } from '@/types/taxinvoice';
import { hireAgreements } from './hireagreement';

/**
 * 5 demo tax invoices, one per hire agreement. Customer, equipment and
 * charge details are copied from the matching agreement so the two
 * plugins always agree with each other.
 */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUSES: InvoiceStatus[] = ['Sent', 'Paid', 'Overdue', 'Draft', 'Sent'];

export const taxInvoices: TaxInvoice[] = hireAgreements.map((h, i) => {
  const terms = parseInt(h.paymentTerms, 10) || 30;
  const invoiceDate = h.hireStartDate;
  const equipmentAmount = h.monthlyRental * 1;
  return {
    id: `inv-${i + 1}`,
    invoiceNo: `INV-2026-${String(i + 1).padStart(3, '0')}`,
    invoiceDate,
    dueDate: addDays(invoiceDate, terms),
    currency: 'AED',
    status: STATUSES[i % STATUSES.length],
    issuerName: h.lessorName,
    issuerAddress: h.lessorAddress,
    issuerPhone: h.lessorPhone,
    issuerEmail: h.lessorEmail,
    issuerTradeLicense: h.lessorTradeLicense,
    issuerTrn: h.lessorTrn,
    customerId: h.customerId,
    customerName: h.customerName,
    customerTrn: h.customerTrn,
    attn: h.attn,
    contactNumber: h.contactNumber,
    customerEmail: h.customerEmail,
    billingAddress: h.billingAddress,
    hireAgreementNo: h.agreementNo,
    hirePeriod: `${h.hireStartDate} – ${h.hireEndDate}`,
    deliveryLocation: h.deliveryLocation,
    paymentTerms: h.paymentTerms,
    equipmentDescription: `${h.equipmentModel} ${h.equipmentName} – Monthly Hire | Serial: ${h.serialNumber} | Working height: ${h.workingHeight} | Capacity: ${h.capacity}`,
    equipmentQty: 1,
    equipmentRate: h.monthlyRental,
    equipmentAmount,
    transportationQty: 1,
    transportationRate: h.transportationCharges,
    transportationAmount: h.transportationCharges,
    subtotal: h.subtotal,
    vat: h.vat,
    totalAmount: h.totalAmount,
    paymentMethod: h.paymentMethod,
    securityDeposit: h.securityDeposit,
    amountDue: h.totalAmount,
    notes: `Please mention invoice number INV-2026-${String(i + 1).padStart(3, '0')} when making payment. This invoice covers the equipment hire and transportation charges listed above.`,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
});

export function getTaxInvoiceById(id: string): TaxInvoice | undefined {
  return taxInvoices.find((t) => t.id === id);
}
