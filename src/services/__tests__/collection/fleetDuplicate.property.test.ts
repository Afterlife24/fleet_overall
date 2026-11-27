import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { findDuplicateFleetNo, fleetNumberOf, type MachineLite } from '../../collectionCore';

// Feature: offhire-collection-docs, Property 2: Fleet number uniqueness is per organisation and normalised
// **Validates: Requirements 4.3, 4.4, 4.5**

const norm = (s: string) => s.trim().toLowerCase();
const ORGS = ['org-a', 'org-b', 'org-c'];

// Small alphabet with case and whitespace variants to provoke collisions.
const fleetText = fc
  .tuple(
    fc.constantFrom('', ' ', '  ', '\t'),
    fc
      .array(fc.constantFrom('a', 'A', 'b', 'B', '1', '-'), { minLength: 0, maxLength: 3 })
      .map((a) => a.join('')),
    fc.constantFrom('', ' ', '\n'),
  )
  .map(([l, c, r]) => l + c + r);

const machineArb = (id: string) =>
  fc.record({
    id: fc.constant(id),
    orgId: fc.constantFrom(...ORGS),
    fleetNo: fc.option(fleetText, { nil: undefined }),
    assetNumber: fleetText,
  });

const machinesArb = fc
  .integer({ min: 0, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => machineArb(`m${i}`))) as fc.Arbitrary<MachineLite[]>);

const candidateArb = fc.record({
  id: fc.option(fc.constantFrom('m0', 'm1', 'm2', 'new'), { nil: undefined }),
  orgId: fc.constantFrom(...ORGS),
  fleetNo: fc.option(fleetText, { nil: undefined }),
  assetNumber: fleetText,
});

describe('Property 2: fleet number duplicates', () => {
  it('reports a duplicate iff another same-org machine has an equal normalised fleet number', () => {
    fc.assert(
      fc.property(machinesArb, candidateArb, (machines, cand) => {
        const target = norm(fleetNumberOf(cand));
        const expected = machines.filter(
          (m) => m.orgId === cand.orgId && m.id !== cand.id && norm(fleetNumberOf(m)) === target,
        );
        const found = findDuplicateFleetNo(machines, cand);
        if (expected.length === 0) {
          expect(found).toBeUndefined();
        } else {
          expect(found).toBeDefined();
          expect(expected).toContain(found);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never reports machines from other organisations', () => {
    fc.assert(
      fc.property(machinesArb, candidateArb, (machines, cand) => {
        const found = findDuplicateFleetNo(machines, cand);
        if (found) expect(found.orgId).toBe(cand.orgId);
        const sameOrgOnly = machines.filter((m) => m.orgId === cand.orgId);
        expect(findDuplicateFleetNo(sameOrgOnly, cand) === undefined).toBe(found === undefined);
      }),
      { numRuns: 200 },
    );
  });

  it('matches case-insensitively after trimming', () => {
    fc.assert(
      fc.property(fleetText.filter((s) => s.trim() !== ''), (s) => {
        const other: MachineLite = { id: 'x', orgId: 'org-a', fleetNo: s, assetNumber: 'zzz' };
        const cand = { id: 'y', orgId: 'org-a', fleetNo: ` ${s.toUpperCase()} `, assetNumber: 'q' };
        expect(findDuplicateFleetNo([other], cand)).toBe(other);
      }),
      { numRuns: 100 },
    );
  });

  it('ignores the machine itself (same id)', () => {
    const m: MachineLite = { id: 'a', orgId: 'org-a', fleetNo: 'F1', assetNumber: 'A1' };
    expect(findDuplicateFleetNo([m], { ...m })).toBeUndefined();
  });
});
