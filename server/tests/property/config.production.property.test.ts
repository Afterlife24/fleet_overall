// Feature: backend-foundation-crm, Property 1: Production configuration guard is total over the guard predicate table
// **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7**
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

const GOOD: Record<string, string> = {
  NODE_ENV: 'production',
  APP_PUBLIC_URL: 'https://app.example.com',
  DATABASE_URL: 'postgres://u:p@db.example.com:5432/fleet',
  DATABASE_SSL_MODE: 'verify-full',
  STORAGE_DRIVER: 's3',
  AWS_REGION: 'ap-south-1',
  S3_BUCKET: 'fleet-bucket',
  S3_KEY_PREFIX: 'uploads/',
  AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_AUDIENCE: 'fleet-api',
  OIDC_JWKS_URL: 'https://idp.example.com/jwks',
  FILE_SCAN_DRIVER: 'approved-scanner',
};

const GUARDED = [
  'DATABASE_URL', 'APP_PUBLIC_URL', 'OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL', 'S3_BUCKET', 'AWS_REGION',
] as const;

const fieldValue = fc.oneof(
  fc.constant('valid'),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('CHANGE_ME'),
  fc.constant('prefix-CHANGE_ME_LOCAL'),
);

function accepts(env: Record<string, string>): boolean {
  try {
    loadConfig(env);
    return true;
  } catch {
    return false;
  }
}

describe('Property 1: production guard', () => {
  it('rejects iff at least one guard predicate holds', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('oidc', 'development-fixture'),
        fc.constantFrom('s3', 'local', 'memory'),
        fc.constantFrom('disable', 'require', 'verify-ca', 'verify-full'),
        fc.constantFrom('development-stub', 'approved-scanner'),
        fc.record(Object.fromEntries(GUARDED.map((k) => [k, fieldValue]))),
        (auth, storage, ssl, scan, fields) => {
          const env: Record<string, string> = { ...GOOD };
          env.AUTH_MODE = auth;
          env.STORAGE_DRIVER = storage;
          env.DATABASE_SSL_MODE = ssl;
          env.FILE_SCAN_DRIVER = scan;
          let badField = false;
          for (const k of GUARDED) {
            const f = (fields as Record<string, string>)[k];
            if (f !== 'valid') {
              env[k] = f;
              badField = true;
            }
          }
          const shouldReject =
            auth === 'development-fixture' ||
            storage !== 's3' ||
            ssl !== 'verify-full' ||
            scan === 'development-stub' ||
            badField;
          expect(accepts(env)).toBe(!shouldReject);
        },
      ),
      { numRuns: 300 },
    );
  });
});
