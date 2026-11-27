// Feature: backend-foundation-crm, Property 7: Migration checksum mismatch is always detected
// **Validates: Requirements 3.4**
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { checksumMismatch, sha256Hex } from '../../scripts/migrateLib.js';

describe('Property 7: checksum mismatch detection', () => {
  it('reports a mismatch iff the file content differs', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (original, later) => {
        const mismatch = checksumMismatch(sha256Hex(original), sha256Hex(later));
        expect(mismatch).toBe(original !== later);
      }),
      { numRuns: 100 },
    );
  });

  it('never reports a mismatch for identical content', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        expect(checksumMismatch(sha256Hex(content), sha256Hex(content))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('detects any single-character edit', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.nat(), (content, i) => {
        const idx = i % content.length;
        const edited = content.slice(0, idx) + (content[idx] === 'x' ? 'y' : 'x') + content.slice(idx + 1);
        expect(checksumMismatch(sha256Hex(content), sha256Hex(edited))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
