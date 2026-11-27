import { AppError } from '../errors.js';

export interface PutInput {
  key: string;
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  maxBytes: number;
}
export interface PutResult {
  key: string;
  bytes: number;
  sha256: string;
}

/** Provider-independent private object store (handoff section 9.1). */
export interface FileStorage {
  put(input: PutInput): Promise<PutResult>;
  head(key: string): Promise<{ bytes: number; contentType?: string } | null>;
  read(key: string): Promise<AsyncIterable<Uint8Array>>;
  removeUnattached(key: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_RE = /^[a-z0-9-]{1,32}$/;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const EXT_RE = /^[a-z0-9]{1,10}$/;
const MAX_KEY_LENGTH = 512;

function reject(message: string): never {
  throw new AppError('FILE_INVALID', message, { file: 'unsafe_path' });
}

/** Rejects traversal sequences, separators, absolute paths, drive letters and control characters in a client filename. */
export function assertSafeFilename(name: string): void {
  if (name.length === 0 || name.length > 255) reject('Filename is invalid');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) reject('Filename is invalid');
  if (name.includes('/') || name.includes('\\') || name.includes('..') || /^[A-Za-z]:/.test(name)) {
    reject('Filename is invalid');
  }
}

/**
 * Builds `environment/orgUUID/fileUUID/original.<ext>`. The organization comes from the Principal and the
 * file id from the server; only the lower-cased extension of the client filename is used.
 */
export function generateKey(env: string, orgId: string, fileId: string, originalName: string): string {
  if (!ENV_RE.test(env)) reject('Storage environment is invalid');
  if (!UUID_RE.test(orgId) || !UUID_RE.test(fileId)) reject('Storage identifiers are invalid');
  assertSafeFilename(originalName);
  const dot = originalName.lastIndexOf('.');
  const ext = dot >= 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  if (!EXT_RE.test(ext)) reject('Filename extension is invalid');
  return `${env}/${orgId.toLowerCase()}/${fileId.toLowerCase()}/original.${ext}`;
}

/** Throws FILE_INVALID for any key that is not a relative path of plain segments. Runs before any I/O. */
export function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) reject('Storage key is invalid');
  if (key.startsWith('/') || key.includes('\\') || /^[A-Za-z]:/.test(key) || key.includes('\0')) {
    reject('Storage key is invalid');
  }
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..' || segment.endsWith('.') || !SEGMENT_RE.test(segment)) {
      reject('Storage key is invalid');
    }
  }
}
