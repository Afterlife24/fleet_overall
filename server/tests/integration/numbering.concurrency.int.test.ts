// Task 7.6 (T19): concurrent numbering on independent connections, against fleet_test with the runtime role.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransactionOn } from '../../src/db/tx.js';
import { allocateNumber } from '../../src/modules/shared/numberAllocator.js';
import { appUrl, migrateTestDb, seedOrg, type SeededOrg } from './testDb.js';

let pool: pg.Pool;
let org: SeededOrg;
const N = 20;

const insertCustomer = (orgId: string, code: string) =>
  `INSERT INTO customers (id, org_id, customer_code, name, phone, address) VALUES ('${randomUUID()}', '${orgId}', '${code}', 'C', '+971', 'A')`;

const counter = async (orgId: string, kind: string, year: number): Promise<bigint | null> =>
  withTransactionOn(pool, orgId, async (tx) => {
    const r = await tx.query<{ next_value: string }>(
      'SELECT next_value FROM number_sequences WHERE org_id = $1 AND sequence_kind = $2 AND sequence_year = $3',
      [orgId, kind, year],
    );
    return r.rows[0] ? BigInt(r.rows[0].next_value) : null;
  });

beforeAll(async () => {
  await migrateTestDb();
  pool = new pg.Pool({ connectionString: appUrl(), max: N });
  org = await seedOrg('numbering');
});
afterAll(async () => {
  await pool.end();
});

describe('Number_Allocator concurrency', () => {
  it('gives N concurrent creates N distinct contiguous numbers', async () => {
    const numbers = await Promise.all(
      Array.from({ length: N }, () =>
        withTransactionOn(pool, org.orgId, async (tx) => {
          const n = await allocateNumber(tx, org.orgId, 'BOOKING', { year: 2031 });
          await tx.query(insertCustomer(org.orgId, n));
          return n;
        }),
      ),
    );
    expect(new Set(numbers).size).toBe(N);
    const values = numbers.map((n) => Number(n.replace('BK-2031', ''))).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(numbers).toContain('BK-20310001');
    expect(await counter(org.orgId, 'BOOKING', 2031)).toBe(BigInt(N + 1));
  });

  it('does not consume a number when the create rolls back', async () => {
    const first = await withTransactionOn(pool, org.orgId, (tx) => allocateNumber(tx, org.orgId, 'GATE', { year: 2032 }));
    expect(first).toBe('GP-20320001');
    await expect(
      withTransactionOn(pool, org.orgId, async (tx) => {
        await allocateNumber(tx, org.orgId, 'GATE', { year: 2032 });
        throw new Error('create failed');
      }),
    ).rejects.toThrow('create failed');
    expect(await counter(org.orgId, 'GATE', 2032)).toBe(2n);
    const next = await withTransactionOn(pool, org.orgId, (tx) => allocateNumber(tx, org.orgId, 'GATE', { year: 2032 }));
    expect(next).toBe('GP-20320002');
  });

  it('does not reissue the number of a record that is later removed', async () => {
    const code = await withTransactionOn(pool, org.orgId, async (tx) => {
      const n = await allocateNumber(tx, org.orgId, 'TRANSPORT', { year: 2033 });
      await tx.query(insertCustomer(org.orgId, n));
      return n;
    });
    await withTransactionOn(pool, org.orgId, (tx) =>
      tx.query('DELETE FROM customers WHERE org_id = $1 AND customer_code = $2', [org.orgId, code]),
    );
    const next = await withTransactionOn(pool, org.orgId, (tx) => allocateNumber(tx, org.orgId, 'TRANSPORT', { year: 2033 }));
    expect(next).not.toBe(code);
    expect(next).toBe('TR-20330002');
  });
});
