import { Router, type RequestHandler } from 'express';
import type { JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import type { ServerConfig } from '../config.js';
import { createDevFixture } from './devFixtureAuth.js';
import { authMiddleware, requirePrincipal } from './middleware.js';
import { createOidcVerifier } from './oidcAdapter.js';
import type { AuthMode } from './types.js';

export interface AuthRuntime {
  authMode: AuthMode;
  /** Public routes (only `POST /dev/session` in development-fixture mode). */
  publicRouter: Router;
  /** Verifies the credential and attaches `req.principal`. */
  middleware: RequestHandler;
}

export interface AuthRuntimeOptions {
  /** Test hook: replaces the remote JWKS in oidc mode. */
  oidcKeyResolver?: JWTVerifyGetKey;
  /** Test hook: fixed dev-fixture signing secret. */
  devSecret?: Uint8Array;
}

/** Builds the auth pieces for the configured AUTH_MODE. Throws ConfigError when dev-fixture's gate fails. */
export function createAuthRuntime(
  config: Pick<ServerConfig, 'nodeEnv' | 'host' | 'auth'>,
  pool: pg.Pool,
  options: AuthRuntimeOptions = {},
): AuthRuntime {
  if (config.auth.mode === 'development-fixture') {
    const fixture = createDevFixture(config, pool, options.devSecret);
    return {
      authMode: 'development-fixture',
      publicRouter: fixture.router,
      middleware: authMiddleware({
        verifier: fixture.verifier,
        pool,
        authMode: 'development-fixture',
        onlyUserId: fixture.userId,
      }),
    };
  }
  const oidc = config.auth.oidc;
  if (!oidc) throw new Error('OIDC settings are required when AUTH_MODE is oidc');
  return {
    authMode: 'oidc',
    publicRouter: Router(),
    middleware: authMiddleware({
      verifier: createOidcVerifier(oidc, options.oidcKeyResolver),
      pool,
      authMode: 'oidc',
    }),
  };
}

/** `GET /session`: the caller's identity, role, actions, organization, branch scope and auth mode. */
export function sessionRouter(): Router {
  const router = Router();
  router.get('/session', (req, res) => {
    const p = requirePrincipal(req);
    res.status(200).json({
      user: { id: p.userId, displayName: p.displayName },
      role: { code: p.roleCode },
      permissions: p.permissions,
      organization: { id: p.orgId, name: p.orgName },
      branchScope: { allBranches: p.allBranches, branchId: p.allBranches ? null : p.branchId },
      authMode: p.authMode,
    });
  });
  return router;
}
