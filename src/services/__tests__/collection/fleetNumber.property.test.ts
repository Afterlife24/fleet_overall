import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fleetNumberOf } from '../../collectionCore';

// Feature: offhire-collection-docs, Property 1: Fleet number selection
// **Validates: Requirements 4.2**

const ws = fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\u00a0'), maxLength: 4 });
const text = fc.string({ maxLength: 12 });
const maybeFleet = fc.option(fc.oneof(text, ws, fc.tuple(ws, text, ws).map((t) => t.join(''))), {
  nil: undefined,
});
const asset = fc.oneof(text, fc.tuple(ws, text, ws).map((t) => t.join('')));

describe('Property 1: Fleet number selection', () => {
  it('returns trimmed fleetNo when non-empty after trim, else trimmed assetNumber', () => {
    fc.assert(
      fc.property(maybeFleet, asset, (fleetNo, assetNumber) => {
        const result = fleetNumberOf({ fleetNo, assetNumber });
        const f = (fleetNo ?? '').trim();
        expect(result).toBe(f !== '' ? f : assetNumber.trim());
      }),
      { numRuns: 200 },
    );
  });

  it('examples', () => {
    expect(fleetNumberOf({ fleetNo: ' F-1 ', assetNumber: 'A-1' })).toBe('F-1');
    expect(fleetNumberOf({ fleetNo: '   ', assetNumber: ' A-1 ' })).toBe('A-1');
    expect(fleetNumberOf({ assetNumber: 'A-1' })).toBe('A-1');
  });
});
