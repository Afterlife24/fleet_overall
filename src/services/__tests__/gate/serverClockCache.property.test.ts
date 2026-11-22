import { beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { resetServerClock, serverNow } from '@/services/serverClock';

// Feature: gate-in-qr-scan, Property 6: Cached offset produces server time
// **Validates: Requirements 7.4**
describe('serverClock cache (Property 6)', () => {
  beforeEach(() => {
    resetServerClock();
  });

  it('serves device time plus offset with no new request inside the 300 s window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 }), // device time at refresh
        fc.integer({ min: -86_400, max: 86_400 }), // offset in whole seconds
        fc.integer({ min: 0, max: 300_000 }), // elapsed since caching
        async (device, offsetSeconds, elapsed) => {
          resetServerClock();
          // Make the header a whole second so the offset is exact.
          const headerMs = Math.floor(device / 1000) * 1000 + offsetSeconds * 1000;
          const offset = headerMs - Math.floor(device / 1000) * 1000;
          let clock = Math.floor(device / 1000) * 1000;
          let calls = 0;
          const fetchFn = (async () => {
            calls += 1;
            return { headers: new Headers({ Date: new Date(headerMs).toUTCString() }) } as Response;
          }) as typeof fetch;
          const deps = { fetchFn, now: () => clock };

          await serverNow(deps);
          expect(calls).toBe(1);

          clock += elapsed;
          const result = await serverNow(deps);

          expect(calls).toBe(1);
          expect(result.source).toBe('server');
          expect(result.iso).toBe(new Date(clock + offset).toISOString());
        },
      ),
      { numRuns: 200 },
    );
  });

  it('sends a new request once the window has passed', async () => {
    let clock = 1_700_000_000_000;
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return { headers: new Headers({ Date: new Date(clock).toUTCString() }) } as Response;
    }) as typeof fetch;
    const deps = { fetchFn, now: () => clock };
    await serverNow(deps);
    clock += 300_001;
    await serverNow(deps);
    expect(calls).toBe(2);
  });
});
