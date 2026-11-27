// Task 13.9: a phase change is atomic, and the runtime role cannot rewrite the append-only history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { changePhase, getQuotation, newCustomer, newQuotation } from './crmFixtures.js';
import { appUrl, attempt, inTenant, migratorUrl } from './testDb.js';

const FAIL_REASON = 'inject-failure-between-update-and-history';

let h: Harness;
let md: Actor;

beforeAll(async () => {
  h = await createHarness();
  md = await h.actor('qt-atomic', 'managing-director');
  // Failure injection: the history insert fails after the quotation row was already updated in the same transaction.
  await inTenant(migratorUrl(), md.orgId, async (c) => {
    await c.query(`CREATE OR REPLACE FUNCTION fleet_test_fail_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE = 'P0001'; END $$`);
    await c.query('DROP TRIGGER IF EXISTS fleet_test_fail_history ON quotation_phase_history');
    await c.query(`CREATE TRIGGER fleet_test_fail_history BEFORE INSERT ON quotation_phase_history
      FOR EACH ROW WHEN (NEW.reason = '${FAIL_REASON}') EXECUTE FUNCTION fleet_test_fail_history()`);
  });
});

afterAll(async () => {
  await inTenant(migratorUrl(), md.orgId, async (c) => {
    await c.query('DROP TRIGGER IF EXISTS fleet_test_fail_history ON quotation_phase_history');
    await c.query('DROP FUNCTION IF EXISTS fleet_test_fail_history()');
  });
  await h.close();
});

describe('phase change atomicity', () => {
  it('leaves neither the new phase nor a history row nor an audit event when the history insert fails', async () => {
    const customer = await newCustomer(h, md);
    const q = await newQuotation(h, md, customer.id);
    const res = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'LOST', reason: FAIL_REASON });
    expect(res.status).toBe(500);

    const after = await getQuotation(h, md, q.id);
    expect(after).toMatchObject({ phase: 'AWAITING', rowVersion: q.rowVersion });
    const rows = await h.sql<{ to_phase: string }>(md, 'SELECT to_phase FROM quotation_phase_history WHERE quotation_id = $1', [q.id]);
    expect(rows.map((r) => r.to_phase)).toEqual(['AWAITING']);
    const lost = await h.sql(md, 'SELECT 1 FROM quotations WHERE id = $1 AND (lost_at IS NOT NULL OR lost_reason IS NOT NULL)', [q.id]);
    expect(lost).toHaveLength(0);
    expect((await h.audit(md, 'quotation.phase_changed')).length).toBe(0);

    // The failed attempt left no idempotency key behind: the same change without the failure succeeds afterwards.
    const ok = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'LOST', reason: 'real reason' });
    expect(ok.status).toBe(200);
    expect(ok.body.rowVersion).toBe(q.rowVersion + 1);
  });

  it('does not let the runtime role update or delete history rows', async () => {
    const customer = await newCustomer(h, md);
    const q = await newQuotation(h, md, customer.id);
    const update = await attempt(appUrl(), md.orgId, "UPDATE quotation_phase_history SET reason = 'tampered' WHERE quotation_id = $1", [q.id]);
    expect(update).toMatchObject({ ok: false, code: '42501' });
    const del = await attempt(appUrl(), md.orgId, 'DELETE FROM quotation_phase_history WHERE quotation_id = $1', [q.id]);
    expect(del).toMatchObject({ ok: false, code: '42501' });
    const rows = await h.sql(md, 'SELECT 1 FROM quotation_phase_history WHERE quotation_id = $1', [q.id]);
    expect(rows).toHaveLength(1);
  });
});
