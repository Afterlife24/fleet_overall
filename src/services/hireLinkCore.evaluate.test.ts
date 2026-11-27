import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  evaluateOnHire,
  type AgreementLite,
  type AllocationLite,
  type OnHireEvent,
  type Plan,
  type QuotationLite,
  type SkipReason,
  type Snapshot,
} from './hireLinkCore';
import type { BookingStatus } from '@/types/booking';
import type { QuotationPhase } from '@/types/quotation';

// Feature: hire-agreement-planner-link, Property 12: Chain validity and skip conditions
// **Validates: Requirements 7.2, 8.6, 8.8, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 15.2, 15.3**

const RUNS = { numRuns: 200 };
const TODAY = '2025-06-15';
const ORGS = ['org-a', 'org-b', 'org-ja'];
const ACTIVE_ORG = 'org-a';
const STATUSES: BookingStatus[] = [
  'Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned', 'Cancelled',
];
const PHASES: QuotationPhase[] = ['Awaiting', 'Tender', 'Lost', 'Won'];
const DATES = ['2025-06-01', '2025-06-14', TODAY, '2025-06-16', '2025-07-01'];

const idArb = (p: string) => fc.integer({ min: 1, max: 3 }).map((n) => `${p}${n}`);

const allocationArb: fc.Arbitrary<AllocationLite> = fc.record({
  id: idArb('al'),
  reference: fc.constant('BK-1'),
  machineId: idArb('m'),
  orgId: fc.option(fc.constantFrom(...ORGS), { nil: undefined }),
  hireAgreementId: fc.option(fc.oneof(idArb('ag'), fc.constant('')), { nil: undefined }),
  startDate: fc.constantFrom(...DATES),
  endDate: fc.constantFrom(...DATES),
  status: fc.constantFrom(...STATUSES),
});

const agreementArb: fc.Arbitrary<AgreementLite> = fc.record({
  id: idArb('ag'),
  orgId: fc.constantFrom(...ORGS),
  // agreementNo deliberately collides with ids of other records
  agreementNo: fc.oneof(idArb('ag'), idArb('qt'), idArb('al')),
  customerName: fc.constantFrom('ABC', 'XYZ'),
  quotationId: fc.oneof(idArb('qt'), fc.constant('')),
});

const quotationArb: fc.Arbitrary<QuotationLite> = fc.record({
  id: idArb('qt'),
  orgId: fc.constantFrom(...ORGS),
  number: idArb('QT-'),
  phase: fc.constantFrom(...PHASES),
  customerName: fc.constantFrom('ABC', 'XYZ'),
});

const snapshotArb: fc.Arbitrary<Snapshot> = fc.record({
  orgId: fc.constant(ACTIVE_ORG),
  today: fc.constant(TODAY),
  crmActive: fc.boolean(),
  quotationActive: fc.boolean(),
  allocations: fc.array(allocationArb, { maxLength: 5 }),
  agreements: fc.array(agreementArb, { maxLength: 4 }),
  quotations: fc.array(quotationArb, { maxLength: 4 }),
});

const eventArb: fc.Arbitrary<OnHireEvent> = fc.oneof(
  idArb('al').map((allocationId) => ({ source: 'booking' as const, allocationId })),
  idArb('m').map((machineId) => ({ source: 'machine' as const, machineId })),
);

/** Independent reference model: first failed check in the documented order. */
function oracle(s: Snapshot, e: OnHireEvent): SkipReason | 'win' {
  if (!s.crmActive) return 'CRM_INACTIVE';
  if (!s.quotationActive) return 'QUOTATION_INACTIVE';

  let al: AllocationLite | undefined;
  if (e.source === 'booking') {
    al = s.allocations.find((a) => a.id === e.allocationId);
    if (!al) return 'ALLOCATION_NOT_FOUND';
    if (al.status !== 'On Hire') return 'NOT_ON_HIRE';
  } else {
    const active = s.allocations.filter(
      (a) =>
        a.machineId === e.machineId &&
        a.status !== 'Cancelled' &&
        a.status !== 'Returned' &&
        a.startDate <= s.today &&
        s.today <= a.endDate,
    );
    if (active.length === 0) return 'NO_ACTIVE_ALLOCATION';
    if (active.length > 1) return 'MULTIPLE_ACTIVE_ALLOCATIONS';
    al = active[0];
  }
  if ((al.orgId ?? 'org-ja') !== s.orgId) return 'ALLOCATION_ORG_MISMATCH';
  if (!al.hireAgreementId) return 'NO_AGREEMENT_ID';
  const ag = s.agreements.find((a) => a.id === al!.hireAgreementId);
  if (!ag) return 'AGREEMENT_NOT_FOUND';
  if (ag.orgId !== s.orgId) return 'AGREEMENT_ORG_MISMATCH';
  if (!ag.quotationId) return 'NO_QUOTATION_ID';
  const q = s.quotations.find((x) => x.id === ag.quotationId);
  if (!q) return 'QUOTATION_NOT_FOUND';
  if (q.orgId !== s.orgId) return 'QUOTATION_ORG_MISMATCH';
  if (q.phase === 'Lost') return 'QUOTATION_LOST';
  if (q.phase === 'Won') return 'ALREADY_WON';
  return 'win';
}

/** A fully valid snapshot for a booking-source event on 'al1'. */
function validSnapshot(phase: QuotationPhase = 'Awaiting'): { s: Snapshot; e: OnHireEvent } {
  const s: Snapshot = {
    orgId: ACTIVE_ORG,
    today: TODAY,
    crmActive: true,
    quotationActive: true,
    allocations: [
      {
        id: 'al1', reference: 'BK-1', machineId: 'm1', orgId: ACTIVE_ORG, hireAgreementId: 'ag1',
        startDate: '2025-06-01', endDate: '2025-07-01', status: 'On Hire',
      },
    ],
    agreements: [
      { id: 'ag1', orgId: ACTIVE_ORG, agreementNo: 'HA-1', customerName: 'ABC', quotationId: 'qt1' },
    ],
    quotations: [{ id: 'qt1', orgId: ACTIVE_ORG, number: 'QT-1', phase, customerName: 'ABC' }],
  };
  return { s, e: { source: 'booking', allocationId: 'al1' } };
}

describe('Property 12: evaluateOnHire chain validity and skip conditions', () => {
  it('is total, deterministic, and matches the documented check order', () => {
    fc.assert(
      fc.property(snapshotArb, eventArb, (s, e) => {
        const before = JSON.stringify(s);
        const plan = evaluateOnHire(s, e);
        expect(evaluateOnHire(s, e)).toEqual(plan);
        expect(JSON.stringify(s)).toBe(before); // input not mutated
        const expected = oracle(s, e);
        if (expected === 'win') expect(plan.kind).toBe('win');
        else expect(plan).toMatchObject({ kind: 'skip', reason: expected });
      }),
      RUNS,
    );
  });

  it('a win plan implies a fully valid chain, matched by id only, in Awaiting/Tender', () => {
    fc.assert(
      fc.property(snapshotArb, eventArb, (s, e) => {
        const plan: Plan = evaluateOnHire(s, e);
        if (plan.kind !== 'win') return;
        expect(s.crmActive && s.quotationActive).toBe(true);
        const al = s.allocations.find((a) => a.id === plan.allocationId)!;
        const ag = s.agreements.find((a) => a.id === plan.agreementId)!;
        const q = s.quotations.find((x) => x.id === plan.quotationId)!;
        expect(al && ag && q).toBeTruthy();
        expect(al.hireAgreementId).toBe(ag.id);
        expect(ag.quotationId).toBe(q.id);
        expect(al.orgId ?? 'org-ja').toBe(s.orgId);
        expect(ag.orgId).toBe(s.orgId);
        expect(q.orgId).toBe(s.orgId);
        expect(['Awaiting', 'Tender']).toContain(q.phase);
        if (e.source === 'booking') {
          expect(al.id).toBe(e.allocationId);
          expect(al.status).toBe('On Hire');
        } else {
          expect(al.machineId).toBe(e.machineId);
        }
      }),
      RUNS,
    );
  });

  it('inactive apps win over any other data (CRM before Quotation)', () => {
    fc.assert(
      fc.property(snapshotArb, eventArb, (base, e) => {
        const crmOff = evaluateOnHire({ ...base, crmActive: false }, e);
        expect(crmOff).toEqual({ kind: 'skip', reason: 'CRM_INACTIVE' });
        const qOff = evaluateOnHire({ ...base, crmActive: true, quotationActive: false }, e);
        expect(qOff).toEqual({ kind: 'skip', reason: 'QUOTATION_INACTIVE' });
      }),
      RUNS,
    );
  });

  it('a booking-source event for a non On Hire allocation is NOT_ON_HIRE', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUSES.filter((x) => x !== 'On Hire')),
        fc.constantFrom<QuotationPhase>('Awaiting', 'Tender'),
        (status, phase) => {
          const { s, e } = validSnapshot(phase);
          s.allocations[0].status = status;
          expect(evaluateOnHire(s, e)).toMatchObject({ kind: 'skip', reason: 'NOT_ON_HIRE' });
        },
      ),
      RUNS,
    );
  });

  it('valid chain in Awaiting or Tender wins with the matching ids', () => {
    fc.assert(
      fc.property(fc.constantFrom<QuotationPhase>('Awaiting', 'Tender'), (phase) => {
        const { s, e } = validSnapshot(phase);
        expect(evaluateOnHire(s, e)).toEqual({
          kind: 'win', quotationId: 'qt1', allocationId: 'al1', agreementId: 'ag1',
        });
      }),
      RUNS,
    );
  });

  describe('each skip reason from a valid chain', () => {
    const cases: [SkipReason, (s: Snapshot) => void][] = [
      ['ALLOCATION_ORG_MISMATCH', (s) => { s.allocations[0].orgId = 'org-b'; }],
      ['ALLOCATION_ORG_MISMATCH', (s) => { delete s.allocations[0].orgId; }], // legacy = org-ja
      ['NO_AGREEMENT_ID', (s) => { delete s.allocations[0].hireAgreementId; }],
      ['NO_AGREEMENT_ID', (s) => { s.allocations[0].hireAgreementId = ''; }],
      ['AGREEMENT_NOT_FOUND', (s) => { s.allocations[0].hireAgreementId = 'ag9'; }],
      // agreementNo equal to the stored id must not resolve
      ['AGREEMENT_NOT_FOUND', (s) => { s.agreements[0].id = 'other'; s.agreements[0].agreementNo = 'ag1'; }],
      ['AGREEMENT_ORG_MISMATCH', (s) => { s.agreements[0].orgId = 'org-b'; }],
      ['NO_QUOTATION_ID', (s) => { s.agreements[0].quotationId = ''; }],
      ['QUOTATION_NOT_FOUND', (s) => { s.agreements[0].quotationId = 'qt9'; }],
      // quotation number / company equal to the link must not resolve
      ['QUOTATION_NOT_FOUND', (s) => { s.quotations[0].id = 'other'; s.quotations[0].number = 'qt1'; }],
      ['QUOTATION_ORG_MISMATCH', (s) => { s.quotations[0].orgId = 'org-b'; }],
      ['QUOTATION_LOST', (s) => { s.quotations[0].phase = 'Lost'; }],
      ['ALREADY_WON', (s) => { s.quotations[0].phase = 'Won'; }],
      ['ALLOCATION_NOT_FOUND', (s) => { s.allocations = []; }],
    ];
    it.each(cases.map((c, i) => [i, c[0], c[1]] as const))('case %i -> %s', (_i, reason, mutate) => {
      const { s, e } = validSnapshot();
      mutate(s);
      const plan = evaluateOnHire(s, e);
      expect(plan).toMatchObject({ kind: 'skip', reason });
    });

    it('reports quotationNumber for quotation-level skips and allocationId once resolved', () => {
      for (const [mutate, reason] of [
        [(s: Snapshot) => { s.quotations[0].phase = 'Lost'; }, 'QUOTATION_LOST'],
        [(s: Snapshot) => { s.quotations[0].phase = 'Won'; }, 'ALREADY_WON'],
        [(s: Snapshot) => { s.quotations[0].orgId = 'org-b'; }, 'QUOTATION_ORG_MISMATCH'],
      ] as const) {
        const { s, e } = validSnapshot();
        mutate(s);
        expect(evaluateOnHire(s, e)).toEqual({
          kind: 'skip', reason, quotationNumber: 'QT-1', allocationId: 'al1',
        });
      }
    });

    it('machine source: no active / multiple active allocations', () => {
      const { s } = validSnapshot();
      const ev: OnHireEvent = { source: 'machine', machineId: 'm1' };
      expect(evaluateOnHire(s, ev)).toMatchObject({ kind: 'win', allocationId: 'al1' });
      expect(evaluateOnHire(s, { source: 'machine', machineId: 'm2' })).toMatchObject({
        kind: 'skip', reason: 'NO_ACTIVE_ALLOCATION',
      });
      s.allocations.push({ ...s.allocations[0], id: 'al2' });
      expect(evaluateOnHire(s, ev)).toMatchObject({ kind: 'skip', reason: 'MULTIPLE_ACTIVE_ALLOCATIONS' });
    });
  });
});
