// Read helpers over the in-memory invoice mirror (filled from `/api/v1/invoices` by `readAdapters.mirrorInvoices`).
// Creating, editing, issuing and cancelling invoices happens through `hooks/api/useInvoicesApi.ts`; the rules
// (Won-only, contiguous periods, Off-Hire end, Draft-only edits) are enforced by the server.
// Must not import services.ts, appStore.ts or any component (keeps the graph acyclic).
import { useMemo } from 'react';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import type { TaxInvoice } from '@/types/taxinvoice';

export function invoicesForQuotation(quotationId: string): TaxInvoice[] {
  if (!quotationId) return [];
  return useTaxInvoiceStore.getState().invoices.filter((i) => i.quotationId === quotationId);
}

/** Zustand selector hook: re-renders when the invoice mirror changes. */
export function useInvoicesForQuotation(quotationId: string): TaxInvoice[] {
  const invoices = useTaxInvoiceStore((s) => s.invoices);
  const orgId = useAuthStore((s) => s.user?.orgId) ?? JA_ORG_ID;
  return useMemo(
    () =>
      quotationId
        ? invoices.filter((i) => i.quotationId === quotationId && (i.orgId ?? JA_ORG_ID) === orgId)
        : [],
    [invoices, quotationId, orgId],
  );
}
