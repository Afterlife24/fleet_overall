// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { resolveAllocation } from '@/services/hireLink';
import { AUTO_WON_REASON } from '@/features/crm/crmRules';
import type { HireAgreement } from '@/types/hireagreement';
import type { Booking, BookingStatus } from '@/types/booking';
import type { Quotation, QuotationPhase } from '@/types/quotation';

// Feature: hire-agreement-planner-link, Property 2: Persistence round trip and legacy migration
// **Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 14.1, 14.2, 15.2**
// Quotations and hire agreements are API data now (backend-foundation-crm Requirement 15.5 and 15.8): their stores
// are in-memory read copies and are not persisted. Bookings are API data as well (Planner stage): useBookingStore is an in-memory mirror and persists nothing.

const BOOKING_KEY = 'fleet-bookings-v1';
const AGREEMENT_KEY = 'fleet-hire-agreements-v1';
const CRM_KEY = 'fleet-crm-v1';

const orgArb = fc.constantFrom(JA_ORG_ID, 'org-a', 'org-b');
const textArb = fc.string({ maxLength: 10 });
const statusArb = fc.constantFrom<BookingStatus>(
  'Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned', 'Cancelled',
);
const phaseArb = fc.constantFrom<QuotationPhase>('Awaiting', 'Tender', 'Lost', 'Won');

// Ids are index based so references can point at existing, missing or empty targets.
const refArb = (prefix: string, n: number) =>
  fc.oneof(
    fc.constant(''),
    fc.constant(`${prefix}-missing`),
    fc.integer({ min: 0, max: Math.max(0, n - 1) }).map((i) => `${prefix}${i}`),
  );

interface World {
  quotations: Quotation[];
  agreements: HireAgreement[];
  bookings: Booking[];
}

const worldArb: fc.Arbitrary<World> = fc
  .record({ nq: fc.integer({ min: 1, max: 4 }), na: fc.integer({ min: 1, max: 4 }), nb: fc.integer({ min: 1, max: 5 }) })
  .chain(({ nq, na, nb }) =>
    fc.record({
      quotations: fc.tuple(...Array.from({ length: nq }, (_, i) =>
        fc.record({ orgId: orgArb, phase: phaseArb, name: textArb }).map(
          (r): Quotation => ({
            id: `q${i}`, orgId: r.orgId, number: `QT-${i}`, opportunity: r.name, hireAgreementNo: '',
            customerId: 'CUS-1', customerName: r.name, amount: 1, currency: 'AED', phase: r.phase,
            createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
            history: [{ id: `h${i}`, timestamp: '2025-01-01T00:00:00.000Z', user: 'u', fromPhase: null, toPhase: r.phase }],
          } as Quotation),
        )) as unknown as [fc.Arbitrary<Quotation>]),
      agreements: fc.tuple(...Array.from({ length: na }, (_, i) =>
        fc.record({ orgId: orgArb, quotationId: refArb('q', nq), no: textArb }).map(
          (r): HireAgreement => ({
            id: `a${i}`, orgId: r.orgId, quotationId: r.quotationId, agreementNo: r.no, customerName: r.no,
            status: 'Active',
          } as unknown as HireAgreement),
        )) as unknown as [fc.Arbitrary<HireAgreement>]),
      bookings: fc.tuple(...Array.from({ length: nb }, (_, i) =>
        fc.record({ status: statusArb, ref: refArb('a', na), withOrg: fc.boolean(), org: orgArb }).map(
          (r): Booking => {
            const b: Record<string, unknown> = {
              id: `b${i}`, reference: `BK-${i}`, machineId: `m${i % 2}`, customerName: 'c',
              startDate: '2025-01-01', endDate: '2025-12-31', status: r.status,
            };
            if (r.ref) b.hireAgreementId = r.ref;
            if (r.withOrg) b.orgId = r.org;
            return b as unknown as Booking;
          },
        )) as unknown as [fc.Arbitrary<Booking>]),
    }),
  );

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Drops the in-memory state of the three stores, as a page reload would. */
function wipeMemory() {
  useHireAgreementStore.setState({ agreements: [] });
  useBookingStore.setState({ userBookings: [] });
  useCrmStore.setState({ quotations: [] });
}

function resetAll() {
  localStorage.clear();
  wipeMemory();
  useAuthStore.setState({ user: null, isAuthenticated: false });
}


function traceAll(bookings: Booking[]) {
  return bookings.map((b) => resolveAllocation(b.id));
}

describe('persistence round trip and legacy migration', () => {
  beforeEach(resetAll);

  it('keeps traces and applies auto-won history to the in-memory quotations', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async (w) => {
        resetAll();
        useHireAgreementStore.setState({ agreements: clone(w.agreements) });
        useBookingStore.setState({ userBookings: clone(w.bookings) });
        useCrmStore.setState({ quotations: clone(w.quotations) });

        // Auto-won history for every quotation the store allows to change.
        for (const q of w.quotations) useCrmStore.getState().autoWon(q.orgId, q.id, 'System');

        const before = {
          agreements: clone(useHireAgreementStore.getState().agreements),
          bookings: clone(useBookingStore.getState().userBookings),
          quotations: clone(useCrmStore.getState().quotations),
          traces: clone(traceAll(w.bookings)),
        };

        // Nothing is stored in the browser: a page load starts empty and the mirrors are refilled from the API.
        expect(localStorage.getItem(BOOKING_KEY)).toBeNull();
        const agreements = before.agreements;
        const quotations = before.quotations;
        wipeMemory();
        expect(useBookingStore.getState().userBookings).toEqual([]);
        useBookingStore.setState({ userBookings: clone(before.bookings) });
        // Agreements and quotations are not persisted: they are read from the API again after a reload.
        expect(useHireAgreementStore.getState().agreements).toEqual([]);
        expect(useCrmStore.getState().quotations).toEqual([]);
        useHireAgreementStore.setState({ agreements: clone(agreements) });
        useCrmStore.setState({ quotations: clone(quotations) });

        expect(useBookingStore.getState().userBookings).toEqual(before.bookings);
        expect(clone(traceAll(w.bookings))).toEqual(before.traces);

        // Auto-won entries survive: Awaiting/Tender became Won with the auto reason; Lost/Won are untouched.
        for (const q of w.quotations) {
          const after = useCrmStore.getState().quotations.find((x) => x.id === q.id)!;
          if (q.phase === 'Awaiting' || q.phase === 'Tender') {
            expect(after.phase).toBe('Won');
            const last = after.history[after.history.length - 1];
            expect(last).toMatchObject({ fromPhase: q.phase, toPhase: 'Won', reason: AUTO_WON_REASON, user: 'System' });
            expect(after.history).toHaveLength(q.history.length + 1);
          } else {
            expect(after.phase).toBe(q.phase);
            expect(after.history).toHaveLength(q.history.length);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('does not write bookings, quotations or hire agreements to localStorage', () => {
    useBookingStore.setState({ userBookings: [{ id: 'bk-1', orgId: JA_ORG_ID } as Booking] });
    useCrmStore.setState({ quotations: [{ id: 'q-1', orgId: JA_ORG_ID } as Quotation] });
    useHireAgreementStore.setState({ agreements: [{ id: 'a-1', orgId: JA_ORG_ID } as HireAgreement] });
    expect(localStorage.getItem(BOOKING_KEY)).toBeNull();
    expect(localStorage.getItem(CRM_KEY)).toBeNull();
    expect(localStorage.getItem(AGREEMENT_KEY)).toBeNull();
  });
});
