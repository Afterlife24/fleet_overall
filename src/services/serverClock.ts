import type { TimeSource } from '@/types/gate';

export interface ServerTime {
  iso: string;
  source: TimeSource;
}

export interface ClockDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  url?: string;
  timeoutMs?: number;
  ttlMs?: number;
}

const DEFAULT_URL = '/';
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_TTL_MS = 300_000;

let cache: { offset: number; cachedAt: number } | null = null;
let inflight: Promise<number | null> | null = null;
let generation = 0;

/** offset = headerMs - (sentAt + receivedAt) / 2. Pure. */
export function computeOffset(headerMs: number, sentAt: number, receivedAt: number): number {
  return headerMs - (sentAt + receivedAt) / 2;
}

/** Clears the cached offset and any in-flight marker. */
export function resetServerClock(): void {
  cache = null;
  inflight = null;
  generation += 1;
}

async function refresh(
  fetchFn: typeof fetch,
  now: () => number,
  url: string,
  timeoutMs: number,
): Promise<number | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sentAt = now();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Server clock request timed out'));
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchFn(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal }),
      timeout,
    ]);
    const receivedAt = now();
    const header = response.headers.get('Date');
    if (!header) return null;
    const headerMs = Date.parse(header);
    if (Number.isNaN(headerMs)) return null;
    const offset = computeOffset(headerMs, sentAt, receivedAt);
    return Number.isFinite(offset) ? offset : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Never throws. Reuses a cached offset for ttlMs. One HEAD request at a time. */
export async function serverNow(deps: ClockDeps = {}): Promise<ServerTime> {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  try {
    if (cache && now() - cache.cachedAt <= ttlMs) {
      return { iso: new Date(now() + cache.offset).toISOString(), source: 'server' };
    }

    if (!inflight) {
      const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
      const myGeneration = generation;
      const promise: Promise<number | null> = refresh(
        fetchFn,
        now,
        deps.url ?? DEFAULT_URL,
        deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )
        .then((offset) => {
          if (offset !== null && myGeneration === generation) {
            cache = { offset, cachedAt: now() };
          }
          return offset;
        })
        .finally(() => {
          if (inflight === promise) inflight = null;
        });
      inflight = promise;
    }

    const offset = await inflight;
    if (offset !== null) {
      return { iso: new Date(now() + offset).toISOString(), source: 'server' };
    }
  } catch {
    // fall through to device time
  }
  return { iso: new Date(now()).toISOString(), source: 'device' };
}
