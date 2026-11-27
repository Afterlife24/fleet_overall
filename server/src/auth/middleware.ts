import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import { withTransactionOn } from '../db/tx.js';
import { AppError } from '../errors.js';
import type { TokenVerifier } from './oidcAdapter.js';
import { effectiveActions, type Principal } from './principal.js';
import type { AuthMode } from './types.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

interface IdentityRow {
  user_id: string;
  org_id: string;
  role_code: string;
  branch_id: string | null;
  all_branches: boolean;
}

interface ProfileRow {
  display_name: string;
  status: string;
  org_name: string;
  permissions: string[];
}

/**
 * Resolves a provider subject to a Principal. The identity resolver runs without Tenant_Context and returns
 * only the one matching ACTIVE user; company, role and branch scope all come from the database.
 * Resolves to undefined when no active user matches.
 */
export async function resolvePrincipal(
  pool: pg.Pool,
  subject: string,
  authMode: AuthMode,
): Promise<Principal | undefined> {
  const identity = (
    await pool.query<IdentityRow>(
      'SELECT user_id, org_id, role_code, branch_id, all_branches FROM identity_resolver($1)',
      [subject],
    )
  ).rows[0];
  if (!identity) return undefined;

  const profile = await withTransactionOn(pool, identity.org_id, async (tx) => {
    const res = await tx.query<ProfileRow>(
      `SELECT u.display_name, u.status, o.name AS org_name, r.permissions
         FROM users u
         JOIN roles r ON r.org_id = u.org_id AND r.id = u.role_id
         JOIN organizations o ON o.id = u.org_id
        WHERE u.id = $1`,
      [identity.user_id],
    );
    return res.rows[0];
  });
  if (!profile || profile.status !== 'ACTIVE') return undefined;

  return {
    userId: identity.user_id,
    displayName: profile.display_name,
    orgId: identity.org_id,
    orgName: profile.org_name,
    roleCode: identity.role_code,
    branchId: identity.branch_id,
    allBranches: identity.all_branches,
    permissions: effectiveActions(identity.role_code, profile.permissions),
    authMode,
  };
}

export interface AuthMiddlewareDeps {
  verifier: TokenVerifier;
  pool: pg.Pool;
  authMode: AuthMode;
  /** Dev fixture only: the one user id that may authenticate. */
  onlyUserId?: string;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Attaches `req.principal`. The Tenant_Context comes from the Principal only; organization
 * values in headers, query or body are never consulted.
 */
export function authMiddleware(deps: AuthMiddlewareDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = bearerToken(req);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const { subject } = await deps.verifier.verify(token);
    const principal = await resolvePrincipal(deps.pool, subject, deps.authMode);
    if (!principal || (deps.onlyUserId !== undefined && principal.userId !== deps.onlyUserId)) {
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }
    req.principal = principal;
    next();
  };
}

/** Fail-closed stand-in used when no authentication is configured. */
export const rejectAllMiddleware: RequestHandler = () => {
  throw new AppError('UNAUTHENTICATED', 'Authentication required');
};

export function requirePrincipal(req: Request): Principal {
  if (!req.principal) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return req.principal;
}
