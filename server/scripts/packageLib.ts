/**
 * Pure helpers for the AWS package (19.2) and the frontend bundle secret scan (19.3).
 * Kept free of I/O so the rules can be unit tested with in-memory file lists.
 */

/** Paths at the ZIP root the Elastic Beanstalk bundle must contain. */
export const REQUIRED_ENTRIES = ['Procfile', 'package.json', 'package-lock.json'] as const;
/** Directories that must contain at least one file. */
export const REQUIRED_DIRS = ['server/dist/', 'dist/'] as const;
/** Sources copied into the ZIP (files or directories), relative to the repo root. */
export const PACKAGE_SOURCES = ['Procfile', 'package.json', 'package-lock.json', 'server/dist', 'dist', '.platform'] as const;

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)\.env(\..*)?$/i, reason: 'environment file' },
  { pattern: /(^|\/)node_modules\//i, reason: 'node_modules' },
  { pattern: /(^|\/)\.local-storage\//i, reason: 'local uploads' },
  { pattern: /(^|\/)storage-local\//i, reason: 'local uploads' },
  { pattern: /(^|\/)\.git\//i, reason: 'git metadata' },
  { pattern: /(^|\/)\.aws\//i, reason: 'AWS credentials' },
  { pattern: /(^|\/)credentials(\.[a-z]+)?$/i, reason: 'credentials file' },
  { pattern: /\.(pem|key|p12|pfx)$/i, reason: 'private key or certificate' },
  { pattern: /\.(sqlite|sqlite3|db|dump|backup|bak)$/i, reason: 'database file' },
  { pattern: /\.sql$/i, reason: 'SQL file (migrations are not shipped)' },
  { pattern: /\.(zip|tar|gz|tgz|7z|rar)$/i, reason: 'nested archive' },
  { pattern: /^(src|server\/src|server\/scripts|server\/tests|shared)\//i, reason: 'source file' },
  { pattern: /(^|\/)_private\//i, reason: 'private reference material' },
  { pattern: /\.(pdf|docx?|xlsx?|pptx?)$/i, reason: 'source attachment' },
];

export interface PackageCheck {
  ok: boolean;
  problems: string[];
}

/** Validates the list of ZIP entry names (forward slashes, no leading slash). */
export function validatePackageEntries(entries: readonly string[]): PackageCheck {
  const problems: string[] = [];
  const names = entries.map((e) => e.replace(/\\/g, '/').replace(/^\/+/, ''));
  for (const name of names) {
    const hit = FORBIDDEN.find((f) => f.pattern.test(name));
    if (hit) problems.push(`forbidden entry (${hit.reason}): ${name}`);
  }
  for (const req of REQUIRED_ENTRIES) {
    if (!names.includes(req)) problems.push(`missing required entry: ${req}`);
  }
  for (const dir of REQUIRED_DIRS) {
    if (!names.some((n) => n.startsWith(dir) && !n.endsWith('/'))) problems.push(`missing required directory: ${dir}`);
  }
  if (!names.includes('server/dist/index.js')) problems.push('missing server entry point: server/dist/index.js');
  if (!names.includes('dist/index.html')) problems.push('missing frontend entry point: dist/index.html');
  return { ok: problems.length === 0, problems };
}

/** Server-only variable names that must never reach the browser bundle. */
export const SERVER_ONLY_NAMES = [
  'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'DATABASE_CA_FILE',
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN',
  'OIDC_CLIENT_SECRET', 'DEV_AUTH_USER_ID', 'ALLOW_DEV_AUTH', 'S3_BUCKET', 'LOCAL_STORAGE_ROOT',
] as const;

const SECRET_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /postgres(?:ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/i, reason: 'database URL with password' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key id' },
  { pattern: /\bASIA[0-9A-Z]{16}\b/, reason: 'AWS temporary access key id' },
  { pattern: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i, reason: 'AWS secret access key' },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'private key' },
  { pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i, reason: 'password-like value' },
];

export interface ScanFinding {
  file: string;
  reason: string;
}

/** Scans in-memory text files. Reports names and reasons only, never the matched value. */
export function scanBundleFiles(files: readonly { path: string; content: string }[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const f of files) {
    for (const name of SERVER_ONLY_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(f.content)) findings.push({ file: f.path, reason: `server-only variable name ${name}` });
    }
    for (const s of SECRET_PATTERNS) {
      if (s.pattern.test(f.content)) findings.push({ file: f.path, reason: s.reason });
    }
  }
  return findings;
}
