// Shared setup for API integration tests: the real Express app with the OIDC middleware (local test JWKS)
// and the runtime role (fleet_app, RLS) against fleet_test. Organizations, roles, branches and users are seeded
// with the migration role, so each test file works on its own fresh organizations.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createAuthRuntime } from '../../src/auth/index.js';
import { setTransactionPool } from '../../src/db/tx.js';
import { createLogger } from '../../src/logger.js';
import { LocalStorageAdapter } from '../../src/storage/localStorageAdapter.js';
import { DevelopmentStubVerifier } from '../../src/storage/verificationAdapter.js';
import { appUrl, inTenant, migrateTestDb, migratorUrl, seedOrg, type SeededOrg } from './testDb.js';

const ISSUER = 'https://idp.test.example/';
const AUDIENCE = 'fleet-api-test';
const KID = 'test-key-1';

export interface Actor extends SeededOrg {
  token: string;
}

export interface Harness {
  /** Seeds an organization whose seeded user holds the role `roleCode` (permissions come from that code's defaults). */
  actor(label: string, roleCode: string, opts?: { allBranches?: boolean }): Promise<Actor>;
  /** Adds a user (with a new role of `roleCode`) to the organization of `org`. */
  addUser(
    org: SeededOrg,
    opts: { roleCode: string; branchId: string | null; allBranches?: boolean; sameRoleAs?: Actor },
  ): Promise<Actor>;
  /** Adds an active branch to the organization of `org`. */
  addBranch(org: SeededOrg, code: string): Promise<string>;
  /** Runs SQL as the migration role (table owner) inside the organization's tenant context. */
  sql<T = unknown>(org: SeededOrg, text: string, params?: unknown[]): Promise<T[]>;
  audit(org: SeededOrg, action: string): Promise<AuditRow[]>;
  call(a: Actor, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string): request.Test;
  create(a: Actor, path: string, body: object, key?: string): request.Test;
  change(a: Actor, method: 'patch' | 'put' | 'delete' | 'post', path: string, version: number, body?: object): request.Test;
  /** Uploads a file through the files API (only when the harness was created with the files option). */
  upload(a: Actor, body: Buffer, filename?: string, type?: string): request.Test;
  /** Downloads file content through the files API. Resolves to the raw bytes in es.body. */
  download(a: Actor, fileId: string): request.Test;
  close(): Promise<void>;
}

export interface AuditRow {
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor_user_id: string;
  reason: string | null;
}

export async function createHarness(opts: { files?: boolean } = {}): Promise<Harness> {
  const storageRoot = opts.files ? mkdtempSync(path.join(tmpdir(), 'fleet-int-harness-')) : undefined;
  await migrateTestDb();
  const pool = new pg.Pool({ connectionString: appUrl(), max: 5 });
  setTransactionPool(pool);
  const pair = await generateKeyPair('RS256');
  const signingKey: CryptoKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] });
  const auth = createAuthRuntime(
    {
      nodeEnv: 'test',
      host: '127.0.0.1',
      auth: { mode: 'oidc', allowDevAuth: false, oidc: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: 'https://idp.test.example/jwks.json' } },
    },
    pool,
    { oidcKeyResolver: jwks },
  );
  const app = createApp({ logger: createLogger({ level: 'silent' }), dbProbe: async () => {}, jsonBodyBytes: 100_000, auth,
    ...(storageRoot ? { files: { storage: new LocalStorageAdapter({ root: storageRoot }), verifier: new DevelopmentStubVerifier(), maxUploadBytes: 4096, environment: 'test' } } : {}),
  });

  const sql = async <T = unknown>(org: SeededOrg, text: string, params: unknown[] = []): Promise<T[]> =>
    inTenant(migratorUrl(), org.orgId, async (c) => (await c.query(text, params)).rows as T[]);

  const tokenFor = (sub: string): Promise<string> =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(signingKey);

  const call: Harness['call'] = (a, method, path) =>
    request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${a.token}`);

  return {
    sql,
    call,
    async actor(label, roleCode, opts = {}) {
      const org = await seedOrg(label);
      await sql(org, 'UPDATE roles SET code = $1, name = $1 WHERE id = $2', [roleCode, org.roleId]);
      await sql(org, 'UPDATE users SET all_branches = $1 WHERE id = $2', [opts.allBranches ?? true, org.userId]);
      return { ...org, token: await tokenFor(org.authSubject) };
    },
    async addUser(org, opts) {
      const roleId = opts.sameRoleAs?.roleId ?? randomUUID();
      const userId = randomUUID();
      const authSubject = `sub-extra-${userId}`;
      if (!opts.sameRoleAs) {
        await sql(org, "INSERT INTO roles (id, org_id, code, name, permissions, app_codes) VALUES ($1, $2, $3, $3, '{}', '{}')", [
          roleId, org.orgId, opts.roleCode,
        ]);
      }
      await sql(
        org,
        `INSERT INTO users (id, org_id, role_id, branch_id, normalized_email, display_name, auth_provider, auth_subject, all_branches)
         VALUES ($1, $2, $3, $4, $5, 'Extra User', 'test', $6, $7)`,
        [userId, org.orgId, roleId, opts.branchId, `extra-${userId}@example.test`, authSubject, opts.allBranches ?? false],
      );
      return { orgId: org.orgId, roleId, userId, branchId: opts.branchId ?? org.branchId, authSubject, token: await tokenFor(authSubject) };
    },
    async addBranch(org, code) {
      const id = randomUUID();
      await sql(
        org,
        `INSERT INTO branches (id, org_id, code, name, country_code, city, address, timezone)
         VALUES ($1, $2, $3, $3, 'AE', 'Dubai', 'Yard', 'Asia/Dubai')`,
        [id, org.orgId, code],
      );
      return id;
    },
    audit: (org, action) =>
      sql<AuditRow>(
        org,
        'SELECT before_data, after_data, actor_user_id, reason FROM audit_events WHERE action = $1 ORDER BY occurred_at',
        [action],
      ),
    create: (a, path, body, key = randomUUID()) => call(a, 'post', path).set('Idempotency-Key', key).send(body),
    change: (a, method, path, version, body) => {
      const r = call(a, method, path).set('If-Match', String(version));
      return body ? r.send(body) : r;
    },
    upload: (a, body, filename = 'doc.pdf', type = 'application/pdf') =>
      request(app)
        .post(`/api/v1/files?filename=${encodeURIComponent(filename)}`)
        .set('Authorization', `Bearer ${a.token}`)
        .set('Content-Type', type)
        .send(body),
    download: (a, fileId) =>
      request(app)
        .get(`/api/v1/files/${fileId}/content`)
        .set('Authorization', `Bearer ${a.token}`)
        .buffer(true)
        .parse((r, cb) => {
          const parts: Buffer[] = [];
          r.on('data', (d: Buffer) => parts.push(d));
          r.on('end', () => cb(null, Buffer.concat(parts)));
        }),
    async close() {
      setTransactionPool(undefined);
      await pool.end();
      if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
    },
  };
}
