import { describe, expect, it } from 'vitest';
import {
  assertManagedName,
  assertSuperuserUrlSafe,
  quoteLiteral,
  withDatabase,
} from '../../scripts/dbSetupGuards.js';

describe('dbSetup guards', () => {
  it('accepts the managed roles and databases', () => {
    for (const r of ['fleet_owner', 'fleet_migrator', 'fleet_app']) expect(() => assertManagedName(r, 'role')).not.toThrow();
    for (const d of ['fleet_local', 'fleet_test']) expect(() => assertManagedName(d, 'database')).not.toThrow();
  });

  it('refuses odoo_dev and odoo (any case)', () => {
    expect(() => assertManagedName('odoo_dev', 'database')).toThrow(/denylist/);
    expect(() => assertManagedName('odoo', 'role')).toThrow(/denylist/);
    expect(() => assertManagedName('ODOO_DEV', 'database')).toThrow(/denylist/);
  });

  it('refuses unmanaged or malformed names', () => {
    expect(() => assertManagedName('postgres', 'database')).toThrow();
    expect(() => assertManagedName('fleet_app"; DROP', 'role')).toThrow();
  });

  it('refuses a superuser URL that targets odoo_dev', () => {
    expect(() => assertSuperuserUrlSafe('postgresql://postgres:x@127.0.0.1:5432/odoo_dev')).toThrow(/denylisted/);
    expect(() => assertSuperuserUrlSafe('postgresql://postgres:x@127.0.0.1:5432/postgres')).not.toThrow();
  });

  it('escapes literals and swaps the database name', () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(withDatabase('postgresql://u:p@h:5432/postgres', 'fleet_test')).toContain('/fleet_test');
  });
});
