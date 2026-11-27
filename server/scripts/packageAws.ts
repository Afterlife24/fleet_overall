/**
 * `npm run package:aws`: builds the app, then writes one deterministic Elastic Beanstalk ZIP to
 * `build-artifacts/fleet-overall-eb.zip` containing Procfile, package.json, package-lock.json,
 * server/dist/, dist/ and .platform/ at the root. The entry list is validated before writing and
 * the script fails on any forbidden entry. Nothing is uploaded or deployed.
 */
import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { PACKAGE_SOURCES, validatePackageEntries } from './packageLib.js';
import { scanDist } from './scanBundle.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(ROOT, 'build-artifacts');
const OUT_FILE = path.join(OUT_DIR, 'fleet-overall-eb.zip');
/** Fixed timestamp so identical inputs give an identical ZIP. */
const FIXED_DATE = new Date('2000-01-01T00:00:00Z');

function collect(rel: string, out: string[]): void {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) return;
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) collect(path.posix.join(rel, name), out);
  } else {
    out.push(rel.replace(/\\/g, '/'));
  }
}

async function writeZip(entries: string[]): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(OUT_FILE, { force: true });
  const output = createWriteStream(OUT_FILE);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    zip.on('error', reject);
    output.on('error', reject);
  });
  zip.pipe(output);
  for (const name of entries) {
    zip.file(path.join(ROOT, name), { name, date: FIXED_DATE, mode: 0o644 });
  }
  await zip.finalize();
  await done;
}

async function main(): Promise<void> {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) {
    console.log('package:aws: running npm run build');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }

  if (scanDist(path.join(ROOT, 'dist')) !== 0) {
    throw new Error('bundle secret scan failed; package not written');
  }

  const entries: string[] = [];
  for (const src of PACKAGE_SOURCES) collect(src, entries);
  entries.sort();

  const check = validatePackageEntries(entries);
  if (!check.ok) {
    for (const p of check.problems) console.error(`  ${p}`);
    throw new Error(`package validation failed with ${check.problems.length} problem(s); package not written`);
  }

  await writeZip(entries);
  const size = statSync(OUT_FILE).size;
  console.log(`package:aws: OK, ${entries.length} entries, ${(size / 1024).toFixed(0)} KiB -> ${path.relative(ROOT, OUT_FILE)}`);
  console.log('package:aws: nothing was uploaded or deployed; upload the ZIP to Elastic Beanstalk manually.');
}

main().catch((err: unknown) => {
  console.error(`package:aws: FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
