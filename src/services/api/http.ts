import { clearSubmission, getOrCreateIdempotencyKey } from './idempotency';

/** All API calls use this relative base, so the Vite proxy (dev) and Express (production) serve the same origin. */
export const API_BASE = '/api/v1';

export type ApiErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_VERSION' | 'DUPLICATE'
  | 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_TRANSITION' | 'AGREEMENT_EXISTS'
  | 'IMMUTABLE_FIELD' | 'FILE_INVALID' | 'QR_INVALID' | 'STORAGE_NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE'
  | 'PAYLOAD_TOO_LARGE' | 'PRECONDITION_REQUIRED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | (string & {});

export const SERVICE_UNAVAILABLE_MESSAGE =
  `The service is unavailable. Check that the backend is running and reachable at ${API_BASE}, then try again.`;

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly correlationId: string | null;
  readonly retryable: boolean;
  constructor(init: {
    code: ApiErrorCode; message: string; status: number;
    fieldErrors?: Record<string, string>; correlationId?: string | null; retryable?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status;
    this.fieldErrors = init.fieldErrors ?? {};
    this.correlationId = init.correlationId ?? null;
    this.retryable = init.retryable ?? false;
  }
}
/** Alias used by screens: the typed API error. */
export { ApiClientError as ApiError };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Maps a server error body (code, message, fieldErrors, correlationId, retryable) to a typed error, keeping each value as sent. */
export function mapErrorBody(body: unknown, status: number): ApiClientError {
  if (isRecord(body) && typeof body.code === 'string') {
    const fieldErrors: Record<string, string> = {};
    if (isRecord(body.fieldErrors)) {
      for (const [k, v] of Object.entries(body.fieldErrors)) if (typeof v === 'string') fieldErrors[k] = v;
    }
    if (status === 503 && body.code === 'SERVICE_UNAVAILABLE') {
      return new ApiClientError({
        code: body.code, message: SERVICE_UNAVAILABLE_MESSAGE, status, fieldErrors,
        correlationId: typeof body.correlationId === 'string' ? body.correlationId : null, retryable: true,
      });
    }
    return new ApiClientError({
      code: body.code,
      message: typeof body.message === 'string' ? body.message : `Request failed (${status})`,
      status,
      fieldErrors,
      correlationId: typeof body.correlationId === 'string' ? body.correlationId : null,
      retryable: body.retryable === true,
    });
  }
  if (status === 503) {
    return new ApiClientError({ code: 'SERVICE_UNAVAILABLE', message: SERVICE_UNAVAILABLE_MESSAGE, status, retryable: true });
  }
  return new ApiClientError({ code: 'INTERNAL_ERROR', message: `Request failed (${status})`, status });
}

// The auth adapter registers itself here, which keeps http.ts free of an import cycle with session.ts.
type CredentialProvider = () => Promise<string | null> | string | null;
let credentialProvider: CredentialProvider = () => null;
export function setCredentialProvider(provider: CredentialProvider): void {
  credentialProvider = provider;
}

/** The `If-Match` header value for a row version. */
export function ifMatch(rowVersion: number): string {
  return `"${rowVersion}"`;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Query string values; `undefined`, `null` and empty strings are omitted. */
  query?: object;
  body?: unknown;
  /** Row version for `If-Match`. */
  rowVersion?: number;
  /** Identifies one submission; its Idempotency-Key is reused on retry until the server answers definitively. */
  submissionId?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the bearer credential (only for the dev session call). */
  anonymous?: boolean;
  /** Send `body` as is (for file uploads); the caller sets Content-Type. */
  rawBody?: BodyInit;
}

export function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query) as [string, unknown][]) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return `${API_BASE}${clean}${qs ? `?${qs}` : ''}`;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** Row version from the `ETag` header, when present. */
  rowVersion: number | null;
}

/** Performs a request and returns data plus the row version; throws `ApiClientError` on any failure. */
export async function apiRequestWithMeta<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined && options.rawBody === undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous) {
    const token = await credentialProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (options.rowVersion !== undefined) headers['If-Match'] = ifMatch(options.rowVersion);
  if (options.submissionId !== undefined) headers['Idempotency-Key'] = getOrCreateIdempotencyKey(options.submissionId);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // The submission may or may not have reached the server, so its key is kept for the retry.
    throw new ApiClientError({ code: 'NETWORK_ERROR', message: SERVICE_UNAVAILABLE_MESSAGE, status: 0, retryable: true });
  }

  let payload: unknown = undefined;
  const text = await res.text().catch(() => '');
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = undefined; }
  }

  if (!res.ok) {
    const error = mapErrorBody(payload, res.status);
    // A definitive client-side answer ends the submission; 5xx and retryable errors keep the key for the retry.
    if (options.submissionId !== undefined && res.status < 500 && !error.retryable) clearSubmission(options.submissionId);
    throw error;
  }
  if (options.submissionId !== undefined) clearSubmission(options.submissionId);
  const etag = res.headers.get('ETag');
  const version = etag ? /(\d+)/.exec(etag) : null;
  return { data: payload as T, status: res.status, rowVersion: version ? Number(version[1]) : null };
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return (await apiRequestWithMeta<T>(path, options)).data;
}



/** GET a binary response (file content) with the bearer credential. Throws `ApiClientError` on failure. */
export async function apiBlobRequest(path: string, options: Pick<ApiRequestOptions, 'signal'> = {}): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = await credentialProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path.startsWith(API_BASE) ? path : buildUrl(path), { headers, signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError({ code: 'NETWORK_ERROR', message: SERVICE_UNAVAILABLE_MESSAGE, status: 0, retryable: true });
  }
  if (!res.ok) {
    let payload: unknown;
    try { payload = JSON.parse(await res.text()); } catch { payload = undefined; }
    throw mapErrorBody(payload, res.status);
  }
  return res.blob();
}
