// Task 9.10: local and S3-mock storage, plus the files API against fleet_test (runtime role, RLS).
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuthRuntime } from '../../src/auth/index.js';
import { devFixtureSubject } from '../../src/auth/devFixtureAuth.js';
import { setTransactionPool, withTransaction } from '../../src/db/tx.js';
import { createLogger } from '../../src/logger.js';
import { assertAttachable } from '../../src/modules/files/index.js';
import { createFileStorage } from '../../src/storage/index.js';
import { generateKey } from '../../src/storage/fileStorage.js';
import { LocalStorageAdapter } from '../../src/storage/localStorageAdapter.js';
import { S3StorageAdapter } from '../../src/storage/s3StorageAdapter.js';
import { DevelopmentStubVerifier, UnconfiguredScanner } from '../../src/storage/verificationAdapter.js';
import { appUrl, inTenant, migrateTestDb, migratorUrl, seedOrg, type SeededOrg } from './testDb.js';

const ISSUER = 'https://idp.test.example/';
const AUDIENCE = 'fleet-api-test';
const KID = 'test-key-1';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(randomUUID().repeat(50))]);

async function* chunked(buf: Buffer, size = 7) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}
async function collect(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of it) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const tmpRoots: string[] = [];
const tmpRoot = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fleet-int-storage-'));
  tmpRoots.push(dir);
  return dir;
};
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('local storage survives a restart', () => {
  it('stores a PDF, then a new adapter instance reads identical bytes and SHA-256', async () => {
    const root = tmpRoot();
    const key = generateKey('test', randomUUID(), randomUUID(), 'original.pdf');
    const first = new LocalStorageAdapter({ root });
    const put = await first.put({ key, body: chunked(PDF), contentType: 'application/pdf', maxBytes: 1_000_000 });
    expect(put).toEqual({ key, bytes: PDF.length, sha256: sha(PDF) });

    const second = new LocalStorageAdapter({ root }); // simulated restart
    expect(await second.head(key)).toEqual({ bytes: PDF.length });
    const bytes = await collect(await second.read(key));
    expect(bytes.equals(PDF)).toBe(true);
    expect(sha(bytes)).toBe(put.sha256);

    await second.removeUnattached(key);
    expect(await second.head(key)).toBeNull();
    expect(readdirSync(path.join(root, path.dirname(key))).filter((f) => f.endsWith('.part'))).toEqual([]);
  });
});

describe('S3 adapter with a mocked client', () => {
  it('sends bucket, prefix-qualified key, body and content type; reads and heads through the same key', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const s3 = mockClient(client);
    const adapter = new S3StorageAdapter({ client, bucket: 'unit-bucket', keyPrefix: '/uploads/' });
    const key = generateKey('test', randomUUID(), randomUUID(), 'original.pdf');

    s3.on(PutObjectCommand).resolves({});
    const put = await adapter.put({ key, body: chunked(PDF), contentType: 'application/pdf', maxBytes: 1_000_000 });
    expect(put).toEqual({ key, bytes: PDF.length, sha256: sha(PDF) });
    const input = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input.Bucket).toBe('unit-bucket');
    expect(input.Key).toBe(`uploads/${key}`);
    expect(input.ContentType).toBe('application/pdf');
    expect(Buffer.from(input.Body as Buffer).equals(PDF)).toBe(true);

    s3.on(HeadObjectCommand).resolves({ ContentLength: PDF.length, ContentType: 'application/pdf' });
    expect(await adapter.head(key)).toEqual({ bytes: PDF.length, contentType: 'application/pdf' });
    expect(s3.commandCalls(HeadObjectCommand)[0].args[0].input).toMatchObject({ Bucket: 'unit-bucket', Key: `uploads/${key}` });

    s3.on(GetObjectCommand).resolves({ Body: chunked(PDF) as never });
    expect((await collect(await adapter.read(key))).equals(PDF)).toBe(true);
    s3.restore();
  });

  it('maps missing, denied and provider failures without leaking credentials or messages', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const s3 = mockClient(client);
    const adapter = new S3StorageAdapter({ client, bucket: 'b', keyPrefix: 'p' });
    const key = generateKey('test', randomUUID(), randomUUID(), 'original.pdf');
    const secret = 'AKIASECRETKEY123 https://b.s3.amazonaws.com/x?X-Amz-Signature=abc';
    const sdkError = (name: string, status: number) =>
      Object.assign(new Error(secret), { name, $metadata: { httpStatusCode: status } });

    s3.on(GetObjectCommand).rejects(sdkError('NoSuchKey', 404));
    await expect(adapter.read(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    s3.on(HeadObjectCommand).rejects(sdkError('NotFound', 404));
    expect(await adapter.head(key)).toBeNull();

    s3.on(PutObjectCommand).rejects(sdkError('AccessDenied', 403));
    const denied = await adapter
      .put({ key, body: chunked(PDF), contentType: 'application/pdf', maxBytes: 1_000_000 })
      .catch((e: Error) => e);
    expect(denied).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });

    s3.on(PutObjectCommand).rejects(sdkError('InternalError', 500));
    const failed = await adapter
      .put({ key, body: chunked(PDF), contentType: 'application/pdf', maxBytes: 1_000_000 })
      .catch((e: Error) => e);
    expect(failed).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
    for (const err of [denied, failed]) expect(JSON.stringify([(err as Error).message, err])).not.toMatch(/AKIA|X-Amz|amazonaws/);
    s3.restore();
  });

  it('rejects unsafe keys before any client call and fails closed on blank s3 configuration', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const s3 = mockClient(client);
    const adapter = new S3StorageAdapter({ client, bucket: 'b', keyPrefix: 'p' });
    await expect(adapter.head('../x')).rejects.toMatchObject({ code: 'FILE_INVALID' });
    expect(s3.calls()).toHaveLength(0);
    s3.restore();

    for (const aws of [undefined, { region: '', bucket: 'b', keyPrefix: 'p' }, { region: 'r', bucket: 'CHANGE_ME', keyPrefix: 'p' }]) {
      expect(() =>
        createFileStorage({ storage: { driver: 's3', maxUploadBytes: 10, aws } }),
      ).toThrowError(expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }));
    }
  });
});

describe('files API (fleet_test, runtime role)', () => {
  let pool: pg.Pool;
  let jwks: JWTVerifyGetKey;
  let signingKey: CryptoKey;
  const logger = createLogger({ level: 'silent' });
  const root = tmpRoot();
  const storage = new LocalStorageAdapter({ root });

  const appWith = (verifier: DevelopmentStubVerifier | UnconfiguredScanner) =>
    createApp({
      logger,
      dbProbe: async () => {},
      jsonBodyBytes: 1024,
      auth: createAuthRuntime(
        {
          nodeEnv: 'test',
          host: '127.0.0.1',
          auth: {
            mode: 'oidc',
            allowDevAuth: false,
            oidc: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: 'https://idp.test.example/jwks.json' },
          },
        },
        pool,
        { oidcKeyResolver: jwks },
      ),
      files: { storage, verifier, maxUploadBytes: 4096, environment: 'test' },
    });

  async function seedUser(label: string, roleCode: string): Promise<SeededOrg> {
    const org = await seedOrg(label);
    await inTenant(migratorUrl(), org.orgId, async (c) => {
      await c.query('UPDATE roles SET code = $1, name = $1 WHERE id = $2', [roleCode, org.roleId]);
      await c.query('UPDATE users SET auth_subject = $1 WHERE id = $2', [devFixtureSubject(org.userId), org.userId]);
    });
    org.authSubject = devFixtureSubject(org.userId);
    return org;
  }
  const tokenFor = (sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(signingKey);

  const upload = (app: ReturnType<typeof appWith>, token: string, body: Buffer, type = 'application/pdf', name = 'signed lpo.pdf') =>
    request(app)
      .post(`/api/v1/files?filename=${encodeURIComponent(name)}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', type)
      .send(body);

  beforeAll(async () => {
    await migrateTestDb();
    pool = new pg.Pool({ connectionString: appUrl(), max: 5 });
    setTransactionPool(pool);
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] });
  });
  afterAll(async () => {
    setTransactionPool(undefined);
    await pool.end();
  });

  it('uploads pending -> verified -> Clean, stores bytes under a server key and downloads identical bytes', async () => {
    const org = await seedUser('files-ok', 'managing-director');
    const token = await tokenFor(org.authSubject);
    const app = appWith(new DevelopmentStubVerifier());

    const res = await upload(app, token, PDF);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      originalName: 'signed lpo.pdf',
      declaredMime: 'application/pdf',
      detectedMime: 'application/pdf',
      byteSize: PDF.length,
      sha256: sha(PDF),
      storageState: 'Verified',
      scanStatus: 'Clean',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/object_key|objectKey|\.local-storage/);

    const row = await inTenant(migratorUrl(), org.orgId, async (c) =>
      (await c.query('SELECT object_key FROM files WHERE id = $1', [res.body.id])).rows[0],
    );
    expect(row.object_key).toBe(`test/${org.orgId}/${res.body.id}/original.pdf`);
    const audits = await inTenant(migratorUrl(), org.orgId, async (c) =>
      (await c.query("SELECT action, reason FROM audit_events WHERE entity_id = $1 ORDER BY action", [res.body.id])).rows,
    );
    expect(audits.map((a: { action: string }) => a.action)).toEqual(['file.scanned', 'file.uploaded']);
    expect(audits[0].reason).toMatch(/no malware scan/);

    const download = await request(app)
      .get(`/api/v1/files/${res.body.id}/content`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (d: Buffer) => parts.push(d));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect((download.body as Buffer).equals(PDF)).toBe(true);

    await withTransaction(org.orgId, (tx) => assertAttachable(tx, res.body.id)); // Clean files can be attached
  });

  it('denies another organization (404) and requires authentication (401)', async () => {
    const a = await seedUser('files-a', 'managing-director');
    const b = await seedUser('files-b', 'managing-director');
    const app = appWith(new DevelopmentStubVerifier());
    const created = await upload(app, await tokenFor(a.authSubject), PDF);
    expect(created.status).toBe(201);

    const tokenB = await tokenFor(b.authSubject);
    for (const suffix of ['', '/content']) {
      const res = await request(app).get(`/api/v1/files/${created.body.id}${suffix}`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    }
    await expect(withTransaction(b.orgId, (tx) => assertAttachable(tx, created.body.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await request(app).get(`/api/v1/files/${created.body.id}/content`)).status).toBe(401);
  });

  it('rejects wrong signature, empty, oversize, unsupported type, traversal name and missing permission', async () => {
    const org = await seedUser('files-bad', 'managing-director');
    const token = await tokenFor(org.authSubject);
    const app = appWith(new DevelopmentStubVerifier());
    const before = readdirSync(root).length;

    expect((await upload(app, token, PDF, 'image/png')).body.code).toBe('FILE_INVALID'); // signature mismatch
    expect((await upload(app, token, Buffer.alloc(0))).body.code).toBe('FILE_INVALID');
    expect((await upload(app, token, Buffer.concat([PDF, Buffer.alloc(5000)]))).body.code).toBe('FILE_INVALID');
    expect((await upload(app, token, PDF, 'text/plain')).body.code).toBe('FILE_INVALID');
    expect((await upload(app, token, PDF, 'application/pdf', '../evil.pdf')).body.code).toBe('FILE_INVALID');
    expect(readdirSync(root).length).toBe(before); // nothing was written for rejected uploads

    const driver = await seedUser('files-driver', 'driver');
    const denied = await upload(app, await tokenFor(driver.authSubject), PDF);
    expect(denied.status).toBe(403);
  });

  it('keeps a non-Clean file inaccessible: not downloadable and not attachable', async () => {
    const org = await seedUser('files-pending', 'managing-director');
    const token = await tokenFor(org.authSubject);
    const app = appWith(new UnconfiguredScanner());

    const res = await upload(app, token, PDF);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ storageState: 'Verified', scanStatus: 'Pending' });

    const download = await request(app).get(`/api/v1/files/${res.body.id}/content`).set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(403);
    await expect(withTransaction(org.orgId, (tx) => assertAttachable(tx, res.body.id))).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });

    // Metadata is still readable so the owner can see the status.
    const meta = await request(app).get(`/api/v1/files/${res.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.scanStatus).toBe('Pending');
  });
});
