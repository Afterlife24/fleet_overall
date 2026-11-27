import { AppError } from '../../errors.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

function positiveInt(raw: unknown, field: string, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new AppError('VALIDATION_ERROR', 'Invalid pagination parameter', { [field]: 'invalid' });
  }
  return n;
}

/** Parses `page` (1-based) and `pageSize` query values; rejects invalid input with a 422. */
export function parsePagination(query: { page?: unknown; pageSize?: unknown }): Pagination {
  const page = positiveInt(query.page, 'page', 1, 1_000_000);
  const pageSize = positiveInt(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export interface SortSpec {
  column: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Parses `sort=field` or `sort=-field` against a whitelist mapping API field names to SQL columns.
 * The returned column always comes from the whitelist, never from the request.
 */
export function parseSort(
  raw: unknown,
  whitelist: Readonly<Record<string, string>>,
  fallback: SortSpec,
): SortSpec {
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') throw new AppError('VALIDATION_ERROR', 'Invalid sort', { sort: 'invalid' });
  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;
  if (!Object.prototype.hasOwnProperty.call(whitelist, field)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid sort field', { sort: 'invalid_field' });
  }
  return { column: whitelist[field], direction: desc ? 'DESC' : 'ASC' };
}
