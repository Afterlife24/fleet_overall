import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { redactSecrets } from './redact.js';

export const IDEMPOTENCY_TTL_HOURS = 24;
const KEY_RE = /^[\x21-\x7e]{1,255}$/;

export type ClaimResult = { kind: 'new' } | { kind: 'replay'; status: number; body: unknown };

/** Stable JSON (sorted keys) so equal payloads hash equally regardless of key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()}\n${path}\n${canonical(body)}`).digest('hex');
}

/**
 * Claims the key inside the command's transaction. A concurrent claim of the same key blocks on the
 * unique index until the first transaction ends; a rollback therefore leaves no key behind.
 * Throws 409 IDEMPOTENCY_CONFLICT when the key exists with a different request hash.
 */
export async function claimIdempotencyKey(
  tx: TxClient,
  orgId: string,
  operation: string,
  key: string,
  requestHash: string,
): Promise<ClaimResult> {
  const inserted = await tx.query(
    `INSERT INTO idempotency_keys (org_id, operation, key, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
     ON CONFLICT (org_id, operation, key) DO NOTHING RETURNING id`,
    [orgId, operation, key, requestHash, IDEMPOTENCY_TTL_HOURS],
  );
  if (inserted.rowCount === 1) return { kind: 'new' };
  const existing = await tx.query<{
    request_hash: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }>(
    `SELECT request_hash, status, response_status, response_body FROM idempotency_keys
     WHERE org_id = $1 AND operation = $2 AND key = $3`,
    [orgId, operation, key],
  );
  const row = existing.rows[0];
  if (!row) throw new AppError('INTERNAL_ERROR', 'Idempotency key could not be read');
  if (row.request_hash !== requestHash) {
    throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different request', {
      'Idempotency-Key': 'conflict',
    });
  }
  if (row.status !== 'Complete' || row.response_status === null) {
    throw new AppError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed', {
      'Idempotency-Key': 'in_progress',
    });
  }
  return { kind: 'replay', status: row.response_status, body: row.response_body };
}

/** Stores the response for replay in the same transaction. Secrets and signed URLs are redacted. */
export async function completeIdempotencyKey(
  tx: TxClient,
  orgId: string,
  operation: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await tx.query(
    `UPDATE idempotency_keys
     SET status = 'Complete', response_status = $4, response_body = $5::jsonb, completed_at = now(),
         updated_at = now(), row_version = row_version + 1
     WHERE org_id = $1 AND operation = $2 AND key = $3`,
    [orgId, operation, key, status, JSON.stringify(redactSecrets(body) ?? null)],
  );
}

/** Validates the header value. Missing and `required` -> 422 with field error `Idempotency-Key`. */
export function parseIdempotencyKey(header: string | string[] | undefined, required: boolean): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw === '') {
    if (required) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', {
        'Idempotency-Key': 'required',
      });
    }
    return undefined;
  }
  if (!KEY_RE.test(raw)) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key is invalid', { 'Idempotency-Key': 'invalid' });
  }
  return raw;
}

export interface IdempotencyContext {
  key: string | undefined;
  requestHash: string;
}

/** Reads `res.locals.idempotency` set by `idempotencyMiddleware`. */
export function getIdempotency(res: Response): IdempotencyContext {
  return res.locals.idempotency as IdempotencyContext;
}

/** Express middleware: validates `Idempotency-Key` and stores key + request hash in `res.locals.idempotency`. */
export function idempotencyMiddleware(opts: { required: boolean }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = parseIdempotencyKey(req.headers['idempotency-key'], opts.required);
      res.locals.idempotency = {
        key,
        requestHash: hashRequest(req.method, req.baseUrl + req.path, req.body),
      } satisfies IdempotencyContext;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export interface CommandResult<B> {
  status: number;
  body: B;
}

/**
 * Runs a command inside the caller's transaction with idempotency: replays a completed identical
 * request, otherwise runs `handler` and records its result. Without a key the handler just runs.
 */
export async function runIdempotent<B>(
  tx: TxClient,
  orgId: string,
  operation: string,
  ctx: IdempotencyContext,
  handler: () => Promise<CommandResult<B>>,
): Promise<CommandResult<B> & { replayed: boolean }> {
  if (!ctx.key) return { ...(await handler()), replayed: false };
  const claim = await claimIdempotencyKey(tx, orgId, operation, ctx.key, ctx.requestHash);
  if (claim.kind === 'replay') return { status: claim.status, body: claim.body as B, replayed: true };
  const result = await handler();
  await completeIdempotencyKey(tx, orgId, operation, ctx.key, result.status, result.body);
  return { ...result, replayed: false };
}
