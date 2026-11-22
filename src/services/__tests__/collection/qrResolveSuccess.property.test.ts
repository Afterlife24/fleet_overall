import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildQrPayload,
  fleetNumberOf,
  normalizeFleetNo,
  resolveQr,
  type MachineLite,
} from '../../collectionCore';

// Ids and org ids never contain the ':' separator; fleet numbers may.
const token = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const fleetText = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim() !== '');

const scenario = fc
  .record({
    org: token,
    otherOrg: token,
    target: fc.record({
      id: token,
      fleetNo: fleetText,
      assetNumber: fleetText,
      useFleetNo: fc.boolean(),
    }),
    others: fc.array(
      fc.record({
        fleetNo: fc.option(fleetText, { nil: undefined }),
        assetNumber: fleetText,
        inOtherOrg: fc.boolean(),
        sameFleetAsTarget: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    insertAt: fc.nat(8),
  })
  .filter((s) => s.org !== s.otherOrg)
  .map((s) => {
    const target: MachineLite = {
      id: s.target.id,
      orgId: s.org,
      fleetNo: s.target.useFleetNo ? s.target.fleetNo : undefined,
      assetNumber: s.target.assetNumber,
    };
    const targetKey = normalizeFleetNo(fleetNumberOf(target));
    const seen = new Set<string>([targetKey]);
    const others: MachineLite[] = [];
    s.others.forEach((o, i) => {
      const m: MachineLite = {
        id: `other-${i}-${s.target.id}`,
        orgId: o.inOtherOrg ? s.otherOrg : s.org,
        fleetNo: o.sameFleetAsTarget && o.inOtherOrg ? target.fleetNo : o.fleetNo,
        assetNumber:
          o.sameFleetAsTarget && o.inOtherOrg ? target.assetNumber : o.assetNumber,
      };
      const key = normalizeFleetNo(fleetNumberOf(m));
      if (m.orgId === s.org) {
        if (seen.has(key)) return; // keep in-org fleet numbers unique
        seen.add(key);
      }
      others.push(m);
    });
    const machines = [...others];
    machines.splice(Math.min(s.insertAt, machines.length), 0, target);
    return { org: s.org, target, machines };
  });

describe('collectionCore QR resolver success', () => {
  // Feature: offhire-collection-docs, Property 4: QR resolver success
  // **Validates: Requirements 5.5**
  it('resolveQr(buildQrPayload(M)) returns ok with M when M has a unique normalised fleet number', () => {
    fc.assert(
      fc.property(scenario, ({ org, target, machines }) => {
        const res = resolveQr(buildQrPayload(target), org, machines);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.machine).toBe(target);
      }),
      { numRuns: 200 },
    );
  });

  it('resolves a simple example', () => {
    const m: MachineLite = { id: 'm1', orgId: 'org-a', fleetNo: 'FL-001', assetNumber: 'A1' };
    const res = resolveQr(buildQrPayload(m), 'org-a', [m]);
    expect(res).toEqual({ ok: true, machine: m });
  });
});
