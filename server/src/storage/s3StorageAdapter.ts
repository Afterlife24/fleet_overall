import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { AppError } from '../errors.js';
import { isBlankOrPlaceholder } from '../config.js';
import { assertSafeKey, type FileStorage, type PutInput, type PutResult } from './fileStorage.js';

export interface S3StorageOptions {
  /** Injected AWS SDK v3 client. Credentials come from the SDK default chain, never from application config. */
  client: Pick<S3Client, 'send'>;
  bucket: string;
  keyPrefix: string;
}

/** Maps a provider failure to a domain error. Never includes the SDK message, credentials or signed URLs. */
export function mapS3Error(err: unknown): AppError {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  const name = e?.name ?? e?.Code ?? '';
  const status = e?.$metadata?.httpStatusCode;
  if (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(name) || status === 404) {
    return new AppError('NOT_FOUND', 'File content not found');
  }
  if (['AccessDenied', 'Forbidden', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken'].includes(name) || status === 403) {
    return new AppError('STORAGE_NOT_CONFIGURED', 'Storage access was denied');
  }
  return new AppError('SERVICE_UNAVAILABLE', 'Storage provider failed', {}, true);
}

export class S3StorageAdapter implements FileStorage {
  private readonly client: Pick<S3Client, 'send'>;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3StorageOptions) {
    if (isBlankOrPlaceholder(options.bucket) || isBlankOrPlaceholder(options.keyPrefix)) {
      throw new AppError('STORAGE_NOT_CONFIGURED', 'S3 storage is not configured');
    }
    this.client = options.client;
    this.bucket = options.bucket;
    this.prefix = options.keyPrefix.replace(/^\/+|\/+$/g, '');
    if (this.prefix === '') throw new AppError('STORAGE_NOT_CONFIGURED', 'S3 storage is not configured');
  }

  private fullKey(key: string): string {
    assertSafeKey(key);
    return `${this.prefix}/${key}`;
  }

  async put(input: PutInput): Promise<PutResult> {
    const Key = this.fullKey(input.key);
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of input.body) {
      bytes += chunk.byteLength;
      if (bytes > input.maxBytes) {
        throw new AppError('FILE_INVALID', 'File is larger than the allowed size', { file: 'too_large' });
      }
      hash.update(chunk);
      chunks.push(Buffer.from(chunk));
    }
    const sha256 = hash.digest('hex');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key,
          Body: Buffer.concat(chunks, bytes),
          ContentType: input.contentType,
          ContentLength: bytes,
        }),
      );
    } catch (err) {
      throw mapS3Error(err);
    }
    return { key: input.key, bytes, sha256 };
  }

  async head(key: string): Promise<{ bytes: number; contentType?: string } | null> {
    const Key = this.fullKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      return { bytes: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (err) {
      const mapped = mapS3Error(err);
      if (mapped.code === 'NOT_FOUND') return null;
      throw mapped;
    }
  }

  async read(key: string): Promise<AsyncIterable<Uint8Array>> {
    const Key = this.fullKey(key);
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
      const body = out.Body as unknown as AsyncIterable<Uint8Array> | undefined;
      if (!body) throw new AppError('NOT_FOUND', 'File content not found');
      return body;
    } catch (err) {
      throw err instanceof AppError ? err : mapS3Error(err);
    }
  }

  async removeUnattached(key: string): Promise<void> {
    const Key = this.fullKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }));
    } catch (err) {
      const mapped = mapS3Error(err);
      if (mapped.code !== 'NOT_FOUND') throw mapped;
    }
  }
}
