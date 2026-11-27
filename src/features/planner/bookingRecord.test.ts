import { describe, expect, it } from 'vitest';
import type { Booking } from '@/types';
import { buildBookingCreate, buildBookingUpdate, displayStatus, planningStatus } from './bookingRecord';

const form = {
  customerId: 'c1', machineId: 'm1', startDate: '2026-03-01', endDate: '2026-03-10',
  deliveryAddress: ' 1 Test Road ', siteContactPhone: '+971 50 123 4567', operatorRequired: false, dailyRate: 100,
  remarks: '', hireAgreementId: '', lpoId: '',
};

const existing = {
  id: 'b1', reference: 'BK-1', customerId: 'c1', machineId: 'm1', startDate: '2026-03-01', endDate: '2026-03-10',
  deliveryAddress: '1 Test Road', contactPhone: '+971 50 123 4567', operatorRequired: false, dailyRate: 100,
  status: 'Reserved', rowVersion: 3,
} as unknown as Booking;

describe('planningStatus', () => {
  it('is Allocated only when every gate is done and nothing is held', () => {
    expect(planningStatus({ quoted: true, haSent: true, haReceived: true, lpoId: 'l1' })).toBe('Allocated');
    expect(planningStatus({ quoted: true, haSent: true, haReceived: true, lpoId: 'l1', reserved: true })).toBe('Reserved');
    expect(planningStatus({ quoted: true, haSent: true, haReceived: false, lpoId: 'l1' })).toBe('Reserved');
    expect(planningStatus({ quoted: true, haSent: true, haReceived: true, lpoId: '' })).toBe('Reserved');
  });
});

describe('buildBookingCreate', () => {
  it('maps the form to the API body and never sends On Hire or Returned', () => {
    const body = buildBookingCreate(form, 'Reserved');
    expect(body).toMatchObject({
      machineId: 'm1', customerId: 'c1', hireAgreementId: null, lpoId: null, status: 'Reserved',
      deliveryAddress: '1 Test Road', contactPhone: '+971 50 123 4567', dailyRate: '100', notes: null,
    });
    expect(body).not.toHaveProperty('totalValue');
  });
});

describe('buildBookingUpdate', () => {
  it('sends only changed fields', () => {
    expect(buildBookingUpdate(form, 'Reserved', existing)).toEqual({});
    expect(buildBookingUpdate({ ...form, endDate: '2026-03-12', lpoId: 'l1' }, 'Reserved', existing))
      .toEqual({ endDate: '2026-03-12', lpoId: 'l1' });
  });

  it('leaves the status out for a booking that is already On Hire', () => {
    const onHire = { ...existing, status: 'On Hire' } as Booking;
    expect(buildBookingUpdate(form, 'Allocated', onHire)).not.toHaveProperty('status');
  });
});

describe('displayStatus', () => {
  it('takes Returned from the server returnedAt, not from the planned dates', () => {
    expect(displayStatus({ status: 'On Hire', returnedAt: null, physicallyOccupied: true, endDate: '2020-01-01' }, '2026-03-05'))
      .toBe('On Hire (overdue)');
    expect(displayStatus({ status: 'Allocated', returnedAt: null, physicallyOccupied: false, endDate: '2020-01-01' }, '2026-03-05'))
      .toBe('Allocated');
    expect(displayStatus({ status: 'On Hire', returnedAt: '2026-03-04T10:00:00Z', physicallyOccupied: false, endDate: '2026-03-10' }, '2026-03-05'))
      .toBe('Returned');
  });
});
