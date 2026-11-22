// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper');

import * as hireLink from '@/services/hireLink';
import { toLocalISODate } from '@/services/hireLink';
import * as toasts from '@/lib/toast-helper';
import { useAppStore } from './appStore';
import { useBookingStore } from './bookingStore';
import { useHireAgreementStore } from './hireAgreementStore';
import { useCrmStore } from './crmStore';
import { useOrgStore } from './orgStore';
import { useAuthStore, JA_ORG_ID } from './authStore';
import type { Booking } from '@/types/booking';
import type { HireAgreement } from '@/types/hireagreement';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import type { MachineStatus } from '@/types/machine';

// Feature: hire-agreement-planner-link, Property 14: Failure isolation
// **Validates: Requirements 7.4, 8.7, 8.9, 11.3, 13.5**

const MACHINE_ID = 'm-iso';
const QT_ID = 'qt-iso';
const AG_ID = 'ha-iso';
const BK_ID = 'bk-iso';

type FailureMode =
  | 'none'
  | 'bookingRead'
  | 'agreementRead'
  | 'crmRead'
  | 'orgRead'
  | 'authRead'
  | 'autoWon'
  | 'toasts'
  | 'autoWonAndToasts'
  | 'handleOnHire';

const failureArb: fc.Arbitrary<FailureMode> = fc.constantFrom(
  'none',
  'bookingRead',
  'agreementRead',
  'crmRead',
  'orgRead',
  'authRead',
  'autoWon',
  'toasts',
  'autoWonAndToasts',
  'handleOnHire',
);

const OTHER_STATUSES: MachineStatus[] = [
  'Available',
  'Allocated',
  'Under Maintenance',
  'Breakdown',
  'Returned',
  'In Transit',
] as MachineStatus[];

const statusArb: fc.Arbitrary<MachineStatus> = fc.oneof(
  fc.constant('On Hire' as MachineStatus),
  fc.constantFrom(...OTHER_STATUSES),
);

const phaseArb: fc.Arbitrary<QuotationPhase> = fc.constantFrom('Awaiting', 'Tender', 'Lost', 'Won');

function shifted(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function makeQuotation(phase: QuotationPhase): Quotation {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: QT_ID,
    orgId: JA_ORG_ID,
    number: 'QT-2025-9100',
    opportunity: 'ISO - Boom Lift',
    hireAgreementNo: 'HA-9100',
    customerId: 'CUS-1',
    customerName: 'Iso Company',
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
    agreementNo: 'HA-9100',
    customerName: 'Iso Company',
    quotationId: QT_ID,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as unknown as HireAgreement;
}

function makeBooking(): Booking {
  return {
    id: BK_ID,
    reference: 'BK-2025-0100',
    customerId: 'c1',
    customerName: 'Iso Company',
    machineId: MACHINE_ID,
    assetNumber: 'A-1',
    machineModel: 'Boom',
    branchId: 'b1',
    branchName: 'Dubai',
    startDate: shifted(-1),
    endDate: shifted(1),
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
  useAppStore.setState({ machineOverrides: [] });
  useBookingStore.setState({ userBookings: [makeBooking()] });
  useHireAgreementStore.setState({ agreements: [makeAgreement()], seededOrgs: [JA_ORG_ID] });
  useCrmStore.setState({ quotations: [makeQuotation(phase)] });
}

const boom = () => {
  throw new Error('injected failure');
};

function injectFailure(mode: FailureMode) {
  const failToasts = () => {
    for (const fn of [toasts.toastError, toasts.toastInfo, toasts.toastSuccess, toasts.toastWarning]) {
      vi.mocked(fn).mockImplementation(boom);
    }
  };
  switch (mode) {
    case 'bookingRead':
      vi.spyOn(useBookingStore, 'getState').mockImplementation(boom);
      break;
    case 'agreementRead':
      vi.spyOn(useHireAgreementStore, 'getState').mockImplementation(boom);
      break;
    case 'crmRead':
      vi.spyOn(useCrmStore, 'getState').mockImplementation(boom);
      break;
    case 'orgRead':
      vi.spyOn(useOrgStore, 'getState').mockImplementation(boom);
      break;
    case 'authRead':
      vi.spyOn(useAuthStore, 'getState').mockImplementation(boom);
      break;
    case 'autoWon':
      vi.spyOn(useCrmStore.getState(), 'autoWon').mockImplementation(boom);
      break;
    case 'toasts':
      failToasts();
      break;
    case 'autoWonAndToasts':
      vi.spyOn(useCrmStore.getState(), 'autoWon').mockImplementation(boom);
      failToasts();
      break;
    case 'handleOnHire':
      // handleOnHire itself is guarded; a failure inside its first store read is covered above.
      break;
    default:
      break;
  }
}

describe('appStore.setMachineStatus failure isolation (Property 14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const fn of [toasts.toastError, toasts.toastInfo, toasts.toastSuccess, toasts.toastWarning]) {
      vi.mocked(fn).mockReset();
    }
  });

  it('moves the linked quotation to Won on On Hire when nothing fails (example)', () => {
    resetWorld('Awaiting');
    useAppStore.getState().setMachineStatus(MACHINE_ID, 'On Hire');
    expect(useCrmStore.getState().quotations[0].phase).toBe('Won');
  });

  it('always writes the override and never throws, whatever fails', () => {
    fc.assert(
      fc.property(statusArb, phaseArb, failureArb, fc.option(fc.string(), { nil: undefined }), (status, phase, mode, reason) => {
        resetWorld(phase);
        const crmBefore = JSON.parse(JSON.stringify(useCrmStore.getState().quotations));
        const spy = vi.spyOn(hireLink, 'handleOnHire');
        injectFailure(mode);

        expect(() => useAppStore.getState().setMachineStatus(MACHINE_ID, status, reason)).not.toThrow();

        const override = useAppStore.getState().machineOverrides.find((o) => o.machineId === MACHINE_ID);
        expect(override).toBeDefined();
        expect(override!.status).toBe(status);

        if (status !== 'On Hire') {
          expect(spy).not.toHaveBeenCalled();
        } else {
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy).toHaveBeenCalledWith({ source: 'machine', machineId: MACHINE_ID });
        }

        vi.restoreAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const fn of [toasts.toastError, toasts.toastInfo, toasts.toastSuccess, toasts.toastWarning]) {
          vi.mocked(fn).mockReset();
        }
        if (status !== 'On Hire') {
          expect(useCrmStore.getState().quotations).toEqual(crmBefore);
        }
      }),
      { numRuns: 100 },
    );
  });
});
