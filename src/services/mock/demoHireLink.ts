// Demo data for the Hire Agreement <-> Planner <-> Fleet <-> CRM link.
// Built on the existing seeds: the five demo hire agreements (ha-seed-<org>-1..5),
// the CRM quotations in ./quotations.ts and the demo machines mc-1..mc-5.
// Johnson Arabia (org-ja) uses its own machines mc-1..mc-5. Any other company gets
// copies of those five machines (mc-demo-1..5) the first time it activates CRM,
// Planner or Quotation (see src/services/demoSeed.ts).
import type { Booking, BookingStatus } from '@/types/booking';
import type { Machine, MachineStatus } from '@/types/machine';
import type { Quotation } from '@/types/quotation';
import type { TaxInvoice } from '@/types/taxinvoice';
import { buildInvoiceDraft, formatInvoiceNo, type AgreementLite, type InvoicingSnapshot, type QuotationLite } from '@/services/invoiceRulesCore';
import { machines } from './machines';
import { seedQuotations } from './quotations';
import { hireAgreements as seedAgreements } from './hireagreement';

export const DEMO_ORG_ID = 'org-ja';

/** Seed agreement n (1..5) -> seed CRM quotation id (see quotations.ts). */
export const DEMO_AGREEMENT_QUOTATION: Record<number, string> = {
  1: 'qt-seed-3',  // ABC Company LLC  - quotation Awaiting -> Won when machine goes On Hire
  2: 'qt-seed-4',  // DEF Company LLC  - quotation Tender   -> Won when machine goes On Hire
  3: 'qt-seed-8',  // GHI Company PJSC - quotation Awaiting, booking starts next week
  4: 'qt-seed-9',  // JKL Company LLC  - quotation Lost, stays Lost (warning shown)
  5: 'qt-seed-10', // MNO Company LLC  - quotation Won, machine already On Hire
};

export const demoAgreementId = (n: number, orgId: string = DEMO_ORG_ID) => `ha-seed-${orgId}-${n}`;

/** Org-specific id of a seed quotation (org-ja keeps the original ids). */
export function demoQuotationId(orgId: string, seedId: string): string {
  return orgId === DEMO_ORG_ID ? seedId : seedId.replace(/^qt-seed-/, `qt-${orgId}-seed-`);
}

/** Quotation id for a seeded agreement id (ha-seed-<org>-<n>), or '' when it is not a demo agreement. */
export function demoQuotationForAgreement(agreementId: string): string {
  const m = /^ha-seed-(.+)-(\d+)$/.exec(agreementId);
  if (!m) return '';
  const seedId = DEMO_AGREEMENT_QUOTATION[Number(m[2])];
  return seedId ? demoQuotationId(m[1], seedId) : '';
}

/** Seed quotations copied for another company (ids, history ids and orgId changed). */
export function demoQuotationsForOrg(orgId: string): Quotation[] {
  if (orgId === DEMO_ORG_ID) return seedQuotations;
  return seedQuotations.map((q) => ({
    ...q,
    id: demoQuotationId(orgId, q.id),
    orgId,
    history: q.history.map((h) => ({ ...h, id: `${orgId}-${h.id}` })),
  }));
}

function localDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface DemoSpec {
  n: number; // agreement number 1..5
  customerName: string;
  startOffset: number;
  endOffset: number;
  status: BookingStatus;
  dailyRate: number;
  site: string;
}

const SPECS: DemoSpec[] = [
  { n: 1, customerName: 'ABC Company LLC',  startOffset: -1,  endOffset: 29, status: 'Allocated', dailyRate: 650, site: 'Dubai Marina - Site 12' },
  { n: 2, customerName: 'DEF Company LLC',  startOffset: 0,   endOffset: 30, status: 'Allocated', dailyRate: 420, site: 'Downtown Dubai - Tower A' },
  { n: 3, customerName: 'GHI Company PJSC', startOffset: 7,   endOffset: 37, status: 'Allocated', dailyRate: 780, site: 'Yas Island - Plot 7' },
  { n: 4, customerName: 'JKL Company LLC',  startOffset: -1,  endOffset: 20, status: 'Allocated', dailyRate: 540, site: 'Mussafah - Zone M4' },
  { n: 5, customerName: 'MNO Company LLC',  startOffset: -10, endOffset: 20, status: 'On Hire',   dailyRate: 910, site: 'Sharjah Industrial Area 12' },
];

/** Machine id used by demo booking n in a company. */
export const demoMachineId = (orgId: string, n: number) => (orgId === DEMO_ORG_ID ? `mc-${n}` : `mc-demo-${n}`);

/** Copies of machines mc-1..mc-5 for a company other than org-ja. */
export function demoMachinesForOrg(orgId: string): Machine[] {
  if (orgId === DEMO_ORG_ID) return [];
  return SPECS.map((s) => {
    const src = machines.find((m) => m.id === `mc-${s.n}`) ?? machines[s.n - 1];
    return {
      ...src,
      id: demoMachineId(orgId, s.n),
      branchId: 'br-dxb',
      // Gate OUT needs an Available machine; the last one is already out on hire.
      status: (s.status === 'On Hire' ? 'On Hire' : 'Available') as MachineStatus,
      currentCustomer: s.status === 'On Hire' ? s.customerName : undefined,
    } as Machine;
  });
}

function days(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
}

/** The five linked demo bookings of a company. */
export function demoBookingsForOrg(orgId: string): Booking[] {
  return SPECS.map((s) => {
    const machineId = demoMachineId(orgId, s.n);
    const m = machines.find((x) => x.id === `mc-${s.n}`);
    const startDate = localDay(s.startOffset);
    const endDate = localDay(s.endOffset);
    const now = new Date().toISOString();
    return {
      id: orgId === DEMO_ORG_ID ? `bk-demo-${s.n}` : `bk-demo-${orgId}-${s.n}`,
      reference: `BK-DEMO-000${s.n}`,
      orgId,
      hireAgreementId: demoAgreementId(s.n, orgId),
      customerId: `cu-${s.n}`,
      customerName: s.customerName,
      machineId,
      assetNumber: m?.assetNumber ?? machineId,
      machineModel: m ? `${m.make} ${m.model}` : '',
      branchId: 'br-dxb',
      branchName: 'Dubai',
      startDate,
      endDate,
      status: s.status,
      deliveryAddress: s.site,
      contactPhone: '+971 50 123 4567',
      operatorRequired: false,
      dailyRate: s.dailyRate,
      totalValue: s.dailyRate * days(startDate, endDate),
      notes: 'Demo booking linked to a hire agreement',
      period: 'Monthly',
      time: 'AM',
      quoted: true,
      haSent: true,
      haReceived: true,
      lpoNumber: `LPO-DEMO-${s.n}`,
      lpoValidityDate: localDay(60),
      salesRep: 'AD',
      paymentTerms: '30',
      createdAt: now,
      updatedAt: now,
    } as unknown as Booking;
  });
}

/** Johnson Arabia demo bookings (kept for the bookingStore initial state and migration). */
export const demoBookings: Booking[] = demoBookingsForOrg(DEMO_ORG_ID);

/** Johnson Arabia machine statuses: Gate OUT is available for mc-1..mc-4, mc-5 is On Hire. */
export const demoMachineOverrides: Array<{ machineId: string; status: MachineStatus; updatedAt: string; reason: string; bookingId: string }> =
  SPECS.map((s) => ({
    machineId: `mc-${s.n}`,
    status: (s.status === 'On Hire' ? 'On Hire' : 'PDI') as MachineStatus,
    updatedAt: new Date().toISOString(),
    reason: s.status === 'On Hire' ? 'Demo: already on hire' : 'Demo: PDI done, ready for Gate OUT',
    bookingId: `bk-demo-${s.n}`,
  }));
/** Sample billing period of the demo invoice (inside the HA-2026-005 hire dates). */
const DEMO_INVOICE_PERIOD = { start: '2026-11-14', end: '2026-11-30' };

/**
 * Sample Continuous Hire invoice (QT-2026-0010/01) for the Won demo quotation, billed from the
 * seed agreement HA-2026-005. Returns the draft without id/timestamps, or null when a seed is missing.
 * Pure: reads seed data only, no stores.
 */
export function demoInvoiceForQuotation(
  orgId: string,
): Omit<TaxInvoice, 'id' | 'createdAt' | 'updatedAt'> | null {
  const ha = seedAgreements.find((a) => a.agreementNo === 'HA-2026-005');
  const seedQ = seedQuotations.find((q) => q.id === DEMO_AGREEMENT_QUOTATION[5]);
  if (!ha || !seedQ) return null;
  const quotation: QuotationLite = {
    id: demoQuotationId(orgId, seedQ.id), orgId, number: seedQ.number, phase: seedQ.phase,
    customerName: seedQ.customerName, customerId: seedQ.customerId, amount: seedQ.amount,
  };
  const agreement: AgreementLite = {
    ...ha, id: demoAgreementId(5, orgId), orgId, quotationId: quotation.id,
  };
  const snapshot: InvoicingSnapshot = {
    orgId, today: DEMO_INVOICE_PERIOD.end, crmActive: true,
    quotations: [quotation], agreements: [agreement], invoices: [], sequenceByQuotation: {},
  };
  const draft = buildInvoiceDraft(
    {
      quotation, agreement, invoiceType: 'Continuous Hire',
      periodStart: DEMO_INVOICE_PERIOD.start, periodEnd: DEMO_INVOICE_PERIOD.end,
      sequence: 1, invoiceNo: formatInvoiceNo(quotation.number, 1),
    },
    snapshot,
  );
  return { ...draft, status: 'Sent' };
}