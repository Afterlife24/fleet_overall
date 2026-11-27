// Pure core (no value imports): one implementation of `<PREFIX>-<year>-<4 digits>`
// shared by the TJ, GP, DN, HMQD and HTPS references.

export type RefPrefix = 'TJ' | 'GP' | 'DN' | 'HMQD' | 'HTPS';
/** Key: `${orgId}|${prefix}|${year}`. */
export type RefCounters = Record<string, number>;

export const MAX_SEQ = 9999;

export const counterKey = (orgId: string, prefix: RefPrefix, year: number): string =>
  `${orgId}|${prefix}|${year}`;

export const formatRef = (prefix: RefPrefix, year: number, seq: number): string =>
  `${prefix}-${year}-${String(seq).padStart(4, '0')}`;

export const REF_RE = /^(TJ|GP|DN|HMQD|HTPS)-(\d{4})-(\d{4})$/;

export type IssueResult =
  | { ok: true; ref: string; seq: number; counters: RefCounters }
  | { ok: false; error: 'EXHAUSTED' };

/** Never decreases a counter. Returns EXHAUSTED (counters untouched) at 9999. */
export function issueRef(
  c: RefCounters,
  orgId: string,
  prefix: RefPrefix,
  year: number,
): IssueResult {
  const key = counterKey(orgId, prefix, year);
  const current = Math.max(0, c[key] ?? 0);
  if (current >= MAX_SEQ) return { ok: false, error: 'EXHAUSTED' };
  const seq = current + 1;
  return { ok: true, ref: formatRef(prefix, year, seq), seq, counters: { ...c, [key]: seq } };
}

/** Highest sequence per key found in existing refs (migration and seed counter floor). */
export function counterFloorFromRefs(
  rows: ReadonlyArray<{ orgId: string; ref: string }>,
): RefCounters {
  const out: RefCounters = {};
  for (const r of rows) {
    const m = REF_RE.exec(r.ref);
    if (!m) continue;
    const key = counterKey(r.orgId, m[1] as RefPrefix, Number(m[2]));
    const seq = Number(m[3]);
    if (seq > (out[key] ?? 0)) out[key] = seq;
  }
  return out;
}
