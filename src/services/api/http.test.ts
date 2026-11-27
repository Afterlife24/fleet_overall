import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiRequest, ifMatch, mapErrorBody, setCredentialProvider } from './http';
import { clearSubmission, getOrCreateIdempotencyKey } from './idempotency';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  setCredentialProvider(() => null);
});

describe('apiRequest', () => {
  it('uses a relative /api/v1 URL, bearer credential, If-Match and one Idempotency-Key per submission', async () => {
    setCredentialProvider(() => 'tok');
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return calls.length === 1 ? json(503, { code: 'SERVICE_UNAVAILABLE', message: 'x', fieldErrors: {}, correlationId: 'c1', retryable: true }) : json(201, { id: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/customers', { method: 'POST', body: {}, submissionId: 's1', rowVersion: 3, query: { q: 'a', skip: undefined } }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, retryable: true, correlationId: 'c1' });
    await apiRequest('/customers', { method: 'POST', body: {}, submissionId: 's1' });
    await apiRequest('/customers', { method: 'POST', body: {}, submissionId: 's1' });

    expect(calls[0].url).toBe('/api/v1/customers?q=a');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].headers['If-Match']).toBe(ifMatch(3));
    expect(calls[1].headers['Idempotency-Key']).toBe(calls[0].headers['Idempotency-Key']);
    expect(calls[2].headers['Idempotency-Key']).not.toBe(calls[0].headers['Idempotency-Key']);
  });

  it('turns a network failure into an error that names /api/v1 and keeps the key for the retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const key = getOrCreateIdempotencyKey('s2');
    const err = (await apiRequest('/machines', { method: 'POST', body: {}, submissionId: 's2' }).catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toContain('/api/v1');
    expect(getOrCreateIdempotencyKey('s2')).toBe(key);
    clearSubmission('s2');
  });

  it('maps a 503 without a body to the service-unavailable error', () => {
    const err = mapErrorBody(undefined, 503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.message).toContain('/api/v1');
  });

  it('keeps code, fieldErrors and correlationId from the server body', () => {
    const err = mapErrorBody({ code: 'VALIDATION_ERROR', message: 'bad', fieldErrors: { name: 'too_small' }, correlationId: 'abc', retryable: false }, 422);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 422, fieldErrors: { name: 'too_small' }, correlationId: 'abc', retryable: false });
  });
});

