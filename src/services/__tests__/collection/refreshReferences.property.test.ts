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
import type { ReferenceFields } from '@/types/collection';

// Feature: offhire-collection-docs, Property 12: Refresh is idempotent and equals a fresh resolve
// **Validates: Requirements 3.7**

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

interface Scenario {
  bookings: { status: string; day: number; agIdx: number | undefined }[];
  agreements: { qIdx: number | undefined }[];
  quotationCount: number;
  invoices: { kind: 'q' | 'aId' | 'aNo'; idx: number; cancelled: boolean; seq: number }[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  bookings: fc.array(
    fc.record({
      status: fc.constantFrom('On Hire', 'Allocated', 'Confirmed', 'Completed'),
      day: fc.integer({ min: 0, max: 40 }),
      agIdx: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
    }),
    { maxLength: 4 },
  ),
  agreements: fc.array(
    fc.record({ qIdx: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }) }),
    { maxLength: 3 },
  ),
  quotationCount: fc.integer({ min: 0, max: 3 }),
  invoices: fc.array(
    fc.record({
      kind: fc.constantFrom('q', 'aId', 'aNo') as fc.Arbitrary<'q' | 'aId' | 'aNo'>,
      idx: fc.integer({ min: 0, max: 3 }),
      cancelled: fc.boolean(),
      seq: fc.integer({ min: 0, max: 20 }),
    }),
    { maxLength: 6 },
  ),
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
    sequence: v.seq * 10 + n,
    status: v.cancelled ? 'Cancelled' : 'Issued',
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
  }));
  return { orgId: ORG, bookings, agreements, quotations, invoices };
}

describe('Property 12: Refresh is idempotent and equals a fresh resolve', () => {
  it('resolving twice is equal, and applying resolved fields onto a stale document then re-resolving changes nothing', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        scenarioArb,
        fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
        (earlier, current, fallback) => {
          const oldSnap = build(earlier);
          const snap = build(current);

          const first = resolveReferences(MACHINE, fallback, snap);
          const second = resolveReferences(MACHINE, fallback, snap);
          expect(second).toEqual(first);

          // Document created from the earlier snapshot, then refreshed.
          const stale = resolveReferences(MACHINE, fallback, oldSnap);
          const doc: { title: string; refs: ReferenceFields } = { title: 'keep', refs: stale };
          const refresh = (d: typeof doc): typeof doc => ({
            ...d,
            refs: { ...d.refs, ...resolveReferences(MACHINE, fallback, snap) },
          });
          const once = refresh(doc);
          const twice = refresh(once);

          expect(once.refs).toEqual(first);
          expect(once.refs.missing).toEqual(first.missing);
          expect(once.refs.refNotes).toEqual(first.refNotes);
          expect(twice).toEqual(once);
          expect(once.title).toBe('keep');
        },
      ),
      { numRuns: 200 },
    );
  });
});
