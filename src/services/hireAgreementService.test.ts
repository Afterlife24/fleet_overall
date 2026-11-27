// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { findAllocationsForAgreement, HireAgreementInUseError } from '@/services/hireLink';
import { useBookingStore } from '@/store/bookingStore';
import type { Booking } from '@/types/booking';

// Feature: hire-agreement-planner-link, Property 13: Agreement delete guard
// **Validates: Requirements 3.4**
// Agreements are API data now and are cancelled through `hireAgreementsApi`; the browser still owns the planner
// bookings that reference them, so the Hire Agreement screen asks `findAllocationsForAgreement` before it cancels.

const ORG = 'org-ja';

function makeBooking(i: number, hireAgreementId: string | undefined): Booking {
  return {
    id: `bk-user-${i}`,
    reference: `BK-2024-${String(i).padStart(4, '0')}`,
    orgId: ORG,
    customerName: 'Acme',
    status: 'Reserved',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...(hireAgreementId !== undefined ? { hireAgreementId } : {}),
  } as unknown as Booking;
}

// Each booking points at an agreement index, an unknown id, or nothing.
const bookingRefArb = fc.oneof(
  fc.record({ type: fc.constant('agreement' as const), idx: fc.nat(1000) }),
  fc.constant({ type: 'unknown' as const }),
  fc.constant({ type: 'none' as const }),
);

describe('agreement cancel guard (findAllocationsForAgreement)', () => {
  beforeEach(() => {
    localStorage.clear();
    useBookingStore.setState({ userBookings: [] });
  });

  it('Property 13: lists exactly the bookings that reference the agreement id and changes nothing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(bookingRefArb, { maxLength: 10 }),
        fc.nat(1000),
        (agreementCount, bookingRefs, targetPick) => {
          const ids = Array.from({ length: agreementCount }, (_, i) => `ha-t-${i}`);
          const bookings = bookingRefs.map((r, i) =>
            makeBooking(i, r.type === 'agreement' ? ids[r.idx % ids.length] : r.type === 'unknown' ? 'ha-unknown' : undefined),
          );
          useBookingStore.setState({ userBookings: bookings });
          const before = structuredClone(useBookingStore.getState().userBookings);

          const targetId = ids[targetPick % ids.length];
          const referencing = bookings.filter((b) => b.hireAgreementId === targetId);
          const refs = findAllocationsForAgreement(targetId);

          expect(refs.map((r) => r.id).sort()).toEqual(referencing.map((b) => b.id).sort());
          expect(refs.map((r) => r.reference).sort()).toEqual(referencing.map((b) => b.reference).sort());
          expect(useBookingStore.getState().userBookings).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the in-use error lists the booking reference', () => {
    useBookingStore.setState({ userBookings: [makeBooking(1, 'ha-1')] });
    const error = new HireAgreementInUseError(findAllocationsForAgreement('ha-1'));
    expect(error.message).toContain('BK-2024-0001');
    expect(findAllocationsForAgreement('')).toEqual([]);
  });
});
