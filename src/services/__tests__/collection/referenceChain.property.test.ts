import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  resolveReferences,
  type AgreementLite,
  type BookingLite,
  type InvoiceLite,
  type MachineLite,
  type QuotationLite,
  type RefSnapshot,
} from '../../collectionCore';
import type { MissingLink } from '@/types/collection';

// Feature: offhire-collection-docs, Property 11: Reference chain resolution
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

const ORG = 'org-1';
const MACHINE: MachineLite = {
  id: 'm-1',
  orgId: ORG,
  fleetNo: 'F-1',
  assetNumber: 'A-1',
  make: 'Liebherr',
  model: 'LTM',
  serialNumber: 'SN1',
};

const day = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const ACTIVE = ['On Hire', 'Allocated'];

interface Scenario {
  bookings: { status: string; day: number; agIdx: number | undefined }[];
  agreements: { qIdx: number | undefined }[];
  quotationCount: number;
  invoices: {
    kind: 'q' | 'aId' | 'aNo' | 'none';
    idx: number;
    cancelled: boolean;
    seqBase: number;
  }[];
  noiseBooking: boolean;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  bookings: fc.array(
    fc.record({
      status: fc.constantFrom('On Hire', 'Allocated', 'Confirmed', 'Completed', 'Pending'),
      day: fc.integer({ min: 0, max: 40 }),
      agIdx: fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }), // may dangle
    }),
    { maxLength: 4 },
  ),
  agreements: fc.array(
    fc.record({ qIdx: fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }) }), // may dangle
    { maxLength: 3 },
  ),
  quotationCount: fc.integer({ min: 0, max: 3 }),
  invoices: fc.array(
    fc.record({
      kind: fc.constantFrom('q', 'aId', 'aNo', 'none') as fc.Arbitrary<
        'q' | 'aId' | 'aNo' | 'none'
      >,
      idx: fc.integer({ min: 0, max: 3 }),
      cancelled: fc.boolean(),
      seqBase: fc.integer({ min: 0, max: 20 }),
    }),
    { maxLength: 7 },
  ),
  noiseBooking: fc.boolean(),
});

function build(s: Scenario): RefSnapshot {
  const bookings: BookingLite[] = s.bookings.map((b, i) => ({
    id: `bk-${i}`,
    orgId: ORG,
    reference: `BK-${i}`,
    machineId: MACHINE.id,
    status: b.status,
    startDate: day(b.day),
    customerId: `cu-b${i}`,
    customerName: `Cust B${i}`,
    hireAgreementId: b.agIdx === undefined ? undefined : `ag-${b.agIdx}`,
  }));
  if (s.noiseBooking) {
    bookings.push({
      id: 'bk-noise',
      orgId: ORG,
      reference: 'BK-NOISE',
      machineId: 'm-other',
      status: 'On Hire',
      startDate: day(99),
      hireAgreementId: 'ag-0',
    });
  }
  const agreements: AgreementLite[] = s.agreements.map((a, j) => ({
    id: `ag-${j}`,
    orgId: ORG,
    agreementNo: `AGR-${j}`,
    quotationId: a.qIdx === undefined ? undefined : `q-${a.qIdx}`,
  }));
  const quotations: QuotationLite[] = Array.from({ length: s.quotationCount }, (_, k) => ({
    id: `q-${k}`,
    orgId: ORG,
    number: `QT-${k}`,
  }));
  const invoices: InvoiceLite[] = s.invoices.map((v, n) => ({
    id: `inv-${n}`,
    orgId: ORG,
    invoiceNo: `INV-${n}`,
    quotationId: v.kind === 'q' ? `q-${v.idx}` : undefined,
    hireAgreementId: v.kind === 'aId' ? `ag-${v.idx}` : undefined,
    hireAgreementNo: v.kind === 'aNo' ? `AGR-${v.idx}` : undefined,
    sequence: v.seqBase * 10 + n, // unique
    status: v.cancelled ? 'Cancelled' : 'Issued',
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
  }));
  return { orgId: ORG, bookings, agreements, quotations, invoices };
}

function latest(list: InvoiceLite[]): InvoiceLite | undefined {
  return [...list].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))[0];
}

describe('Property 11: Reference chain resolution', () => {
  it('follows the chain, stops at the first broken link, falls back to agreement invoice', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const snap = build(s);
        const r = resolveReferences(MACHINE, 'Fallback Co', snap);
        const expMissing: MissingLink[] = [];

        // Always returns a result carrying machine identity
        expect(r.machineId).toBe(MACHINE.id);
        expect(r.fleetNo).toBe('F-1');
        expect(r.refNotes.length).toBe(r.missing.length);

        const mine = snap.bookings.filter((b) => b.machineId === MACHINE.id);
        if (mine.length === 0) {
          expect(r.missing).toEqual(['BOOKING']);
          expect(r.bookingId).toBe('');
          expect(r.bookingRef).toBe('');
          expect(r.hireAgreementId).toBe('');
          expect(r.hireAgreementNo).toBe('');
          expect(r.quotationId).toBe('');
          expect(r.quotationNo).toBe('');
          expect(r.invoiceId).toBe('');
          expect(r.invoiceNo).toBe('');
          expect(r.refNotes.length).toBe(1);
          return;
        }

        // Booking selection: active if any exists, otherwise latest start date
        const chosen = mine.find((b) => b.id === r.bookingId);
        expect(chosen).toBeDefined();
        expect(r.bookingRef).toBe(chosen!.reference);
        const actives = mine.filter((b) => ACTIVE.includes(b.status));
        if (actives.length > 0) {
          expect(ACTIVE).toContain(chosen!.status);
        } else {
          const maxStart = mine.map((b) => b.startDate).sort().at(-1);
          expect(chosen!.startDate).toBe(maxStart);
        }

        const ag = snap.agreements.find((a) => a.id === chosen!.hireAgreementId);
        if (!ag) {
          expMissing.push('AGREEMENT');
          expect(r.missing).toEqual(expMissing);
          expect(r.hireAgreementId).toBe('');
          expect(r.hireAgreementNo).toBe('');
          expect(r.quotationId).toBe('');
          expect(r.quotationNo).toBe('');
          expect(r.invoiceId).toBe('');
          expect(r.invoiceNo).toBe('');
          expect(r.refNotes.length).toBe(1);
          return;
        }
        expect(r.hireAgreementId).toBe(ag.id);
        expect(r.hireAgreementNo).toBe(ag.agreementNo);

        const q = snap.quotations.find((x) => x.id === ag.quotationId);
        const live = snap.invoices.filter((i) => i.status !== 'Cancelled');
        let inv: InvoiceLite | undefined;
        if (q) {
          expect(r.quotationId).toBe(q.id);
          expect(r.quotationNo).toBe(q.number);
          inv =
            latest(live.filter((i) => i.quotationId === q.id)) ??
            latest(live.filter((i) => i.hireAgreementId === ag.id || i.hireAgreementNo === ag.agreementNo));
        } else {
          expMissing.push('QUOTATION');
          expect(r.quotationId).toBe('');
          expect(r.quotationNo).toBe('');
          inv = latest(
            live.filter(
              (i) => i.hireAgreementId === ag.id || i.hireAgreementNo === ag.agreementNo,
            ),
          );
        }
        if (inv) {
          expect(r.invoiceId).toBe(inv.id);
          expect(r.invoiceNo).toBe(inv.invoiceNo);
        } else {
          expMissing.push('INVOICE');
          expect(r.invoiceId).toBe('');
          expect(r.invoiceNo).toBe('');
        }
        expect(r.missing).toEqual(expMissing);
        expect(r.refNotes.length).toBe(expMissing.length);
      }),
      { numRuns: 300 },
    );
  });

  it('examples: complete chain, missing quotation with agreement fallback, cancelled invoice ignored', () => {
    const base: RefSnapshot = {
      orgId: ORG,
      bookings: [
        {
          id: 'b1',
          orgId: ORG,
          reference: 'BK-1',
          machineId: MACHINE.id,
          status: 'On Hire',
          startDate: '2026-01-01',
          hireAgreementId: 'a1',
        },
      ],
      agreements: [{ id: 'a1', orgId: ORG, agreementNo: 'AGR-1', quotationId: 'q1' }],
      quotations: [{ id: 'q1', orgId: ORG, number: 'QT-1' }],
      invoices: [
        { id: 'i1', orgId: ORG, invoiceNo: 'INV-1', quotationId: 'q1', status: 'Issued', createdAt: '2026-01-01', sequence: 1 },
        { id: 'i2', orgId: ORG, invoiceNo: 'INV-2', quotationId: 'q1', status: 'Cancelled', createdAt: '2026-01-02', sequence: 2 },
      ],
    };
    const full = resolveReferences(MACHINE, undefined, base);
    expect(full.missing).toEqual([]);
    expect(full.invoiceNo).toBe('INV-1');

    const noQuote = resolveReferences(MACHINE, undefined, {
      ...base,
      quotations: [],
      invoices: [
        { id: 'i3', orgId: ORG, invoiceNo: 'INV-3', hireAgreementNo: 'AGR-1', status: 'Issued', createdAt: '2026-01-03', sequence: 3 },
      ],
    });
    expect(noQuote.missing).toEqual(['QUOTATION']);
    expect(noQuote.invoiceNo).toBe('INV-3');
  });
});
