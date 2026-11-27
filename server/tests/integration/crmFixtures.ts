// Shared builders for the quotation, hire agreement and LPO integration tests.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { Actor, Harness } from './apiHarness.js';
import type { SeededOrg } from './testDb.js';

export interface Customer { id: string; customerCode: string; rowVersion: number }
export interface Quotation { id: string; quotationNo: string; phase: string; rowVersion: number; customerId: string; amount: string }

export async function newCustomer(h: Harness, a: Actor, name = `Cust ${randomUUID().slice(0, 8)}`, extra: object = {}): Promise<Customer> {
  const res = await h.create(a, '/customers', { name, phone: '+971 4 000 0000', address: 'Dubai', ...extra });
  expect(res.status).toBe(201);
  return res.body as Customer;
}

export async function newQuotation(h: Harness, a: Actor, customerId: string, extra: object = {}): Promise<Quotation> {
  const res = await h.create(a, '/quotations', { customerId, opportunity: 'Boom lift hire', amount: '1000', ...extra });
  expect(res.status).toBe(201);
  return res.body as Quotation;
}

/** POST /quotations/:id/phase with a fresh (or given) Idempotency-Key and the given row version. */
export function changePhase(h: Harness, a: Actor, id: string, version: number | undefined, body: object, key: string = randomUUID()) {
  const r = h.call(a, 'post', `/quotations/${id}/phase`).set('Idempotency-Key', key);
  return (version === undefined ? r : r.set('If-Match', String(version))).send(body);
}

export async function getQuotation(h: Harness, a: Actor, id: string): Promise<Quotation> {
  const res = await h.call(a, 'get', `/quotations/${id}`);
  expect(res.status).toBe(200);
  return res.body as Quotation;
}

/** Moves a quotation (as `a`) along `phases`, giving a reason for every move that needs one. */
export async function advance(h: Harness, a: Actor, id: string, phases: string[]): Promise<Quotation> {
  let q = await getQuotation(h, a, id);
  for (const to of phases) {
    const res = await changePhase(h, a, id, q.rowVersion, { toPhase: to, reason: 'because' });
    expect(res.status).toBe(200);
    q = res.body as Quotation;
  }
  return q;
}

/** Inserts a file row directly (as the table owner) in the given state. */
export async function insertFile(h: Harness, o: SeededOrg, state: { storage: string; scan: string }): Promise<string> {
  const id = randomUUID();
  const verified = state.storage === 'Verified';
  await h.sql(
    o,
    `INSERT INTO files (id, org_id, object_key, original_name, declared_mime, detected_mime, expected_size, byte_size, sha256,
                        storage_state, scan_status, uploaded_by, uploaded_at, verified_at)
     VALUES ($1, $2, $3, 'doc.pdf', 'application/pdf', $4, 10, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, o.orgId, `test/${id}`, verified ? 'application/pdf' : null, verified ? 10 : null, verified ? 'a'.repeat(64) : null,
      state.storage, state.scan, o.userId, verified ? new Date() : null, verified ? new Date() : null,
    ],
  );
  return id;
}
