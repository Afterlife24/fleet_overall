// Task 13.5 (T01): the quotation phase transition table through the API.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { advance, changePhase, getQuotation, newCustomer, newQuotation } from './crmFixtures.js';

let h: Harness;
let md: Actor; // managing-director: quotations.write + quotations.reopen
let ops: Actor; // ops-executive: quotations.write, no reopen permission
let customerId: string;

const PHASES = ['AWAITING', 'TENDER', 'LOST', 'WON'] as const;
type Phase = (typeof PHASES)[number];
/** The only manual moves. */
const ALLOWED = new Set(['AWAITING>TENDER', 'AWAITING>LOST', 'AWAITING>WON', 'TENDER>WON', 'TENDER>LOST', 'LOST>AWAITING']);
/** Shortest valid route from a new (AWAITING) quotation to each phase. */
const ROUTE: Record<Phase, string[]> = { AWAITING: [], TENDER: ['TENDER'], LOST: ['LOST'], WON: ['WON'] };

beforeAll(async () => {
  h = await createHarness();
  md = await h.actor('qt-trans', 'managing-director');
  ops = await h.addUser(md, { roleCode: 'ops-executive', branchId: md.branchId, allBranches: true });
  customerId = (await newCustomer(h, md)).id;
});

afterAll(async () => {
  await h.close();
});

async function quotationIn(phase: Phase) {
  const q = await newQuotation(h, md, customerId);
  return advance(h, md, q.id, ROUTE[phase]);
}

describe('transition table', () => {
  it('matches the allowed table and the reason and reopen-permission rules for every ordered pair', async () => {
    for (const from of PHASES) {
      for (const to of PHASES) {
        for (const actor of [md, ops]) {
          for (const reason of [undefined, 'Customer asked for a new quote']) {
            const q = await quotationIn(from);
            const res = await changePhase(h, actor, q.id, q.rowVersion, reason === undefined ? { toPhase: to } : { toPhase: to, reason });
            const label = `${from}>${to} actor=${actor === md ? 'md' : 'ops'} reason=${reason !== undefined}`;
            const pair = `${from}>${to}`;
            const reopen = pair === 'LOST>AWAITING';
            const needsReason = to === 'LOST' || reopen;
            if (!ALLOWED.has(pair)) {
              expect(res.status, label).toBe(422);
              expect(res.body.code, label).toBe('INVALID_TRANSITION');
            } else if (reopen && actor === ops) {
              expect(res.status, label).toBe(403);
              expect(res.body.code, label).toBe('FORBIDDEN');
            } else if (needsReason && reason === undefined) {
              expect(res.status, label).toBe(422);
              expect(res.body.code, label).toBe('VALIDATION_ERROR');
              expect(res.body.fieldErrors.reason, label).toBeDefined();
            } else {
              expect(res.status, label).toBe(200);
              expect(res.body.phase, label).toBe(to);
              expect(res.body.rowVersion, label).toBe(q.rowVersion + 1);
            }
            if (res.status !== 200) {
              // A rejected change leaves the quotation and its history alone.
              const after = await getQuotation(h, md, q.id);
              expect(after.phase, label).toBe(from);
              expect(after.rowVersion, label).toBe(q.rowVersion);
            }
          }
        }
      }
    }
  }, 180_000);

  it('rejects a blank or over-long reason, trims the stored reason and sets the lost and won fields', async () => {
    const a = await quotationIn('AWAITING');
    for (const reason of ['', '   \t ', 'x'.repeat(501)]) {
      const res = await changePhase(h, md, a.id, a.rowVersion, { toPhase: 'LOST', reason });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors.reason).toBeDefined();
    }
    const lost = await changePhase(h, md, a.id, a.rowVersion, { toPhase: 'LOST', reason: `  ${'r'.repeat(500)}  ` });
    expect(lost.status).toBe(200);
    expect(lost.body).toMatchObject({ phase: 'LOST', lostReason: 'r'.repeat(500), lostBy: md.userId, wonAt: null });
    expect(lost.body.lostAt).toEqual(expect.any(String));

    const reopened = await changePhase(h, md, a.id, lost.body.rowVersion, { toPhase: 'AWAITING', reason: 'back on' });
    expect(reopened.body).toMatchObject({ phase: 'AWAITING', lostReason: null, lostAt: null, lostBy: null });

    const won = await changePhase(h, md, a.id, reopened.body.rowVersion, { toPhase: 'WON' });
    expect(won.status).toBe(200);
    expect(won.body.wonAt).toEqual(expect.any(String));
    expect((await h.audit(md, 'quotation.phase_changed')).length).toBeGreaterThanOrEqual(3);
  });

  it('requires If-Match and Idempotency-Key and rejects a stale version', async () => {
    const q = await quotationIn('AWAITING');
    expect((await changePhase(h, md, q.id, undefined, { toPhase: 'TENDER' })).status).toBe(428);
    const noKey = await h.call(md, 'post', `/quotations/${q.id}/phase`).set('If-Match', String(q.rowVersion)).send({ toPhase: 'TENDER' });
    expect(noKey.status).toBe(422);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const ok = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'TENDER' });
    expect(ok.status).toBe(200);
    const stale = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'LOST', reason: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    expect((await changePhase(h, md, q.id, ok.body.rowVersion, { toPhase: 'bogus' })).status).toBe(422);
  });
});

describe('history chain', () => {
  const sequences: string[][] = [
    ['TENDER', 'WON'],
    ['LOST', 'AWAITING', 'TENDER', 'LOST', 'AWAITING', 'WON'],
    ['TENDER', 'LOST', 'AWAITING', 'LOST'],
    ['WON'],
    [],
  ];

  it('keeps from = previous to and ends at the current phase for several valid sequences', async () => {
    for (const route of sequences) {
      const q = await newQuotation(h, md, customerId);
      const done = await advance(h, md, q.id, route);
      const res = await h.call(md, 'get', `/quotations/${q.id}/history`);
      expect(res.status).toBe(200);
      const rows = res.body.items as { fromPhase: string | null; toPhase: string; source: string }[];
      expect(rows).toHaveLength(route.length + 1);
      expect(rows[0]).toMatchObject({ fromPhase: null, toPhase: 'AWAITING' });
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].fromPhase).toBe(rows[i - 1].toPhase);
        expect(rows[i].source).toBe('MANUAL');
      }
      expect(rows[rows.length - 1].toPhase).toBe(done.phase);
    }
  });

  it('a repeated Idempotency-Key replays the response and adds no second history row', async () => {
    const q = await newQuotation(h, md, customerId);
    const key = randomUUID();
    const first = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'TENDER' }, key);
    expect(first.status).toBe(200);
    const replay = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'TENDER' }, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    const count = await h.sql<{ n: string }>(md, 'SELECT count(*) AS n FROM quotation_phase_history WHERE quotation_id = $1', [q.id]);
    expect(Number(count[0].n)).toBe(2);
    expect((await getQuotation(h, md, q.id)).rowVersion).toBe(q.rowVersion + 1);
    // The same key with a different request is a conflict.
    const conflict = await changePhase(h, md, q.id, q.rowVersion, { toPhase: 'WON' }, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
