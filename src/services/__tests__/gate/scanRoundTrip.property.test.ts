import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildQrPayload, type MachineLite } from '../../collectionCore';
import { resolveGateScan } from '../../gateCore';

const ORGS = ['org-a', 'org-b', 'org-c'];

// Fleet numbers carry a unique index suffix, so normalised values are unique.
const machinesArb = fc
  .array(
    fc.record({
      org: fc.constantFrom(...ORGS),
      base: fc.stringMatching(/^[A-Za-z0-9]{1,6}$/),
      pad: fc.constantFrom('', ' ', '  '),
      upper: fc.boolean(),
      useAsset: fc.boolean(),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((rows): MachineLite[] =>
    rows.map((r, i) => {
      const f = `${r.upper ? r.base.toUpperCase() : r.base}-${i}`;
      return {
        id: `m${i}`,
        orgId: r.org,
        fleetNo: r.useAsset ? undefined : `${r.pad}${f}${r.pad}`,
        assetNumber: r.useAsset ? f : `AS-${i}`,
      };
    }),
  );

describe('gateCore scan round trip', () => {
  // Feature: gate-in-qr-scan, Property 1: Scan round trip
  // **Validates: Requirements 2.1, 2.11**
  it('resolves buildQrPayload of each machine in its own org to that machine', () => {
    fc.assert(
      fc.property(machinesArb, (machines) => {
        for (const m of machines) {
          const res = resolveGateScan(buildQrPayload(m), m.orgId, machines);
          expect(res).toEqual({ ok: true, machine: m });
        }
      }),
      { numRuns: 200 },
    );
  });
});
