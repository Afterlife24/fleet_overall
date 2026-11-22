import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { resetServerClock, serverNow } from '@/services/serverClock';

type Kind = 'rejected' | 'timeout' | 'missingHeader' | 'unparseableHeader';

function makeFetch(kind: Kind, garbage: string, counter: { calls: number }): typeof fetch {
  return ((_url: unknown, init?: RequestInit) => {
    counter.calls += 1;
    switch (kind) {
      case 'rejected':
        return Promise.reject(new TypeError('network down'));
      case 'timeout':
        // Settles only when aborted, like a real fetch.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      case 'missingHeader':
        return Promise.resolve({ headers: new Headers() } as Response);
      case 'unparseableHeader':
        return Promise.resolve({ headers: new Headers({ Date: garbage }) } as Response);
    }
  }) as typeof fetch;
}

// Feature: gate-in-qr-scan, Property 7: Clock failure falls back to device time
// **Validates: Requirements 7.5**
describe('serverClock failure (Property 7)', () => {
  beforeEach(() => {
    resetServerClock();
  });

  it('falls back to device time, never throws, and does not cache', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Kind>('rejected', 'timeout', 'missingHeader', 'unparseableHeader'),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.stringMatching(/^[a-z]{3,12}$/).filter((s) => Number.isNaN(Date.parse(s))),
        async (kind, device, garbage) => {
          resetServerClock();
          const counter = { calls: 0 };
          const deps = {
            fetchFn: makeFetch(kind, garbage, counter),
            now: () => device,
            timeoutMs: 3,
          };

          const first = await serverNow(deps);
          expect(first).toEqual({ iso: new Date(device).toISOString(), source: 'device' });
          expect(counter.calls).toBe(1);

          const second = await serverNow(deps);
          expect(second.source).toBe('device');
          expect(counter.calls).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('serverClock default timeout', () => {
  beforeEach(() => {
    resetServerClock();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up after 2000 ms by default and uses device time', async () => {
    const counter = { calls: 0 };
    const pending = serverNow({ fetchFn: makeFetch('timeout', '', counter), now: () => 5000 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ iso: new Date(5000).toISOString(), source: 'device' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
