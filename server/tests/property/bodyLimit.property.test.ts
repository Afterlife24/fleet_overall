// Feature: backend-foundation-crm, Property 6: Oversized bodies are rejected at the configured limit
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { bodyLimit, errorMiddleware } from '../../src/app.js';
import { createLogger, correlationMiddleware } from '../../src/logger.js';

const LIMIT = 512;
const logger = createLogger({ level: 'silent' });
const app = express();
app.use(correlationMiddleware(logger));
app.use(bodyLimit(LIMIT));
app.post('/echo', (_req, res) => {
  res.status(200).json({ ok: true });
});
app.use(errorMiddleware);

/** JSON object whose serialized byte length is exactly `n` (n >= 8). */
function jsonOfLength(n: number): string {
  return `{"a":"${'x'.repeat(n - 8)}"}`;
}

describe('Property 6: body size limit', () => {
  it('passes iff length <= limit, else 413', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 8, max: LIMIT * 3 }), async (len) => {
        const payload = jsonOfLength(len);
        expect(Buffer.byteLength(payload)).toBe(len);
        const res = await request(app).post('/echo').set('Content-Type', 'application/json').send(payload);
        if (len <= LIMIT) expect(res.status).toBe(200);
        else {
          expect(res.status).toBe(413);
          expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
        }
      }),
      { numRuns: 100 },
    );
  });
});
