import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'STALE_VERSION' | 'DUPLICATE' | 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_TRANSITION' | 'AGREEMENT_EXISTS' | 'IMMUTABLE_FIELD' | 'FILE_INVALID'
  | 'QR_INVALID' | 'STORAGE_NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE'
  | 'PAYLOAD_TOO_LARGE' | 'PRECONDITION_REQUIRED' | 'INTERNAL_ERROR'
  // Stage 2+ business rules.
  | 'BOOKING_CONFLICT' | 'REOPEN_REQUIRED' | 'NOT_WON' | 'PERIOD_CONFLICT' | 'BUSINESS_RULE';

/** The single code -> HTTP status table (Requirement 2.15). */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  DUPLICATE: 409,
  AGREEMENT_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VALIDATION_ERROR: 422,
  INVALID_TRANSITION: 422,
  IMMUTABLE_FIELD: 422,
  FILE_INVALID: 422,
  QR_INVALID: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  STORAGE_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  PRECONDITION_REQUIRED: 428,
  INTERNAL_ERROR: 500,
  /** Overlapping booking dates or physical occupancy of the machine. */
  BOOKING_CONFLICT: 409,
  /** The linked quotation is Lost; it must be reopened first. */
  REOPEN_REQUIRED: 409,
  /** Invoices need a Won quotation. */
  NOT_WON: 422,
  /** An invoice period overlaps another non-cancelled invoice of the quotation. */
  PERIOD_CONFLICT: 409,
  /** A documented business precondition is not met (message says which). */
  BUSINESS_RULE: 422,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS_BY_CODE[code];
  }
}

export interface ErrorResponseBody {
  code: ErrorCode;
  message: string;
  fieldErrors: Record<string, string>;
  correlationId: string;
  retryable: boolean;
}

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH',
  '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006',
]);

/** True when an error means PostgreSQL cannot be reached (not a query bug). */
export function isDbUnavailable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errors?: unknown; message?: unknown };
  if (typeof e.code === 'string' && DB_UNAVAILABLE_CODES.has(e.code)) return true;
  if (Array.isArray(e.errors) && e.errors.length > 0) return e.errors.every(isDbUnavailable); // AggregateError
  if (typeof e.message === 'string') {
    return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i.test(
      e.message,
    );
  }
  return false;
}

/** Field errors keyed by path; never contains the raw zod/SQL message text. */
export function zodFieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!(key in out)) out[key] = issue.code;
  }
  return out;
}

function httpErrorType(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'type' in err) {
    const t = (err as { type: unknown }).type;
    return typeof t === 'string' ? t : undefined;
  }
  return undefined;
}

/** Pure mapper used by the error middleware and by unit/property tests. */
export function toErrorBody(
  err: unknown,
  correlationId: string,
): { status: number; body: ErrorResponseBody } {
  const make = (
    code: ErrorCode,
    message: string,
    fieldErrors: Record<string, string> = {},
    retryable = false,
  ) => ({
    status: STATUS_BY_CODE[code],
    body: { code, message, fieldErrors, correlationId, retryable } satisfies ErrorResponseBody,
  });

  if (err instanceof AppError) return make(err.code, err.message, err.fieldErrors, err.retryable);
  if (err instanceof ZodError) return make('VALIDATION_ERROR', 'Request validation failed', zodFieldErrors(err));
  const type = httpErrorType(err);
  if (type === 'entity.too.large') return make('PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return make('VALIDATION_ERROR', 'Request body is not valid JSON', { body: 'invalid_json' });
  }
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '22003') {
    return make('VALIDATION_ERROR', 'A numeric value is out of range', { _: 'out_of_range' });
  }
  if (isDbUnavailable(err)) return make('SERVICE_UNAVAILABLE', 'Service temporarily unavailable', {}, true);
  return make('INTERNAL_ERROR', 'Internal server error');
}
