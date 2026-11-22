import { beforeEach, describe, expect, it } from 'vitest';
import { resetServerClock, serverNow } from '@/services/serverClock';

function setup() {
  const clock = 1_700_000_000_000;
  const state = { calls: 0, release: () => {} };
  const fetchFn = ((_url: unknown, init?: RequestInit) => {
    state.calls += 1;
    expect(init?.method).toBe('HEAD');
    expect(init?.cache).toBe('no-store');
    return new Promise<Response>((resolve) => {
      state.release = () =>
        resolve({ headers: new Headers({ Date: new Date(clock + 5000).toUTCString() }) } as Response);
    });
  }) as typeof fetch;
  return { state, deps: { fetchFn, now: () => clock } };
}

describe('serverClock concurrency', () => {
  beforeEach(() => {
    resetServerClock();
  });

  it('shares one HEAD request among concurrent calls', async () => {
    const { state, deps } = setup();
    const calls = [serverNow(deps), serverNow(deps), serverNow(deps)];
    expect(state.calls).toBe(1);
    state.release();
    const results = await Promise.all(calls);
    expect(state.calls).toBe(1);
    for (const r of results) {
      expect(r).toEqual({ iso: new Date(1_700_000_005_000).toISOString(), source: 'server' });
    }
  });

  it('sends a new request after resetServerClock', async () => {
    const { state, deps } = setup();
    const first = serverNow(deps);
    state.release();
    await first;
    await serverNow(deps); // cached, no request
    expect(state.calls).toBe(1);

    resetServerClock();
    const again = serverNow(deps);
    expect(state.calls).toBe(2);
    state.release();
    await again;
  });
});
