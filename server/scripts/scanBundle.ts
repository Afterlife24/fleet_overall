/**
 * `npm run scan:bundle`: scans the built frontend (`dist/`) for server-only variable names,
 * database URLs, password-like values and AWS credential patterns. Exits 1 on any finding.
 * Only file names and reasons are printed, never matched values.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { scanBundleFiles } from './packageLib.js';

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.webmanifest']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function scanDist(distDir: string): number {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.error(`scan:bundle: ${distDir} has no index.html; run "npm run build" first`);
    return 2;
  }
  const files = walk(distDir)
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ path: path.relative(distDir, f).replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
  const findings = scanBundleFiles(files);
  if (findings.length > 0) {
    console.error(`scan:bundle: FAILED, ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  ${f.file}: ${f.reason}`);
    return 1;
  }
  console.log(`scan:bundle: OK, ${files.length} file(s) scanned in ${distDir}, no secrets or server-only names found`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  process.exitCode = scanDist(path.resolve(import.meta.dirname, '../../dist'));
}
