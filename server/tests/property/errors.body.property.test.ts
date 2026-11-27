// Feature: backend-foundation-crm, Property 4: Every mapped error produces a complete, correctly shaped body
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { AppError, STATUS_BY_CODE, toErrorBody, type ErrorCode } from '../../src/errors.js';

const codes = Object.keys(STATUS_BY_CODE) as ErrorCode[];
const TABLE: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, STALE_VERSION: 409, DUPLICATE: 409,
  AGREEMENT_EXISTS: 409, VALIDATION_ERROR: 422, INVALID_TRANSITION: 422, IMMUTABLE_FIELD: 422,
  FILE_INVALID: 422, QR_INVALID: 422, SERVICE_UNAVAILABLE: 503,
};

const errorArb: fc.Arbitrary<unknown> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...codes), fc.string(), fc.dictionary(fc.string(), fc.string()), fc.boolean())
    .map(([c, m, f, r]) => new AppError(c, m, f, r)),
  fc.string().map((m) => new Error(m)),
  fc.string().map((m) => new TypeError(m)),
  fc.anything(),
  fc.constant(z.object({ a: z.string() }).safeParse({}).error),
);

describe('Property 4: error body shape', () => {
  it('always has exactly the five fields, the given correlation id and the table status', () => {
    fc.assert(
      fc.property(errorArb, fc.uuid(), (err, cid) => {
        const { status, body } = toErrorBody(err, cid);
        expect(Object.keys(body).sort()).toEqual(['code', 'correlationId', 'fieldErrors', 'message', 'retryable']);
        expect(body.correlationId).toBe(cid);
        expect(typeof body.message).toBe('string');
        expect(typeof body.retryable).toBe('boolean');
        expect(status).toBe(STATUS_BY_CODE[body.code]);
        const expected = TABLE[body.code];
        if (expected !== undefined) expect(status).toBe(expected);
        if (err instanceof AppError) expect(body.code).toBe(err.code);
      }),
      { numRuns: 200 },
    );
  });
});
