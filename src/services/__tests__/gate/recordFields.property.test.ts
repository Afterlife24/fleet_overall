import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fleetNumberOf } from '../../collectionCore';
import { buildGateRecordFields } from '../../gateCore';

export const ZONES = [
  'UTC',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
  'Asia/Kathmandu',
];

const instant = fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true });
const machine = fc.record({
  fleetNo: fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
  assetNumber: fc.string({ maxLength: 8 }),
});

describe('gateCore buildGateRecordFields', () => {
  // Feature: gate-in-qr-scan, Property 8: Record fields are consistent and deterministic
  // **Validates: Requirements 8.5, 8.6, 8.7, 8.8, 8.9, 8.10**
  it('produces well-formed, deterministic fields', () => {
    fc.assert(
      fc.property(
        instant,
        fc.constantFrom(...ZONES),
        machine,
        fc.constantFrom('QR', 'Manual' as const),
        fc.constantFrom('server', 'device' as const),
        fc.option(fc.string(), { nil: undefined }),
        (d, zone, m, method, source, payload) => {
          const iso = d.toISOString();
          const r = buildGateRecordFields(iso, zone, m, method, source, payload);
          expect(r.timestamp).toBe(iso);
          expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          expect(r.gateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(r.gateTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
          expect(r.gateTimeZone).toBe(zone);
          expect(r.fleetNo).toBe(fleetNumberOf(m));
          expect(r.captureMethod).toBe(method);
          expect(r.timeSource).toBe(source);
          if (method === 'QR' && payload !== undefined) expect(r.qrPayload).toBe(payload);
          else expect('qrPayload' in r).toBe(false);
          expect(buildGateRecordFields(iso, zone, m, method, source, payload)).toEqual(r);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('throws RangeError for an invalid instant or zone', () => {
    const m = { assetNumber: 'A1' };
    expect(() => buildGateRecordFields('nope', 'UTC', m, 'Manual', 'server')).toThrow(RangeError);
    expect(() =>
      buildGateRecordFields('2025-01-15T08:30:00.000Z', 'Mars/Phobos', m, 'Manual', 'server'),
    ).toThrow(RangeError);
  });
});
