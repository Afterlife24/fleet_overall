import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateServiceLine } from '../../collectionCore';

const TYPES = ['Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other'];

const validNum = fc.double({ min: 0, max: 1e9, noNaN: true });
const anyNum = fc.oneof(
  validNum,
  fc.double({ min: -1e9, max: -Number.MIN_VALUE, noNaN: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 0),
);
const anyValue = fc.oneof(anyNum, fc.string(), fc.constant(null), fc.constant(undefined), fc.boolean());
const anyType = fc.oneof(fc.constantFrom(...TYPES), fc.string(), fc.constantFrom('transport', 'Other '));

const isGoodNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

describe('serviceLineValidation property', () => {
  // Feature: offhire-collection-docs, Property 15: Service line validation
  // **Validates: Requirements 9.4, 9.10**
  it('accepts iff type is allowed and quantity and rate are finite non-negative numbers', () => {
    fc.assert(
      fc.property(anyType, anyValue, anyValue, (serviceType, quantity, rate) => {
        const res = validateServiceLine({ serviceType, quantity, rate });
        const expected = TYPES.includes(serviceType) && isGoodNum(quantity) && isGoodNum(rate);
        expect(res.ok).toBe(expected);
        if (!res.ok) {
          const field = !TYPES.includes(serviceType) ? 'serviceType' : !isGoodNum(quantity) ? 'quantity' : 'rate';
          expect(res.field).toBe(field);
        }
      }),
      { numRuns: 200 },
    );
  });
});
