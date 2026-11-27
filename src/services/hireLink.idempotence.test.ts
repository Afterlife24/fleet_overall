// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper');

import { handleOnHire, toLocalISODate, type HireLinkResult } from './hireLink';
import { useBookingStore } from '@/store/bookingStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useCrmStore } from '@/store/crmStore';
import { useOrgStore } from '@/store/orgStore';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import type { Booking } from '@/types/booking';
import type { HireAgreement } from '@/types/hireagreement';
import type { Quotation, QuotationPhase } from '@/types/quotation';

// Feature: hire-agreement-planner-link, Property 10: Idempotence across trigger paths
// **Validates: Requirements 10.2, 10.3, 10.4, 14.3**

const MACHINE_ID = 'm-1';
const QT_ID = 'qt-prop';
const AG_ID = 'ha-prop';
const BK_ID = 'bk-prop';

type Step = { path: 'booking' | 'machine'; rehydrateBefore: boolean };

const stepArb: fc.Arbitrary<Step> = fc.record({
  path: fc.constantFrom('booking' as const, 'machine' as const),
  rehydrateBefore: fc.boolean(),
});

const phaseArb: fc.Arbitrary<QuotationPhase> = fc.constantFrom('Awaiting', 'Tender', 'Lost', 'Won');

function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function makeQuotation(phase: QuotationPhase): Quotation {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: QT_ID,
    orgId: JA_ORG_ID,
    number: 'QT-2025-9001',
    opportunity: 'ABC - Boom Lift',
    hireAgreementNo: 'HA-9001',
    customerId: 'CUS-1',
    customerName: 'ABC Company',
    amount: 1000,
    currency: 'AED',
    phase,
    createdAt: now,
    updatedAt: now,
    history: [{ id: 'ph-0', timestamp: now, user: 'u', fromPhase: null, toPhase: phase }],
  } as Quotation;
}

function makeAgreement(): HireAgreement {
  return {
    id: AG_ID,
    orgId: JA_ORG_ID,
    agreementNo: 'HA-9001',
    customerName: 'ABC Company',
    quotationId: QT_ID,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as unknown as HireAgreement;
}

function makeBooking(): Booking {
  return {
    id: BK_ID,
    reference: 'BK-2025-0001',
    customerId: 'c1',
    customerName: 'ABC Company',
    machineId: MACHINE_ID,
    assetNumber: 'A-1',
    machineModel: 'Boom',
    branchId: 'b1',
    branchName: 'Dubai',
    startDate: shiftedDate(-1),
    endDate: shiftedDate(1),
    status: 'On Hire',
    deliveryAddress: '',
    contactPhone: '',
    operatorRequired: false,
    dailyRate: 100,
    totalValue: 300,
    orgId: JA_ORG_ID,
    hireAgreementId: AG_ID,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as Booking;
}

function resetWorld(phase: QuotationPhase) {
  localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false });
  useOrgStore.setState({ installedApps: {} });
  useBookingStore.setState({ userBookings: [makeBooking()] });
  useHireAgreementStore.setState({ agreements: [makeAgreement()] });
  useCrmStore.setState({ quotations: [makeQuotation(phase)] });
}

async function rehydrateAll() {
  // the booking store is an in-memory mirror; there is nothing to rehydrate
}

function fire(path: Step['path']): HireLinkResult {
  return path === 'booking'
    ? handleOnHire({ source: 'booking', allocationId: BK_ID })
    : handleOnHire({ source: 'machine', machineId: MACHINE_ID });
}

const crm = () => useCrmStore.getState().quotations;

describe('hireLink idempotence across trigger paths (Property 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wins an Awaiting quotation once, whichever path fires first (example)', () => {
    resetWorld('Awaiting');
    const first = fire('machine');
    expect(first.outcome).toBe('won');
    const second = fire('booking');
    expect(second).toMatchObject({ outcome: 'skipped', reason: 'ALREADY_WON' });
    expect(crm()[0].phase).toBe('Won');
    expect(crm()[0].history).toHaveLength(2);
  });

  it('any sequence of booking/machine events changes the quotation at most once', async () => {
    await fc.assert(
      fc.asyncProperty(
        phaseArb,
        fc.array(stepArb, { minLength: 1, maxLength: 6 }),
        async (phase, steps) => {
          resetWorld(phase);
          const before = crm()[0];
          const wonBefore = before.history.filter((h) => h.toPhase === 'Won').length;

          let wins = 0;
          let afterFirstChange: Quotation | undefined;
          for (const step of steps) {
            if (step.rehydrateBefore) await rehydrateAll();
            const res = fire(step.path);
            if (res.outcome === 'won') {
              wins += 1;
              afterFirstChange = crm()[0];
            } else if (afterFirstChange) {
              // events after the Won transition leave the quotation untouched
              expect(res).toMatchObject({ reason: 'ALREADY_WON' });
              expect(crm()[0]).toEqual(afterFirstChange);
            }
          }

          const after = crm()[0];
          const wonAfter = after.history.filter((h) => h.toPhase === 'Won').length;

          if (phase === 'Awaiting' || phase === 'Tender') {
            expect(wins).toBe(1);
            expect(after.phase).toBe('Won');
            expect(wonAfter).toBe(wonBefore + 1);
            expect(after.history).toHaveLength(before.history.length + 1);
          } else {
            // Won and Lost quotations are never changed
            expect(wins).toBe(0);
            expect(after).toEqual(before);
          }
          expect(crm()).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
