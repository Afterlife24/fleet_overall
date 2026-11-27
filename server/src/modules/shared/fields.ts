import { z } from 'zod';

/** Required trimmed text, 1..max characters. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** Optional text where an empty string means "no value" (stored as null). */
export const nullableText = (max: number) =>
  z.union([z.string().trim().max(max).transform((v) => (v === '' ? null : v)), z.null()]);

/** Non-negative decimal accepted as a string or number and kept as a string, so no float rounding reaches numeric columns. */
export const decimal = (intDigits: number, scale: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,${scale}})?$`), 'invalid decimal'));

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Calendar date `YYYY-MM-DD`. */
export const isoDate = z.string().refine(isCalendarDate, 'invalid date');

/** Snapshot of the named keys of a DTO, used as audit before/after data. */
export function pick(dto: object, keys: readonly string[]): Record<string, unknown> {
  const d = dto as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, d[k]]));
}
