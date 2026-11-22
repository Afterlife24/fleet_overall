// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = __dirname;
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Module specifiers of all import / export-from / dynamic import / require lines. */
function specifiers(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const re =
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) out.push(m[1] ?? m[2]);
  return out;
}

/** Full import statements, to tell type-only imports from value imports. */
function importStatements(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return noComments.match(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"][^'"]+['"]|(?:^|\n)\s*import\s+['"][^'"]+['"]/g) ?? [];
}

const CRM_STORE = /(^|\/)store\/crmStore$/;
const isCrmStore = (spec: string) => spec === '@/store/crmStore' || CRM_STORE.test(spec);

describe('architecture: plugin boundaries', () => {
  for (const dir of ['features/planner', 'features/gate', 'features/documents']) {
    it(`${dir} does not import crmStore`, () => {
      const root = path.join(SRC, dir);
      expect(fs.existsSync(root)).toBe(true);
      const offenders = listFiles(root)
        .filter((f) => !/\.test\.tsx?$/.test(f))
        .filter((f) => specifiers(fs.readFileSync(f, 'utf8')).some(isCrmStore))
        .map((f) => path.relative(SRC, f));
      expect(offenders).toEqual([]);
    });
  }

  it('apps.ts adds no depends between planner, fleet, quotation and crm beyond the existing ones', () => {
    const source = read('constants/apps.ts');
    const tracked = ['planner', 'fleet', 'quotation', 'crm'];
    const parts = source.split(/\n\s*\{\s*\n?\s*id:\s*'/).slice(1);
    const deps: Record<string, string[]> = {};
    for (const part of parts) {
      const id = part.slice(0, part.indexOf("'"));
      const block = part.split(/\n\s*\},?\s*\n/)[0];
      const m = block.match(/depends:\s*\[([^\]]*)\]/);
      deps[id] = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    }
    for (const id of tracked) expect(deps).toHaveProperty(id);
    const edges: string[] = [];
    for (const id of tracked) {
      for (const d of deps[id]) if (tracked.includes(d)) edges.push(`${id}->${d}`);
    }
    // Existing edges only: planner depends on fleet.
    expect(edges.sort()).toEqual(['planner->fleet']);
  });

  it('hireLinkCore.ts imports only types', () => {
    const stmts = importStatements(read('services/hireLinkCore.ts'));
    expect(stmts.length).toBeGreaterThan(0);
    const valueImports = stmts.filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s));
    expect(valueImports).toEqual([]);
    // No inline `{ type X }`-free value imports and no dynamic imports / require.
    expect(read('services/hireLinkCore.ts')).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });

  it('hireLink.ts does not import services.ts or appStore.ts', () => {
    const specs = specifiers(read('services/hireLink.ts'));
    expect(specs.length).toBeGreaterThan(0);
    const bad = specs.filter(
      (s) => /(^|\/)services\/services$/.test(s) || /^\.\/services$/.test(s) || /(^|\/)store\/appStore$/.test(s),
    );
    expect(bad).toEqual([]);
  });

  it('invoiceRulesCore.ts imports only types', () => {
    const source = read('services/invoiceRulesCore.ts');
    const stmts = importStatements(source);
    const valueImports = stmts.filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s));
    expect(valueImports).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });

  it('collectionCore.ts imports only types', () => {
    const source = read('services/collectionCore.ts');
    const stmts = importStatements(source);
    expect(stmts.length).toBeGreaterThan(0);
    const valueImports = stmts.filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s));
    expect(valueImports).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });

  it('gateCore.ts value-imports only collectionCore, with no require or dynamic import', () => {
    const source = read('services/gateCore.ts');
    const stmts = importStatements(source);
    expect(stmts.length).toBeGreaterThan(0);
    const valueImports = stmts.filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s));
    const offenders = valueImports.filter(
      (s) => !/from\s+['"](?:@\/services\/collectionCore|\.\/collectionCore)['"]/.test(s),
    );
    expect(offenders).toEqual([]);
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(
      /\brequire\s*\(|\bimport\s*\(/,
    );
  });

  it('serverClock.ts does not import any store module', () => {
    const specs = specifiers(read('services/serverClock.ts'));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => s.includes('/store/') || s.includes('Store'))).toEqual([]);
  });

  it('jsqr is a runtime dependency, not a devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty('jsqr');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('jsqr');
  });

  const FORBIDDEN_SERVICES = (s: string) =>
    /(^|\/)services\/services$/.test(s) || /^\.\/services$/.test(s) || /(^|\/)store\/appStore$/.test(s);

  for (const file of ['services/collectionDocs.ts', 'services/collectionPdf.ts']) {
    it(`${file} does not import services.ts or appStore.ts`, () => {
      const specs = specifiers(read(file));
      expect(specs.length).toBeGreaterThan(0);
      expect(specs.filter(FORBIDDEN_SERVICES)).toEqual([]);
    });
  }

  for (const dir of ['features/collection', 'features/thirdparty']) {
    it(`${dir} does not import crmStore, services.ts or appStore.ts`, () => {
      const root = path.join(SRC, dir);
      expect(fs.existsSync(root)).toBe(true);
      const offenders = listFiles(root)
        .filter((f) => specifiers(fs.readFileSync(f, 'utf8')).some((s) => isCrmStore(s) || FORBIDDEN_SERVICES(s)))
        .map((f) => path.relative(SRC, f));
      expect(offenders).toEqual([]);
    });
  }

  it('third_party_services app exists with its path and no depends', () => {
    const source = read('constants/apps.ts');
    const part = source.split(/\n\s*\{\s*\n?\s*id:\s*'third_party_services'/)[1];
    expect(part).toBeDefined();
    const block = part.split(/\n\s*\},?\s*\n/)[0];
    expect(block).toContain("'/docs/third-party-services'");
    expect(block).not.toMatch(/depends:/);
  });

  it('Machine type has optional fleetNo', () => {
    expect(read('types/machine.ts')).toMatch(/interface Machine\b[\s\S]*?\n\s*fleetNo\?:\s*string;/);
  });

  describe('gate operations only in the Gate Operations app', () => {
    const norm = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
    const isTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.includes('__tests__/');
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const prod = listFiles(SRC)
      .map((f) => ({ rel: norm(f), source: fs.readFileSync(f, 'utf8') }))
      .filter((f) => !isTest(f.rel));

    it('only src/features/gate uses gate operations (GatePassDialog, gate mutations, addGateEntry, updateGateEntry)', () => {
      const definitions = [
        'hooks/useQueries.ts',
        'services/services.ts',
        'store/appStore.ts',
        'store/gateStore.ts',
      ];
      const re =
        /\b(?:GatePassDialog|useCreateGateEntry|useApproveGateEntry|useCompleteGateEntry)\b|\b(?:addGateEntry|updateGateEntry)\s*\(/;
      const offenders = prod
        .filter((f) => !f.rel.startsWith('features/gate/') && !definitions.includes(f.rel))
        .filter((f) => re.test(strip(f.source)))
        .map((f) => f.rel);
      expect(offenders).toEqual([]);
    });

    it('only gate and services code sets a Collection Note status to Collected', () => {
      // Assignments and patches only; a type union or status list is not a write.
      const re =
        /\bstatus\s*:\s*['"]Collected['"]|\bstatus\s*=\s*['"]Collected['"]|\b(?:setValue|set|patch)\s*\([^)]*['"]Collected['"]/;
      const servicesAllowed = (rel: string) =>
        rel === 'services/collectionDocs.ts' || rel === 'services/demoSeed.ts' || rel.startsWith('services/mock/');
      const offenders = prod
        .filter((f) => !f.rel.startsWith('features/gate/'))
        .filter((f) => !servicesAllowed(f.rel))
        .filter((f) => re.test(strip(f.source)))
        .map((f) => f.rel);
      expect(offenders).toEqual([]);
    });

    it('CollectionDetail has no Collected option list and the type still declares Collected', () => {
      expect(read('features/collection/CollectionDetail.tsx')).not.toMatch(
        /\[\s*'Draft'\s*,\s*'Scheduled'\s*,\s*'Collected'\s*,\s*'Closed'\s*\]/,
      );
      expect(read('types/collection.ts')).toMatch(/'Collected'/);
    });

    it('only the gate feature and gate-owning services import the gate store', () => {
      const allowed = ['store/gateStore.ts', 'services/services.ts', 'services/demoSeed.ts'];
      const offenders = prod
        .filter((f) => !allowed.includes(f.rel) && !f.rel.startsWith('features/gate/'))
        .filter((f) => specifiers(f.source).some((s) => /(^|\/)store\/gateStore$/.test(s)))
        .map((f) => f.rel);
      expect(offenders).toEqual([]);
    });

    it('demoGate.ts imports only gateCore, collectionCore, demoHireLink and types', () => {
      const source = read('services/mock/demoGate.ts');
      const valueImports = importStatements(source).filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s));
      const offenders = valueImports.filter(
        (s) => !/from\s+['"][^'"]*\b(?:gateCore|collectionCore|demoHireLink)['"]/.test(s),
      );
      expect(offenders).toEqual([]);
    });
  });

  it('quotationInvoicing.ts does not import services.ts or appStore.ts', () => {
    const specs = specifiers(read('services/quotationInvoicing.ts'));
    expect(specs.length).toBeGreaterThan(0);
    const bad = specs.filter(
      (s) => /(^|\/)services\/services$/.test(s) || /^\.\/services$/.test(s) || /(^|\/)store\/appStore$/.test(s),
    );
    expect(bad).toEqual([]);
  });
});
