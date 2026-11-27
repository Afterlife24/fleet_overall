// Feature: backend-foundation-crm, Property 5: Invalid request bodies map to 422 with a field error per invalid field and no raw SQL
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { toErrorBody } from '../../src/errors.js';

const SQL = /\b(select|insert|update|delete|from|where|table|violates|constraint|relation)\b/i;
const fieldName = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 8 })
  .map((a) => a.join(''));

describe('Property 5: validation errors', () => {
  it('maps to 422 with one fieldErrors entry per failing field and no SQL text', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fieldName, { minLength: 1, maxLength: 8 }), fc.uuid(), (fields, cid) => {
        // Every field is a required string; the body supplies a number for all of them.
        const schema = z.object(Object.fromEntries(fields.map((f) => [f, z.string().min(1)])));
        const result = schema.safeParse(Object.fromEntries(fields.map((f) => [f, 42])));
        expect(result.success).toBe(false);
        if (result.success) return;
        const { status, body } = toErrorBody(result.error, cid);
        expect(status).toBe(422);
        expect(Object.keys(body.fieldErrors).sort()).toEqual([...fields].sort());
        expect(body.message).not.toMatch(SQL);
        for (const v of Object.values(body.fieldErrors)) expect(v).not.toMatch(SQL);
      }),
      { numRuns: 100 },
    );
  });
});
