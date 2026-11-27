import { create } from 'zustand';
import type { TaxInvoice } from '@/types/taxinvoice';

interface TaxInvoiceState {
  /**
   * In-memory read copy of the invoices for the retained browser screens (customer links, collection and
   * gate-pass references, the CRM quotation panel). The API is the authority: `readAdapters.mirrorInvoices`
   * fills this list. It is never persisted, seeded or written by a screen.
   */
  invoices: TaxInvoice[];
  forOrg: (orgId: string) => TaxInvoice[];
  getById: (id: string) => TaxInvoice | undefined;
}

export const useTaxInvoiceStore = create<TaxInvoiceState>()((_set, get) => ({
  invoices: [],
  forOrg: (orgId) => get().invoices.filter((i) => i.orgId === orgId),
  getById: (id) => get().invoices.find((i) => i.id === id),
}));
