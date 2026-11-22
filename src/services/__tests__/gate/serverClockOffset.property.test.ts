import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { computeOffset, resetServerClock, serverNow } from '@/services/serverClock';

// Feature: gate-in-qr-scan, Property 5: Clock offset round trip and accuracy
// **Validates: Requirements 7.3, 7.7, 7.10**
describe('serverClock offset (Property 5)', () => {
  beforeEach(() => {
    resetServerClock();
  });

  it('computeOffset + midpoint equals the header time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000_000, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (headerMs, sentAt, delta) => {
          const receivedAt = sentAt + delta;
          const offset = computeOffset(headerMs, sentAt, receivedAt);
          expect(offset + (sentAt + receivedAt) / 2).toBe(headerMs);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('serverNow is within 1000 ms plus half the round trip of the true server time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 }), // device time at send
        fc.integer({ min: -86_400_000, max: 86_400_000 }), // server minus device skew
        fc.integer({ min: 0, max: 3000 }), // outbound latency
        fc.integer({ min: 0, max: 3000 }), // return latency
        async (sentAt, skew, outbound, inbound) => {
          resetServerClock();
          let clock = sentAt;
          const receivedAt = sentAt + outbound + inbound;
          const fetchFn = (async () => {
            const serverTrue = sentAt + outbound + skew;
            const header = new Date(Math.floor(serverTrue / 1000) * 1000).toUTCString();
            clock = receivedAt;
            return { headers: new Headers({ Date: header }) } as Response;
          }) as typeof fetch;

          const result = await serverNow({ fetchFn, now: () => clock });

          expect(result.source).toBe('server');
          const trueServerNow = clock + skew;
          const error = Math.abs(Date.parse(result.iso) - trueServerNow);
          expect(error).toBeLessThanOrEqual(1000 + (receivedAt - sentAt) / 2);
        },
      ),
      { numRuns: 200 },
    );
  });
});
