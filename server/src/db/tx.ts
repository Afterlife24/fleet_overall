import pg from 'pg';

/** Query surface handed to work running inside a tenant transaction. */
export type TxClient = Pick<pg.PoolClient, 'query'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let defaultPool: pg.Pool | undefined;

/** Registers the pool used by `withTransaction`. Call once at startup (and in tests). */
export function setTransactionPool(pool: pg.Pool | undefined): void {
  defaultPool = pool;
}

/**
 * Runs `fn` in one transaction with the transaction-local tenant context `app.org_id` set.
 * `set_config(..., true)` is transaction-scoped, so the context never survives COMMIT/ROLLBACK
 * and cannot leak to the next user of the pooled connection. The client is released in every outcome.
 */
async function runOnce<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) throw new TypeError('withTransaction: orgId must be a UUID');
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // The connection is in an unknown state: destroy it instead of returning it to the pool.
      releaseError = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
    }
    throw err;
  } finally {
    client.release(releaseError);
  }
}

/** Retries once when Postgres aborts the transaction with a deadlock (40P01) or serialization failure (40001); the whole transaction rolled back. */
export async function withTransactionOn<T>(pool: pg.Pool, orgId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  try {
    return await runOnce(pool, orgId, fn);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '40P01' && code !== '40001') throw err;
    return runOnce(pool, orgId, fn);
  }
}

export async function withTransaction<T>(orgId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  if (!defaultPool) throw new Error('withTransaction: no pool registered; call setTransactionPool first');
  return withTransactionOn(defaultPool, orgId, fn);
}
