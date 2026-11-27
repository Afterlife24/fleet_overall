import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../errors.js';

export interface TokenVerifier {
  /** Resolves to the verified provider subject or throws AppError (401, or 503 when keys are unreachable). */
  verify(token: string): Promise<{ subject: string }>;
}

export interface JoseVerifierOptions {
  /** A symmetric secret (dev fixture) or a key resolver (JWKS). */
  key: Uint8Array | JWTVerifyGetKey;
  issuer: string;
  audience: string;
  algorithms: string[];
  clockToleranceSeconds?: number;
}

const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Authentication required');

/**
 * The single verification path: signature, algorithm allowlist, issuer, audience and expiry
 * are all checked by `jwtVerify`, for RS256 OIDC tokens and HS256 dev-fixture tokens alike.
 */
export function createJoseVerifier(opts: JoseVerifierOptions): TokenVerifier {
  return {
    async verify(token: string) {
      try {
        const verifyOptions = {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: opts.algorithms,
          requiredClaims: ['exp', 'sub'],
          clockTolerance: opts.clockToleranceSeconds ?? 5,
        };
        const { payload } =
          opts.key instanceof Uint8Array
            ? await jwtVerify(token, opts.key, verifyOptions)
            : await jwtVerify(token, opts.key, verifyOptions);
        if (typeof payload.sub !== 'string' || payload.sub.trim() === '') throw unauthenticated();
        return { subject: payload.sub };
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err instanceof errors.JWKSTimeout) {
          throw new AppError('SERVICE_UNAVAILABLE', 'Identity provider keys are unavailable', {}, true);
        }
        if (err instanceof errors.JOSEError) throw unauthenticated();
        // Network failure while fetching the remote key set, or another unexpected failure.
        throw new AppError('SERVICE_UNAVAILABLE', 'Identity provider keys are unavailable', {}, true);
      }
    },
  };
}

export interface OidcSettings {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

/**
 * OIDC verifier backed by the provider's remote JWKS. `keyResolver` replaces the remote set (tests use a local one).
 */
export function createOidcVerifier(settings: OidcSettings, keyResolver?: JWTVerifyGetKey): TokenVerifier {
  return createJoseVerifier({
    key: keyResolver ?? createRemoteJWKSet(new URL(settings.jwksUrl)),
    issuer: settings.issuer,
    audience: settings.audience,
    algorithms: ['RS256'],
  });
}
