// Idempotent local PostgreSQL setup for the fleet app.
// Usage (PowerShell):
//   $env:PG_SUPERUSER_URL = 'postgresql://postgres:<password>@127.0.0.1:5432/postgres'
//   npm run db:setup:local
// Optional: FLEET_OWNER_PASSWORD, FLEET_MIGRATOR_PASSWORD, FLEET_APP_PASSWORD (local default CHANGE_ME_LOCAL).
// The superuser URL is read from the environment only and is never written to disk or logged.
import pg from 'pg';
import {
  DATABASES,
  ROLES,
  assertManagedName,
  assertSuperuserUrlSafe,
  quoteIdent,
  quoteLiteral,
} from './dbSetupGuards.js';

const LOCAL_DEFAULT_PASSWORD = 'CHANGE_ME_LOCAL';

const rolePasswords: Record<(typeof ROLES)[number], string> = {
  fleet_owner: process.env.FLEET_OWNER_PASSWORD || LOCAL_DEFAULT_PASSWORD,
  fleet_migrator: process.env.FLEET_MIGRATOR_PASSWORD || LOCAL_DEFAULT_PASSWORD,
  fleet_app: process.env.FLEET_APP_PASSWORD || LOCAL_DEFAULT_PASSWORD,
};

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const superUrl = process.env.PG_SUPERUSER_URL;
  if (!superUrl) {
    throw new Error(
      "PG_SUPERUSER_URL is not set. Example: $env:PG_SUPERUSER_URL = 'postgresql://postgres:<password>@127.0.0.1:5432/postgres'",
    );
  }
  assertSuperuserUrlSafe(superUrl);
  for (const r of ROLES) assertManagedName(r, 'role');
  for (const d of DATABASES) assertManagedName(d, 'database');

  await withClient(superUrl, async (c) => {
    for (const role of ROLES) {
      const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      const pw = quoteLiteral(rolePasswords[role]);
      if (exists.rowCount === 0) {
        await c.query(
          `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD ${pw} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
        );
        console.log(`role ${role}: created`);
      } else {
        // Keep attributes safe on re-run; do not reset an existing password.
        await c.query(`ALTER ROLE ${quoteIdent(role)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
        console.log(`role ${role}: exists`);
      }
    }

    for (const db of DATABASES) {
      const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (exists.rowCount === 0) {
        await c.query(`CREATE DATABASE ${quoteIdent(db)} OWNER ${quoteIdent('fleet_migrator')}`);
        console.log(`database ${db}: created`);
      } else {
        console.log(`database ${db}: exists`);
      }
      await c.query(`REVOKE CONNECT ON DATABASE ${quoteIdent(db)} FROM PUBLIC`);
      await c.query(`GRANT CONNECT ON DATABASE ${quoteIdent(db)} TO ${quoteIdent('fleet_app')}`);
      await c.query(`GRANT CONNECT ON DATABASE ${quoteIdent(db)} TO ${quoteIdent('fleet_migrator')}`);
    }

    const ext = await c.query("SELECT default_version FROM pg_available_extensions WHERE name = 'btree_gist'");
    if (ext.rowCount === 0) {
      throw new Error('btree_gist extension is not available on this PostgreSQL server (install contrib).');
    }
    console.log(`extension btree_gist: available (${ext.rows[0].default_version})`);
  });

  console.log('Local database setup complete. odoo_dev and role odoo were not touched.');
}

main().catch((err: unknown) => {
  // Never print the connection string; pg errors do not include the password.
  console.error(`db:setup:local failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
