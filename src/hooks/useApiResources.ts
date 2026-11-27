// React Query hooks for the screens that read and write through `/api/v1`: customers, fleet, quotations,
// hire agreements and LPOs. Query keys come from `services/api/queryKeys.ts` (organization, branch scope,
// resource id and filters). Queries wait for the API session; mutations send the row version as `If-Match`
// and one Idempotency-Key per submission. There is no mock fallback: a failed read is an error.
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BranchDto, CustomerCreateDto, CustomerDto, CustomerLpoCreateDto, CustomerLpoDto, CustomerLpoUpdateDto,
  CustomerUpdateDto, HireAgreementCreateDto, HireAgreementUpdateDto, MachineDocumentDto, MachineManualStatusDto,
  MachineModelDto, QuotationCreateDto, QuotationDto, QuotationPhaseChangeDto,
} from '../../shared/dto/index';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { queryKeys as legacyKeys } from '@/hooks/useQueries';
import { branchesApi } from '@/services/api/company';
import { customersApi } from '@/services/api/customers';
import { customerLposApi } from '@/services/api/customerLpos';
import { filesApi } from '@/services/api/files';
import { hireAgreementsApi } from '@/services/api/hireAgreements';
import { newSubmissionId } from '@/services/api/idempotency';
import { machineDocumentsApi, type MachineDocumentCreate } from '@/services/api/machineDocuments';
import { machineModelsApi, type MachineModelInput } from '@/services/api/machineModels';
import { machinesApi, type MachineCreate, type MachineUpdate } from '@/services/api/machines';
import { historyEntryFromDto } from '@/services/api/mappers';
import { queryKeys as apiKeys, useQueryScope } from '@/services/api/queryKeys';
import {
  listAll, loadCustomerRecords, loadMachines, loadQuotationsAndAgreements, mirrorRetainedData,
  type CrmSnapshot,
} from '@/services/api/readAdapters';
import { quotationsApi } from '@/services/api/quotations';
import { bookingFromDto, bookingsListKey, loadBookingDtos, mirrorBookings } from '@/services/api/bookingMirror';
import { useSessionStore } from '@/services/api/session';
import type { FileMimeType } from '../../shared/dto/index';

export function useApiReady(): boolean {
  return useSessionStore((s) => s.status === 'ready');
}

function useBrowserOrg(): string {
  return useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
}

/** One submission id per form. Reuse it when the same submission is retried; call `renew` after a success. */
export function useSubmission() {
  const ref = useRef<string>(newSubmissionId());
  const id = useCallback(() => ref.current, []);
  const renew = useCallback(() => { ref.current = newSubmissionId(); }, []);
  return { id, renew };
}

/** Invalidation helpers that also refresh the legacy keys read by retained screens. */
function useInvalidate() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return {
    customers: () => {
      void qc.invalidateQueries({ queryKey: apiKeys.customers.all(scope) });
      void qc.invalidateQueries({ queryKey: apiKeys.quotations.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.customerANIs });
      void qc.invalidateQueries({ queryKey: legacyKeys.customers });
    },
    machines: () => {
      void qc.invalidateQueries({ queryKey: apiKeys.machines.all(scope) });
      void qc.invalidateQueries({ queryKey: apiKeys.machineModels.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.machines });
    },
    machineDocuments: (machineId: string) => {
      void qc.invalidateQueries({ queryKey: apiKeys.machineDocuments.child(scope, machineId, 'documents') });
    },
    crm: () => {
      void qc.invalidateQueries({ queryKey: apiKeys.quotations.all(scope) });
      void qc.invalidateQueries({ queryKey: apiKeys.hireAgreements.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.hireAgreements });
    },
    lpos: () => { void qc.invalidateQueries({ queryKey: apiKeys.customerLpos.all(scope) }); },
  };
}

// ── Branches ────────────────────────────────────────────────────────────────

export function useApiBranches() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<BranchDto[]>({
    queryKey: apiKeys.branches.list(scope, { all: true }),
    queryFn: () => listAll((page, pageSize) => branchesApi.list({ page, pageSize })),
    enabled: ready,
  });
}

// ── Customers ───────────────────────────────────────────────────────────────

export function useCustomerRecords() {
  const scope = useQueryScope();
  const ready = useApiReady();
  const orgId = useBrowserOrg();
  return useQuery({
    queryKey: apiKeys.customers.list(scope, { view: 'records', orgId }),
    queryFn: () => loadCustomerRecords(orgId),
    enabled: ready,
  });
}

export function useCreateCustomer() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: CustomerCreateDto; submissionId: string }) => customersApi.create(body, submissionId),
    onSuccess: inv.customers,
  });
}

export function useUpdateCustomer() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: CustomerUpdateDto }) =>
      customersApi.update(id, rowVersion, patch),
    onSuccess: inv.customers,
  });
}

export function useArchiveCustomer() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => customersApi.archive(id, rowVersion),
    onSuccess: inv.customers,
  });
}

/** Reads the latest customer (used by the conflict "Reload latest" action). */
export function fetchCustomer(id: string): Promise<CustomerDto> {
  return customersApi.get(id);
}

// ── Fleet ───────────────────────────────────────────────────────────────────

export function useFleetMachines() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: apiKeys.machines.list(scope, { view: 'mapped' }),
    queryFn: loadMachines,
    enabled: ready,
  });
}

export function useMachineModels() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<MachineModelDto[]>({
    queryKey: apiKeys.machineModels.list(scope, { all: true }),
    queryFn: () => listAll((page, pageSize) => machineModelsApi.list({ page, pageSize })),
    enabled: ready,
  });
}

export function useCreateMachine() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: MachineCreate; submissionId: string }) => machinesApi.create(body, submissionId),
    onSuccess: inv.machines,
  });
}

export function useUpdateMachine() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: MachineUpdate }) =>
      machinesApi.update(id, rowVersion, patch),
    onSuccess: inv.machines,
  });
}

export function useArchiveMachine() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => machinesApi.archive(id, rowVersion),
    onSuccess: inv.machines,
  });
}

export function useSetMachineStatus() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, input }: { id: string; rowVersion: number; input: MachineManualStatusDto }) =>
      machinesApi.setOperationalStatus(id, rowVersion, input),
    onSuccess: inv.machines,
  });
}

export function useCreateMachineModel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: MachineModelInput; submissionId: string }) => machineModelsApi.create(body, submissionId),
    onSuccess: inv.machines,
  });
}

export function useUpdateMachineModel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: Partial<MachineModelInput> }) =>
      machineModelsApi.update(id, rowVersion, patch),
    onSuccess: inv.machines,
  });
}

/** Reads the latest model (used by the conflict "Reload latest" action). */
export function fetchMachineModel(id: string): Promise<MachineModelDto> {
  return machineModelsApi.get(id);
}

export function useMachineDocuments(machineId: string | undefined) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: apiKeys.machineDocuments.child(scope, machineId ?? '', 'documents'),
    queryFn: () => machineDocumentsApi.list(machineId!, { active: true }),
    enabled: ready && !!machineId,
  });
}

/** Uploads the file, then registers it as a machine document. The file keeps its own Clean/Pending scan state. */
export function useAddMachineDocument(machineId: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ file, name, documentType, expiresOn, submissionId }: {
      file: File; name: string; documentType: MachineDocumentCreate['documentType']; expiresOn?: string | null; submissionId: string;
    }): Promise<MachineDocumentDto> => {
      const uploaded = await filesApi.upload(file, file.name, file.type as FileMimeType);
      return machineDocumentsApi.create(machineId, { fileId: uploaded.id, name, documentType, expiresOn: expiresOn || null }, submissionId);
    },
    onSuccess: () => inv.machineDocuments(machineId),
  });
}

export function useDeactivateMachineDocument(machineId: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ docId, rowVersion }: { docId: string; rowVersion: number }) => machineDocumentsApi.deactivate(machineId, docId, rowVersion),
    onSuccess: () => inv.machineDocuments(machineId),
  });
}

// ── Quotations and hire agreements ──────────────────────────────────────────

export function useCrmData() {
  const scope = useQueryScope();
  const ready = useApiReady();
  const orgId = useBrowserOrg();
  return useQuery<CrmSnapshot>({
    queryKey: apiKeys.quotations.list(scope, { view: 'crm', orgId }),
    queryFn: () => loadQuotationsAndAgreements(orgId),
    enabled: ready,
  });
}

/** Keeps the in-memory copies read by the retained screens in step with the API data. */
export function useRetainedMirrorSync(): void {
  const ready = useApiReady();
  const { data } = useCrmData();
  const qc = useQueryClient();
  const scope = useQueryScope();
  const orgId = useBrowserOrg();
  // Bookings share this key with `usePlannerApi.useBookings`, so both read one cache entry.
  const bookings = useQuery({
    queryKey: bookingsListKey(scope),
    queryFn: async () => (await loadBookingDtos()).map((b) => bookingFromDto(b, orgId)),
    enabled: ready,
  });
  useEffect(() => {
    if (!ready) mirrorBookings([]);
    else if (bookings.data) mirrorBookings(bookings.data);
  }, [ready, bookings.data]);
  useEffect(() => {
    if (!ready) mirrorRetainedData({ quotations: [], agreements: [] });
    else if (data) mirrorRetainedData({ quotations: data.quotations, agreements: data.agreements });
    // Retained screens read agreements through a legacy query key; refresh it with the new copy.
    void qc.invalidateQueries({ queryKey: legacyKeys.hireAgreements });
  }, [ready, data, qc]);
}

export function useQuotationHistory(id: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: apiKeys.quotations.child(scope, id ?? '', 'history'),
    queryFn: async () => (await quotationsApi.history(id!)).items.map((h) => historyEntryFromDto(h)),
    enabled: ready && !!id,
  });
}

export function useCreateQuotation() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: QuotationCreateDto; submissionId: string }): Promise<QuotationDto> =>
      quotationsApi.create(body, submissionId),
    onSuccess: inv.crm,
  });
}

export function useChangePhase() {
  const inv = useInvalidate();
  const qc = useQueryClient();
  const scope = useQueryScope();
  return useMutation({
    mutationFn: ({ id, rowVersion, input, submissionId }: {
      id: string; rowVersion: number; input: QuotationPhaseChangeDto; submissionId: string;
    }) => quotationsApi.changePhase(id, rowVersion, input, submissionId),
    onSuccess: (_q, vars) => {
      inv.crm();
      void qc.invalidateQueries({ queryKey: apiKeys.quotations.child(scope, vars.id, 'history') });
    },
  });
}

/** Reads the latest agreement (used by the conflict "Reload latest" action). */
export function fetchAgreement(id: string) {
  return hireAgreementsApi.get(id);
}

export function useCreateAgreement() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: HireAgreementCreateDto; submissionId: string }) =>
      hireAgreementsApi.create(body, submissionId),
    onSuccess: inv.crm,
  });
}

export function useUpdateAgreement() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: HireAgreementUpdateDto }) =>
      hireAgreementsApi.update(id, rowVersion, patch),
    onSuccess: inv.crm,
  });
}

// ── Customer LPOs ───────────────────────────────────────────────────────────

export function useLpos() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<CustomerLpoDto[]>({
    queryKey: apiKeys.customerLpos.list(scope, { all: true }),
    queryFn: () => listAll((page, pageSize) => customerLposApi.list({ page, pageSize })),
    enabled: ready,
  });
}

export function useCreateLpo() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: CustomerLpoCreateDto; submissionId: string }) => customerLposApi.create(body, submissionId),
    onSuccess: inv.lpos,
  });
}

export function useUpdateLpo() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: CustomerLpoUpdateDto }) =>
      customerLposApi.update(id, rowVersion, patch),
    onSuccess: inv.lpos,
  });
}

/** Reads the latest LPO (used by the conflict "Reload latest" action). */
export function fetchLpo(id: string) {
  return customerLposApi.get(id);
}

export function uploadLpoFile(file: File) {
  return filesApi.upload(file, file.name, file.type as FileMimeType);
}
