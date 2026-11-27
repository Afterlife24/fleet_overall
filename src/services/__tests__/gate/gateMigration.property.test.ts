import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { migrateGateRecords } from '@/services/gateCore';

const objArb = fc.record(
  {
    id: fc.oneof(fc.string({ minLength: 1, maxLength: 8 }), fc.constant(''), fc.integer()),
    orgId: fc.oneof(fc.string({ minLength: 1, maxLength: 8 }), fc.constant(''), fc.constant(undefined)),
    reference: fc.string({ maxLength: 8 }),
    driver: fc.string({ maxLength: 8 }),
    destination: fc.string({ maxLength: 8 }),
    arrivingFrom: fc.string({ maxLength: 8 }),
    createdAt: fc.constantFrom('2026-01-01T00:00:00.000Z', 'junk'),
    status: fc.constantFrom('Pending', 'Approved', 'Completed'),
  },
  { requiredKeys: [] },
);
const rowsArb = fc.array(fc.oneof(objArb, fc.integer(), fc.constant(null), fc.string(), fc.array(fc.integer())), { maxLength: 10 });

// Feature: gate-in-qr-scan, Property 18: Legacy migration is total and assigns org-ja
// **Validates: Requirements 14.8**
describe('Property 18: migrateGateRecords', () => {
  it('is total, assigns org-ja, keeps present fields and is idempotent', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const out = migrateGateRecords(rows);
        const valid = rows.filter(
          (r): r is Record<string, unknown> =>
            typeof r === 'object' && r !== null && !Array.isArray(r) &&
            typeof (r as Record<string, unknown>).id === 'string' && (r as Record<string, unknown>).id !== '',
        );
        expect(out).toHaveLength(valid.length);
        out.forEach((o, i) => {
          const src = valid[i];
          expect(typeof o.id).toBe('string');
          expect(o.id).not.toBe('');
          const hadOrg = typeof src.orgId === 'string' && src.orgId !== '';
          expect(o.orgId).toBe(hadOrg ? src.orgId : 'org-ja');
          for (const [k, v] of Object.entries(src)) {
            if (k === 'orgId') continue;
            expect((o as unknown as Record<string, unknown>)[k]).toEqual(v);
          }
        });
        expect(migrateGateRecords(out)).toEqual(out);
      }),
      { numRuns: 100 },
    );
  });

  it('does not throw for non-array input', () => {
    fc.assert(fc.property(fc.anything(), (v) => { expect(() => migrateGateRecords(v)).not.toThrow(); }), { numRuns: 100 });
  });
});
