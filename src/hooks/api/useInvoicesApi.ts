// React Query hooks for invoices (`/api/v1/invoices`). Query keys carry the organization and branch scope like the
// other resources, so invalidating `invoiceKeys.all(scope)` clears every invoice query. Mutations send the row
// version as `If-Match` and one Idempotency-Key per submission. Numbers, totals and snapshots come from the server.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiReady } from '@/hooks/useApiResources';
import { invoicesApi, type InvoiceCreateDto, type InvoiceDto, type InvoicePaymentStatusDto, type InvoiceTypeValue, type InvoiceUpdateDto } from '@/services/api/invoices';
import { useQueryScope, type QueryScope } from '@/services/api/queryKeys';
import { browserOrgId, listAll, mirrorInvoices } from '@/services/api/readAdapters';
import { invoiceFromDto } from '@/services/api/invoiceMappers';
import { useSessionStore } from '@/services/api/session';

export const invoiceKeys = {
  all: (scope: QueryScope) => ['invoices', scope.orgId, scope.branch] as const,
  list: (scope: QueryScope) => ['invoices', scope.orgId, scope.branch, 'list'] as const,
  prefill: (scope: QueryScope, quotationId: string, type: InvoiceTypeValue) =>
    ['invoices', scope.orgId, scope.branch, 'prefill', quotationId, type] as const,
};

/** Invoice actions that need more than the base `invoices.write` permission. */
export type InvoiceAction = 'invoices.transport_repeat' | 'invoices.report_payment' | 'invoices.write';

/** True when the signed-in API session holds the permission (the server enforces it again). */
export function useInvoicePermission(action: InvoiceAction): boolean {
  return useSessionStore((s) => s.session?.permissions.includes(action) ?? false);
}

export function useInvoices() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<InvoiceDto[]>({
    queryKey: invoiceKeys.list(scope),
    queryFn: () => listAll((page, pageSize) => invoicesApi.list({ page, pageSize })),
    enabled: ready,
  });
}

/** Keeps the in-memory copy read by the retained screens in step with the API. Mounted once in the app layout. */
export function useInvoiceMirrorSync(): void {
  const ready = useApiReady();
  const { data } = useInvoices();
  useEffect(() => {
    if (!ready) mirrorInvoices([]);
    else if (data) {
      const orgId = browserOrgId();
      mirrorInvoices(data.map((i) => invoiceFromDto(i, orgId)));
    }
  }, [ready, data]);
}

/** The server's suggested values for a new invoice of the quotation. A rule failure (NOT_WON, nothing to bill, ...) is the query error. */
export function useInvoicePrefill(quotationId: string, type: InvoiceTypeValue) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: invoiceKeys.prefill(scope, quotationId, type),
    queryFn: ({ signal }) => invoicesApi.prefill(quotationId, type, { signal }),
    enabled: ready && !!quotationId,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
}

function useInvalidateInvoices() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return () => { void qc.invalidateQueries({ queryKey: invoiceKeys.all(scope) }); };
}

export function useCreateInvoice() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: InvoiceCreateDto; submissionId: string }) => invoicesApi.create(body, submissionId),
    onSuccess: invalidate,
  });
}

export function useUpdateInvoice() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: InvoiceUpdateDto }) =>
      invoicesApi.update(id, rowVersion, patch),
    onSuccess: invalidate,
  });
}

export function useIssueInvoice() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => invoicesApi.issue(id, rowVersion),
    onSuccess: invalidate,
  });
}

export function useCancelInvoice() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: ({ id, rowVersion, reason }: { id: string; rowVersion: number; reason: string }) =>
      invoicesApi.cancel(id, rowVersion, reason),
    onSuccess: invalidate,
  });
}

export function useReportInvoicePayment() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: ({ id, rowVersion, body }: { id: string; rowVersion: number; body: InvoicePaymentStatusDto }) =>
      invoicesApi.reportPaymentStatus(id, rowVersion, body),
    onSuccess: invalidate,
  });
}

/** Reads the latest invoice (used by the conflict "Reload latest" action). */
export function fetchInvoice(id: string): Promise<InvoiceDto> {
  return invoicesApi.get(id);
}
