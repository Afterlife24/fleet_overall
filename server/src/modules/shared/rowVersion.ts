import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';

export interface VersionedUpdateResult<R> {
  rowVersion: number;
  row: R;
}

/**
 * Parses an `If-Match` header holding a row version: `3`, `"3"` or `W/"3"`.
 * Absent -> 428 PRECONDITION_REQUIRED; malformed -> 422.
 */
export function parseIfMatch(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') {
    throw new AppError('PRECONDITION_REQUIRED', 'If-Match header is required', { 'If-Match': 'required' });
  }
  const m = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(raw);
  if (!m) throw new AppError('VALIDATION_ERROR', 'If-Match must be a row version', { 'If-Match': 'invalid' });
  const n = Number(m[1]);
  if (n < 1) throw new AppError('VALIDATION_ERROR', 'If-Match must be a row version', { 'If-Match': 'invalid' });
  return n;
}

const IDENT = /^[a-z][a-z0-9_]*$/;

/**
 * UPDATE ... WHERE org_id AND id AND row_version = expected, incrementing row_version by 1.
 * `table` and column names must be code constants (validated as identifiers); values are parameterized.
 * Zero matched rows -> NOT_FOUND if the row does not exist, otherwise STALE_VERSION with nothing changed.
 */
export async function versionedUpdate<R extends Record<string, unknown> = Record<string, unknown>>(
  tx: TxClient,
  args: {
    table: string;
    orgId: string;
    id: string;
    expectedVersion: number;
    set: Readonly<Record<string, unknown>>;
  },
): Promise<VersionedUpdateResult<R>> {
  const { table, orgId, id, expectedVersion, set } = args;
  const columns = Object.keys(set);
  if (!IDENT.test(table) || columns.some((c) => !IDENT.test(c) || c === 'row_version' || c === 'org_id' || c === 'id')) {
    throw new TypeError('versionedUpdate: invalid table or column name');
  }
  const params: unknown[] = [orgId, id, expectedVersion];
  const assignments = columns.map((c) => {
    params.push(set[c]);
    return `${c} = $${params.length}`;
  });
  assignments.push('row_version = row_version + 1');
  const res = await tx.query(
    `UPDATE ${table} SET ${assignments.join(', ')} WHERE org_id = $1 AND id = $2 AND row_version = $3 RETURNING *`,
    params,
  );
  const row = res.rows[0] as (R & { row_version: string | number }) | undefined;
  if (row) return { rowVersion: Number(row.row_version), row };
  const exists = await tx.query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [orgId, id]);
  if (exists.rowCount === 0) throw new AppError('NOT_FOUND', 'Record not found');
  throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
}
