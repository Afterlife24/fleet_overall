import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateSignedFile } from '@/services/collectionCore';

// Feature: offhire-collection-docs, Property 19: Signed file type validation
// **Validates: Requirements 11.4**

const accepted = (type: string): boolean =>
  type === 'application/pdf' || type.startsWith('image/');

describe('Property 19: Signed file type validation', () => {
  it('accepts iff type is application/pdf or starts with image/ (arbitrary strings)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (type, name) => {
        expect(validateSignedFile({ type, name }).ok).toBe(accepted(type));
      }),
      { numRuns: 200 },
    );
  });

  it('accepts any image/ subtype and pdf; rejects near-miss types', () => {
    fc.assert(
      fc.property(fc.string(), (sub) => {
        expect(validateSignedFile({ type: `image/${sub}`, name: 'a' }).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
    const nonMatching = fc
      .oneof(
        fc.constantFrom(
          '',
          'application/PDF',
          'Application/pdf',
          'application/pdf ',
          ' application/pdf',
          'IMAGE/png',
          'image',
          'imagepng',
          ' image/png',
          'text/plain',
          'application/zip',
          'video/mp4',
        ),
        fc.string().map((s) => `text/${s}`),
      )
      .filter((t) => !accepted(t));
    fc.assert(
      fc.property(nonMatching, (type) => {
        const r = validateSignedFile({ type, name: 'a.pdf' });
        expect(r.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
    expect(validateSignedFile({ type: 'application/pdf', name: 'x' }).ok).toBe(true);
  });
});
