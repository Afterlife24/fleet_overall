// React Query hooks for the Planner (bookings, Start Hire, off-hire request) and the Delivery Note screen.
// Bookings come from `/api/v1/bookings`; the list shares its query key with the retained booking mirror
// (`useRetainedMirrorSync`). Mutations send the row version as `If-Match` and one Idempotency-Key per submission.
// There is no mock fallback: a failed read is an error.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomerDto, FileMimeType, HireAgreementDto } from '../../../shared/dto/index';
import { useApiReady, useSubmission } from '@/hooks/useApiResources';
import { queryKeys as legacyKeys } from '@/hooks/useQueries';
import {
  bookingFromDto, bookingsAllKey, bookingsListKey, loadBookingDtos,
} from '@/services/api/bookingMirror';
import { bookingsApi, type BookingCreateDto, type BookingDto, type BookingUpdateDto } from '@/services/api/bookings';
import { customersApi } from '@/services/api/customers';
import {
  deliveryNotesApi, documentsApi, type DeliveryNoteCreateDto, type DeliveryNoteDto, type DeliveryNoteUpdateDto,
  type DocumentDto, type DocumentFileDto,
} from '@/services/api/documents';
import { fetchFileBlob } from '@/services/api/fileDownload';
import { filesApi } from '@/services/api/files';
import { hireAgreementsApi } from '@/services/api/hireAgreements';
import { queryKeys as apiKeys, useQueryScope } from '@/services/api/queryKeys';
import { browserOrgId, listAll } from '@/services/api/readAdapters';
import {
  DN_SNAPSHOT_SCHEMA_VERSION, DN_TEMPLATE_VERSION, deliveryNotePdf, deliveryNoteSnapshot,
} from '@/services/deliveryNotePdf';
import { newSubmissionId } from '@/services/api/idempotency';
import type { Booking } from '@/types/booking';

export { useSubmission };

// ── Bookings ────────────────────────────────────────────────────────────────

/** Every booking the user may see, in the browser shape. */
export function useBookings() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<Booking[]>({
    queryKey: bookingsListKey(scope),
    queryFn: async () => {
      const orgId = browserOrgId();
      return (await loadBookingDtos()).map((b) => bookingFromDto(b, orgId));
    },
    enabled: ready,
  });
}

/** Customers for the booking form (uuid, code, name). */
export function usePlannerCustomers() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<CustomerDto[]>({
    queryKey: apiKeys.customers.list(scope, { view: 'planner' }),
    queryFn: () => listAll((page, pageSize) => customersApi.list({ page, pageSize })),
    enabled: ready,
  });
}

/** Hire agreements for the booking form (uuid, number, customer, status). */
export function usePlannerAgreements() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<HireAgreementDto[]>({
    queryKey: apiKeys.hireAgreements.list(scope, { view: 'planner' }),
    queryFn: () => listAll((page, pageSize) => hireAgreementsApi.list({ page, pageSize })),
    enabled: ready,
  });
}

function useInvalidateBookings() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return () => {
    void qc.invalidateQueries({ queryKey: bookingsAllKey(scope) });
    // Start Hire changes the machine status and can move the linked quotation to Won.
    void qc.invalidateQueries({ queryKey: apiKeys.machines.all(scope) });
    void qc.invalidateQueries({ queryKey: legacyKeys.machines });
    void qc.invalidateQueries({ queryKey: apiKeys.quotations.all(scope) });
    void qc.invalidateQueries({ queryKey: apiKeys.hireAgreements.all(scope) });
  };
}

export function useCreateBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: BookingCreateDto; submissionId: string }): Promise<BookingDto> =>
      bookingsApi.create(body, submissionId),
    onSuccess: invalidate,
  });
}

export function useUpdateBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: BookingUpdateDto }) =>
      bookingsApi.update(id, rowVersion, patch),
    onSuccess: invalidate,
  });
}

export function useCancelBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, rowVersion, reason }: { id: string; rowVersion: number; reason: string }) =>
      bookingsApi.cancel(id, rowVersion, reason),
    onSuccess: invalidate,
  });
}

/** The explicit Start Hire command. One submission id per click sequence keeps retries idempotent. */
export function useStartHire() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, rowVersion, submissionId }: { id: string; rowVersion: number; submissionId: string }) =>
      bookingsApi.startHire(id, rowVersion, submissionId),
    onSuccess: invalidate,
  });
}

export function useRequestOffHire() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => bookingsApi.requestOffHire(id, rowVersion),
    onSuccess: invalidate,
  });
}

/** Reads the latest booking (used by the conflict "Reload latest" action). */
export function fetchBooking(id: string): Promise<Booking> {
  return bookingsApi.get(id).then((b) => bookingFromDto(b));
}

// ── Delivery notes ──────────────────────────────────────────────────────────

const dnKeys = {
  all: (scope: ReturnType<typeof useQueryScope>) => ['delivery-notes', scope.orgId, scope.branch] as const,
  list: (scope: ReturnType<typeof useQueryScope>) => ['delivery-notes', scope.orgId, scope.branch, 'list', {}] as const,
  documents: (scope: ReturnType<typeof useQueryScope>, id: string) =>
    ['delivery-notes', scope.orgId, scope.branch, 'documents', id] as const,
};

export function useDeliveryNotes() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<DeliveryNoteDto[]>({
    queryKey: dnKeys.list(scope),
    queryFn: () => listAll((page, pageSize) => deliveryNotesApi.list({ page, pageSize, sort: '-createdAt' })),
    enabled: ready,
  });
}

function useInvalidateDn() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return () => { void qc.invalidateQueries({ queryKey: dnKeys.all(scope) }); };
}

export function useCreateDeliveryNote() {
  const invalidate = useInvalidateDn();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: DeliveryNoteCreateDto; submissionId: string }) =>
      deliveryNotesApi.create(body, submissionId),
    onSuccess: invalidate,
  });
}

export function useUpdateDeliveryNote() {
  const invalidate = useInvalidateDn();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: DeliveryNoteUpdateDto }) =>
      deliveryNotesApi.update(id, rowVersion, patch),
    onSuccess: invalidate,
  });
}

/** Reads the latest delivery note (used by the conflict "Reload latest" action). */
export function fetchDeliveryNote(id: string): Promise<DeliveryNoteDto> {
  return deliveryNotesApi.get(id);
}

/** The DN document (versions and files) of one delivery note. */
export function useDeliveryNoteDocument(deliveryNoteId: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<DocumentDto | null>({
    queryKey: dnKeys.documents(scope, deliveryNoteId ?? ''),
    queryFn: async () => (await documentsApi.listForOwner('delivery_note', deliveryNoteId!)).items.find((d) => d.documentType === 'DN') ?? null,
    enabled: ready && !!deliveryNoteId,
  });
}

const SCAN_POLLS = 8;
const SCAN_WAIT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the uploaded file is Clean (only a verified, clean file can be attached to a document). */
export async function waitForCleanFile(fileId: string): Promise<void> {
  for (let i = 0; i < SCAN_POLLS; i++) {
    const dto = await filesApi.get(fileId);
    if (dto.scanStatus === 'Clean') return;
    if (dto.scanStatus === 'Rejected' || dto.scanStatus === 'Failed') {
      throw new Error(`The file was ${dto.scanStatus.toLowerCase()} by the scan. Choose a different file.`);
    }
    await sleep(SCAN_WAIT_MS);
  }
  throw new Error('The file is still being scanned. Try again in a moment.');
}

/** The active file of one role in the current version of a document. */
export function currentFile(doc: DocumentDto | null | undefined, role: DocumentFileDto['fileRole']): DocumentFileDto | undefined {
  const version = doc?.versions.find((v) => v.id === doc.currentVersionId);
  return version?.files.find((f) => f.fileRole === role && f.active);
}

/**
 * Renders the delivery note PDF in the browser, uploads the bytes, then records the document version with the data
 * snapshot. The same snapshot returns the stored version, so a second click does not create a new one.
 */
export function useGenerateDeliveryNotePdf() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return useMutation({
    mutationFn: async ({ dn, booking, submissionId }: { dn: DeliveryNoteDto; booking: Booking | undefined; submissionId: string }) => {
      const snapshot = deliveryNoteSnapshot(dn, booking);
      const blob = await deliveryNotePdf(snapshot);
      const uploaded = await filesApi.upload(blob, `${dn.number}.pdf`, 'application/pdf');
      await waitForCleanFile(uploaded.id);
      return documentsApi.generate({
        documentType: 'DN', ownerId: dn.id, templateVersion: DN_TEMPLATE_VERSION,
        snapshotSchemaVersion: DN_SNAPSHOT_SCHEMA_VERSION, dataSnapshot: snapshot, fileId: uploaded.id,
      }, submissionId);
    },
    onSuccess: (_doc, vars) => { void qc.invalidateQueries({ queryKey: dnKeys.documents(scope, vars.dn.id) }); },
  });
}

/** Uploads a signed copy and attaches it to the current version. Replacing an active copy needs a reason. */
export function useAttachSignedCopy() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return useMutation({
    mutationFn: async ({ doc, file, replacementReason, submissionId }: {
      dnId: string; doc: DocumentDto; file: File; replacementReason?: string; submissionId: string;
    }) => {
      if (!doc.currentVersionId) throw new Error('Generate the PDF first.');
      const uploaded = await filesApi.upload(file, file.name, file.type as FileMimeType);
      await waitForCleanFile(uploaded.id);
      return documentsApi.attachFile(doc.id, doc.currentVersionId, {
        fileId: uploaded.id, fileRole: 'Signed Copy', ...(replacementReason ? { replacementReason } : {}),
      }, submissionId);
    },
    onSuccess: (_doc, vars) => { void qc.invalidateQueries({ queryKey: dnKeys.documents(scope, vars.dnId) }); },
  });
}

/** Downloads the stored bytes of a file through the authenticated content endpoint. */
export async function downloadStoredFile(file: DocumentFileDto): Promise<Blob> {
  return fetchFileBlob(file.fileId);
}

export { newSubmissionId };
