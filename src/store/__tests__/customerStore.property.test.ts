// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { CustomerRecord } from '@/types/customerani';
import { migrateCustomerState, useCustomerStore, CUSTOMER_STORE_KEY } from '../customerStore';

const ORGS = ['org-a', 'org-b', 'org-c'] as const;
const WORDS = ['abc', 'alpha', 'nile', 'gulf', 'sand', 'delta', 'omega', 'crane'];
const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const rowArb = fc.record({
  orgId: fc.constantFrom(...ORGS),
  aniRavaliActive: fc.boolean(),
  trn: fc.constantFrom('', '100412345600003'),
  attn: fc.option(fc.constantFrom('Mr. A', 'Ms. B'), { nil: undefined }),
  attl: fc.integer({ min: 0, max: 5_000_000 }),
  status: fc.constantFrom('Active' as const, 'Inactive' as const, 'Suspended' as const),
  word: fc.constantFrom(...WORDS),
});

/** A valid persisted state with records of several companies. Undefined optional fields are dropped. */
const stateArb = fc
  .tuple(
    fc.array(rowArb, { maxLength: 10 }),
    fc.dictionary(fc.constantFrom(...ORGS), fc.array(fc.constantFrom('cani-1', 'cani-2', 'cani-3'), { maxLength: 3 })),
  )
  .map(([rows, seedMarkers]) => {
    const customers: CustomerRecord[] = rows.map((r, n) => ({
      id: `cani-${r.orgId}-${n + 10}`,
      orgId: r.orgId,
      customerId: `CUST-${String(1000 + n).padStart(6, '0')}`,
      customerName: `${r.word}-${r.orgId}-${n}`,
      fleetLogId: `FL-${String(n + 1).padStart(5, '0')}`,
      aniRavaliActive: r.aniRavaliActive,
      trn: r.trn,
      attn: r.attn,
      address: 'Dubai',
      attl: r.attl,
      contactNumber: '+971 50 123 4567',
      status: r.status,
      branchName: 'Dubai HQ',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }));
    return { customers: roundTrip(customers), seedMarkers };
  });

const reset = (s: { customers: CustomerRecord[]; seedMarkers: Record<string, string[]> }) =>
  useCustomerStore.setState({ customers: s.customers, seedMarkers: s.seedMarkers });

beforeEach(() => {
  localStorage.clear();
  useCustomerStore.setState({ customers: [], seedMarkers: {} });
});

// Feature: rental-flow-integration, Property 18: Company isolation and persistence round trip
describe('Property 18: Company isolation and persistence round trip (customer store)', () => {
  it('forOrg returns only that company, and a change for A leaves every B record equal', () => {
    fc.assert(
      fc.property(stateArb, fc.constantFrom(...ORGS), (state, a) => {
        reset(state);
        const store = () => useCustomerStore.getState();
        for (const o of ORGS) {
          expect(store().forOrg(o)).toEqual(state.customers.filter((c) => c.orgId === o));
          expect(store().forOrg(o).every((c) => c.orgId === o)).toBe(true);
        }
        const others = state.customers.filter((c) => c.orgId !== a);
        const mineBefore = store().forOrg(a);

        // create, find-or-create, update, remove and seed for A
        const created = store().create(a, { customerName: 'Brand New Isolation Co' });
        store().findOrCreate(a, 'brand new isolation co llc');
        store().findOrCreate(a, 'Another Isolation Customer');
        store().update(a, created.id, { attl: 123 });
        store().seedOrg(a, [{ ...created, id: 'seed-1', customerId: 'CUST-009999', customerName: 'Seed Co', orgId: a }]);
        if (mineBefore[0]) store().remove(a, mineBefore[0].id);

        expect(store().customers.filter((c) => c.orgId !== a)).toEqual(others);
        store().clearOrg(a);
        expect(store().forOrg(a)).toEqual([]);
        expect(store().customers).toEqual(others);
      }),
      { numRuns: 100 },
    );
  });

  it('update never changes id, orgId or customerId of the record', () => {
    fc.assert(
      fc.property(stateArb.filter((s) => s.customers.length > 0), fc.nat(), (state, i) => {
        reset(state);
        const target = state.customers[i % state.customers.length];
        const out = useCustomerStore.getState().update(target.orgId, target.id, {
          customerId: 'CUST-999999', id: 'zzz', orgId: 'org-zzz', attl: 7,
        } as Partial<CustomerRecord>);
        expect(out.id).toBe(target.id);
        expect(out.orgId).toBe(target.orgId);
        expect(out.customerId).toBe(target.customerId);
        expect(out.attl).toBe(7);
      }),
      { numRuns: 100 },
    );
  });

  it('serializing then migrating a valid state returns the same records and seed markers', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const back = migrateCustomerState(roundTrip(state));
        expect(back.customers).toEqual(state.customers);
        expect(back.seedMarkers).toEqual(state.seedMarkers);
        expect(back.migrationError).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('the persisted JSON written by the store rehydrates to the same state', async () => {
    await fc.assert(
      fc.asyncProperty(stateArb, async (state) => {
        localStorage.clear();
        reset(state);
        // force a write through the persist middleware, then read it back
        useCustomerStore.setState({ seedMarkers: { ...state.seedMarkers } });
        const raw = localStorage.getItem(CUSTOMER_STORE_KEY);
        expect(raw).not.toBeNull();
        useCustomerStore.setState({ customers: [], seedMarkers: {} }); // this write replaces the stored value
        localStorage.setItem(CUSTOMER_STORE_KEY, raw as string);
        await useCustomerStore.persist.rehydrate();
        expect(useCustomerStore.getState().customers).toEqual(state.customers);
        expect(useCustomerStore.getState().seedMarkers).toEqual(state.seedMarkers);
      }),
      { numRuns: 100 },
    );
  });

  it('migrates state of the previous shape keeping every record, and does not throw on malformed input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fc.assert(
        fc.property(
          stateArb,
          fc.array(fc.oneof(fc.constant(null), fc.integer(), fc.string(), fc.constant({ id: 1 })), { maxLength: 4 }),
          fc.boolean(),
          (state, junk, dropMarkers) => {
            // previous shape: no seedMarkers, extra unknown fields, unreadable rows mixed in
            const previous: Record<string, unknown> = {
              customers: [...junk, ...state.customers.map((c) => ({ ...c, legacyField: 1 }))],
              extra: 'x',
            };
            if (!dropMarkers) previous.seedMarkers = state.seedMarkers;
            const out = migrateCustomerState(roundTrip(previous));
            expect(out.customers).toEqual(state.customers.map((c) => ({ ...c, legacyField: 1 })));
            expect(out.seedMarkers).toEqual(dropMarkers ? {} : state.seedMarkers);
          },
        ),
        { numRuns: 100 },
      );

      fc.assert(
        fc.property(fc.jsonValue(), (anything) => {
          const out = migrateCustomerState(anything);
          expect(Array.isArray(out.customers)).toBe(true);
          expect(typeof out.seedMarkers).toBe('object');
        }),
        { numRuns: 100 },
      );
      for (const bad of [undefined, null, 5, 'x', [], { customers: 'nope' }, { customers: { a: 1 } }]) {
        const out = migrateCustomerState(bad);
        expect(out.customers).toEqual([]);
        expect(out.migrationError).toBe(true);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
