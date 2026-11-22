// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CustomerRecord } from '@/types/customerani';
import { useCustomerStore } from '@/store/customerStore';
import {
  findCustomer, nextCustomerRecordId, normalizeCustomerName, planFindOrCreate,
} from '../customerCore';

const WORDS = ['abc', 'alpha', 'nile', 'gulf', 'sand', 'delta', 'omega', 'crane', 'hire', 'zed'];
const ORGS = ['org-a', 'org-b'] as const;
const SUFFIXES = ['', ' LLC', ' llc', ' L.L.C.', ', LLC', ' PJSC', ' pjsc', ' P.J.S.C.'];
const NOW = '2026-01-01T00:00:00.000Z';

/** Base words (no legal suffix) of a customer name. */
const baseArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 });
const suffixArb = fc.constantFrom(...SUFFIXES);
const caseArb = fc.constantFrom<'lower' | 'upper' | 'title'>('lower', 'upper', 'title');
const gapArb = fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 3, maxLength: 3 });
const padArb = fc.integer({ min: 0, max: 3 });

const title = (w: string) => w[0].toUpperCase() + w.slice(1);
const cased = (s: string, c: 'lower' | 'upper' | 'title') =>
  c === 'lower' ? s.toLowerCase() : c === 'upper' ? s.toUpperCase() : s.split(' ').map((w) => (w ? title(w) : w)).join(' ');

/** A spelling of the base words: letter case, inner gaps, suffix and outer padding vary. */
const spellingArb = (base: fc.Arbitrary<string[]>) =>
  fc.tuple(base, suffixArb, caseArb, gapArb, padArb, padArb).map(([words, suffix, c, gaps, l, r]) => {
    const joined = words.map((w, i) => (i === 0 ? w : ' '.repeat(gaps[(i - 1) % gaps.length]) + w)).join('');
    return ' '.repeat(l) + cased(joined, c) + suffix + ' '.repeat(r);
  });

// A name always starts from the same words, so a second spelling of a first name is a variant of it.
const sameBaseArb = baseArb.chain((words) =>
  fc.tuple(spellingArb(fc.constant(words)), spellingArb(fc.constant(words))));

const nameArb = spellingArb(baseArb);
const opArb = fc.record({ orgId: fc.constantFrom(...ORGS), name: nameArb });

const key = (orgId: string, name: string) => `${orgId}|${normalizeCustomerName(name)}`;

function runPlan(ops: { orgId: string; name: string }[]) {
  let list: CustomerRecord[] = [];
  const trail: { orgId: string; name: string; customer: CustomerRecord; created: boolean; size: number }[] = [];
  for (const op of ops) {
    const plan = planFindOrCreate(list, op.orgId, op.name, () => nextCustomerRecordId(list, op.orgId), NOW);
    if (plan.created) list = [...list, plan.customer];
    trail.push({ ...op, customer: plan.customer, created: plan.created, size: list.length });
  }
  return { list, trail };
}

// Feature: rental-flow-integration, Property 12: Customer find-or-create
describe('Property 12: Customer find-or-create', () => {
  it('normalization ignores case, outer and inner spaces, and a trailing LLC or PJSC', () => {
    fc.assert(
      fc.property(sameBaseArb, ([a, b]) => {
        expect(normalizeCustomerName(a)).toBe(normalizeCustomerName(b));
        const n = normalizeCustomerName(a);
        expect(normalizeCustomerName(n)).toBe(n);
        expect(n).toBe(n.trim());
        expect(n).not.toMatch(/\s{2,}/);
      }),
      { numRuns: 100 },
    );
  });

  it('names with different words stay different after normalization', () => {
    fc.assert(
      fc.property(fc.tuple(baseArb, baseArb).filter(([x, y]) => x.join(' ') !== y.join(' ')), ([x, y]) => {
        expect(normalizeCustomerName(x.join(' '))).not.toBe(normalizeCustomerName(y.join(' ')));
      }),
      { numRuns: 100 },
    );
  });

  it('a variant of an existing name returns that customer and keeps the registry size', () => {
    fc.assert(
      fc.property(sameBaseArb, fc.constantFrom(...ORGS), ([first, variant], orgId) => {
        const a = planFindOrCreate([], orgId, first, () => 'cani-x-10', NOW);
        expect(a.created).toBe(true);
        const list = [a.customer];
        const b = planFindOrCreate(list, orgId, variant, () => 'cani-x-11', NOW);
        expect(b.created).toBe(false);
        expect(b.customer).toBe(a.customer);
        expect(b.customer.customerId).toBe(a.customer.customerId);
        expect(findCustomer(list, orgId, variant)).toBe(a.customer);
      }),
      { numRuns: 100 },
    );
  });

  it('for any sequence of names: one customer per company and normalized name, ids never change', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const { list, trail } = runPlan(ops);
        const keys = new Set(ops.map((o) => key(o.orgId, o.name)));
        // never a second customer with the same normalized name in a company
        expect(list.length).toBe(keys.size);
        expect(new Set(list.map((c) => key(c.orgId, c.customerName))).size).toBe(list.length);
        // a name that matches no customer adds exactly one; a match adds none
        const seen = new Set<string>();
        let prev = 0;
        for (const t of trail) {
          const k = key(t.orgId, t.name);
          expect(t.created).toBe(!seen.has(k));
          expect(t.size).toBe(prev + (t.created ? 1 : 0));
          seen.add(k);
          prev = t.size;
          expect(t.customer.orgId).toBe(t.orgId);
          expect(key(t.customer.orgId, t.customer.customerName)).toBe(k);
        }
        // the customerId a company first got for a name is what every later call returns
        const first = new Map<string, string>();
        for (const t of trail) {
          const k = key(t.orgId, t.name);
          if (!first.has(k)) first.set(k, t.customer.customerId);
          expect(t.customer.customerId).toBe(first.get(k));
        }
        // ids are unique within a company
        for (const org of ORGS) {
          const mine = list.filter((c) => c.orgId === org);
          expect(new Set(mine.map((c) => c.customerId)).size).toBe(mine.length);
          expect(new Set(mine.map((c) => c.id)).size).toBe(mine.length);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 12: Customer find-or-create (customerStore.findOrCreate)', () => {
  beforeEach(() => useCustomerStore.setState({ customers: [], seedMarkers: {} }));

  it('reuses variants, never duplicates and never changes the customerId', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 20 }), (ops) => {
        useCustomerStore.setState({ customers: [], seedMarkers: {} });
        const firstId = new Map<string, string>();
        for (const op of ops) {
          const before = useCustomerStore.getState().customers.length;
          const c = useCustomerStore.getState().findOrCreate(op.orgId, op.name);
          const k = key(op.orgId, op.name);
          const isNew = !firstId.has(k);
          if (isNew) firstId.set(k, c.customerId);
          expect(c.customerId).toBe(firstId.get(k));
          expect(useCustomerStore.getState().customers.length).toBe(before + (isNew ? 1 : 0));
        }
        expect(useCustomerStore.getState().customers.length).toBe(firstId.size);
      }),
      { numRuns: 100 },
    );
  });
});
