import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CAMERA_MESSAGES, mapCameraError, type CameraErrorCode } from '../../gateCore';

const names = fc.oneof(
  fc.constantFrom(
    'NotAllowedError',
    'SecurityError',
    'NotFoundError',
    'OverconstrainedError',
    'NotReadableError',
    'AbortError',
  ),
  fc.string(),
  fc.constant(undefined),
);
const errArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  names.map((name) => ({ name })),
);

const expectedByName = (name?: string): CameraErrorCode =>
  name === 'NotAllowedError' || name === 'SecurityError'
    ? 'DENIED'
    : name === 'NotFoundError' || name === 'OverconstrainedError'
      ? 'NOT_FOUND'
      : 'OTHER';

describe('gateCore camera error precedence', () => {
  // Feature: gate-in-qr-scan, Property 4: Camera error precedence
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
  it('applies insecure, unsupported, then error-name mapping', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), errArb, (isSecureContext, hasGetUserMedia, err) => {
        const got = mapCameraError({ isSecureContext, hasGetUserMedia }, err);
        const want: CameraErrorCode = !isSecureContext
          ? 'INSECURE'
          : !hasGetUserMedia
            ? 'UNSUPPORTED'
            : expectedByName(err?.name);
        expect(got).toBe(want);
      }),
      { numRuns: 200 },
    );
  });

  it('every camera message directs to Manual entry', () => {
    for (const msg of Object.values(CAMERA_MESSAGES)) expect(msg).toMatch(/Manual entry/);
  });
});
