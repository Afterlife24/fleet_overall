import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InvoiceType, TaxInvoice } from '@/types/taxinvoice';
import { taxInvoices as seedInvoices } from '@/services/mock/taxinvoice';
import { JA_ORG_ID } from '@/store/authStore';

interface TaxInvoiceData {
  invoices: TaxInvoice[]; // all orgs
  seededOrgs: string[]; // orgs whose legacy demo rows were inserted
  demoLinkedOrgs: string[]; // orgs whose sample linked invoice was inserted
  sequenceByQuotation: Record<string, number>;
}

interface TaxInvoiceState extends TaxInvoiceData {
  ensureSeeded: (orgId: string) => void;
  forOrg: (orgId: string) => TaxInvoice[];
  getById: (id: string) => TaxInvoice | undefined;
  insert: (inv: TaxInvoice) => void;
  insertLinked: (inv: TaxInvoice) => void;
  patch: (id: string, data: Partial<TaxInvoice>) => TaxInvoice;
  remove: (id: string) => void;
  newId: () => string;
}

/** Fills defaults on rows persisted before orgId existed. */
function normalizeInvoice(raw: Partial<TaxInvoice> & { id: string }): TaxInvoice {
  return { ...(raw as TaxInvoice), orgId: raw.orgId ?? JA_ORG_ID };
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Pure, total migration of persisted state. Resets on malformed data, normalises rows
 * and rebuilds the per-quotation counters from the stored map and stored sequences.
 */
export function migrateTaxInvoiceState(persisted: unknown): TaxInvoiceData {
  const p = persisted as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.invoices)) {
    console.warn('[taxInvoiceStore] malformed persisted state; resetting');
    return { invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} };
  }
  const invoices = (p.invoices as unknown[])
    .filter(
      (r): r is Partial<TaxInvoice> & { id: string } =>
        !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
    )
    .map(normalizeInvoice);

  const sequenceByQuotation: Record<string, number> = {};
  const stored = p.sequenceByQuotation;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) sequenceByQuotation[k] = v;
    }
  }
  for (const inv of invoices) {
    if (inv.quotationId && typeof inv.sequence === 'number' && Number.isFinite(inv.sequence)) {
      sequenceByQuotation[inv.quotationId] = Math.max(
        sequenceByQuotation[inv.quotationId] ?? 0,
        inv.sequence
      );
    }
  }
  return {
    invoices,
    seededOrgs: stringArray(p.seededOrgs),
    demoLinkedOrgs: stringArray(p.demoLinkedOrgs),
    sequenceByQuotation,
  };
}

/**
 * v1 -> v2: demo rows seeded before invoice types existed get their type and billing period from the
 * current seed; the old HA-2026-005 demo row is dropped because the linked sample QT-2026-0010/01 bills it.
 * User-created and edited rows are left alone.
 */
function upgradeSeedRows(data: TaxInvoiceData): TaxInvoiceData {
  const invoices: TaxInvoice[] = [];
  for (const inv of data.invoices) {
    const m = /^inv-seed-.+-(\d+)$/.exec(inv.id);
    if (!m || inv.invoiceType || inv.quotationId) { invoices.push(inv); continue; }
    const seed = seedInvoices[Number(m[1]) - 1];
    if (seed && seed.hireAgreementNo === inv.hireAgreementNo) {
      invoices.push({
        ...inv,
        invoiceType: seed.invoiceType,
        periodStart: seed.periodStart,
        periodEnd: seed.periodEnd,
        hirePeriod: seed.hirePeriod,
        invoiceDate: seed.invoiceDate,
        dueDate: seed.dueDate,
        status: seed.status,
      });
    } else if (inv.invoiceNo === 'INV-2026-005' && inv.hireAgreementNo === 'HA-2026-005') {
      // replaced by the linked sample invoice
    } else {
      invoices.push(inv);
    }
  }
  return { ...data, invoices };
}

/** Stable "random" pick per invoice id, so the same invoice always gets the same type. */
export function pickInvoiceType(id: string): InvoiceType {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? 'Continuous Hire' : 'Off-Hire';
}

/**
 * v2 -> v3: every invoice gets an Invoice_Type. Rows saved without one get a type picked from their id,
 * and a billing period read from the hire period text ("YYYY-MM-DD – YYYY-MM-DD") when they have none.
 */
export function assignMissingTypes(data: TaxInvoiceData): TaxInvoiceData {
  return {
    ...data,
    invoices: data.invoices.map((inv) => {
      if (inv.invoiceType) return inv;
      const m = /(\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})/.exec(inv.hirePeriod ?? '');
      return {
        ...inv,
        invoiceType: pickInvoiceType(inv.id),
        periodStart: inv.periodStart ?? m?.[1],
        periodEnd: inv.periodEnd ?? m?.[2],
      };
    }),
  };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export const useTaxInvoiceStore = create<TaxInvoiceState>()(
  persist(
    (set, get) => ({
      invoices: [],
      seededOrgs: [],
      demoLinkedOrgs: [],
      sequenceByQuotation: {},

      ensureSeeded: (orgId) => {
        if (get().seededOrgs.includes(orgId)) return;
        const now = new Date().toISOString();
        const rows: TaxInvoice[] = seedInvoices.map((s, i) => ({
          ...s,
          id: `inv-seed-${orgId}-${i + 1}`,
          orgId,
          createdAt: s.createdAt ?? now,
          updatedAt: s.updatedAt ?? now,
        }));
        set((state) => {
          if (state.seededOrgs.includes(orgId)) return state;
          const existing = new Set(state.invoices.map((r) => r.id));
          return {
            invoices: [...state.invoices, ...rows.filter((r) => !existing.has(r.id))],
            seededOrgs: [...state.seededOrgs, orgId],
          };
        });
      },

      forOrg: (orgId) => get().invoices.filter((i) => i.orgId === orgId),

      getById: (id) => get().invoices.find((i) => i.id === id),

      insert: (inv) => set((state) => ({ invoices: [...state.invoices, inv] })),

      insertLinked: (inv) =>
        set((state) => {
          const q = inv.quotationId;
          const seq = inv.sequence ?? 0;
          return {
            invoices: [...state.invoices, inv],
            sequenceByQuotation: q
              ? {
                  ...state.sequenceByQuotation,
                  [q]: Math.max(state.sequenceByQuotation[q] ?? 0, seq),
                }
              : state.sequenceByQuotation,
          };
        }),

      patch: (id, data) => {
        const existing = get().invoices.find((i) => i.id === id);
        if (!existing) throw new Error('Tax invoice not found');
        // Identity and ownership fields are immutable.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, orgId: _orgId, createdAt: _createdAt, ...rest } = data;
        const updated: TaxInvoice = { ...existing, ...rest };
        set((state) => ({
          invoices: state.invoices.map((i) => (i.id === id ? updated : i)),
        }));
        return updated;
      },

      // The per-quotation counter is intentionally left unchanged so numbers are never reused.
      remove: (id) => set((state) => ({ invoices: state.invoices.filter((i) => i.id !== id) })),

      newId: () => {
        const taken = new Set(get().invoices.map((i) => i.id));
        let id: string;
        do {
          id = `inv-${Date.now().toString(36)}-${randomSuffix()}`;
        } while (taken.has(id));
        return id;
      },
    }),
    {
      name: 'fleet-tax-invoices-v1',
      version: 3,
      partialize: (state) => ({
        invoices: state.invoices,
        seededOrgs: state.seededOrgs,
        demoLinkedOrgs: state.demoLinkedOrgs,
        sequenceByQuotation: state.sequenceByQuotation,
      }),
      migrate: (persisted, version) => {
        const data = migrateTaxInvoiceState(persisted);
        const upgraded = version < 2 ? upgradeSeedRows(data) : data;
        return version < 3 ? assignMissingTypes(upgraded) : upgraded;
      },
    }
  )
);
