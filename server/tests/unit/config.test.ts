import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError, isLoopbackHost } from '../../src/config.js';

const DEV: Record<string, string> = {
  NODE_ENV: 'development',
  APP_PUBLIC_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://u:SuperSecret@localhost:5432/fleet_local',
  AUTH_MODE: 'development-fixture',
  FILE_SCAN_DRIVER: 'development-stub',
  STORAGE_DRIVER: 'local',
  AWS_REGION: '',
  S3_BUCKET: '',
};

const PROD: Record<string, string> = {
  NODE_ENV: 'production',
  APP_PUBLIC_URL: 'https://app.example.com',
  DATABASE_URL: 'postgres://u:p@db.example.com:5432/fleet',
  DATABASE_SSL_MODE: 'verify-full',
  STORAGE_DRIVER: 's3',
  AWS_REGION: 'ap-south-1',
  S3_BUCKET: 'bucket',
  S3_KEY_PREFIX: 'p/',
  AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_AUDIENCE: 'api',
  OIDC_JWKS_URL: 'https://idp.example.com/jwks',
  FILE_SCAN_DRIVER: 'approved-scanner',
};

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).safeIssues;
  }
  return [];
}

describe('loadConfig', () => {
  it('accepts a local config with blank AWS values', () => {
    const cfg = loadConfig(DEV);
    expect(cfg.storage.driver).toBe('local');
    expect(cfg.storage.aws).toBeUndefined();
    expect(cfg.port).toBe(3000);
  });

  it('accepts a valid production config', () => {
    expect(loadConfig(PROD).auth.oidc?.audience).toBe('api');
  });

  it('reports missing and invalid variables by name without secrets', () => {
    const env = { ...DEV, PORT: 'abc', DATABASE_URL: '' };
    delete (env as Record<string, string | undefined>).APP_PUBLIC_URL;
    const issues = issuesOf(env);
    expect(issues.join(' ')).toMatch(/PORT/);
    expect(issues.join(' ')).toMatch(/DATABASE_URL/);
    expect(issues.join(' ')).toMatch(/APP_PUBLIC_URL/);
    expect(issues.join(' ')).not.toMatch(/SuperSecret|abc/);
  });

  it('does not leak values of rejected fields', () => {
    const issues = issuesOf({ ...DEV, DATABASE_SSL_MODE: 'bogus-secret-value' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).not.toContain('bogus-secret-value');
  });

  it.each([
    ['dev auth', { AUTH_MODE: 'development-fixture' }, 'AUTH_MODE'],
    ['local storage', { STORAGE_DRIVER: 'local' }, 'STORAGE_DRIVER'],
    ['memory storage', { STORAGE_DRIVER: 'memory' }, 'STORAGE_DRIVER'],
    ['disabled TLS', { DATABASE_SSL_MODE: 'disable' }, 'DATABASE_SSL_MODE'],
    ['require TLS', { DATABASE_SSL_MODE: 'require' }, 'DATABASE_SSL_MODE'],
    ['stub scanner', { FILE_SCAN_DRIVER: 'development-stub' }, 'FILE_SCAN_DRIVER'],
    ['CHANGE_ME database url', { DATABASE_URL: 'postgres://u:CHANGE_ME_LOCAL@h/db' }, 'DATABASE_URL'],
    ['blank issuer', { OIDC_ISSUER: '' }, 'OIDC_ISSUER'],
    ['placeholder bucket', { S3_BUCKET: 'CHANGE_ME' }, 'S3_BUCKET'],
  ])('rejects in production: %s', (_label, override, name) => {
    const issues = issuesOf({ ...PROD, ...override });
    expect(issues.some((i) => i.startsWith(name))).toBe(true);
  });

  it('rejects s3 mode with blank prefix', () => {
    const issues = issuesOf({ ...DEV, STORAGE_DRIVER: 's3', AWS_REGION: 'r', S3_BUCKET: 'b', S3_KEY_PREFIX: '' });
    expect(issues.some((i) => i.startsWith('S3_KEY_PREFIX'))).toBe(true);
  });

  it('ignores VITE_ variables', () => {
    const cfg = loadConfig({ ...DEV, VITE_MAPBOX_TOKEN: 'x' });
    expect(JSON.stringify(cfg)).not.toContain('"x"');
  });

  it('isLoopbackHost recognises loopback addresses', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });
});
