// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
}));

import { hireAgreementService } from '@/services/services';
import { HireAgreementInUseError } from '@/services/hireLink';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useAuthStore } from '@/store/authStore';
import type { HireAgreement } from '@/types/hireagreement';
import type { Booking } from '@/types/booking';

// Feature: hire-agreement-planner-link, Property 13: Agreement delete guard
// **Validates: Requirements 3.4**

const ORG = 'org-ja';

function resetAll() {
  localStorage.clear();
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [ORG] });
  useBookingStore.setState({ userBookings: [] });
  useAuthStore.setState({
    user: { orgId: ORG } as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>,
    isAuthenticated: true,
  });
}

function makeAgreement(id: string): HireAgreement {
  return {
    id,
    orgId: ORG,
    quotationId: '',
    agreementNo: `HA-${id}`,
    customerName: 'Acme',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as unknown as HireAgreement;
}

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

/** Runs the service call (sync throw or async rejection) and flushes its latency timer. */
async function attempt(fn: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let p: Promise<unknown>;
  try {
    p = fn();
  } catch (error) {
    return { ok: false, error };
  }
  const settled = p.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error })
  );
  await vi.advanceTimersByTimeAsync(500);
  return settled;
}

// Each booking points at an agreement index, an unknown id, or nothing.
const bookingRefArb = fc.oneof(
  fc.record({ type: fc.constant('agreement' as const), idx: fc.nat(1000) }),
  fc.constant({ type: 'unknown' as const }),
  fc.constant({ type: 'none' as const })
);

describe('hireAgreementService.delete guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAll();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAll();
  });

  it('Property 13: rejected with HireAgreementInUseError iff a booking references the id; store unchanged on rejection, only target removed otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.array(bookingRefArb, { maxLength: 10 }),
        fc.nat(1000),
        async (agreementCount, bookingRefs, targetPick) => {
          resetAll();
          const ids = Array.from({ length: agreementCount }, (_, i) => `ha-t-${i}`);
          useHireAgreementStore.setState({ agreements: ids.map(makeAgreement), seededOrgs: [ORG] });
          const bookings = bookingRefs.map((r, i) =>
            makeBooking(
              i,
              r.type === 'agreement' ? ids[r.idx % ids.length] : r.type === 'unknown' ? 'ha-unknown' : undefined
            )
          );
          useBookingStore.setState({ userBookings: bookings });

          const targetId = ids[targetPick % ids.length];
          const referencing = bookings.filter((b) => b.hireAgreementId === targetId);
          const agreementsBefore = structuredClone(useHireAgreementStore.getState().agreements);
          const bookingsBefore = structuredClone(useBookingStore.getState().userBookings);

          const result = await attempt(() => hireAgreementService.delete(targetId));
          const after = useHireAgreementStore.getState().agreements;

          if (referencing.length > 0) {
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error).toBeInstanceOf(HireAgreementInUseError);
            const refs = (result.error as HireAgreementInUseError).references;
            expect(refs.map((r) => r.id).sort()).toEqual(referencing.map((b) => b.id).sort());
            expect(refs.map((r) => r.reference).sort()).toEqual(referencing.map((b) => b.reference).sort());
            expect(after).toEqual(agreementsBefore);
          } else {
            expect(result.ok).toBe(true);
            expect(after.map((a) => a.id)).toEqual(agreementsBefore.filter((a) => a.id !== targetId).map((a) => a.id));
            for (const a of after) {
              expect(a).toEqual(agreementsBefore.find((x) => x.id === a.id));
            }
          }
          expect(useBookingStore.getState().userBookings).toEqual(bookingsBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects deleting an agreement referenced by a booking and lists the booking reference', async () => {
    useHireAgreementStore.setState({ agreements: [makeAgreement('ha-1')], seededOrgs: [ORG] });
    useBookingStore.setState({ userBookings: [makeBooking(1, 'ha-1')] });
    const result = await attempt(() => hireAgreementService.delete('ha-1'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as Error).message).toContain('BK-2024-0001');
    expect(useHireAgreementStore.getState().agreements).toHaveLength(1);
  });
});
