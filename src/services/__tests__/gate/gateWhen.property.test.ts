import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildGateRecordFields, formatGateWhen } from '../../gateCore';

const GOOD_ZONES = ['UTC', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
const instantIso = fc
  .date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString());
const maybeInstant = fc.option(fc.oneof(instantIso, fc.constantFrom('not a date', '', 'garbage')), {
  nil: undefined,
});
const zoneArb = fc.option(
  fc.oneof(fc.constantFrom(...GOOD_ZONES), fc.constantFrom('Mars/Phobos', '', 'nowhere')),
  { nil: undefined },
);
const entry = fc.record({
  gateDate: fc.option(fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/), { nil: undefined }),
  gateTime: fc.option(fc.stringMatching(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/), { nil: undefined }),
  gateTimeZone: zoneArb,
  timestamp: maybeInstant,
  createdAt: maybeInstant,
});

const usable = (v?: string) => v !== undefined && Number.isFinite(Date.parse(v)) && v !== '';

describe('gateCore formatGateWhen', () => {
  // Feature: gate-in-qr-scan, Property 13: Gate display fallback order
  // **Validates: Requirements 12.2, 12.3, 12.4, 12.5**
  it('follows stored -> timestamp -> createdAt -> UTC/Unknown/unavailable', () => {
    fc.assert(
      fc.property(entry, (e) => {
        const r = formatGateWhen(e);
        const zoneOk = e.gateTimeZone !== undefined && GOOD_ZONES.includes(e.gateTimeZone);
        const hasStored = !!e.gateDate && !!e.gateTime;
        const src = usable(e.timestamp) ? e.timestamp : usable(e.createdAt) ? e.createdAt : undefined;

        if (hasStored && zoneOk) {
          expect(r).toEqual({ available: true, date: e.gateDate, time: e.gateTime, zone: e.gateTimeZone });
        } else if (src) {
          expect(r.available).toBe(true);
          expect(r.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
          const iso = new Date(src).toISOString();
          if (zoneOk) {
            const b = buildGateRecordFields(iso, e.gateTimeZone!, { assetNumber: 'A' }, 'Manual', 'server');
            expect(r).toEqual({ available: true, date: b.gateDate, time: b.gateTime, zone: e.gateTimeZone });
          } else {
            expect(r.zone).toBe('UTC');
            expect(r.date).toBe(iso.slice(0, 10));
            expect(r.time).toBe(iso.slice(11, 19));
          }
        } else if (hasStored) {
          expect(r).toEqual({ available: true, date: e.gateDate, time: e.gateTime, zone: 'Unknown' });
        } else {
          expect(r).toEqual({ available: false });
        }
      }),
      { numRuns: 300 },
    );
  });
});
