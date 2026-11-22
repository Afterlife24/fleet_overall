import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { QR_PREFIX, resolveQr, type MachineLite } from '../../collectionCore';
import { resolveGateScan } from '../../gateCore';

const token = fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/);
const fleetText = fc.stringMatching(/^[A-Za-z0-9-]{1,10}$/);
const payload = (org: string, id: string, fleet: string) => `${QR_PREFIX}:${org}:${id}:${fleet}`;
const orgMachines = (org: string, n: number): MachineLite[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    orgId: org,
    fleetNo: `F${i}`,
    assetNumber: `A${i}`,
  }));

describe('gateCore scan error classification', () => {
  // Feature: gate-in-qr-scan, Property 2: Scan errors are classified and match resolveQr
  // **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.9**
  it('equals resolveQr for arbitrary strings, orgs and machine lists', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string().map((s) => `${QR_PREFIX}:${s}`)),
        token,
        fc.array(
          fc.record({
            id: token,
            orgId: token,
            fleetNo: fc.option(fleetText, { nil: undefined }),
            assetNumber: fleetText,
          }),
          { maxLength: 6 },
        ),
        (raw, org, machines) => {
          const res = resolveGateScan(raw, org, machines);
          expect(res).toEqual(resolveQr(raw, org, machines));
          if (!res.ok) expect('machine' in res).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns OTHER for malformed payloads', () => {
    const bad = fc.oneof(
      fc.string().filter((s) => !s.startsWith(`${QR_PREFIX}:`)),
      token.map((a) => `${QR_PREFIX}:${a}`),
      token.chain((a) => token.map((b) => `${QR_PREFIX}:${a}:${b}`)),
      token.chain((a) => token.map((b) => `${QR_PREFIX}:${a}:${b}:   `)),
    );
    fc.assert(
      fc.property(bad, token, fc.nat(4), (raw, org, n) => {
        expect(resolveGateScan(raw, org, orgMachines(org, n))).toEqual({ ok: false, error: 'OTHER' });
      }),
      { numRuns: 100 },
    );
  });

  it('returns OTHER_ORG for a different org', () => {
    fc.assert(
      fc.property(token, token, token, fleetText, fc.nat(4), (cur, other, id, fleet, n) => {
        fc.pre(cur !== other);
        expect(resolveGateScan(payload(other, id, fleet), cur, orgMachines(cur, n))).toEqual({
          ok: false,
          error: 'OTHER_ORG',
        });
      }),
      { numRuns: 100 },
    );
  });

  it('returns NOT_FOUND when nothing matches in the org', () => {
    fc.assert(
      fc.property(token, fc.nat(5), fleetText, (org, n, suffix) => {
        const machines = [...orgMachines(org, n), ...orgMachines(`${org}-x`, 3)];
        expect(
          resolveGateScan(payload(org, `unknown-${suffix}`, `NOPE-${suffix}`), org, machines),
        ).toEqual({ ok: false, error: 'NOT_FOUND' });
      }),
      { numRuns: 100 },
    );
  });

  it('returns AMBIGUOUS for fleet numbers that differ only by case or whitespace', () => {
    fc.assert(
      fc.property(
        token,
        fleetText,
        fc.integer({ min: 2, max: 5 }),
        fc.boolean(),
        (org, fleet, count, idMatches) => {
          const machines: MachineLite[] = Array.from({ length: count }, (_, i) => ({
            id: `d${i}`,
            orgId: org,
            fleetNo: i % 2 === 0 ? fleet : `  ${fleet.toUpperCase()} `,
            assetNumber: `A${i}`,
          }));
          const id = idMatches ? 'd0' : 'none';
          expect(resolveGateScan(payload(org, id, fleet), org, machines)).toEqual({
            ok: false,
            error: 'AMBIGUOUS',
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns MISMATCH when id and fleet number identify different machines', () => {
    fc.assert(
      fc.property(token, fc.integer({ min: 2, max: 6 }), fc.nat(5), fc.nat(5), (org, n, a, b) => {
        const i = a % n;
        const j = (i + 1 + (b % (n - 1))) % n;
        expect(
          resolveGateScan(payload(org, `m${i}`, `F${j}`), org, orgMachines(org, n)),
        ).toEqual({ ok: false, error: 'MISMATCH' });
      }),
      { numRuns: 100 },
    );
  });

  it('returns MISMATCH when only the fleet number is found', () => {
    fc.assert(
      fc.property(token, fc.integer({ min: 1, max: 6 }), fc.nat(5), (org, n, a) => {
        const j = a % n;
        expect(
          resolveGateScan(payload(org, 'ghost', `f${j}`), org, orgMachines(org, n)),
        ).toEqual({ ok: false, error: 'MISMATCH' });
      }),
      { numRuns: 100 },
    );
  });
});
