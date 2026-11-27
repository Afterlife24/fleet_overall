import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { createSignedFiles, type SignedFilesApi } from '../../signedFiles';

// Feature: offhire-collection-docs, Property 18: Signed copy store round trip
// **Validates: Requirements 11.1, 11.3, 11.5, 11.6**
// Runs: 100 for the memory backend and 100 for fake-indexeddb (a fresh IDBFactory per run).

const MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

const fileArb = fc.record({
  bytes: fc.uint8Array({ minLength: 0, maxLength: 256 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  mime: fc.constantFrom(...MIMES),
});
const keyArb = fc
  .tuple(fc.stringMatching(/^[a-z0-9-]{1,8}$/), fc.constantFrom('CN', 'MQD', 'TPS'), fc.stringMatching(/^[a-z0-9-]{1,8}$/))
  .map(([o, t, d]) => `${o}/${t}/${d}`);

type F = { bytes: Uint8Array; name: string; mime: string };
const toBlob = (f: F) => new Blob([f.bytes as BlobPart], { type: f.mime });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

async function roundTrip(api: SignedFilesApi, key: string, a: F, b: F) {
  const refA = await api.put(key, toBlob(a), { name: a.name, mime: a.mime });
  const gotA = await api.get(key);
  expect(gotA).toBeDefined();
  expect(Array.from(await bytesOf(gotA!.blob))).toEqual(Array.from(a.bytes));
  expect(gotA!.ref).toEqual(refA);
  expect(refA).toMatchObject({ key, name: a.name, mime: a.mime, size: a.bytes.length });

  const refB = await api.put(key, toBlob(b), { name: b.name, mime: b.mime });
  const gotB = await api.get(key);
  expect(gotB).toBeDefined();
  expect(Array.from(await bytesOf(gotB!.blob))).toEqual(Array.from(b.bytes));
  expect(gotB!.ref).toEqual(refB);
  expect(refB).toMatchObject({ key, name: b.name, mime: b.mime, size: b.bytes.length });
}

describe('Property 18: signed copy store round trip', () => {
  it('memory backend: put then get returns same bytes and metadata; second put replaces', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, fileArb, fileArb, async (key, a, b) => {
        const api = createSignedFiles(null);
        expect(api.backend).toBe('memory');
        await roundTrip(api, key, a, b);
        await api.remove(key);
        expect(await api.get(key)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('fake-indexeddb backend: put then get returns same bytes and metadata; second put replaces', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, fileArb, fileArb, async (key, a, b) => {
        const api = createSignedFiles(new IDBFactory());
        await roundTrip(api, key, a, b);
        expect(api.backend).toBe('indexeddb');
        await api.remove(key);
        expect(await api.get(key)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
