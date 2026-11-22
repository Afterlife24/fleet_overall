import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveFleetQuery,
  resolveQr,
  buildQrPayload,
  fleetNumberOf,
  normalizeFleetNo,
  type MachineLite,
} from '../../collectionCore';

// Feature: offhire-collection-docs, Property 6: Deep link resolution
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

const ORGS = ['org-a', 'org-b'];
const fleetNo = fc.stringMatching(/^[A-Za-z0-9]{1,5}$/);

const machinesArb = fc
  .array(
    fc.record({
      orgId: fc.constantFrom(...ORGS),
      fleetNo: fc.option(fleetNo, { nil: undefined }),
      assetNumber: fleetNo,
    }),
    { maxLength: 8 },
  )
  .map((xs): MachineLite[] => xs.map((x, i) => ({ id: `m-${i}`, ...x })));

const orgArb = fc.constantFrom(...ORGS);

describe('Property 6: Deep link resolution', () => {
  it('fleet+id returns the machine matching both in the org, else DEEP_LINK_NOT_FOUND', () => {
    fc.assert(
      fc.property(
        machinesArb,
        orgArb,
        fc.oneof(fleetNo, fc.constant('m-0'), fc.constant('m-1')),
        fleetNo,
        fc.boolean(),
        (machines, orgId, idRaw, fleetRaw, useReal) => {
          let id = idRaw;
          let fleet = fleetRaw;
          if (useReal && machines.length > 0) {
            const pick = machines[machines.length - 1];
            id = pick.id;
            fleet = ` ${fleetNumberOf(pick).toUpperCase()} `;
          }
          const res = resolveFleetQuery({ fleet, id }, orgId, machines);
          const expected = machines.find(
            (m) =>
              m.orgId === orgId &&
              m.id === id &&
              normalizeFleetNo(fleetNumberOf(m)) === normalizeFleetNo(fleet),
          );
          if (fleet === '' && id === '') {
            expect(res).toBeNull();
          } else if (expected) {
            expect(res).toEqual({ ok: true, machine: expected });
          } else {
            expect(res).toEqual({ ok: false, error: 'DEEP_LINK_NOT_FOUND' });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never resolves a machine from another organisation', () => {
    fc.assert(
      fc.property(machinesArb, (machines) => {
        for (const m of machines.filter((x) => x.orgId === 'org-b')) {
          const res = resolveFleetQuery({ fleet: fleetNumberOf(m), id: m.id }, 'org-a', machines);
          expect(res).toEqual({ ok: false, error: 'DEEP_LINK_NOT_FOUND' });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('qr returns the same result as resolveQr', () => {
    fc.assert(
      fc.property(
        machinesArb,
        orgArb,
        fc.nat(10),
        fc.oneof(fc.string(), fc.constant('')),
        (machines, orgId, idx, junk) => {
          const raw = machines.length > 0 && idx % 3 !== 0
            ? buildQrPayload(machines[idx % machines.length])
            : junk;
          const res = resolveFleetQuery({ qr: raw, fleet: 'x', id: 'y' }, orgId, machines);
          if (raw === '') {
            // empty qr falls back to fleet/id lookup
            expect(res).toEqual(resolveFleetQuery({ fleet: 'x', id: 'y' }, orgId, machines));
          } else {
            expect(res).toEqual(resolveQr(raw, orgId, machines));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
