// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
}));

import * as toast from '@/lib/toast-helper';
import { handleOnHire, toLocalISODate } from './hireLink';
import { useBookingStore } from '@/store/bookingStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useCrmStore } from '@/store/crmStore';
import { useOrgStore } from '@/store/orgStore';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import type { Booking } from '@/types/booking';
import type { HireAgreement } from '@/types/hireagreement';
import type { Quotation, QuotationPhase } from '@/types/quotation';

// Feature: hire-agreement-planner-link, notice table (design.md, section 6)
// **Validates: Requirements 4.8, 9.7, 11.2, 13.4, 13.7, 15.2, 15.3**

const MACHINE_ID = 'm-1';
const QT_ID = 'qt-n';
const AG_ID = 'ha-n';
const BK_ID = 'bk-n';
const QT_NUMBER = 'QT-2025-9001';
const OTHER_ORG = 'org-other';
const NOW = '2025-01-01T00:00:00.000Z';

function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function makeQuotation(over: Partial<Quotation> = {}): Quotation {
  return {
    id: QT_ID,
    orgId: JA_ORG_ID,
    number: QT_NUMBER,
    opportunity: 'ABC - Boom Lift',
    hireAgreementNo: 'HA-9001',
    customerId: 'CUS-1',
    customerName: 'ABC Company',
    amount: 1000,
    currency: 'AED',
    phase: 'Awaiting' as QuotationPhase,
    createdAt: NOW,
    updatedAt: NOW,
    history: [{ id: 'ph-0', timestamp: NOW, user: 'u', fromPhase: null, toPhase: 'Awaiting' }],
    ...over,
  } as Quotation;
}

function makeAgreement(over: Partial<HireAgreement> = {}): HireAgreement {
  return {
    id: AG_ID,
    orgId: JA_ORG_ID,
    agreementNo: 'HA-9001',
    customerName: 'ABC Company',
    quotationId: QT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as unknown as HireAgreement;
}

function makeBooking(over: Partial<Booking> = {}): Booking {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Booking;
}

interface World {
  bookings?: Booking[];
  agreements?: HireAgreement[];
  quotations?: Quotation[];
  apps?: string[];
}

function setup(w: World = {}) {
  localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false });
  useOrgStore.setState({ installedApps: { [JA_ORG_ID]: w.apps ?? ['crm', 'quotation'] } });
  useBookingStore.setState({ userBookings: w.bookings ?? [makeBooking()] });
  useHireAgreementStore.setState({ agreements: w.agreements ?? [makeAgreement()], seededOrgs: [JA_ORG_ID] });
  useCrmStore.setState({ quotations: w.quotations ?? [makeQuotation()] });
}

type Helper = 'toastSuccess' | 'toastError' | 'toastWarning' | 'toastInfo';
const HELPERS: Helper[] = ['toastSuccess', 'toastError', 'toastWarning', 'toastInfo'];

function expectOnly(helper: Helper | null, text?: string) {
  for (const h of HELPERS) {
    if (h === helper) {
      expect(toast[h]).toHaveBeenCalledTimes(1);
      expect(toast[h]).toHaveBeenCalledWith(text);
    } else {
      expect(toast[h]).not.toHaveBeenCalled();
    }
  }
}

const bookingEvent = { source: 'booking' as const, allocationId: BK_ID };
const machineEvent = { source: 'machine' as const, machineId: MACHINE_ID };

describe('hireLink notice table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('won: success toast names the quotation number', () => {
    setup();
    const res = handleOnHire(bookingEvent);
    expect(res).toMatchObject({ outcome: 'won', quotationId: QT_ID, quotationNumber: QT_NUMBER });
    expectOnly('toastSuccess', `Quotation ${QT_NUMBER} moved to Won`);
  });

  it('QUOTATION_LOST: warning naming the quotation, quotation unchanged', () => {
    setup({ quotations: [makeQuotation({ phase: 'Lost' })] });
    const before = useCrmStore.getState().quotations;
    const res = handleOnHire(bookingEvent);
    expect(res).toMatchObject({ outcome: 'skipped', reason: 'QUOTATION_LOST', quotationNumber: QT_NUMBER });
    expectOnly('toastWarning', `Quotation ${QT_NUMBER} is Lost and was not changed`);
    expect(useCrmStore.getState().quotations).toEqual(before);
  });

  it('CRM_INACTIVE: info toast', () => {
    setup({ apps: ['quotation'] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'CRM_INACTIVE' });
    expectOnly('toastInfo', 'CRM app is inactive; quotation not updated');
  });

  it('QUOTATION_INACTIVE: info toast', () => {
    setup({ apps: ['crm'] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'QUOTATION_INACTIVE' });
    expectOnly('toastInfo', 'Quotation app is inactive; quotation not updated');
  });

  it('NO_ACTIVE_ALLOCATION: info toast', () => {
    setup({ bookings: [] });
    expect(handleOnHire(machineEvent)).toMatchObject({ outcome: 'skipped', reason: 'NO_ACTIVE_ALLOCATION' });
    expectOnly('toastInfo', 'No active booking linked to this machine');
  });

  it('MULTIPLE_ACTIVE_ALLOCATIONS: warning toast', () => {
    setup({ bookings: [makeBooking(), makeBooking({ id: 'bk-n2', reference: 'BK-2025-0002' })] });
    expect(handleOnHire(machineEvent)).toMatchObject({
      outcome: 'skipped',
      reason: 'MULTIPLE_ACTIVE_ALLOCATIONS',
    });
    expectOnly('toastWarning', 'Multiple active bookings; link cannot be resolved');
  });

  it('NO_AGREEMENT_ID: info toast for the machine source', () => {
    setup({ bookings: [makeBooking({ hireAgreementId: undefined })] });
    expect(handleOnHire(machineEvent)).toMatchObject({ outcome: 'skipped', reason: 'NO_AGREEMENT_ID' });
    expectOnly('toastInfo', 'Booking has no Hire Agreement');
  });

  it('NO_AGREEMENT_ID: silent for the booking source', () => {
    setup({ bookings: [makeBooking({ hireAgreementId: undefined })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'NO_AGREEMENT_ID' });
    expectOnly(null);
  });

  it('AGREEMENT_NOT_FOUND: warning toast', () => {
    setup({ agreements: [] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'AGREEMENT_NOT_FOUND' });
    expectOnly('toastWarning', 'Hire Agreement not found');
  });

  it('QUOTATION_NOT_FOUND: warning toast', () => {
    setup({ quotations: [] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'QUOTATION_NOT_FOUND' });
    expectOnly('toastWarning', 'Linked quotation not found');
  });

  it('QUOTATION_ORG_MISMATCH: error toast', () => {
    setup({ quotations: [makeQuotation({ orgId: OTHER_ORG })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'QUOTATION_ORG_MISMATCH' });
    expectOnly('toastError', 'Linked quotation belongs to another organisation');
  });

  it('AGREEMENT_ORG_MISMATCH: error toast', () => {
    setup({ agreements: [makeAgreement({ orgId: OTHER_ORG })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'AGREEMENT_ORG_MISMATCH' });
    expectOnly('toastError', 'Hire Agreement belongs to another organisation');
  });

  it('ALLOCATION_ORG_MISMATCH: error toast', () => {
    setup({ bookings: [makeBooking({ orgId: OTHER_ORG })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'ALLOCATION_ORG_MISMATCH' });
    expectOnly('toastError', 'Booking belongs to another organisation');
  });

  it('NO_QUOTATION_ID: silent', () => {
    setup({ agreements: [makeAgreement({ quotationId: '' })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'NO_QUOTATION_ID' });
    expectOnly(null);
  });

  it('ALREADY_WON: silent', () => {
    setup({ quotations: [makeQuotation({ phase: 'Won' })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'ALREADY_WON' });
    expectOnly(null);
  });

  it('NOT_ON_HIRE: silent', () => {
    setup({ bookings: [makeBooking({ status: 'Confirmed' as Booking['status'] })] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'NOT_ON_HIRE' });
    expectOnly(null);
  });

  it('ALLOCATION_NOT_FOUND: silent', () => {
    setup({ bookings: [] });
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'ALLOCATION_NOT_FOUND' });
    expectOnly(null);
  });

  it('no replay: skipped while CRM is inactive, then CRM activated, leaves the CRM store unchanged', () => {
    setup({ apps: ['quotation'] });
    const before = useCrmStore.getState().quotations;
    expect(handleOnHire(bookingEvent)).toMatchObject({ outcome: 'skipped', reason: 'CRM_INACTIVE' });

    useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
    expect(useOrgStore.getState().isAppActive(JA_ORG_ID, 'crm')).toBe(true);

    expect(useCrmStore.getState().quotations).toEqual(before);
    expect(useCrmStore.getState().quotations[0].phase).toBe('Awaiting');
  });

  it('INTERNAL_ERROR: a throwing store read never throws, logs, and shows the error toast', () => {
    setup();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(useBookingStore, 'getState').mockImplementation(() => {
      throw new Error('boom');
    });

    let res: ReturnType<typeof handleOnHire> | undefined;
    expect(() => {
      res = handleOnHire(bookingEvent);
    }).not.toThrow();

    expect(res).toEqual({ outcome: 'skipped', reason: 'INTERNAL_ERROR' });
    expect(errSpy).toHaveBeenCalledWith('[hireLink]', expect.any(Error));
    expectOnly('toastError', 'Could not update the linked quotation');
  });
});
