// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper', () => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

import { handleOnHire } from './hireLink';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useBookingStore } from '@/store/bookingStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useCrmStore } from '@/store/crmStore';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';
import type { Booking, BookingStatus } from '@/types/booking';

const OTHER_ORG = 'org-other';
const NOW = '2025-01-01T00:00:00.000Z';
const COMPANIES = ['ABC Trading LLC', 'ABC Trading', 'XYZ Contracting', 'Delta Co'];
const AGREEMENT_NOS = ['HA-001', 'HA-002'];
const PHASES: QuotationPhase[] = ['Awaiting', 'Tender', 'Lost', 'Won'];
const STATUSES: BookingStatus[] = ['Reserved', 'Allocated', 'On Hire', 'Returned', 'Cancelled'];

const initialOrgState = useOrgStore.getState();

function resetStores(): void {
  localStorage.clear();
  useOrgStore.setState(initialOrgState, true);
  useAuthStore.setState({ user: null, isAuthenticated: false });
  useBookingStore.setState({ userBookings: [] });
  useHireAgreementStore.setState({ agreements: [] });
  useCrmStore.setState({ quotations: [] });
}

interface Scenario {
  quotations: Quotation[];
  agreements: HireAgreement[];
  bookings: Booking[];
  targetIndex: number;
  viaMachine: boolean;
}

function makeQuotation(i: number, orgId: string, phase: QuotationPhase, company: string, no: string): Quotation {
  return {
    id: `q-${i}`,
    orgId,
    number: `QT-2025-${String(i).padStart(4, '0')}`,
    opportunity: `Opp ${i}`,
    hireAgreementNo: no,
    customerId: `c-${i}`,
    customerName: company,
    amount: 1000 + i,
    currency: 'AED',
    phase,
    createdAt: NOW,
    updatedAt: NOW,
    history: [{ id: `ph-${i}`, timestamp: NOW, user: 'seed', fromPhase: null, toPhase: 'Awaiting' }],
  };
}

function makeAgreement(i: number, orgId: string, company: string, no: string, quotationId: string): HireAgreement {
  return {
    id: `ha-${i}`,
    orgId,
    quotationId,
    agreementNo: no,
    customerName: company,
    date: '2025-01-01',
    status: 'Active',
    createdAt: NOW,
    updatedAt: NOW,
  } as HireAgreement;
}

function makeBooking(i: number, orgId: string | undefined, agreementId: string, status: BookingStatus): Booking {
  return {
    id: `bk-${i}`,
    reference: `BK-2025-${String(i).padStart(4, '0')}`,
    customerId: 'c',
    customerName: 'ABC Trading LLC',
    machineId: `m-${i}`, // unique per booking, so the machine path is unambiguous
    assetNumber: `A-${i}`,
    machineModel: 'Model',
    branchId: 'b',
    branchName: 'Branch',
    startDate: '2000-01-01',
    endDate: '2999-12-31',
    status,
    deliveryAddress: '',
    contactPhone: '',
    operatorRequired: false,
    dailyRate: 100,
    totalValue: 100,
    createdAt: NOW,
    updatedAt: NOW,
    ...(orgId ? { orgId } : {}),
    ...(agreementId ? { hireAgreementId: agreementId } : {}),
  };
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    qSpecs: fc.array(
      fc.record({
        org: fc.constantFrom(JA_ORG_ID, JA_ORG_ID, OTHER_ORG),
        phase: fc.constantFrom(...PHASES),
        company: fc.constantFrom(...COMPANIES),
        no: fc.constantFrom(...AGREEMENT_NOS),
      }),
      { minLength: 1, maxLength: 6 },
    ),
    aSpecs: fc.array(
      fc.record({
        org: fc.constantFrom(JA_ORG_ID, JA_ORG_ID, OTHER_ORG),
        company: fc.constantFrom(...COMPANIES),
        no: fc.constantFrom(...AGREEMENT_NOS), // duplicate agreementNo across agreements
        qRef: fc.nat(8), // index into quotations; out of range = unlinked / dangling
      }),
      { minLength: 1, maxLength: 6 },
    ),
    bSpecs: fc.array(
      fc.record({
        org: fc.constantFrom<string | undefined>(JA_ORG_ID, JA_ORG_ID, undefined, OTHER_ORG),
        aRef: fc.nat(8), // out of range = no agreement id; 7 and up may dangle
        status: fc.constantFrom(...STATUSES),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    target: fc.nat(100),
    viaMachine: fc.boolean(),
  })
  .map(({ qSpecs, aSpecs, bSpecs, target, viaMachine }) => {
    const quotations = qSpecs.map((s, i) => makeQuotation(i, s.org, s.phase, s.company, s.no));
    const agreements = aSpecs.map((s, i) =>
      makeAgreement(i, s.org, s.company, s.no, s.qRef < quotations.length ? quotations[s.qRef].id : s.qRef === 8 ? '' : 'q-missing'),
    );
    const bookings = bSpecs.map((s, i) =>
      makeBooking(
        i,
        s.org,
        s.aRef < agreements.length ? agreements[s.aRef].id : s.aRef === 8 ? '' : 'ha-missing',
        s.status,
      ),
    );
    return { quotations, agreements, bookings, targetIndex: target % bookings.length, viaMachine };
  });

function load(s: Scenario): void {
  useCrmStore.setState({ quotations: structuredClone(s.quotations) });
  useHireAgreementStore.setState({ agreements: structuredClone(s.agreements) });
  useBookingStore.setState({ userBookings: structuredClone(s.bookings) });
}

function fire(s: Scenario) {
  const b = s.bookings[s.targetIndex];
  return handleOnHire(
    s.viaMachine
      ? { source: 'machine', machineId: b.machineId }
      : { source: 'booking', allocationId: b.id },
  );
}

/** Quotation id reached through the target booking's own agreement id, if any. */
function linkedQuotationId(s: Scenario): string | undefined {
  const b = s.bookings[s.targetIndex];
  const agreement = s.agreements.find((a) => a.id === b.hireAgreementId);
  return agreement?.quotationId || undefined;
}

describe('hireLink isolation', () => {
  beforeEach(() => {
    resetStores();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Feature: hire-agreement-planner-link, Property 11: Only the linked quotation changes
  it('Property 11: only the quotation of the allocation\'s own agreement id may change', () => {
    // **Validates: Requirements 7.3, 12.1, 12.2, 12.3, 12.4, 12.8**
    fc.assert(
      fc.property(scenarioArb, (s) => {
        resetStores();
        load(s);
        const before = structuredClone(useCrmStore.getState().quotations);
        const linkedId = linkedQuotationId(s);

        const result = fire(s);

        const after = useCrmStore.getState().quotations;
        expect(after).toHaveLength(before.length);
        const changed = after
          .filter((q, i) => JSON.stringify(q) !== JSON.stringify(before[i]))
          .map((q) => q.id);
        for (const id of changed) expect(id).toBe(linkedId);

        if (result.outcome === 'won') {
          expect(changed).toEqual([linkedId]);
          const was = before.find((q) => q.id === linkedId)!;
          const now = after.find((q) => q.id === linkedId)!;
          expect(was.orgId).toBe(JA_ORG_ID);
          expect(['Awaiting', 'Tender']).toContain(was.phase);
          expect(now.phase).toBe('Won');
          expect(now.history).toHaveLength(was.history.length + 1);
        } else {
          expect(changed).toEqual([]);
        }
        // agreements and bookings are never touched by the facade
        expect(useHireAgreementStore.getState().agreements).toEqual(s.agreements);
        expect(useBookingStore.getState().userBookings).toEqual(s.bookings);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 11: duplicate agreementNo resolves each allocation to its own agreement\'s quotation', () => {
    // **Validates: Requirements 12.2, 12.3, 12.8**
    fc.assert(
      fc.property(
        fc.constantFrom(...COMPANIES),
        fc.constantFrom<'booking' | 'machine'>('booking', 'machine'),
        fc.boolean(),
        (company, source, pickSecond) => {
          resetStores();
          const quotations = [
            makeQuotation(0, JA_ORG_ID, 'Awaiting', company, 'HA-001'),
            makeQuotation(1, JA_ORG_ID, 'Tender', company, 'HA-001'),
            makeQuotation(2, OTHER_ORG, 'Awaiting', company, 'HA-001'),
          ];
          const agreements = [
            makeAgreement(0, JA_ORG_ID, company, 'HA-001', 'q-0'),
            makeAgreement(1, JA_ORG_ID, company, 'HA-001', 'q-1'),
          ];
          const bookings = [
            makeBooking(0, JA_ORG_ID, 'ha-0', 'On Hire'),
            makeBooking(1, JA_ORG_ID, 'ha-1', 'On Hire'),
          ];
          const s: Scenario = {
            quotations,
            agreements,
            bookings,
            targetIndex: pickSecond ? 1 : 0,
            viaMachine: source === 'machine',
          };
          load(s);
          const result = fire(s);
          const wonId = pickSecond ? 'q-1' : 'q-0';
          expect(result).toMatchObject({ outcome: 'won', quotationId: wonId });
          const after = useCrmStore.getState().quotations;
          expect(after.filter((q) => q.phase === 'Won').map((q) => q.id)).toEqual([wonId]);
          for (const q of after) {
            if (q.id !== wonId) expect(q).toEqual(quotations.find((x) => x.id === q.id));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('skip plans leave the CRM store unchanged', () => {
    // **Validates: Requirements 7.3, 12.4**
    fc.assert(
      fc.property(
        scenarioArb,
        fc.constantFrom<'crm-off' | 'quotation-off' | 'not-on-hire' | 'lost' | 'org-mismatch'>(
          'crm-off',
          'quotation-off',
          'not-on-hire',
          'lost',
          'org-mismatch',
        ),
        (s, how) => {
          resetStores();
          const base = s.bookings[s.targetIndex];
          // Force a linked chain, then break it in one specific way
          const q = makeQuotation(100, JA_ORG_ID, how === 'lost' ? 'Lost' : 'Awaiting', 'ABC Trading LLC', 'HA-001');
          const a = makeAgreement(100, how === 'org-mismatch' ? OTHER_ORG : JA_ORG_ID, 'ABC Trading LLC', 'HA-001', q.id);
          const b: Booking = {
            ...base,
            orgId: JA_ORG_ID,
            hireAgreementId: a.id,
            status: how === 'not-on-hire' ? 'Allocated' : 'On Hire',
          };
          const bookings = s.bookings.map((x, i) => (i === s.targetIndex ? b : x));
          const scenario: Scenario = {
            ...s,
            // a non-On-Hire booking only skips on the booking path; the machine path matches by date
            viaMachine: how === 'not-on-hire' ? false : s.viaMachine,
            quotations: [...s.quotations, q],
            agreements: [...s.agreements, a],
            bookings,
          };
          load(scenario);
          if (how === 'crm-off') useOrgStore.getState().deactivateApp(JA_ORG_ID, 'crm');
          if (how === 'quotation-off') useOrgStore.getState().deactivateApp(JA_ORG_ID, 'quotation');

          // Booking path always targets b; for the machine path other bookings use other machines.
          const before = structuredClone(useCrmStore.getState().quotations);
          const result = fire(scenario);

          expect(result.outcome).toBe('skipped');
          expect(useCrmStore.getState().quotations).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
