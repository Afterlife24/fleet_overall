import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';
import { assertSafeKey, type FileStorage, type PutInput, type PutResult } from './fileStorage.js';

export interface LocalStorageOptions {
  /** LOCAL_STORAGE_ROOT; resolved to an absolute path once. */
  root: string;
  /** Directories the root must not be inside (dist, src, public). */
  forbiddenDirs?: string[];
}

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Filesystem adapter. No HTTP static handler is ever attached to its root. */
export class LocalStorageAdapter implements FileStorage {
  readonly root: string;

  constructor(options: LocalStorageOptions) {
    this.root = path.resolve(options.root);
    for (const dir of options.forbiddenDirs ?? []) {
      if (isInside(this.root, path.resolve(dir))) {
        throw new AppError('STORAGE_NOT_CONFIGURED', 'LOCAL_STORAGE_ROOT must be outside dist, src and public directories');
      }
    }
    mkdirSync(this.root, { recursive: true });
  }

  private resolveKey(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, ...key.split('/'));
    if (!isInside(full, this.root) || full === this.root) {
      throw new AppError('FILE_INVALID', 'Storage key is invalid', { file: 'unsafe_path' });
    }
    return full;
  }

  async put(input: PutInput): Promise<PutResult> {
    const finalPath = this.resolveKey(input.key);
    const dir = path.dirname(finalPath);
    await mkdir(dir, { recursive: true });
    const partPath = `${finalPath}.${randomUUID()}.part`;
    const hash = createHash('sha256');
    let bytes = 0;
    const handle = await open(partPath, 'wx', 0o600);
    let closed = false;
    try {
      for await (const chunk of input.body) {
        bytes += chunk.byteLength;
        if (bytes > input.maxBytes) {
          throw new AppError('FILE_INVALID', 'File is larger than the allowed size', { file: 'too_large' });
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
      await handle.close();
      closed = true;
      await rename(partPath, finalPath);
    } catch (err) {
      if (!closed) await handle.close().catch(() => undefined);
      await unlink(partPath).catch(() => undefined);
      throw err;
    }
    return { key: input.key, bytes, sha256: hash.digest('hex') };
  }

  async head(key: string): Promise<{ bytes: number; contentType?: string } | null> {
    const full = this.resolveKey(key);
    try {
      const s = await stat(full);
      return s.isFile() ? { bytes: s.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async read(key: string): Promise<AsyncIterable<Uint8Array>> {
    const full = this.resolveKey(key);
    let handle;
    try {
      handle = await open(full, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', 'File content not found');
      throw err;
    }
    return handle.createReadStream();
  }

  async removeUnattached(key: string): Promise<void> {
    const full = this.resolveKey(key);
    try {
      await unlink(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
