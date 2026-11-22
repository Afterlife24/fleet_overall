import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { demoDay, integrityViolations, planSeeds, type IntegritySnapshot } from '../seedCore';

const idArb = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 1, maxLength: 2 }).map((a) => a.join(''));

// Feature: rental-flow-integration, Property 16: Seed plan respects user changes
describe('Property 16: Seed plan respects user changes', () => {
  it('returns exactly the seeds that are neither marked nor present', () => {
    fc.assert(
      fc.property(
        fc.array(idArb, { maxLength: 8 }),
        fc.array(idArb, { maxLength: 8 }),
        fc.uniqueArray(idArb, { maxLength: 10 }),
        (markers, existing, seedIds) => {
          const seeds = seedIds.map((id) => ({ id, v: 'seed' }));
          const plan = planSeeds(markers, new Set(existing), seeds);
          const expected = seeds.filter((s) => !markers.includes(s.id) && !existing.includes(s.id));
          expect(plan).toEqual(expected);
          // deleted (marked, absent) seeds are not re-added; edited (present) are not replaced
          for (const id of markers) expect(plan.some((s) => s.id === id)).toBe(false);
          for (const id of existing) expect(plan.some((s) => s.id === id)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('seedCore helpers', () => {
  it('demoDay is local YYYY-MM-DD plus offset', () => {
    expect(demoDay(new Date(2026, 0, 31, 23, 59), 1)).toBe('2026-02-01');
    expect(demoDay(new Date(2026, 2, 1), -1)).toBe('2026-02-28');
    fc.assert(
      fc.property(
        fc.date({ min: new Date(2000, 0, 1), max: new Date(2040, 0, 1), noInvalidDate: true }),
        fc.integer({ min: -400, max: 400 }),
        (today, off) => {
          const s = demoDay(today, off);
          expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          const [y, m, d] = s.split('-').map(Number);
          const exp = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
          expect([y, m, d]).toEqual([exp.getFullYear(), exp.getMonth() + 1, exp.getDate()]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('integrityViolations flags dangling refs and customer mismatches, per company', () => {
    const empty: IntegritySnapshot = {
      customers: [], quotations: [], agreements: [], bookings: [], machines: [], invoices: [],
      collectionNotes: [], mqd: [], tps: [], transportJobs: [], drivers: [], trucks: [],
      hireDocs: [], gateRecords: [],
    };
    const good: IntegritySnapshot = {
      ...empty,
      customers: [{ id: 'c1', orgId: 'o', customerId: 'CUST-1', name: 'ABC Company LLC' }],
      quotations: [{ id: 'q1', orgId: 'o', customerId: 'CUST-1', customerName: 'ABC Company LLC' }],
      gateRecords: [{ id: 'g1', orgId: 'o', quotationId: 'q1' }],
    };
    expect(integrityViolations('o', good)).toEqual([]);
    const bad: IntegritySnapshot = {
      ...good,
      quotations: [{ id: 'q1', orgId: 'o', customerId: 'CUST-1', customerName: 'Other' }],
      gateRecords: [{ id: 'g1', orgId: 'o', quotationId: 'q1', machineId: 'm9' }],
    };
    expect(integrityViolations('o', bad)).toHaveLength(2);
    // a reference that resolves only in another company is dangling
    const cross: IntegritySnapshot = { ...good, quotations: [{ ...good.quotations[0], orgId: 'p' }] };
    expect(integrityViolations('o', cross)).toHaveLength(1);
  });
});
