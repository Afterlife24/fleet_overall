import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import { z } from 'zod';

export type SslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  appPublicUrl: string;
  database: {
    url: string;
    migrationUrl?: string;
    sslMode: SslMode;
    caFile?: string;
    poolMax: number;
  };
  storage: {
    driver: 'local' | 'memory' | 's3';
    localRoot?: string;
    maxUploadBytes: number;
    aws?: { region: string; bucket: string; keyPrefix: string };
  };
  auth: {
    mode: 'oidc' | 'development-fixture';
    allowDevAuth: boolean;
    devAuthUserId?: string;
    oidc?: { issuer: string; audience: string; jwksUrl: string };
  };
  fileScanDriver: 'development-stub' | 'approved-scanner';
  limits: { jsonBodyBytes: number; shutdownTimeoutMs: number };
}

/** Carries only variable names and safe codes, never values. */
export class ConfigError extends Error {
  readonly safeIssues: string[];
  constructor(safeIssues: string[]) {
    super(`Invalid configuration: ${safeIssues.join('; ')}`);
    this.name = 'ConfigError';
    this.safeIssues = safeIssues;
  }
}

const PLACEHOLDER = /CHANGE_ME/i;

export function isBlankOrPlaceholder(value: string | undefined): boolean {
  return value === undefined || value.trim() === '' || PLACEHOLDER.test(value);
}

/** True for localhost, 127.0.0.0/8 and ::1. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h);
}

/**
 * pg `ssl` option. Any mode other than `disable` verifies certificate and
 * hostname; rejectUnauthorized is never false.
 */
export function buildPgSsl(mode: SslMode, caFile?: string): false | ConnectionOptions {
  if (mode === 'disable') return false;
  const ssl: ConnectionOptions = { rejectUnauthorized: true };
  if (caFile && caFile.trim() !== '') ssl.ca = readFileSync(caFile, 'utf8');
  return ssl;
}

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(blankToUndefined, z.string().optional());
const reqStr = z.preprocess(blankToUndefined, z.string());
const boolStr = z.preprocess(
  blankToUndefined,
  z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
);

const envSchema = z.object({
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  HOST: z.preprocess(blankToUndefined, z.string().default('127.0.0.1')),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(3000)),
  APP_PUBLIC_URL: reqStr,
  DATABASE_URL: reqStr,
  MIGRATION_DATABASE_URL: optStr,
  DATABASE_SSL_MODE: z.preprocess(
    blankToUndefined,
    z.enum(['disable', 'require', 'verify-ca', 'verify-full']).default('disable'),
  ),
  DATABASE_CA_FILE: optStr,
  DATABASE_POOL_MAX: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).default(10)),
  STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(['local', 'memory', 's3']).default('local')),
  LOCAL_STORAGE_ROOT: optStr,
  MAX_UPLOAD_BYTES: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(10 * 1024 * 1024)),
  AWS_REGION: optStr,
  S3_BUCKET: optStr,
  S3_KEY_PREFIX: optStr,
  AUTH_MODE: z.preprocess(blankToUndefined, z.enum(['oidc', 'development-fixture']).default('oidc')),
  ALLOW_DEV_AUTH: boolStr,
  DEV_AUTH_USER_ID: optStr,
  OIDC_ISSUER: optStr,
  OIDC_AUDIENCE: optStr,
  OIDC_JWKS_URL: optStr,
  JSON_BODY_LIMIT_BYTES: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(1024 * 1024)),
  SHUTDOWN_TIMEOUT_MS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(10000)),
  FILE_SCAN_DRIVER: z.preprocess(
    blankToUndefined,
    z.enum(['development-stub', 'approved-scanner']).default('approved-scanner'),
  ),
});

/** Parse and validate server env. Only server variables are read; no VITE_ names. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.code}`),
    );
  }
  const e = parsed.data;
  const issues: string[] = [];
  const prod = e.NODE_ENV === 'production';

  if (prod) {
    if (e.AUTH_MODE === 'development-fixture') issues.push('AUTH_MODE: forbidden_in_production');
    if (e.STORAGE_DRIVER === 'local' || e.STORAGE_DRIVER === 'memory') {
      issues.push('STORAGE_DRIVER: forbidden_in_production');
    }
    if (e.DATABASE_SSL_MODE !== 'verify-full') issues.push('DATABASE_SSL_MODE: must_be_verify_full');
    if (e.FILE_SCAN_DRIVER === 'development-stub') issues.push('FILE_SCAN_DRIVER: forbidden_in_production');
    const required: Array<[string, string | undefined]> = [
      ['DATABASE_URL', e.DATABASE_URL],
      ['APP_PUBLIC_URL', e.APP_PUBLIC_URL],
      ['OIDC_ISSUER', e.OIDC_ISSUER],
      ['OIDC_AUDIENCE', e.OIDC_AUDIENCE],
      ['OIDC_JWKS_URL', e.OIDC_JWKS_URL],
      ['S3_BUCKET', e.S3_BUCKET],
      ['AWS_REGION', e.AWS_REGION],
    ];
    for (const [name, value] of required) {
      if (isBlankOrPlaceholder(value)) issues.push(`${name}: blank_or_placeholder`);
    }
  }

  if (e.STORAGE_DRIVER === 's3') {
    for (const [name, value] of [
      ['AWS_REGION', e.AWS_REGION],
      ['S3_BUCKET', e.S3_BUCKET],
      ['S3_KEY_PREFIX', e.S3_KEY_PREFIX],
    ] as Array<[string, string | undefined]>) {
      if (isBlankOrPlaceholder(value)) issues.push(`${name}: blank_or_placeholder`);
    }
  }

  if (e.AUTH_MODE === 'oidc') {
    for (const [name, value] of [
      ['OIDC_ISSUER', e.OIDC_ISSUER],
      ['OIDC_AUDIENCE', e.OIDC_AUDIENCE],
      ['OIDC_JWKS_URL', e.OIDC_JWKS_URL],
    ] as Array<[string, string | undefined]>) {
      if (!prod && (value === undefined || value.trim() === '')) issues.push(`${name}: required`);
    }
  }

  const uniq = [...new Set(issues)];
  if (uniq.length > 0) throw new ConfigError(uniq);

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    appPublicUrl: e.APP_PUBLIC_URL,
    database: {
      url: e.DATABASE_URL,
      migrationUrl: e.MIGRATION_DATABASE_URL,
      sslMode: e.DATABASE_SSL_MODE,
      caFile: e.DATABASE_CA_FILE,
      poolMax: e.DATABASE_POOL_MAX,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      localRoot: e.LOCAL_STORAGE_ROOT,
      maxUploadBytes: e.MAX_UPLOAD_BYTES,
      aws:
        e.STORAGE_DRIVER === 's3'
          ? { region: e.AWS_REGION!, bucket: e.S3_BUCKET!, keyPrefix: e.S3_KEY_PREFIX! }
          : undefined,
    },
    auth: {
      mode: e.AUTH_MODE,
      allowDevAuth: e.ALLOW_DEV_AUTH,
      devAuthUserId: e.DEV_AUTH_USER_ID,
      oidc:
        e.AUTH_MODE === 'oidc'
          ? { issuer: e.OIDC_ISSUER!, audience: e.OIDC_AUDIENCE!, jwksUrl: e.OIDC_JWKS_URL! }
          : undefined,
    },
    fileScanDriver: e.FILE_SCAN_DRIVER,
    limits: { jsonBodyBytes: e.JSON_BODY_LIMIT_BYTES, shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS },
  };
}
