// Pure helpers for dbSetup.ts. No I/O so they can be unit tested.

export const DENYLIST: readonly string[] = ['odoo_dev', 'odoo'];

export const ROLES = ['fleet_owner', 'fleet_migrator', 'fleet_app'] as const;
export const DATABASES = ['fleet_local', 'fleet_test'] as const;

const ALLOWED = new Set<string>([...ROLES, ...DATABASES]);
const SAFE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Throws when a role or database name is denylisted, malformed or not one this script manages. */
export function assertManagedName(name: string, kind: 'role' | 'database'): void {
  const lower = name.trim().toLowerCase();
  if (DENYLIST.includes(lower)) {
    throw new Error(`Refusing to touch ${kind} "${name}": it belongs to Odoo and is on the denylist.`);
  }
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Refusing ${kind} name "${name}": not a plain lowercase identifier.`);
  }
  if (!ALLOWED.has(name)) {
    throw new Error(`Refusing ${kind} "${name}": this script only manages ${[...ROLES, ...DATABASES].join(', ')}.`);
  }
}

/** Throws when the superuser connection string targets a denylisted database. */
export function assertSuperuserUrlSafe(url: string): void {
  const u = new URL(url);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (DENYLIST.includes(db.toLowerCase())) {
    throw new Error(`Refusing PG_SUPERUSER_URL: it targets denylisted database "${db}". Use the "postgres" database.`);
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Returns the same connection string pointing at another database, without exposing the password. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}
