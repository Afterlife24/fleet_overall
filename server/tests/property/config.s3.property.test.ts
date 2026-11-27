// Feature: backend-foundation-crm, Property 2: s3-mode storage configuration completeness
// **Validates: Requirements 1.8**
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

const value = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('CHANGE_ME'),
  fc.constant('x-change_me-y'),
  fc.array(fc.constantFrom(...'abcdefghij0123-/'.split('')), { minLength: 1, maxLength: 12 })
    .map((a) => a.join('')),
);

const isBad = (v: string) => v.trim() === '' || /CHANGE_ME/i.test(v);

describe('Property 2: s3 completeness', () => {
  it('accepts iff region, bucket and prefix are non-blank and not placeholders', () => {
    fc.assert(
      fc.property(value, value, value, (region, bucket, prefix) => {
        const env = {
          NODE_ENV: 'development',
          APP_PUBLIC_URL: 'http://localhost:5173',
          DATABASE_URL: 'postgres://u:p@localhost:5432/fleet_local',
          AUTH_MODE: 'development-fixture',
          FILE_SCAN_DRIVER: 'development-stub',
          STORAGE_DRIVER: 's3',
          AWS_REGION: region,
          S3_BUCKET: bucket,
          S3_KEY_PREFIX: prefix,
        };
        let ok = true;
        try {
          loadConfig(env);
        } catch {
          ok = false;
        }
        expect(ok).toBe(!(isBad(region) || isBad(bucket) || isBad(prefix)));
      }),
      { numRuns: 200 },
    );
  });
});
