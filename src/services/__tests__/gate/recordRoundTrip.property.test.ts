import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildGateRecordFields } from '../../gateCore';

const ZONES = [
  'UTC',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
  'Asia/Kathmandu',
];

/** Independent oracle: zone offset (ms) at instant t, read from the longOffset zone name. */
function offsetMs(t: number, zone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(t))
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m) throw new Error(`unexpected zone name ${name}`);
  if (!m[1]) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** UTC instants whose local wall time in `zone` equals the given date/time. */
function utcCandidates(date: string, time: string, zone: string): number[] {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  const day = 86_400_000;
  const offsets = new Set([offsetMs(local - day, zone), offsetMs(local + day, zone)]);
  const out = new Set<number>();
  for (const off of offsets) {
    const u = local - off;
    if (offsetMs(u, zone) === off) out.add(u);
  }
  return [...out];
}

describe('gateCore local date/time round trip', () => {
  // Feature: gate-in-qr-scan, Property 9: Local date and time round trip
  // **Validates: Requirements 8.11**
  it('converts gateDate/gateTime from gateTimeZone back to the timestamp (whole seconds)', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1970-01-02T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
        fc.constantFrom(...ZONES),
        (d, zone) => {
          const r = buildGateRecordFields(d.toISOString(), zone, { assetNumber: 'A' }, 'Manual', 'server');
          const cands = utcCandidates(r.gateDate, r.gateTime, zone);
          fc.pre(cands.length === 1); // skip DST-ambiguous local times
          expect(cands[0]).toBe(Math.floor(Date.parse(r.timestamp) / 1000) * 1000);
        },
      ),
      { numRuns: 300 },
    );
  });
});
