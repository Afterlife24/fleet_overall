// Development seed CLI. Usage: npm run db:seed:dev
// Reads MIGRATION_DATABASE_URL (fleet_migrator) and DEV_AUTH_USER_ID. Never run at API startup.
import { existsSync } from 'node:fs';
import { SeedError, runSeed } from './seedDevLib.js';
import type { SslMode } from '../src/config.js';

const SSL_MODES = ['disable', 'require', 'verify-ca', 'verify-full'];

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env'); // does not override variables already set

  const sslMode = process.env.DATABASE_SSL_MODE || 'disable';
  if (!SSL_MODES.includes(sslMode)) throw new SeedError('DATABASE_SSL_MODE is invalid.');

  const result = await runSeed({
    url: process.env.MIGRATION_DATABASE_URL,
    devUserId: process.env.DEV_AUTH_USER_ID,
    nodeEnv: process.env.NODE_ENV,
    sslMode: sslMode as SslMode,
    caFile: process.env.DATABASE_CA_FILE || undefined,
    log: (m) => console.log(m),
  });
  for (const [table, n] of Object.entries(result.counts)) console.log(`${table}: ${n}`);
}

main().catch((err: unknown) => {
  if (err instanceof SeedError) {
    console.error(`seed: ${err.message}`);
  } else {
    console.error('seed: unexpected failure.', err instanceof Error ? err.message : '');
  }
  process.exit(1);
});
