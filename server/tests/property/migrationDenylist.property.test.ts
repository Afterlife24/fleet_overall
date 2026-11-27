// Feature: backend-foundation-crm, Property 8: Migration target database name denylist is total
// **Validates: Requirements 3.9, 3.11**
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TARGET_CONFIG,
  ODOO_DENYLIST,
  TEST_DB_PATTERN,
  assertAllowedTarget,
} from '../../scripts/migrateLib.js';

const ident = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), { minLength: 1, maxLength: 20 })
  .map((a) => a.join(''));

const candidate = fc.oneof(
  fc.constantFrom('odoo_dev', 'odoo', 'ODOO_DEV', 'Odoo', ' odoo_dev ', 'fleet_local', 'fleet_test', 'fleet_prod', 'postgres'),
  ident.map((s) => `fleet_test_${s}`),
  ident.map((s) => `odoo_${s}`),
  ident,
  fc.string(),
);

function expectedAllowed(name: string): boolean {
  if (ODOO_DENYLIST.includes(name.trim().toLowerCase())) return false;
  return DEFAULT_TARGET_CONFIG.applicationDatabases.includes(name) || TEST_DB_PATTERN.test(name);
}

describe('Property 8: target database guard', () => {
  it('refuses iff the name is denylisted or not the app/test database pattern', () => {
    fc.assert(
      fc.property(candidate, (name) => {
        const allowed = expectedAllowed(name);
        if (allowed) {
          expect(() => assertAllowedTarget(name)).not.toThrow();
        } else {
          expect(() => assertAllowedTarget(name)).toThrow();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('always refuses denylisted names, even when listed as an application database', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ODOO_DENYLIST), fc.boolean(), fc.boolean(), (name, upper, pad) => {
        const n = (upper ? name.toUpperCase() : name) + (pad ? ' ' : '');
        expect(() =>
          assertAllowedTarget(n, { applicationDatabases: [n, name], denylist: ODOO_DENYLIST }),
        ).toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
