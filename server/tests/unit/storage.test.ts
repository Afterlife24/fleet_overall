import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config.js';
import { AppError } from '../../src/errors.js';
import { assertSafeKey, generateKey } from '../../src/storage/fileStorage.js';
import { LocalStorageAdapter } from '../../src/storage/localStorageAdapter.js';
import { validateUpload } from '../../src/storage/uploadValidator.js';
import { createVerificationAdapter } from '../../src/storage/verificationAdapter.js';

const PDF = Buffer.from('%PDF-1.4\nbody');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);

async function* chunks(...parts: Buffer[]) {
  for (const p of parts) yield p;
}

describe('storage keys', () => {
  it('generates environment/org/file/original.<ext>', () => {
    const org = randomUUID();
    const file = randomUUID();
    expect(generateKey('test', org, file, 'Scan.PDF')).toBe(`test/${org}/${file}/original.pdf`);
  });

  it.each(['../a', '/etc/passwd', 'C:\\x', 'C:/x', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a/b.', '', 'a/b\0c'])(
    'rejects unsafe key %j',
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(AppError);
    },
  );

  it.each(['../x.pdf', 'a/b.pdf', 'a\\b.pdf', 'C:evil.pdf', 'noextension'])('rejects unsafe filename %j', (name) => {
    expect(() => generateKey('test', randomUUID(), randomUUID(), name)).toThrow(AppError);
  });
});

describe('upload validator', () => {
  it('accepts matching PDF/PNG/JPEG and rejects mismatch, empty and oversize', () => {
    expect(validateUpload(PDF, 'application/pdf', 100).ok).toBe(true);
    expect(validateUpload(PNG, 'image/png', 100).ok).toBe(true);
    expect(validateUpload(JPG, 'image/jpeg', 100).ok).toBe(true);
    expect(validateUpload(PDF, 'image/png', 100)).toEqual({ ok: false, code: 'FILE_INVALID' });
    expect(validateUpload(Buffer.alloc(0), 'application/pdf', 100).ok).toBe(false);
    expect(validateUpload(PDF, 'application/pdf', PDF.length).ok).toBe(true);
    expect(validateUpload(PDF, 'application/pdf', PDF.length - 1).ok).toBe(false);
    expect(validateUpload(PDF, 'text/plain', 100).ok).toBe(false);
  });
});

describe('verification adapter selection', () => {
  it('allows the development stub only in development and test', () => {
    expect(createVerificationAdapter({ nodeEnv: 'test', fileScanDriver: 'development-stub' }).name).toBe('development-stub');
    expect(createVerificationAdapter({ nodeEnv: 'development', fileScanDriver: 'development-stub' }).name).toBe(
      'development-stub',
    );
    expect(() => createVerificationAdapter({ nodeEnv: 'production', fileScanDriver: 'development-stub' })).toThrow(ConfigError);
  });

  it('records an audit marker saying no malware scan occurred', async () => {
    const result = await createVerificationAdapter({ nodeEnv: 'test', fileScanDriver: 'development-stub' }).scan({
      fileId: randomUUID(),
      key: 'k',
      bytes: 1,
      sha256: 'x',
      mime: 'application/pdf',
    });
    expect(result.status).toBe('Clean');
    expect(result.auditMarker).toMatch(/no malware scan/);
  });
});

describe('local adapter', () => {
  it('aborts an oversize stream and leaves no partial file', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fleet-store-'));
    try {
      const store = new LocalStorageAdapter({ root });
      const key = `test/${randomUUID()}/${randomUUID()}/original.pdf`;
      await expect(
        store.put({ key, body: chunks(Buffer.alloc(6), Buffer.alloc(6)), contentType: 'application/pdf', maxBytes: 10 }),
      ).rejects.toMatchObject({ code: 'FILE_INVALID' });
      expect(await store.head(key)).toBeNull();
      const { readdirSync } = await import('node:fs');
      expect(readdirSync(path.join(root, path.dirname(key)))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a root inside a forbidden directory and unsafe keys before any I/O', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fleet-store-'));
    try {
      expect(() => new LocalStorageAdapter({ root: path.join(root, 'dist', 'x'), forbiddenDirs: [path.join(root, 'dist')] })).toThrow(
        AppError,
      );
      const store = new LocalStorageAdapter({ root });
      await expect(store.head('../outside')).rejects.toMatchObject({ code: 'FILE_INVALID' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
