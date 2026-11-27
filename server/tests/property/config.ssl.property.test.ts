// Feature: backend-foundation-crm, Property 3: Non-disabled SSL modes never disable certificate verification
// **Validates: Requirements 1.10**
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { buildPgSsl } from '../../src/config.js';

describe('Property 3: pg ssl options', () => {
  it('never sets rejectUnauthorized to false unless mode is disable (which yields no ssl)', () => {
    fc.assert(
      fc.property(fc.constantFrom('disable', 'require', 'verify-ca', 'verify-full'), (mode) => {
        const ssl = buildPgSsl(mode);
        if (mode === 'disable') {
          expect(ssl).toBe(false);
        } else {
          expect(ssl).not.toBe(false);
          expect((ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
