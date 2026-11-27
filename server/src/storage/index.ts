import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { isBlankOrPlaceholder, type ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { FileStorage } from './fileStorage.js';
import { LocalStorageAdapter } from './localStorageAdapter.js';
import { S3StorageAdapter } from './s3StorageAdapter.js';

// server/src/storage or server/dist/storage -> repository root
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

/** Directories that must never hold private uploads. */
export const FORBIDDEN_STORAGE_DIRS = ['dist', 'src', 'public', 'server/dist', 'server/src'].map((d) =>
  path.join(repoRoot, d),
);

export const DEFAULT_LOCAL_STORAGE_ROOT = path.join(repoRoot, '.local-storage');

/**
 * Builds the configured File_Storage. The local driver never touches AWS. An s3 driver with blank or
 * placeholder settings fails with STORAGE_NOT_CONFIGURED and never falls back to local storage.
 */
export function createFileStorage(config: Pick<ServerConfig, 'storage'>): FileStorage {
  const { storage } = config;
  if (storage.driver === 's3') {
    const aws = storage.aws;
    if (!aws || isBlankOrPlaceholder(aws.region) || isBlankOrPlaceholder(aws.bucket) || isBlankOrPlaceholder(aws.keyPrefix)) {
      throw new AppError('STORAGE_NOT_CONFIGURED', 'S3 storage is not configured');
    }
    // Region only: credentials come from the SDK default provider chain.
    return new S3StorageAdapter({ client: new S3Client({ region: aws.region }), bucket: aws.bucket, keyPrefix: aws.keyPrefix });
  }
  if (storage.driver === 'local') {
    return new LocalStorageAdapter({
      root: storage.localRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
      forbiddenDirs: FORBIDDEN_STORAGE_DIRS,
    });
  }
  throw new AppError('STORAGE_NOT_CONFIGURED', 'The memory storage driver is not supported for file uploads');
}
