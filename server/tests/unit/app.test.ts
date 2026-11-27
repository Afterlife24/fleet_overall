import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';
import { gracefulShutdown } from '../../src/shutdown.js';

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    lines.push(String(chunk));
    cb();
  },
});
const logger = createLogger({ destination: sink });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fleet-fe-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<html>SPA</html>');
  writeFileSync(path.join(dir, 'assets', 'a.js'), 'x');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const up = async () => {};
const down = async () => {
  throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
};
const mk = (probe: () => Promise<void>) =>
  createApp({ logger, dbProbe: probe, jsonBodyBytes: 1024, frontendDir: dir });

describe('app foundation', () => {
  it('live is 200 even when the database is down', async () => {
    const res = await request(mk(down)).get('/api/v1/health/live');
    expect(res.status).toBe(200);
  });

  it('ready is 200 when the probe passes and exposes nothing else', async () => {
    const res = await request(mk(up)).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('ready is 503 retryable with no connection details when the probe fails', async () => {
    const res = await request(mk(down)).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });

  it('unknown /api path is a JSON 404 with a correlation id', async () => {
    const res = await request(mk(up)).get('/api/x');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('POST to an unknown path is a JSON error, not the SPA', async () => {
    const res = await request(mk(up)).post('/planner').send({});
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('malformed JSON maps to 422 with a field error', async () => {
    const res = await request(mk(up))
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.body).toBe('invalid_json');
  });

  it('serves index.html for navigation paths and 404 for missing assets', async () => {
    const app = mk(up);
    const nav = await request(app).get('/crm/won');
    expect(nav.status).toBe(200);
    expect(nav.text).toContain('SPA');
    expect((await request(app).get('/assets/a.js')).status).toBe(200);
    const missing = await request(app).get('/missing.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('SPA');
  });

  it('logs JSON with the correlation id and no secrets', async () => {
    lines.length = 0;
    const res = await request(mk(up))
      .get('/api/nope')
      .set('Authorization', 'Bearer abc.def.ghi');
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.some((l) => l.correlationId === res.body.correlationId)).toBe(true);
    expect(lines.join('')).not.toContain('abc.def.ghi');
    const direct = createLogger({ destination: sink });
    lines.length = 0;
    direct.info({ password: 'hunter2', nested: { token: 'tok123' } }, 'conn postgres://u:pw9@h/db');
    const out = lines.join('');
    expect(out).not.toMatch(/hunter2|tok123|pw9/);
  });

  it('graceful shutdown stops listening and closes the pool', async () => {
    const server = mk(up).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const pool = new pg.Pool({ connectionString: 'postgres://u:p@127.0.0.1:1/none' });
    await gracefulShutdown({ server, pool, logger, timeoutMs: 1000 });
    expect(server.listening).toBe(false);
    expect((pool as unknown as { ended: boolean }).ended).toBe(true);
  });
});
