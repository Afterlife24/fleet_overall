// Task 10: pure logic of the company area (gating validation, app catalog copy, custom attribute validation).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CATALOG, dependentsOf, withDependencies } from '../../src/constants/appCatalog.js';
import { AppError } from '../../src/errors.js';
import { GATING_RULE_KEYS, validateGatingRules } from '../../src/modules/company/index.js';
import { validateCustomAttributes, type CustomFieldDef } from '../../src/modules/shared/customAttributes.js';
import { allowlisted, validateRoleCodes } from '../../src/modules/users/index.js';
import { isActionCode } from '../../src/auth/principal.js';

const rules = Object.fromEntries(GATING_RULE_KEYS.map((k) => [k, true]));

function fieldErrors(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.fieldErrors;
    throw err;
  }
  throw new Error('expected an AppError');
}

describe('validateGatingRules', () => {
  it('accepts exactly the seven booleans', () => {
    expect(validateGatingRules(rules)).toEqual(rules);
  });

  it('rejects missing, extra and non-boolean keys', () => {
    expect(fieldErrors(() => validateGatingRules(Object.fromEntries(Object.entries(rules).filter(([k]) => k !== 'requireLpo'))))).toEqual({ 'gatingRules.requireLpo': 'required' });
    expect(fieldErrors(() => validateGatingRules({ ...rules, bogus: true }))).toEqual({ 'gatingRules.bogus': 'unrecognized_key' });
    expect(fieldErrors(() => validateGatingRules({ ...rules, requireQuote: 1 }))).toEqual({ 'gatingRules.requireQuote': 'invalid_type' });
  });

  it('flags Won-only invoicing and same-company ownership as locked rules', () => {
    const errors = fieldErrors(() => validateGatingRules({ ...rules, wonOnlyInvoicing: false, same_company_ownership: false }));
    expect(errors).toEqual({ 'gatingRules.wonOnlyInvoicing': 'locked_rule', 'gatingRules.same_company_ownership': 'locked_rule' });
  });
});

describe('app catalog copy', () => {
  // Parses src/constants/apps.ts as text (it imports browser-only icons) to detect drift.
  const source = readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'src', 'constants', 'apps.ts'), 'utf8');
  const frontend = [...source.matchAll(/\n {2}\{\r?\n([\s\S]*?)\r?\n {2}\},/g)].map((m) => {
    const id = /\bid: '(\w+)'/.exec(m[1])?.[1];
    const deps = /depends: \[([^\]]*)\]/.exec(m[1])?.[1] ?? '';
    return { id, depends: [...deps.matchAll(/'(\w+)'/g)].map((d) => d[1]) };
  });

  it('has the same app ids and dependencies as src/constants/apps.ts', () => {
    expect(frontend.length).toBeGreaterThan(20);
    expect(APP_CATALOG.map((a) => ({ id: a.id, depends: [...a.depends] }))).toEqual(frontend);
  });

  it('resolves transitive dependencies and dependents', () => {
    expect(withDependencies('crm').sort()).toEqual(['crm', 'customer_ani', 'invoice']);
    expect(dependentsOf('fleet', ['planner', 'crm', 'fleet'])).toEqual(['planner']);
  });
});

describe('role code allowlists', () => {
  it('keeps only known codes and rejects unknown ones with a field error per code', () => {
    expect(allowlisted(['customers.read', 'x', 'customers.read'], isActionCode)).toEqual(['customers.read']);
    expect(() => validateRoleCodes({ permissions: ['customers.read'], appCodes: ['crm'] })).not.toThrow();
    expect(fieldErrors(() => validateRoleCodes({ permissions: ['nope'], appCodes: ['nada'] }))).toEqual({
      'permissions.nope': 'unknown_code',
      'appCodes.nada': 'unknown_code',
    });
  });
});

describe('validateCustomAttributes', () => {
  const defs: CustomFieldDef[] = [
    { fieldKey: 'note', fieldType: 'TEXT', required: true, options: [] },
    { fieldKey: 'limit', fieldType: 'NUMBER', required: false, options: [] },
    { fieldKey: 'price', fieldType: 'CURRENCY', required: false, options: [] },
    { fieldKey: 'since', fieldType: 'DATE', required: false, options: [] },
    { fieldKey: 'tier', fieldType: 'SELECT', required: false, options: ['gold', 'silver'] },
    { fieldKey: 'vip', fieldType: 'BOOLEAN', required: false, options: [] },
  ];

  it('accepts valid values and drops cleared optional fields', () => {
    const out = validateCustomAttributes(defs, { note: 'hi', limit: 3, price: '10.50', since: '2024-02-29', tier: 'gold', vip: false });
    expect(out).toEqual({ note: 'hi', limit: 3, price: '10.50', since: '2024-02-29', tier: 'gold', vip: false });
    expect(validateCustomAttributes(defs, { note: 'hi', tier: '' })).toEqual({ note: 'hi' });
  });

  it('reports unknown keys, wrong types, bad options, bad dates and missing required fields', () => {
    expect(
      fieldErrors(() => validateCustomAttributes(defs, { limit: '3', since: '2023-02-29', tier: 'bronze', vip: 'yes', extra: 1 })),
    ).toEqual({
      'customAttributes.limit': 'invalid_number',
      'customAttributes.since': 'invalid_date',
      'customAttributes.tier': 'invalid_option',
      'customAttributes.vip': 'invalid_boolean',
      'customAttributes.extra': 'unknown_field',
      'customAttributes.note': 'required',
    });
    expect(fieldErrors(() => validateCustomAttributes(defs, []))).toEqual({ customAttributes: 'invalid_type' });
  });
});
