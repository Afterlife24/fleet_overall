import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isActiveAllocation,
  resolveActiveAllocation,
  type AllocationLite,
} from './hireLinkCore';
import type { BookingStatus } from '@/types/booking';

const STATUSES: BookingStatus[] = [
  'Draft',
  'Reserved',
  'Pending Approval',
  'Approved',
  'Allocated',
  'On Hire',
  'Returned',
  'Cancelled',
];

/** Small day range so start/end/today frequently coincide (boundary dates). */
const dayArb = fc.integer({ min: 0, max: 12 }).map((n) => {
  const d = new Date(Date.UTC(2025, 0, 1 + n));
  return d.toISOString().slice(0, 10);
});

const machineArb = fc.constantFrom('m1', 'm2', 'm3');

const allocationArb = (i: number): fc.Arbitrary<AllocationLite> =>
  fc
    .record({
      machineId: machineArb,
      a: dayArb,
      b: dayArb,
      status: fc.constantFrom(...STATUSES),
    })
    .map(({ machineId, a, b, status }) => ({
      id: `bk-${i}`,
      reference: `BK-${i}`,
      machineId,
      startDate: a <= b ? a : b,
      endDate: a <= b ? b : a,
      status,
    }));

const allocationsArb = fc
  .integer({ min: 0, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => allocationArb(i))));

/** Independent oracle for the rule stated in Property 8. */
const oracle = (a: AllocationLite, machineId: string, today: string) =>
  a.machineId === machineId &&
  a.startDate <= today &&
  today <= a.endDate &&
  a.status !== 'Cancelled' &&
  a.status !== 'Returned';

describe('hireLinkCore active allocation resolution', () => {
  // Feature: hire-agreement-planner-link, Property 8: Active allocation resolution
  // **Validates: Requirements 8.3, 8.4, 8.5**
  it('Property 8: resolves exactly the active allocations of the machine', () => {
    fc.assert(
      fc.property(allocationsArb, machineArb, dayArb, (allocs, machineId, today) => {
        const expected = allocs.filter((a) => oracle(a, machineId, today));
        const result = resolveActiveAllocation(allocs, machineId, today);

        if (expected.length === 0) {
          expect(result).toEqual({ ok: false, reason: 'NO_ACTIVE_ALLOCATION' });
        } else if (expected.length === 1) {
          expect(result).toEqual({ ok: true, allocation: expected[0] });
        } else {
          expect(result).toEqual({ ok: false, reason: 'MULTIPLE_ACTIVE_ALLOCATIONS' });
          expect('allocation' in result).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  // Feature: hire-agreement-planner-link, Property 8: Active allocation resolution
  // **Validates: Requirements 8.3, 8.4, 8.5**
  it('Property 8: isActiveAllocation is inclusive on both date bounds and excludes Cancelled/Returned', () => {
    fc.assert(
      fc.property(dayArb, dayArb, dayArb, fc.constantFrom(...STATUSES), (a, b, today, status) => {
        const start = a <= b ? a : b;
        const end = a <= b ? b : a;
        const alloc: AllocationLite = {
          id: 'x',
          reference: 'X',
          machineId: 'm1',
          startDate: start,
          endDate: end,
          status,
        };
        expect(isActiveAllocation(alloc, today)).toBe(oracle(alloc, 'm1', today));
        // boundaries
        const live = status !== 'Cancelled' && status !== 'Returned';
        expect(isActiveAllocation(alloc, start)).toBe(live);
        expect(isActiveAllocation(alloc, end)).toBe(live);
      }),
      { numRuns: 200 },
    );
  });

  it('every status is covered, with single-day allocation on its boundary date', () => {
    for (const status of STATUSES) {
      const alloc: AllocationLite = {
        id: 'a',
        reference: 'A',
        machineId: 'm1',
        startDate: '2025-03-01',
        endDate: '2025-03-01',
        status,
      };
      const live = status !== 'Cancelled' && status !== 'Returned';
      expect(isActiveAllocation(alloc, '2025-03-01')).toBe(live);
      expect(isActiveAllocation(alloc, '2025-02-28')).toBe(false);
      expect(isActiveAllocation(alloc, '2025-03-02')).toBe(false);
    }
  });
});
