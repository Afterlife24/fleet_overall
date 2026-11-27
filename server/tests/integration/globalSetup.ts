import { existsSync } from 'node:fs';
import { assertTestDatabase } from './dbGuard.js';

/** Runs once before integration tests; aborts the run unless the target DB is a test DB. */
export default function setup(): void {
  if (existsSync('.env')) {
    // Does not override variables that are already set in the environment.
    process.loadEnvFile('.env');
  }
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assertTestDatabase(url);
}
