import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { ConfigError, isLoopbackHost, type ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import { resolvePrincipal } from './middleware.js';
import { createJoseVerifier, type TokenVerifier } from './oidcAdapter.js';

export const DEV_ISSUER = 'fleet-dev-fixture';
export const DEV_AUDIENCE = 'fleet-dev-fixture';
export const DEV_TOKEN_TTL_SECONDS = 15 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The provider subject the seeded fixture user must have in `users.auth_subject`. */
export function devFixtureSubject(userId: string): string {
  return `dev-fixture:${userId}`;
}

/** Safe issue codes (no values) for a development-fixture configuration that breaks the gate; empty = allowed. */
export function devFixtureGateIssues(
  config: Pick<ServerConfig, 'nodeEnv' | 'host' | 'auth'>,
): string[] {
  const issues: string[] = [];
  if (config.nodeEnv !== 'development' && config.nodeEnv !== 'test') issues.push('NODE_ENV: dev_auth_requires_development_or_test');
  if (!config.auth.allowDevAuth) issues.push('ALLOW_DEV_AUTH: must_be_true');
  if (!isLoopbackHost(config.host)) issues.push('HOST: dev_auth_requires_loopback');
  if (!config.auth.devAuthUserId || !UUID_RE.test(config.auth.devAuthUserId)) {
    issues.push('DEV_AUTH_USER_ID: must_be_uuid');
  }
  return issues;
}

/** True only for AUTH_MODE=development-fixture under the full three-condition gate. */
export function isDevFixtureActive(config: Pick<ServerConfig, 'nodeEnv' | 'host' | 'auth'>): boolean {
  return config.auth.mode === 'development-fixture' && devFixtureGateIssues(config).length === 0;
}

export interface DevFixture {
  verifier: TokenVerifier;
  userId: string;
  /** Mounted before the auth middleware: `POST /dev/session`. */
  router: Router;
}

/**
 * Dev fixture authentication. Throws ConfigError when the gate fails, so the server never starts in that state.
 * Tokens are HS256, signed with a per-process random secret and verified by the same jose path as OIDC tokens.
 */
export function createDevFixture(
  config: Pick<ServerConfig, 'nodeEnv' | 'host' | 'auth'>,
  pool: pg.Pool,
  secret: Uint8Array = randomBytes(32),
): DevFixture {
  const issues = devFixtureGateIssues(config);
  if (issues.length > 0) throw new ConfigError(issues);
  const userId = config.auth.devAuthUserId as string;
  const subject = devFixtureSubject(userId);

  const verifier = createJoseVerifier({
    key: secret,
    issuer: DEV_ISSUER,
    audience: DEV_AUDIENCE,
    algorithms: ['HS256'],
  });

  const router = Router();
  // The body, headers and query are deliberately never read: no role, organization or password can be requested.
  router.post('/dev/session', async (_req: Request, res: Response) => {
    const principal = await resolvePrincipal(pool, subject, 'development-fixture');
    if (!principal || principal.userId !== userId) {
      throw new AppError('UNAUTHENTICATED', 'Development fixture user is not available');
    }
    const expiresAt = Math.floor(Date.now() / 1000) + DEV_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(secret);
    res.status(200).json({
      token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      user: { id: principal.userId, displayName: principal.displayName, authMode: 'development-fixture' },
    });
  });

  return { verifier, userId, router };
}
