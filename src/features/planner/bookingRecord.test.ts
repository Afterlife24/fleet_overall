import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildBookingRecord, type BookingRecordFormData } from './bookingRecord';
import type { Booking } from '@/types';

// Feature: hire-agreement-planner-link, Property 6: Booking record builder
// **Validates: Requirements 4.5, 4.6, 4.8, 6.4, 15.4**

const str = fc.string({ minLength: 0, maxLength: 12 });
const idStr = fc.string({ minLength: 1, maxLength: 12 });
const isoNow = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString());

// Agreement field: arbitrary text, optionally padded with whitespace, sometimes only whitespace/empty/undefined.
const ws = fc.stringMatching(/^[ \t\n]{0,3}$/);
const agreementField = fc.oneof(
  fc.constant(undefined),
  ws,
  fc.tuple(ws, idStr, ws).map(([a, b, c]) => `${a}${b}${c}`),
  fc.string({ maxLength: 12 }),
);

const formData = fc.record({
  customerId: idStr,
  machineId: idStr,
  branchId: idStr,
  startDate: fc.constant('2025-01-01'),
  endDate: fc.constant('2025-01-05'),
  deliveryAddress: str,
  siteContactPhone: str,
  operatorRequired: fc.boolean(),
  dailyRate: fc.integer({ min: 0, max: 100000 }),
  remarks: fc.option(str, { nil: undefined }),
  hireAgreementId: agreementField,
});

const existingBooking = fc
  .record({
    id: idStr,
    reference: idStr,
    createdAt: isoNow,
    orgId: fc.option(idStr, { nil: undefined }),
    hireAgreementId: fc.option(idStr, { nil: undefined }),
  })
  .map((r) => r as unknown as Booking);

const names = fc.record({
  customerName: str,
  assetNumber: str,
  machineModel: str,
  branchName: str,
});

const common = {
  names,
  status: fc.constantFrom('Draft', 'Reserved', 'On Hire') as fc.Arbitrary<Booking['status']>,
  totalValue: fc.integer({ min: 0, max: 1_000_000 }),
  orgId: idStr,
  now: isoNow,
  idSeed: fc.integer({ min: 1, max: 9_999_999_999_999 }),
};

const expectedAgreement = (raw: string | undefined) => (typeof raw === 'string' ? raw.trim() : '');

function checkAgreement(rec: Booking, raw: string | undefined) {
  const want = expectedAgreement(raw);
  if (want) {
    expect(rec.hireAgreementId).toBe(want);
  } else {
    expect('hireAgreementId' in rec).toBe(false);
  }
}

describe('Property 6: Booking record builder', () => {
  it('edit mode preserves identity from the existing booking', () => {
    fc.assert(
      fc.property(
        formData,
        existingBooking,
        common.names,
        common.status,
        common.totalValue,
        common.orgId,
        common.now,
        common.idSeed,
        (data, existing, nm, status, totalValue, orgId, now, idSeed) => {
          const rec = buildBookingRecord({
            mode: 'edit', data: data as BookingRecordFormData, existing, orgId, now,
            names: nm, status, totalValue, idSeed,
          });
          expect(rec.id).toBe(existing.id);
          expect(rec.reference).toBe(existing.reference);
          expect(rec.createdAt).toBe(existing.createdAt);
          expect(rec.orgId).toBe(existing.orgId ?? orgId);
          expect(rec.updatedAt).toBe(now);
          checkAgreement(rec, data.hireAgreementId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('create mode makes a new id and reference and uses the active org', () => {
    fc.assert(
      fc.property(
        formData,
        common.names,
        common.status,
        common.totalValue,
        common.orgId,
        common.now,
        common.idSeed,
        (data, nm, status, totalValue, orgId, now, idSeed) => {
          const rec = buildBookingRecord({
            mode: 'create', data: data as BookingRecordFormData, orgId, now,
            names: nm, status, totalValue, idSeed,
          });
          expect(rec.id).toBe(`bk-user-${idSeed}`);
          expect(rec.reference).toMatch(/^BK-\d{4}-\d{1,4}$/);
          expect(rec.orgId).toBe(orgId);
          expect(rec.createdAt).toBe(now);
          expect(rec.updatedAt).toBe(now);
          checkAgreement(rec, data.hireAgreementId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('form data cannot override identity keys', () => {
    fc.assert(
      fc.property(formData, existingBooking, common.orgId, common.now, (data, existing, orgId, now) => {
        const hostile = {
          ...data,
          id: 'evil-id',
          reference: 'evil-ref',
          createdAt: 'evil-created',
          orgId: 'evil-org',
        } as BookingRecordFormData;
        const base = {
          data: hostile, orgId, now, status: 'Reserved' as const, totalValue: 1, idSeed: 12345,
          names: { customerName: 'c', assetNumber: 'a', machineModel: 'm', branchName: 'b' },
        };
        const edit = buildBookingRecord({ ...base, mode: 'edit', existing });
        expect(edit.id).toBe(existing.id);
        expect(edit.reference).toBe(existing.reference);
        expect(edit.createdAt).toBe(existing.createdAt);
        expect(edit.orgId).toBe(existing.orgId ?? orgId);
        const created = buildBookingRecord({ ...base, mode: 'create' });
        expect(created.id).toBe('bk-user-12345');
        expect(created.orgId).toBe(orgId);
        expect(created.createdAt).toBe(now);
      }),
      { numRuns: 100 },
    );
  });

  it('clearing the agreement on edit removes a previously linked id', () => {
    const existing = { id: 'x', reference: 'BK-2025-0001', createdAt: '2025-01-01T00:00:00.000Z', hireAgreementId: 'ha-1' } as unknown as Booking;
    const rec = buildBookingRecord({
      mode: 'edit',
      data: { customerId: 'c', machineId: 'm', branchId: 'b', startDate: '2025-01-01', endDate: '2025-01-02',
        deliveryAddress: '', siteContactPhone: '', operatorRequired: false, dailyRate: 1, hireAgreementId: '   ' },
      existing, orgId: 'org', now: '2025-02-01T00:00:00.000Z',
      names: { customerName: '', assetNumber: '', machineModel: '', branchName: '' },
      status: 'Reserved', totalValue: 1, idSeed: 1,
    });
    expect('hireAgreementId' in rec).toBe(false);
    expect(rec.orgId).toBe('org');
  });
});
