import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomerANI, CustomerRecord } from '@/types/customerani';
import {
  buildCustomerRecord, findCustomer, nextCustomerRecordId, planFindOrCreate,
} from '@/services/customerCore';
import { planSeeds } from '@/services/seedCore';

export const CUSTOMER_STORE_KEY = 'fleet-customers-v1';

export class DuplicateCustomerError extends Error {
  readonly existingId: string;
  constructor(name: string, existingId: string) {
    super(`A customer named "${name}" already exists`);
    this.name = 'DuplicateCustomerError';
    this.existingId = existingId;
  }
}

export interface CustomerData {
  customers: CustomerRecord[];
  seedMarkers: Record<string, string[]>;
  /** Set when persisted state could not be read. Not persisted. */
  migrationError?: boolean;
}

interface CustomerState extends CustomerData {
  forOrg: (orgId: string) => CustomerRecord[];
  /** Returns the existing customer (customerId unchanged) or adds one. */
  findOrCreate: (orgId: string, name: string) => CustomerRecord;
  /** Throws DuplicateCustomerError when the normalized name is taken in the company. */
  create: (orgId: string, data: Partial<CustomerANI>) => CustomerRecord;
  /** The customerId, id and company never change. Throws when the id is unknown or the new name is taken. */
  update: (orgId: string, id: string, patch: Partial<CustomerANI>) => CustomerRecord;
  remove: (orgId: string, id: string) => void;
  /** Adds the seeds that are not marked and not present, and marks all given seeds. */
  seedOrg: (orgId: string, seeds: CustomerRecord[]) => CustomerRecord[];
  /** Removes every customer of the company ("start fresh"). Seed markers stay, so seeds are not re-added. */
  clearOrg: (orgId: string) => void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const emptyData = (): CustomerData => ({ customers: [], seedMarkers: {} });

const isCustomer = (v: unknown): v is CustomerRecord =>
  isObj(v) && typeof v.id === 'string' && typeof v.orgId === 'string'
  && typeof v.customerId === 'string' && typeof v.customerName === 'string';

/** Pure, total. Keeps every readable record unchanged. */
export function migrateCustomerState(persisted: unknown): CustomerData {
  if (!isObj(persisted) || (persisted.customers !== undefined && !Array.isArray(persisted.customers))) {
    console.warn('[customerStore] malformed persisted state; starting empty');
    return { ...emptyData(), migrationError: true };
  }
  const customers = ((persisted.customers as unknown[] | undefined) ?? []).filter(isCustomer);
  const seedMarkers: Record<string, string[]> = {};
  if (isObj(persisted.seedMarkers)) {
    for (const [k, v] of Object.entries(persisted.seedMarkers)) {
      if (Array.isArray(v)) seedMarkers[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  return { customers, seedMarkers };
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      ...emptyData(),

      forOrg: (orgId) => get().customers.filter((c) => c.orgId === orgId),

      findOrCreate: (orgId, name) => {
        const list = get().customers;
        const now = new Date().toISOString();
        const plan = planFindOrCreate(list, orgId, name, () => nextCustomerRecordId(list, orgId), now);
        if (plan.created) set((s) => ({ customers: [...s.customers, plan.customer] }));
        return plan.customer;
      },

      create: (orgId, data) => {
        const list = get().customers;
        const dup = findCustomer(list, orgId, data.customerName ?? '');
        if (dup && (data.customerName ?? '').trim() !== '') {
          throw new DuplicateCustomerError(data.customerName ?? '', dup.id);
        }
        const clean: Partial<CustomerANI> = { ...data };
        if (!clean.customerId?.trim()) delete clean.customerId;
        const rec = buildCustomerRecord(list, orgId, clean, nextCustomerRecordId(list, orgId), new Date().toISOString());
        set((s) => ({ customers: [...s.customers, rec] }));
        return rec;
      },

      update: (orgId, id, patch) => {
        const existing = get().customers.find((c) => c.orgId === orgId && c.id === id);
        if (!existing) throw new Error('Customer ANI record not found');
        if (patch.customerName !== undefined) {
          const dup = findCustomer(get().customers, orgId, patch.customerName);
          if (dup && dup.id !== id) throw new DuplicateCustomerError(patch.customerName, dup.id);
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, orgId: _orgId, customerId: _customerId, ...rest } = patch as Partial<CustomerRecord>;
        const updated: CustomerRecord = { ...existing, ...rest, updatedAt: new Date().toISOString() };
        set((s) => ({ customers: s.customers.map((c) => (c.orgId === orgId && c.id === id ? updated : c)) }));
        return updated;
      },

      remove: (orgId, id) => {
        if (!get().customers.some((c) => c.orgId === orgId && c.id === id)) {
          throw new Error('Customer ANI record not found');
        }
        set((s) => ({ customers: s.customers.filter((c) => !(c.orgId === orgId && c.id === id)) }));
      },

      seedOrg: (orgId, seeds) => {
        const markers = get().seedMarkers[orgId] ?? [];
        const have = new Set(get().customers.filter((c) => c.orgId === orgId).map((c) => c.id));
        const fresh = planSeeds(markers, have, seeds).filter((s) => s.orgId === orgId);
        set((s) => ({
          customers: [...s.customers, ...fresh],
          seedMarkers: { ...s.seedMarkers, [orgId]: [...new Set([...markers, ...seeds.map((x) => x.id)])] },
        }));
        return fresh;
      },

      clearOrg: (orgId) => set((s) => ({ customers: s.customers.filter((c) => c.orgId !== orgId) })),
    }),
    {
      name: CUSTOMER_STORE_KEY,
      version: 1,
      partialize: (s) => ({ customers: s.customers, seedMarkers: s.seedMarkers }),
      migrate: (persisted) => migrateCustomerState(persisted),
      merge: (persisted, current) => {
        if (persisted === undefined || persisted === null) return current;
        return { ...current, ...migrateCustomerState(persisted) };
      },
    },
  ),
);
