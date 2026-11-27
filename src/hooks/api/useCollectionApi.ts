// React Query hooks for Collection Notes, MQD reports and Third-Party Service reports over `/api/v1`, and the
// stored PDFs and signed copies of those documents. PDFs are still rendered in the browser; the rendered bytes
// are uploaded through `filesApi` and recorded with `documentsApi.generate` (types CN, MQD/HMQD, TPS/HTPS)
// together with the data snapshot. Reads wait for the API session; writes send `If-Match` and one
// Idempotency-Key per submission. There is no mock fallback.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiReady, useSubmission } from '@/hooks/useApiResources';
import { useInvalidateTransport } from '@/hooks/api/useTransportApi';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import type { FileMimeType } from '../../../shared/dto/index';
import { bookingsApi, type BookingDto } from '@/services/api/bookings';
import {
  collectionApi, type CollectionBundleDto, type CollectionInitiateInput, type CollectionNoteUpdate,
} from '@/services/api/collection';
import {
  collectionNoteFromDto, mqdFromDto, tpsFromDto, type DocMapContext,
} from '@/services/api/collectionMappers';
import {
  documentsApi, evidenceApi, mqdReportsApi, serviceReportsApi,
  type DocumentDto, type DocumentOwnerType, type DocumentTypeCode, type MqdReportCreateDto, type MqdReportDto,
  type MqdReportUpdateDto, type ReportPhase, type ServiceReportCreateDto, type ServiceReportDto,
  type ServiceReportUpdateDto,
} from '@/services/api/documents';
import { filesApi } from '@/services/api/files';
import { apiBlobRequest } from '@/services/api/http';
import { hireAgreementsApi } from '@/services/api/hireAgreements';
import { invoicesApi } from '@/services/api/invoices';
import { useQueryScope, type QueryScope } from '@/services/api/queryKeys';
import { browserOrgId, listAll } from '@/services/api/readAdapters';
import type { CollectionNote, DocType, MqdRecord, TpsDocument } from '@/types/collection';

export const PDF_TEMPLATE_VERSION = 'browser-pdf-v1';
export const SNAPSHOT_SCHEMA_VERSION = 'v1';
export const MQD_FORM_SCHEMA_VERSION = 'REF-15-v1';

const docKeys = {
  all: (s: QueryScope) => ['collection-docs', s.orgId, s.branch] as const,
  world: (s: QueryScope) => ['collection-docs', s.orgId, s.branch, 'world'] as const,
  onHire: (s: QueryScope) => ['collection-docs', s.orgId, s.branch, 'on-hire-bookings'] as const,
  documents: (s: QueryScope, type: DocumentOwnerType, id: string) =>
    ['collection-docs', s.orgId, s.branch, 'documents', type, id] as const,
  invoices: (s: QueryScope, agreementId: string) => ['collection-docs', s.orgId, s.branch, 'invoices', agreementId] as const,
};

// -- Reads ----------------------------------------------------------------------------------------------------
export interface CollectionWorld {
  notes: CollectionNote[];
  mqds: MqdRecord[];
  tps: TpsDocument[];
  bookings: BookingDto[];
}

async function loadWorld(orgId: string): Promise<CollectionWorld> {
  const [noteDtos, bookings, mqdDtos, tpsDtos, invoices] = await Promise.all([
    listAll((page, pageSize) => collectionApi.list({ page, pageSize, sort: '-createdAt' })),
    listAll((page, pageSize) => bookingsApi.list({ page, pageSize })),
    listAll((page, pageSize) => mqdReportsApi.list({ page, pageSize, sort: '-createdAt' })),
    listAll((page, pageSize) => serviceReportsApi.list({ page, pageSize, sort: '-createdAt' })),
    // Invoice numbers are only labels for the optional invoice reference; a role without invoice access still gets the notes.
    listAll((page, pageSize) => invoicesApi.list({ page, pageSize })).catch(() => []),
  ]);
  const mqdByNote = new Map<string, string>();
  for (const m of mqdDtos) if (m.collectionNoteId && m.phase === 'COLLECTION') mqdByNote.set(m.collectionNoteId, m.id);
  const tpsByNote = new Map<string, string>();
  for (const t of tpsDtos) if (t.collectionNoteId && t.phase === 'COLLECTION') tpsByNote.set(t.collectionNoteId, t.id);
  const ctx: DocMapContext = {
    orgId,
    bookings: new Map(bookings.map((b) => [b.id, b])),
    mqdByNote,
    tpsByNote,
    invoiceNos: new Map(invoices.map((i) => [i.id, i.invoiceNo])),
  };
  return {
    notes: noteDtos.map((n) => collectionNoteFromDto(n, ctx)),
    mqds: mqdDtos.map((m) => mqdFromDto(m, ctx)),
    tps: tpsDtos.map((t) => tpsFromDto(t, ctx)),
    bookings,
  };
}

/** Collection notes, MQD reports and service reports with the booking references, read together. */
export function useCollectionWorld() {
  const scope = useQueryScope();
  const ready = useApiReady();
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const query = useQuery<CollectionWorld>({
    queryKey: docKeys.world(scope),
    queryFn: () => loadWorld(browserOrgId()),
    enabled: ready,
  });
  const data = query.data;
  // Non-persisted in-memory copies for the retained synchronous readers (gate, signed copies).
  useEffect(() => {
    useCollectionStore.getState().setAll(ready && data ? data.notes : []);
    useMqdStore.getState().setAll(ready && data ? data.mqds : []);
    useThirdPartyStore.getState().setAll(ready && data ? data.tps : []);
  }, [ready, data, orgId]);
  return query;
}

export function useCollectionNotes() {
  const q = useCollectionWorld();
  return { ...q, data: q.data?.notes };
}
export function useMqdReports() {
  const q = useCollectionWorld();
  return { ...q, data: q.data?.mqds };
}
export function useServiceReports() {
  const q = useCollectionWorld();
  return { ...q, data: q.data?.tps };
}

/** Bookings that are On Hire: the only ones collection can be initiated for. */
export function useOnHireBookings(enabled = true) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<BookingDto[]>({
    queryKey: docKeys.onHire(scope),
    queryFn: () => listAll((page, pageSize) => bookingsApi.list({ page, pageSize, status: 'On Hire' })),
    enabled: ready && enabled,
  });
}

/** Invoices of the booking's quotation (through its hire agreement), for the optional invoice reference. */
export function useBookingInvoices(booking: BookingDto | undefined) {
  const scope = useQueryScope();
  const ready = useApiReady();
  const agreementId = booking?.hireAgreementId ?? '';
  return useQuery({
    queryKey: docKeys.invoices(scope, agreementId),
    queryFn: async () => {
      const agreement = await hireAgreementsApi.get(agreementId);
      return listAll((page, pageSize) => invoicesApi.list({ page, pageSize, quotationId: agreement.quotationId }));
    },
    enabled: ready && !!agreementId,
  });
}

function useInvalidateCollection() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  const transport = useInvalidateTransport();
  return {
    docs: () => { void qc.invalidateQueries({ queryKey: docKeys.all(scope) }); },
    withJobs: () => {
      void qc.invalidateQueries({ queryKey: docKeys.all(scope) });
      transport.jobs();
    },
  };
}

// -- Collection notes ------------------------------------------------------------------------------------------
/** Initiates collection from the exact booking. Repeating it returns the existing open note and its documents. */
export function useInitiateCollection() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ bookingId, input, submissionId }: { bookingId: string; input: CollectionInitiateInput; submissionId: string }) =>
      collectionApi.initiate(bookingId, input, submissionId),
    onSuccess: inv.withJobs,
  });
}

export function useUpdateCollectionNote() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: CollectionNoteUpdate }) =>
      collectionApi.update(id, rowVersion, patch),
    onSuccess: inv.withJobs,
  });
}

/** Records the truck pickup. This is not a gate receipt. */
export function useMarkPickedUp() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => collectionApi.markPickedUp(id, rowVersion),
    onSuccess: inv.withJobs,
  });
}

export function useCancelCollection() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ id, rowVersion, reason }: { id: string; rowVersion: number; reason: string }) =>
      collectionApi.cancel(id, rowVersion, reason),
    onSuccess: inv.withJobs,
  });
}

/** Reads the latest note (used by the conflict "Reload latest" action). */
export function fetchCollectionNote(id: string): Promise<CollectionBundleDto> {
  return collectionApi.get(id);
}

// -- MQD reports -----------------------------------------------------------------------------------------------
export function useCreateMqdReport() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: MqdReportCreateDto; submissionId: string }) =>
      mqdReportsApi.create(body, submissionId),
    onSuccess: inv.docs,
  });
}

export function useUpdateMqdReport() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: MqdReportUpdateDto }) =>
      mqdReportsApi.update(id, rowVersion, patch),
    onSuccess: inv.docs,
  });
}

export function fetchMqdReport(id: string): Promise<MqdReportDto> {
  return mqdReportsApi.get(id);
}

/** Uploads a photo and attaches it to the MQD report as evidence. Only PNG and JPEG are accepted by the server. */
export async function attachMqdPhoto(args: { mqdReportId: string; file: File; photoRole: string; displayOrder: number; submissionId: string }) {
  const uploaded = await filesApi.upload(args.file, args.file.name, args.file.type as FileMimeType);
  return evidenceApi.create({
    fileId: uploaded.id, mqdReportId: args.mqdReportId, photoRole: args.photoRole, displayOrder: args.displayOrder,
  }, args.submissionId);
}

export function useMqdEvidence(mqdReportId: string | undefined) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: ['collection-docs', scope.orgId, scope.branch, 'evidence', mqdReportId ?? ''] as const,
    queryFn: () => evidenceApi.list('mqd_report', mqdReportId!),
    enabled: ready && !!mqdReportId,
  });
}

// -- Service (third-party) reports -----------------------------------------------------------------------------
export function useCreateServiceReport() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: ServiceReportCreateDto; submissionId: string }) =>
      serviceReportsApi.create(body, submissionId),
    onSuccess: inv.docs,
  });
}

export function useUpdateServiceReport() {
  const inv = useInvalidateCollection();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: ServiceReportUpdateDto }) =>
      serviceReportsApi.update(id, rowVersion, patch),
    onSuccess: inv.docs,
  });
}

export function fetchServiceReport(id: string): Promise<ServiceReportDto> {
  return serviceReportsApi.get(id);
}

// -- Stored PDFs and signed copies --------------------------------------------------------------------------------
/** The document type code for a collection document (HIRE reports use HMQD / HTPS). */
export function documentTypeFor(type: DocType, phase?: ReportPhase): DocumentTypeCode {
  if (type === 'CN') return 'CN';
  if (type === 'MQD') return phase === 'HIRE' ? 'HMQD' : 'MQD';
  return phase === 'HIRE' ? 'HTPS' : 'TPS';
}

export function ownerTypeFor(type: DocType): DocumentOwnerType {
  return type === 'CN' ? 'collection_note' : type === 'MQD' ? 'mqd_report' : 'service_report';
}

export interface RenderedDocument {
  blob: Blob;
  /** The data the PDF was rendered from. */
  snapshot: Record<string, unknown>;
  number: string;
}

/** Uploads the rendered PDF and records it as the next version of the document, with the data snapshot. */
export async function storeGeneratedPdf(args: {
  documentType: DocumentTypeCode; ownerId: string; rendered: RenderedDocument; submissionId: string;
}): Promise<DocumentDto> {
  const file = await filesApi.upload(args.rendered.blob, `${args.rendered.number}.pdf`, 'application/pdf');
  return documentsApi.generate({
    documentType: args.documentType,
    ownerId: args.ownerId,
    templateVersion: PDF_TEMPLATE_VERSION,
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    dataSnapshot: args.rendered.snapshot,
    fileId: file.id,
  }, args.submissionId);
}

/** Stores the generated PDF, then attaches the signed copy to that version (replacing an earlier signed copy). */
export async function attachSignedCopy(args: {
  documentType: DocumentTypeCode; ownerType: DocumentOwnerType; ownerId: string; file: File;
  rendered: RenderedDocument; submissionId: string;
}): Promise<DocumentDto> {
  const generated = await storeGeneratedPdf({
    documentType: args.documentType, ownerId: args.ownerId, rendered: args.rendered, submissionId: `${args.submissionId}:pdf`,
  });
  const version = generated.versions.find((v) => v.id === generated.currentVersionId);
  if (!version) throw new Error('The document has no version to attach the signed copy to.');
  const uploaded = await filesApi.upload(args.file, args.file.name, args.file.type as FileMimeType);
  const replaces = version.files.some((f) => f.fileRole === 'Signed Copy' && f.active);
  return documentsApi.attachFile(generated.id, version.id, {
    fileId: uploaded.id,
    fileRole: 'Signed Copy',
    ...(replaces ? { replacementReason: 'Replaced signed copy' } : {}),
  }, `${args.submissionId}:signed`);
}

export function activeSignedCopy(documents: DocumentDto[] | undefined, documentType: DocumentTypeCode) {
  const doc = documents?.find((d) => d.documentType === documentType && d.status === 'Active');
  const version = doc?.versions.find((v) => v.id === doc.currentVersionId);
  // The signed copy may sit on an earlier version if the record was regenerated afterwards.
  const files = (version ? [version, ...doc!.versions.filter((v) => v.id !== version.id)] : []).flatMap((v) => v.files);
  return files.find((f) => f.fileRole === 'Signed Copy' && f.active);
}

/** The stored documents (generated PDFs and signed copies) of one record. */
export function useOwnerDocuments(ownerType: DocumentOwnerType, ownerId: string | undefined) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery({
    queryKey: docKeys.documents(scope, ownerType, ownerId ?? ''),
    queryFn: async () => (await documentsApi.listForOwner(ownerType, ownerId!)).items,
    enabled: ready && !!ownerId,
  });
}

/** Attaches a signed copy and refreshes the owner's documents. `render` builds the PDF of the current record. */
export function useAttachSignedCopy() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  const submission = useSubmission();
  return useMutation({
    mutationFn: async (args: {
      documentType: DocumentTypeCode; ownerType: DocumentOwnerType; ownerId: string; file: File;
      render: () => Promise<RenderedDocument>;
    }) => {
      const out = await attachSignedCopy({
        documentType: args.documentType, ownerType: args.ownerType, ownerId: args.ownerId, file: args.file,
        rendered: await args.render(), submissionId: submission.id(),
      });
      submission.renew();
      return out;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: docKeys.documents(scope, vars.ownerType, vars.ownerId) });
    },
  });
}

/** Stores the generated PDF of a record (so a downloaded PDF is also the stored one). */
export function useStoreGeneratedPdf() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  const submission = useSubmission();
  return useMutation({
    mutationFn: async (args: { documentType: DocumentTypeCode; ownerType: DocumentOwnerType; ownerId: string; rendered: RenderedDocument }) => {
      const out = await storeGeneratedPdf({
        documentType: args.documentType, ownerId: args.ownerId, rendered: args.rendered, submissionId: submission.id(),
      });
      submission.renew();
      return out;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: docKeys.documents(scope, vars.ownerType, vars.ownerId) });
    },
  });
}

/** Opens a stored file (needs the bearer credential, so it is fetched, not linked). */
export async function openStoredFile(fileId: string): Promise<void> {
  const blob = await apiBlobRequest(filesApi.contentPath(fileId));
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Looks up and opens the signed copy of a record. Returns false when there is none. */
export async function openSignedCopy(ownerType: DocumentOwnerType, ownerId: string, documentType: DocumentTypeCode): Promise<boolean> {
  const { items } = await documentsApi.listForOwner(ownerType, ownerId);
  const signed = activeSignedCopy(items, documentType);
  if (!signed) return false;
  await openStoredFile(signed.fileId);
  return true;
}

/**
 * The data a PDF is rendered from, as stored with the generated document. Fields that change without the
 * document content changing (row version, signed status) are left out, so an unchanged record keeps one version.
 */
export function docSnapshot(doc: CollectionNote | MqdRecord | TpsDocument): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rowVersion: _rv, signedStatus: _ss, signedFile: _sf, updatedAt: _ua, ...rest } = doc;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}
