import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { requirePrincipal } from '../../auth/middleware.js';
import { authorize, type ActionCode, type Principal } from '../../auth/principal.js';
import { AppError } from '../../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The authenticated Principal, after checking it holds `action`; otherwise 403. */
export function principalWith(req: Request, action: ActionCode): Principal {
  const principal = requirePrincipal(req);
  if (authorize(principal, action) !== 'allow') {
    throw new AppError('FORBIDDEN', 'You do not have permission for this action');
  }
  return principal;
}

/** Middleware form of `principalWith`, so the permission check runs before body and header validation. */
export function requireAction(action: ActionCode): RequestHandler {
  return (req, _res, next) => {
    principalWith(req, action);
    next();
  };
}

/** A path id that is not a UUID can never match a row, so it is a 404 (not a 422). */
export function uuidParam(req: Request, name = 'id'): string {
  const value = String(req.params[name]);
  if (!UUID_RE.test(value)) throw new AppError('NOT_FOUND', 'Record not found');
  return value;
}

/** Parses the JSON body with a zod schema; a missing body is treated as `{}`. Invalid -> 422 with field errors. */
export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return schema.parse(req.query);
}

/** Sets the weak-free ETag holding the row version, so clients can send it back in `If-Match`. */
export function setVersionHeader(res: Response, rowVersion: number): void {
  res.setHeader('ETag', `"${rowVersion}"`);
}

export interface PgErrorLike {
  code?: string;
  constraint?: string;
}

/** The PostgreSQL error code/constraint of a driver error, if it is one. */
export function pgError(err: unknown): PgErrorLike {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; constraint?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : undefined,
      constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
    };
  }
  return {};
}

/** Maps a unique violation on a named constraint to 409 DUPLICATE with a field error; rethrows anything else. */
export function mapUniqueViolation(err: unknown, fieldByConstraint: Readonly<Record<string, string>>, message: string): never {
  const { code, constraint } = pgError(err);
  if (code === '23505' && constraint && Object.prototype.hasOwnProperty.call(fieldByConstraint, constraint)) {
    throw new AppError('DUPLICATE', message, { [fieldByConstraint[constraint]]: 'duplicate' });
  }
  throw err;
}

/** Offsets for list envelopes. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Escapes `%`, `_` and `\` so user input is matched literally by ILIKE ... ESCAPE '\'. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
