import pg from 'pg';
import type { Logger } from 'pino';
import { buildPgSsl, type ServerConfig } from '../config.js';

/** Creates the runtime pool. It does not connect until the first query. */
export function createPool(config: ServerConfig['database'], logger?: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.poolMax,
    ssl: buildPgSsl(config.sslMode, config.caFile),
    connectionTimeoutMillis: 5000,
  });
  // An idle client error (e.g. server restart) must not crash the process.
  pool.on('error', (err) => logger?.warn({ err }, 'idle database client error'));
  return pool;
}

/** Readiness probe: resolves when PostgreSQL answers a trivial query. */
export function createDbProbe(pool: pg.Pool): () => Promise<void> {
  return async () => {
    await pool.query('SELECT 1');
  };
}
