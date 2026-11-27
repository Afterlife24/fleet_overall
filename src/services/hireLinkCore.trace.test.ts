// Feature: hire-agreement-planner-link, Property 7: Allocation to quotation trace round trip
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  allocationsForQuotation,
  traceAllocation,
  type AgreementLite,
  type AllocationLite,
  type QuotationLite,
  type SkipReason,
} from './hireLinkCore';

type TraceSnap = { allocations: AllocationLite[]; agreements: AgreementLite[]; quotations: QuotationLite[] };

const ORG = 'org-test';

/** Snapshot with unique ids and links that are empty, valid or dangling. */
const snapshotArb: fc.Arbitrary<TraceSnap> = fc
  .record({
    nQ: fc.integer({ min: 0, max: 5 }),
    nA: fc.integer({ min: 0, max: 6 }),
    nB: fc.integer({ min: 0, max: 8 }),
  })
  .chain(({ nQ, nA, nB }) =>
    fc.record({
      quotations: fc.tuple(
        ...Array.from({ length: nQ }, (_, i) =>
          fc.constantFrom('Awaiting', 'Tender', 'Lost', 'Won').map(
            (phase): QuotationLite => ({
              id: `q-${i}`,
              orgId: ORG,
              number: `QT-${i}`,
              phase: phase as QuotationLite['phase'],
              customerName: `Cust ${i}`,
            }),
          ),
        ),
      ),
      agreements: fc.tuple(
        ...Array.from({ length: nA }, (_, i) =>
          fc.oneof(fc.constant(''), fc.constantFrom('q-missing', 'q-x'), fc.integer({ min: 0, max: Math.max(nQ - 1, 0) }).map((n) => `q-${n}`)).map(
            (quotationId): AgreementLite => ({
              id: `ha-${i}`,
              orgId: ORG,
              agreementNo: `HA-${i}`,
              customerName: `Cust ${i}`,
              quotationId,
            }),
          ),
        ),
      ),
      allocations: fc.tuple(
        ...Array.from({ length: nB }, (_, i) =>
          fc
            .oneof(
              fc.constant(undefined),
              fc.constant(''),
              fc.constantFrom('ha-missing', 'ha-x'),
              fc.integer({ min: 0, max: Math.max(nA - 1, 0) }).map((n) => `ha-${n}`),
            )
            .map(
              (hireAgreementId): AllocationLite => ({
                id: `bk-${i}`,
                reference: `BK-${i}`,
                machineId: `m-${i % 3}`,
                orgId: ORG,
                hireAgreementId,
                startDate: '2025-01-01',
                endDate: '2025-12-31',
                status: 'Allocated',
              }),
            ),
        ),
      ),
    }),
  );

/** Independent model of the chain walk. */
function expectedTrace(s: TraceSnap, allocationId: string): SkipReason | 'OK' {
  const al = s.allocations.find((a) => a.id === allocationId);
  if (!al) return 'ALLOCATION_NOT_FOUND';
  if (!al.hireAgreementId) return 'NO_AGREEMENT_ID';
  const ag = s.agreements.find((a) => a.id === al.hireAgreementId);
  if (!ag) return 'AGREEMENT_NOT_FOUND';
  if (!ag.quotationId) return 'NO_QUOTATION_ID';
  const q = s.quotations.find((x) => x.id === ag.quotationId);
  if (!q) return 'QUOTATION_NOT_FOUND';
  return 'OK';
}

const rehydrate = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('Property 7: allocation to quotation trace round trip', () => {
  it('resolved chains trace to their agreement and quotation, and the reverse lookup contains the allocation', () => {
    fc.assert(
      fc.property(snapshotArb, (s) => {
        for (const al of s.allocations) {
          const r = traceAllocation(s, al.id);
          if (expectedTrace(s, al.id) !== 'OK') continue;
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          expect(r.allocation).toEqual(al);
          expect(r.agreement.id).toBe(al.hireAgreementId);
          expect(r.quotation.id).toBe(r.agreement.quotationId);
          expect(allocationsForQuotation(s, r.quotation.id).map((a) => a.id)).toContain(al.id);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('unresolved chains return the reason of the first missing link', () => {
    fc.assert(
      fc.property(snapshotArb, fc.constantFrom('bk-none', 'bk-0', 'bk-1', 'bk-2', 'bk-5'), (s, id) => {
        const exp = expectedTrace(s, id);
        const r = traceAllocation(s, id);
        if (exp === 'OK') {
          expect(r.ok).toBe(true);
        } else {
          expect(r).toEqual({ ok: false, reason: exp });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('allocationsForQuotation equals the allocations whose agreement has that quotationId', () => {
    fc.assert(
      fc.property(snapshotArb, fc.constantFrom('q-0', 'q-1', 'q-2', 'q-missing', ''), (s, qid) => {
        const expected = s.allocations.filter((al) => {
          if (!qid || !al.hireAgreementId) return false;
          const ag = s.agreements.find((a) => a.id === al.hireAgreementId);
          return !!ag && ag.quotationId === qid;
        });
        expect(allocationsForQuotation(s, qid)).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic and unchanged after the snapshot is persisted and rehydrated', () => {
    fc.assert(
      fc.property(snapshotArb, (s) => {
        const copy = rehydrate(s);
        for (const al of s.allocations) {
          expect(traceAllocation(s, al.id)).toEqual(traceAllocation(s, al.id));
          expect(traceAllocation(copy, al.id)).toEqual(traceAllocation(s, al.id));
        }
        for (const q of s.quotations) {
          expect(allocationsForQuotation(s, q.id)).toEqual(allocationsForQuotation(s, q.id));
          expect(allocationsForQuotation(copy, q.id)).toEqual(allocationsForQuotation(s, q.id));
        }
      }),
      { numRuns: 100 },
    );
  });
});
