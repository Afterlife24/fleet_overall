import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/routes.js';

/**
 * Static contract check between the frontend API clients (src/services/api) and the Express routers.
 * Compares method + path only (param names ignored). Bodies and headers are reviewed by hand.
 */

const API_DIR = path.resolve(import.meta.dirname, '../../../src/services/api');
const CLIENT_FILES = [
  'bookings', 'invoices', 'transport', 'collection', 'documents', 'gate', 'customers', 'machines', 'machineModels',
  'machineDocuments', 'quotations', 'hireAgreements', 'customerLpos', 'files', 'company', 'session',
];

/** Routes mounted only when `auth.publicRouter` is the dev fixture router (not built here). */
const CONDITIONAL_SERVER_ROUTES = ['POST /dev/session'];

const norm = (p: string): string =>
  ('/' + p.split('?')[0].replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z]\w*/g, ':p').replace(/^\/+|\/+$/g, '')).replace(/\/+/g, '/');

// ----------------------------------------------------------------------------- server side

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

function collectRoutes(stack: Layer[], out: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const [m, on] of Object.entries(layer.route.methods)) if (on) out.add(`${m.toUpperCase()} ${norm(p)}`);
      }
    } else if (layer.handle?.stack) {
      // Every module router is mounted at the root of /api/v1, so no prefix is applied.
      collectRoutes(layer.handle.stack, out);
    }
  }
}

function serverRoutes(): Set<string> {
  const router = createApiRouter({
    dbProbe: async () => undefined,
    auth: { publicRouter: Router(), middleware: (_req: unknown, _res: unknown, next: () => void) => next() } as never,
    files: {} as never,
  });
  const out = new Set<string>();
  collectRoutes((router as unknown as { stack: Layer[] }).stack, out);
  return out;
}

// ----------------------------------------------------------------------------- client side

interface ClientCall { method: string; path: string; file: string; line: number }

const lineOf = (src: string, index: number): number => src.slice(0, index).split('\n').length;

function extractCalls(file: string): ClientCall[] {
  const src = readFileSync(path.join(API_DIR, `${file}.ts`), 'utf8');
  const calls: ClientCall[] = [];

  // Local path helpers: const passPath = (id: string) => `/gate-passes/${...}`;
  const helpers = new Map<string, string>();
  for (const m of src.matchAll(/const (\w+) = \(\w+: string\) =>\s*`([^`]*)`/g)) helpers.set(m[1], m[2]);

  const resolve = (expr: string): string => {
    let e = expr;
    for (const [name, tpl] of helpers) e = e.split('${' + name + '(').length > 1 || e.startsWith(name + '(')
      ? e.replace(new RegExp('\\$\\{' + name + '\\([^)]*\\)\\}', 'g'), tpl) : e;
    for (const [name, tpl] of helpers) if (new RegExp('^' + name + '\\(').test(e)) e = tpl;
    return e;
  };

  // apiRequest<T>( `...` | '...' | helper(x) , { ... method: 'X' ... } )
  const re = /apiRequest(?:WithMeta)?\s*(?:<[^(]*?>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*"|\w+\([^)]*\))/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    const window = src.slice(m.index!, end);
    const method = /method:\s*'(\w+)'/.exec(window)?.[1] ?? 'GET';
    let expr = m[1];
    expr = /^[`'"]/.test(expr) ? expr.slice(1, -1) : expr;
    expr = resolve(expr);
    calls.push({ method, path: norm(expr), file, line: lineOf(src, m.index!) });
  });

  // Generic CRUD clients: collectionApi<...>('/x') and archiveCall<...>('/x')
  for (const m of src.matchAll(/collectionApi\s*<[^(]*?>\s*\(\s*'([^']+)'/g)) {
    const line = lineOf(src, m.index!);
    const b = m[1];
    calls.push({ method: 'GET', path: norm(b), file, line }, { method: 'GET', path: norm(`${b}/:id`), file, line });
    calls.push({ method: 'POST', path: norm(b), file, line }, { method: 'PATCH', path: norm(`${b}/:id`), file, line });
  }
  for (const m of src.matchAll(/archiveCall\s*<[^(]*?>\s*\(\s*'([^']+)'/g)) {
    calls.push({ method: 'DELETE', path: norm(`${m[1]}/:id`), file, line: lineOf(src, m.index!) });
  }

  // File content download: contentPath: (id) => `${API_BASE}/files/${id}/content`, fetched with GET.
  for (const m of src.matchAll(/contentPath:[^`]*`\$\{API_BASE\}([^`]*)`/g)) {
    calls.push({ method: 'GET', path: norm(m[1]), file, line: lineOf(src, m.index!) });
  }
  return calls;
}

describe('frontend API clients vs server routes', () => {
  const server = serverRoutes();
  const calls = CLIENT_FILES.flatMap(extractCalls);

  it('discovers a plausible number of routes and calls (guards against a broken extractor)', () => {
    expect(server.size).toBeGreaterThan(80);
    expect(calls.length).toBeGreaterThan(80);
  });

  it('every frontend call has a matching server route (method + path)', () => {
    const missing = calls
      .filter((c) => !server.has(`${c.method} ${c.path}`) && !CONDITIONAL_SERVER_ROUTES.includes(`${c.method} ${c.path}`))
      .map((c) => `${c.method} ${c.path}   (src/services/api/${c.file}.ts:${c.line})`);
    expect(missing, `Frontend calls without a server route:\n${missing.join('\n')}`).toEqual([]);
  });

  it('lists server routes the frontend never calls (informational)', () => {
    const called = new Set(calls.map((c) => `${c.method} ${c.path}`));
    const unused = [...server].filter((r) => !called.has(r)).sort();
    console.info(`Server routes never called by the frontend clients (${unused.length}):\n${unused.join('\n')}`);
    expect(Array.isArray(unused)).toBe(true);
  });
});
