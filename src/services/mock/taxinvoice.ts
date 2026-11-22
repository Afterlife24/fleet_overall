import type { TaxInvoice, InvoiceStatus, InvoiceType } from '@/types/taxinvoice';
import { hireAgreements } from './hireagreement';

/**
 * Demo tax invoices, one per hire agreement HA-2026-001..004. HA-2026-005 (MNO) is billed by the
 * linked sample invoice QT-2026-0010/01 instead (see demoHireLink.ts), so it has no row here.
 * Continuous Hire rows bill the first month of the hire; the Off-Hire row is the final invoice of a
 * hire that has ended (invoice date = hire end date).
 *
 * Earlier text: Customer, equipment and
 * charge details are copied from the matching agreement so the two
 * plugins always agree with each other.
 */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUSES: InvoiceStatus[] = ['Sent', 'Paid', 'Overdue', 'Paid', 'Sent'];

/** Billing type per seed agreement (by agreement number). */
const TYPES: Record<string, InvoiceType> = {
  'HA-2026-001': 'Continuous Hire',
  'HA-2026-002': 'Continuous Hire',
  'HA-2026-003': 'Continuous Hire',
  'HA-2026-004': 'Off-Hire',
};

/** One month from `start` (day before the same day next month), capped at `end`. */
function monthEnd(start: string, end: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(d, dim)));
  next.setUTCDate(next.getUTCDate() - 1);
  const iso = next.toISOString().slice(0, 10);
  return iso > end ? end : iso;
}

export const taxInvoices: TaxInvoice[] = hireAgreements.filter((h) => TYPES[h.agreementNo]).map((h, i) => {
  const terms = parseInt(h.paymentTerms, 10) || 30;
  const invoiceType = TYPES[h.agreementNo];
  const periodStart = h.hireStartDate;
  const periodEnd = invoiceType === 'Off-Hire' ? h.hireEndDate : monthEnd(h.hireStartDate, h.hireEndDate);
  const invoiceDate = invoiceType === 'Off-Hire' ? h.hireEndDate : h.hireStartDate;
  const equipmentAmount = h.monthlyRental * 1;
  return {
    id: `inv-${i + 1}`,
    invoiceNo: `INV-2026-${String(i + 1).padStart(3, '0')}`,
    invoiceDate,
    dueDate: addDays(invoiceDate, terms),
    currency: 'AED',
    status: STATUSES[i % STATUSES.length],
    invoiceType,
    periodStart,
    periodEnd,
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
    hirePeriod: `${periodStart} – ${periodEnd}`,
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
