import type { Server } from 'node:http';
import type pg from 'pg';
import type { Logger } from 'pino';

/**
 * Stops accepting connections, waits up to timeoutMs for in-flight requests
 * (then force-closes remaining sockets), and closes the pool.
 */
export async function gracefulShutdown(opts: {
  server: Server;
  pool: Pick<pg.Pool, 'end'>;
  logger: Logger;
  timeoutMs: number;
  signal?: string;
}): Promise<void> {
  const { server, pool, logger, timeoutMs, signal } = opts;
  logger.info({ signal }, 'shutdown started');
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeIdleConnections();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const result = await Promise.race([closed.then(() => 'closed' as const), timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    logger.warn('shutdown timeout reached, closing remaining connections');
    server.closeAllConnections();
    await closed;
  }
  await pool.end();
  logger.info('shutdown complete');
}
