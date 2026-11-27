import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { QR_PREFIX, resolveQr, type MachineLite } from '../../collectionCore';

const token = fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/);
const fleetText = fc.stringMatching(/^[A-Za-z0-9-]{1,10}$/);
const ERRORS = ['OTHER', 'OTHER_ORG', 'NOT_FOUND', 'AMBIGUOUS', 'MISMATCH'];

const payload = (org: string, id: string, fleet: string) => `${QR_PREFIX}:${org}:${id}:${fleet}`;

// Machines in `org` with unique ids "m<i>" and unique fleet numbers "F<i>-<suffix>".
const fleetOf = (i: number) => `F${i}`;
const orgMachines = (org: string, n: number): MachineLite[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    orgId: org,
    fleetNo: fleetOf(i),
    assetNumber: `A${i}`,
  }));

describe('collectionCore QR resolver errors', () => {
  // Feature: offhire-collection-docs, Property 5: QR resolver errors
  // **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 5.10**
  it('never throws and returns exactly one known outcome for any string', () => {
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
          const res = resolveQr(raw, org, machines);
          if (res.ok) {
            expect(machines).toContain(res.machine);
          } else {
            expect(ERRORS).toContain(res.error);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns OTHER for strings that do not match the payload format', () => {
    const bad = fc.oneof(
      fc.string().filter((s) => !s.startsWith(`${QR_PREFIX}:`)),
      token.map((a) => `${QR_PREFIX}:${a}`), // missing parts
      token.chain((a) => token.map((b) => `${QR_PREFIX}:${a}:${b}`)), // missing fleet
      token.chain((b) => fleetText.map((f) => `${QR_PREFIX}::${b}:${f}`)), // empty org
      token.chain((a) => fleetText.map((f) => `${QR_PREFIX}:${a}::${f}`)), // empty id
      token.chain((a) => token.map((b) => `${QR_PREFIX}:${a}:${b}:   `)), // blank fleet
    );
    fc.assert(
      fc.property(bad, token, fc.nat(4), (raw, org, n) => {
        expect(resolveQr(raw, org, orgMachines(org, n))).toEqual({ ok: false, error: 'OTHER' });
      }),
      { numRuns: 200 },
    );
  });

  it('returns OTHER_ORG for a well-formed payload with a different organisation', () => {
    fc.assert(
      fc.property(
        token,
        token,
        token,
        fleetText,
        fc.nat(4),
        (cur, other, id, fleet, n) => {
          fc.pre(cur !== other);
          expect(resolveQr(payload(other, id, fleet), cur, orgMachines(cur, n))).toEqual({
            ok: false,
            error: 'OTHER_ORG',
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns NOT_FOUND when neither id nor fleet number match an in-org machine', () => {
    fc.assert(
      fc.property(token, fc.nat(5), fleetText, (org, n, suffix) => {
        // Matching machines exist only in another org; in-org ones don't match.
        const machines = [...orgMachines(org, n), ...orgMachines(`${org}-x`, 3)];
        const raw = payload(org, `unknown-${suffix}`, `NOPE-${suffix}`);
        expect(resolveQr(raw, org, machines)).toEqual({ ok: false, error: 'NOT_FOUND' });
        // Id and fleet number that exist only in another org are also not found.
        expect(resolveQr(payload(org, 'm0', fleetOf(0)), org, orgMachines(`${org}-x`, 3))).toEqual({
          ok: false,
          error: 'NOT_FOUND',
        });
      }),
      { numRuns: 200 },
    );
  });

  it('returns AMBIGUOUS when the fleet number matches several in-org machines', () => {
    fc.assert(
      fc.property(
        token,
        fleetText,
        fc.integer({ min: 2, max: 5 }),
        fc.boolean(),
        token,
        (org, fleet, count, idMatches, pid) => {
          const machines: MachineLite[] = Array.from({ length: count }, (_, i) => ({
            id: `d${i}`,
            orgId: org,
            // normalised-equal variants: case and surrounding whitespace
            fleetNo: i % 2 === 0 ? fleet : `  ${fleet.toUpperCase()} `,
            assetNumber: `A${i}`,
          }));
          const id = idMatches ? 'd0' : `none-${pid}`;
          expect(resolveQr(payload(org, id, fleet), org, machines)).toEqual({
            ok: false,
            error: 'AMBIGUOUS',
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns MISMATCH when id and fleet number identify different machines', () => {
    fc.assert(
      fc.property(
        token,
        fc.integer({ min: 2, max: 6 }),
        fc.nat(5),
        fc.nat(5),
        (org, n, a, b) => {
          const i = a % n;
          const j = (i + 1 + (b % (n - 1))) % n; // j != i
          const machines = orgMachines(org, n);
          expect(resolveQr(payload(org, `m${i}`, fleetOf(j)), org, machines)).toEqual({
            ok: false,
            error: 'MISMATCH',
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
