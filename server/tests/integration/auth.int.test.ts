// Task 8.7: authentication flow against fleet_test with the runtime role (fleet_app).
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuthRuntime } from '../../src/auth/index.js';
import { DEV_AUDIENCE, DEV_ISSUER, devFixtureSubject } from '../../src/auth/devFixtureAuth.js';
import type { ServerConfig } from '../../src/config.js';
import { ConfigError } from '../../src/config.js';
import { setTransactionPool } from '../../src/db/tx.js';
import { createLogger } from '../../src/logger.js';
import { appUrl, inTenant, migrateTestDb, migratorUrl, seedOrg, type SeededOrg } from './testDb.js';

type AuthCfg = Pick<ServerConfig, 'nodeEnv' | 'host' | 'auth'>;

const ISSUER = 'https://idp.test.example/';
const AUDIENCE = 'fleet-api-test';
const KID = 'test-key-1';

let pool: pg.Pool;
let jwks: JWTVerifyGetKey;
let signingKey: CryptoKey;
let otherKey: CryptoKey;
const devSecret = new Uint8Array(32).fill(7);

const logger = createLogger({ level: 'silent' });

async function tweak(org: SeededOrg, sql: string, params: unknown[]): Promise<void> {
  await inTenant(migratorUrl(), org.orgId, async (c) => {
    await c.query(sql, params);
  });
}

/** Seeds an org whose user has the given role code and the dev-fixture subject. */
async function seedUser(label: string, roleCode: string): Promise<SeededOrg> {
  const org = await seedOrg(label);
  await tweak(org, 'UPDATE roles SET code = $1, name = $1 WHERE id = $2', [roleCode, org.roleId]);
  await tweak(org, 'UPDATE users SET auth_subject = $1 WHERE id = $2', [devFixtureSubject(org.userId), org.userId]);
  org.authSubject = devFixtureSubject(org.userId);
  return org;
}

const oidcConfig = (): AuthCfg => ({
  nodeEnv: 'test',
  host: '127.0.0.1',
  auth: {
    mode: 'oidc',
    allowDevAuth: false,
    oidc: { issuer: ISSUER, audience: AUDIENCE, jwksUrl: 'https://idp.test.example/jwks.json' },
  },
});

const devConfig = (userId: string, over: Partial<AuthCfg> = {}): AuthCfg => ({
  nodeEnv: 'test',
  host: '127.0.0.1',
  auth: { mode: 'development-fixture', allowDevAuth: true, devAuthUserId: userId },
  ...over,
});

function appFor(config: AuthCfg) {
  const auth = createAuthRuntime(config, pool, { oidcKeyResolver: jwks, devSecret });
  return createApp({ logger, dbProbe: async () => {}, jsonBodyBytes: 1024, auth });
}

interface TokenOpts {
  sub: string;
  iss?: string;
  aud?: string;
  exp?: number | string;
  key?: CryptoKey;
}
async function oidcToken(o: TokenOpts): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(o.sub)
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '5m')
    .sign(o.key ?? signingKey);
}

beforeAll(async () => {
  await migrateTestDb();
  pool = new pg.Pool({ connectionString: appUrl(), max: 5 });
  setTransactionPool(pool);
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

afterAll(async () => {
  setTransactionPool(undefined);
  await pool.end();
});

describe('protected routes', () => {
  it('rejects a request with no credential (401)', async () => {
    const res = await request(appFor(oidcConfig())).get('/api/v1/session');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed Authorization header (401)', async () => {
    const res = await request(appFor(oidcConfig())).get('/api/v1/session').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('keeps health endpoints public', async () => {
    const res = await request(appFor(oidcConfig())).get('/api/v1/health/live');
    expect(res.status).toBe(200);
  });
});

describe('OIDC verification with a local test JWKS', () => {
  it('accepts a valid token and derives everything from the database', async () => {
    const org = await seedUser('oidc-ok', 'sales-manager');
    const token = await oidcToken({ sub: org.authSubject });
    const res = await request(appFor(oidcConfig())).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: org.userId, displayName: 'Test User' },
      role: { code: 'sales-manager' },
      organization: { id: org.orgId, name: 'Org oidc-ok' },
      branchScope: { allBranches: false, branchId: org.branchId },
      authMode: 'oidc',
    });
    expect(res.body.permissions).toContain('quotations.reopen');
    expect(res.body.permissions).not.toContain('users.manage');
  });

  it('rejects expired, wrong-issuer, wrong-audience and wrongly signed tokens (401)', async () => {
    const org = await seedUser('oidc-bad', 'managing-director');
    const app = appFor(oidcConfig());
    const bad = [
      await oidcToken({ sub: org.authSubject, exp: Math.floor(Date.now() / 1000) - 3600 }),
      await oidcToken({ sub: org.authSubject, iss: 'https://evil.example/' }),
      await oidcToken({ sub: org.authSubject, aud: 'someone-else' }),
      await oidcToken({ sub: org.authSubject, key: otherKey }),
      'not-a-jwt',
    ];
    for (const token of bad) {
      const res = await request(app).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects an HS256 token and an unsigned token in oidc mode (algorithm allowlist)', async () => {
    const org = await seedUser('oidc-alg', 'managing-director');
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(org.authSubject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(devSecret);
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: org.authSubject, iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 }),
    ).toString('base64url')}.`;
    const app = appFor(oidcConfig());
    for (const token of [hs, unsigned]) {
      const res = await request(app).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a valid token whose subject matches no user (401)', async () => {
    const token = await oidcToken({ sub: `unknown-${randomUUID()}` });
    const res = await request(appFor(oidcConfig())).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it.each(['INACTIVE', 'SUSPENDED'])('rejects a %s user even with a valid token (401)', async (status) => {
    const org = await seedUser(`oidc-${status.toLowerCase()}`, 'managing-director');
    const token = await oidcToken({ sub: org.authSubject });
    const app = appFor(oidcConfig());
    expect((await request(app).get('/api/v1/session').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await tweak(org, 'UPDATE users SET status = $1 WHERE id = $2', [status, org.userId]);
    const res = await request(app).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('derives the tenant from the database, not from headers, query or body', async () => {
    const a = await seedUser('tenant-a', 'managing-director');
    const b = await seedUser('tenant-b', 'managing-director');
    const token = await oidcToken({ sub: a.authSubject });
    const res = await request(appFor(oidcConfig()))
      .get(`/api/v1/session?orgId=${b.orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', b.orgId)
      .set('X-Organization-Id', b.orgId)
      .set('X-Role', 'Driver');
    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(a.orgId);
    expect(res.body.role.code).toBe('managing-director');
  });

  it('does not expose the dev session endpoint', async () => {
    const res = await request(appFor(oidcConfig())).post('/api/v1/dev/session').send({});
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });
});

describe('development fixture auth', () => {
  it('issues a short-lived token for the fixture user only and the session reports the auth mode', async () => {
    const fixture = await seedUser('dev-ok', 'operations-manager');
    const other = await seedUser('dev-other', 'driver');
    const app = appFor(devConfig(fixture.userId));

    const issued = await request(app)
      .post('/api/v1/dev/session')
      .send({ role: 'Managing Director', orgId: other.orgId, userId: other.userId, password: 'hunter2' });
    expect(issued.status).toBe(200);
    expect(issued.body.user).toEqual({ id: fixture.userId, displayName: 'Test User', authMode: 'development-fixture' });
    const lifetimeMs = Date.parse(issued.body.expiresAt) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60 * 1000);

    const session = await request(app).get('/api/v1/session').set('Authorization', `Bearer ${issued.body.token}`);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      user: { id: fixture.userId },
      role: { code: 'operations-manager' },
      organization: { id: fixture.orgId },
      authMode: 'development-fixture',
    });
  });

  it('rejects expired, wrong-secret and wrong-issuer dev tokens (401)', async () => {
    const fixture = await seedUser('dev-bad', 'managing-director');
    const app = appFor(devConfig(fixture.userId));
    const sign = (secret: Uint8Array, iss: string, exp: number) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(devFixtureSubject(fixture.userId))
        .setIssuer(iss)
        .setAudience(DEV_AUDIENCE)
        .setExpirationTime(exp)
        .sign(secret);
    const future = Math.floor(Date.now() / 1000) + 300;
    for (const token of [
      await sign(devSecret, DEV_ISSUER, Math.floor(Date.now() / 1000) - 3600),
      await sign(new Uint8Array(32).fill(9), DEV_ISSUER, future),
      await sign(devSecret, 'other-issuer', future),
    ]) {
      const res = await request(app).get('/api/v1/session').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a valid dev token for any user other than DEV_AUTH_USER_ID (401)', async () => {
    const fixture = await seedUser('dev-only', 'managing-director');
    const other = await seedUser('dev-only-other', 'managing-director');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(devFixtureSubject(other.userId))
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setExpirationTime('5m')
      .sign(devSecret);
    const res = await request(appFor(devConfig(fixture.userId)))
      .get('/api/v1/session')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('refuses a suspended fixture user (no session issued)', async () => {
    const fixture = await seedUser('dev-suspended', 'managing-director');
    await tweak(fixture, "UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [fixture.userId]);
    const res = await request(appFor(devConfig(fixture.userId))).post('/api/v1/dev/session').send({});
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('refuses to start outside the gate (NODE_ENV, ALLOW_DEV_AUTH, loopback HOST)', () => {
    const id = randomUUID();
    const cases: AuthCfg[] = [
      devConfig(id, { nodeEnv: 'production' }),
      devConfig(id, { host: '0.0.0.0' }),
      devConfig(id, { host: 'example.com' }),
      { ...devConfig(id), auth: { mode: 'development-fixture', allowDevAuth: false, devAuthUserId: id } },
      { ...devConfig(id), auth: { mode: 'development-fixture', allowDevAuth: true } },
    ];
    for (const cfg of cases) {
      expect(() => createAuthRuntime(cfg, pool)).toThrow(ConfigError);
    }
  });
});

describe('no password authentication', () => {
  it('has no password columns and no login/password endpoints', async () => {
    const cols = await inTenant(migratorUrl(), null, async (c) =>
      (
        await c.query(
          `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name ~* '(password|passwd|pwd)'`,
        )
      ).rows,
    );
    expect(cols).toEqual([]);

    const org = await seedUser('nopw', 'managing-director');
    const token = await oidcToken({ sub: org.authSubject });
    const app = appFor(oidcConfig());
    for (const p of ['/api/v1/login', '/api/v1/auth/login', '/api/v1/password', '/api/v1/auth/password']) {
      const res = await request(app).post(p).set('Authorization', `Bearer ${token}`).send({ email: 'a', password: 'b' });
      expect(res.status).toBe(404);
    }
  });
});
