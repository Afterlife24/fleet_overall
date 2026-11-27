// Task 7.7: idempotency and optimistic concurrency with real transactions on fleet_test (runtime role).
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransactionOn, type TxClient } from '../../src/db/tx.js';
import { AppError } from '../../src/errors.js';
import { hashRequest, parseIdempotencyKey, runIdempotent } from '../../src/modules/shared/idempotency.js';
import { parseIfMatch, versionedUpdate } from '../../src/modules/shared/rowVersion.js';
import { appUrl, migrateTestDb, seedOrg, type SeededOrg } from './testDb.js';

let pool: pg.Pool;
let org: SeededOrg;

beforeAll(async () => {
  await migrateTestDb();
  pool = new pg.Pool({ connectionString: appUrl(), max: 5 });
  org = await seedOrg('idem');
});
afterAll(async () => {
  await pool.end();
});

async function createCustomer(tx: TxClient, code: string): Promise<{ status: number; body: { id: string } }> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO customers (id, org_id, customer_code, name, phone, address) VALUES ($1, $2, $3, 'C', '+971', 'A')`,
    [id, org.orgId, code],
  );
  return { status: 201, body: { id } };
}

const countCustomers = (code: string) =>
  withTransactionOn(pool, org.orgId, async (tx) =>
    Number((await tx.query('SELECT count(*) AS c FROM customers WHERE customer_code = $1', [code])).rows[0].c),
  );

const run = (key: string, hash: string, code: string) =>
  withTransactionOn(pool, org.orgId, (tx) =>
    runIdempotent(tx, org.orgId, 'customers.create', { key, requestHash: hash }, () => createCustomer(tx, code)),
  );

describe('idempotency', () => {
  it('replays the stored response for the same key and hash without a second row', async () => {
    const key = `k-${randomUUID()}`;
    const hash = hashRequest('POST', '/api/v1/customers', { name: 'A' });
    const first = await run(key, hash, `IDEM-${key}`);
    const second = await run(key, hash, `IDEM-${key}`);
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, status: 201, body: first.body });
    expect(await countCustomers(`IDEM-${key}`)).toBe(1);
  });

  it('rejects the same key with a different hash as 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = `k-${randomUUID()}`;
    await run(key, hashRequest('POST', '/x', { a: 1 }), `IDEM-${key}`);
    const err = await run(key, hashRequest('POST', '/x', { a: 2 }), `IDEM-other-${key}`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    expect(await countCustomers(`IDEM-other-${key}`)).toBe(0);
  });

  it('leaves no completed key after a rollback, so the retry runs again', async () => {
    const key = `k-${randomUUID()}`;
    const hash = hashRequest('POST', '/x', { a: 1 });
    await expect(
      withTransactionOn(pool, org.orgId, async (tx) => {
        await runIdempotent(tx, org.orgId, 'customers.create', { key, requestHash: hash }, () => createCustomer(tx, `IDEM-${key}`));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await withTransactionOn(pool, org.orgId, async (tx) =>
      (await tx.query('SELECT 1 FROM idempotency_keys WHERE key = $1', [key])).rowCount,
    );
    expect(rows).toBe(0);
    const retry = await run(key, hash, `IDEM-${key}`);
    expect(retry.replayed).toBe(false);
  });

  it('serializes concurrent requests with the same key into one create plus one replay', async () => {
    const key = `k-${randomUUID()}`;
    const hash = hashRequest('POST', '/x', { a: 1 });
    const results = await Promise.all([run(key, hash, `IDEM-${key}`), run(key, hash, `IDEM-${key}`)]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(await countCustomers(`IDEM-${key}`)).toBe(1);
  });

  it('requires the key for create commands with 422 and the Idempotency-Key field error', () => {
    try {
      parseIdempotencyKey(undefined, true);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED', status: 422, fieldErrors: { 'Idempotency-Key': 'required' } });
    }
  });

  it('does not retain secrets in stored response bodies', async () => {
    const key = `k-${randomUUID()}`;
    await withTransactionOn(pool, org.orgId, (tx) =>
      runIdempotent(tx, org.orgId, 'files.sign', { key, requestHash: hashRequest('POST', '/f', {}) }, async () => ({
        status: 200,
        body: { id: 1, downloadToken: 'abc', url: 'https://b.s3/x?X-Amz-Signature=zzz' },
      })),
    );
    const stored = await withTransactionOn(pool, org.orgId, async (tx) =>
      (await tx.query('SELECT response_body FROM idempotency_keys WHERE key = $1', [key])).rows[0].response_body,
    );
    expect(JSON.stringify(stored)).not.toMatch(/abc|zzz/);
  });
});

describe('optimistic concurrency', () => {
  let customerId: string;
  beforeAll(async () => {
    customerId = (await withTransactionOn(pool, org.orgId, (tx) => createCustomer(tx, `RV-${randomUUID()}`))).body.id;
  });

  const update = (expected: number, name: string) =>
    withTransactionOn(pool, org.orgId, (tx) =>
      versionedUpdate(tx, { table: 'customers', orgId: org.orgId, id: customerId, expectedVersion: expected, set: { name } }),
    );
  const read = () =>
    withTransactionOn(pool, org.orgId, async (tx) =>
      (await tx.query<{ name: string; row_version: string }>('SELECT name, row_version FROM customers WHERE id = $1', [customerId])).rows[0],
    );

  it('returns 428 when If-Match is missing', () => {
    expect(() => parseIfMatch(undefined)).toThrow(AppError);
    try {
      parseIfMatch(undefined);
    } catch (e) {
      expect(e).toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
    }
  });

  it('parses quoted, weak and bare versions', () => {
    expect([parseIfMatch('3'), parseIfMatch('"3"'), parseIfMatch('W/"3"')]).toEqual([3, 3, 3]);
  });

  it('increments row_version by 1 on success and returns the new value', async () => {
    const before = Number((await read()).row_version);
    const res = await update(before, 'Renamed');
    expect(res.rowVersion).toBe(before + 1);
    expect(await read()).toMatchObject({ name: 'Renamed', row_version: String(before + 1) });
  });

  it('rejects a stale If-Match with 409 STALE_VERSION and changes nothing', async () => {
    const current = await read();
    const err = await update(Number(current.row_version) - 1, 'Stale').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'STALE_VERSION', status: 409 });
    expect(await read()).toEqual(current);
  });
});
