// Migration_Runner CLI. Usage: npm run db:migrate
// Reads MIGRATION_DATABASE_URL (fleet_migrator). Never run at API startup.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MigrationError, DEFAULT_TARGET_CONFIG, databaseNameFromUrl, runMigrations } from './migrateLib.js';
import type { SslMode } from '../src/config.js';

const SSL_MODES = ['disable', 'require', 'verify-ca', 'verify-full'];

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env'); // does not override variables already set

  const sslMode = process.env.DATABASE_SSL_MODE || 'disable';
  if (!SSL_MODES.includes(sslMode)) throw new MigrationError('DATABASE_SSL_MODE is invalid.');

  // The application database is whatever DATABASE_URL names (e.g. RDS), plus fleet_local.
  const applicationDatabases = [...DEFAULT_TARGET_CONFIG.applicationDatabases];
  if (process.env.DATABASE_URL) {
    try {
      applicationDatabases.push(databaseNameFromUrl(process.env.DATABASE_URL));
    } catch {
      /* an invalid DATABASE_URL is reported by the API config, not here */
    }
  }

  const dir = process.env.MIGRATIONS_DIR || path.resolve(import.meta.dirname, '..', 'migrations');
  const result = await runMigrations({
    url: process.env.MIGRATION_DATABASE_URL,
    dir,
    sslMode: sslMode as SslMode,
    caFile: process.env.DATABASE_CA_FILE || undefined,
    target: { ...DEFAULT_TARGET_CONFIG, applicationDatabases },
    log: (m) => console.log(m),
  });
  console.log(result.applied.length === 0 ? 'No migrations to apply.' : `Applied ${result.applied.length} migration(s).`);
}

main().catch((err: unknown) => {
  if (err instanceof MigrationError) {
    console.error(`migrate: ${err.message}`);
    process.exit(err.exitCode);
  }
  console.error('migrate: unexpected failure.', err instanceof Error ? err.message : '');
  process.exit(1);
});
