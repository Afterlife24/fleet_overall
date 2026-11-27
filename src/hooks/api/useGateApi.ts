// React Query hooks for Gate operations (QR scan, gate passes, approve, complete, cancel) and the return-intake
// inspection (checklist, hold release). The server owns passes, movements and inspections; there is no mock
// fallback and nothing is stored in the browser. Queries wait for the API session. Mutations send the row version
// as `If-Match`; create and complete send one Idempotency-Key per submission, reused when the same one is retried.
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '@/services/api/session';
import { queryKeys as legacyKeys } from '@/hooks/useQueries';
import { useApiReady, useSubmission } from '@/hooks/useApiResources';
import { bookingsApi, type BookingDto } from '@/services/api/bookings';
import {
  documentsApi, evidenceApi, type EvidenceDto,
} from '@/services/api/documents';
import { filesApi } from '@/services/api/files';
import {
  gateApi, inspectionsApi,
  type GatePassCreateDto, type GatePassDto, type GatePassFilters, type InspectionAnswerInput, type InspectionDto,
  type InspectionPatchDto,
} from '@/services/api/gate';
import { newSubmissionId } from '@/services/api/idempotency';
import { queryKeys as apiKeys, useQueryScope, type QueryScope } from '@/services/api/queryKeys';
import { listAll } from '@/services/api/readAdapters';
import { gatePassPdf, type GatePassPdfCtx } from '@/services/gatePassPdf';
import type { GateRecord } from '@/types/gate';
import type { FileMimeType } from '../../../shared/dto/index';

export { useSubmission };

/** Intake inspections created by Gate IN completion carry this type (see `server/src/modules/gate/intakeChecklist.ts`). */
export const RETURN_INTAKE_TYPE = 'Return Intake';

// ── Keys ────────────────────────────────────────────────────────────────────

type Filters = Record<string, unknown> | undefined;
const gateKeys = {
  all: (s: QueryScope) => ['gate-passes', s.orgId, s.branch] as const,
  list: (s: QueryScope, f?: Filters) => ['gate-passes', s.orgId, s.branch, 'list', f ?? {}] as const,
  evidence: (s: QueryScope, id: string) => ['gate-passes', s.orgId, s.branch, 'detail', id, 'evidence'] as const,
  booking: (s: QueryScope, id: string) => ['gate-passes', s.orgId, s.branch, 'booking', id] as const,
  machineBookings: (s: QueryScope, machineId: string) => ['gate-passes', s.orgId, s.branch, 'machine-bookings', machineId] as const,
};
const inspectionKeys = {
  all: (s: QueryScope) => ['inspections', s.orgId, s.branch] as const,
  list: (s: QueryScope, f?: Filters) => ['inspections', s.orgId, s.branch, 'list', f ?? {}] as const,
  detail: (s: QueryScope, id: string) => ['inspections', s.orgId, s.branch, 'detail', id] as const,
  evidence: (s: QueryScope, id: string) => ['inspections', s.orgId, s.branch, 'detail', id, 'evidence'] as const,
};

// ── Permissions ─────────────────────────────────────────────────────────────

export type GateAction = 'gate.read' | 'gate.write' | 'gate.approve' | 'inspections.read' | 'inspections.write' | 'inspections.release_hold';

/**
 * Whether the signed-in user holds a server action code. Screens use it to hide buttons only; the server
 * decides (403 FORBIDDEN). A session that lists no codes at all is treated as "ask the server".
 */
export function useCan(action: GateAction): boolean {
  const permissions = useSessionStore((s) => s.session?.permissions);
  if (!permissions || permissions.length === 0) return true;
  return permissions.includes(action);
}

/** The signed-in company id (a UUID), the first part of every gate pass QR payload. */
export function useSessionOrgId(): string {
  return useSessionStore((s) => s.session?.organization.id ?? '');
}

export function useSessionOrgName(): string {
  return useSessionStore((s) => s.session?.organization.name ?? '');
}

// ── Invalidation ────────────────────────────────────────────────────────────

function useInvalidateGate() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return {
    passes: () => { void qc.invalidateQueries({ queryKey: gateKeys.all(scope) }); },
    /** A completed movement changes the machine, the booking, the collection note and creates an inspection. */
    movement: () => {
      void qc.invalidateQueries({ queryKey: gateKeys.all(scope) });
      void qc.invalidateQueries({ queryKey: inspectionKeys.all(scope) });
      void qc.invalidateQueries({ queryKey: apiKeys.machines.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.machines });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['collection-notes'] });
      void qc.invalidateQueries({ queryKey: apiKeys.quotations.all(scope) });
    },
    inspections: () => { void qc.invalidateQueries({ queryKey: inspectionKeys.all(scope) }); },
    hold: () => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.all(scope) });
      void qc.invalidateQueries({ queryKey: apiKeys.machines.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.machines });
    },
  };
}

// ── Gate passes ─────────────────────────────────────────────────────────────

/** Every gate pass the user may see (all pages), newest first. */
export function useGatePasses(filters: GatePassFilters = {}) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<GatePassDto[]>({
    queryKey: gateKeys.list(scope, { ...filters }),
    queryFn: () => listAll((page, pageSize) => gateApi.list({ page, pageSize, sort: '-requestedAt', ...filters })),
    enabled: ready,
  });
}

/** Strict QR resolution. A bad, foreign or stale QR rejects with `QR_INVALID`; nothing is created. */
export function useResolveQr() {
  return useMutation({ mutationFn: (payload: string) => gateApi.resolveQr(payload) });
}

/** Bookings of one machine (used to pick the exact booking for a customer movement). */
export function useMachineBookings(machineId: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<BookingDto[]>({
    queryKey: gateKeys.machineBookings(scope, machineId ?? ''),
    queryFn: () => listAll((page, pageSize) => bookingsApi.list({ page, pageSize, machineId: machineId as string })),
    enabled: ready && !!machineId,
  });
}

/** The booking a gate pass belongs to (reference, customer and agreement number for the pass and its PDF). */
export function usePassBooking(bookingId: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<BookingDto>({
    queryKey: gateKeys.booking(scope, bookingId ?? ''),
    queryFn: () => bookingsApi.get(bookingId as string),
    enabled: ready && !!bookingId,
  });
}

export function useCreateGatePass() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: GatePassCreateDto; submissionId: string }) => gateApi.create(body, submissionId),
    onSuccess: inv.passes,
  });
}

export function useApproveGatePass() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => gateApi.approve(id, rowVersion),
    onSuccess: inv.passes,
  });
}

export function useCancelGatePass() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion, reason }: { id: string; rowVersion: number; reason: string }) =>
      gateApi.cancel(id, rowVersion, reason),
    onSuccess: inv.passes,
  });
}

/**
 * Completes a pass: the physical crossing. One Idempotency-Key is kept per pass until the call succeeds, so a retry
 * after a timeout or a double click returns the same result and records one movement.
 */
export function useCompleteGatePass() {
  const inv = useInvalidateGate();
  const keys = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string | null }) => {
      let key = keys.current.get(id);
      if (!key) {
        key = newSubmissionId();
        keys.current.set(id, key);
      }
      const result = await gateApi.complete(id, key, notes);
      keys.current.delete(id);
      return result;
    },
    onSuccess: inv.movement,
    // A response that arrives with a definite server answer (4xx) ends the attempt; the next click is a new submission.
    onError: (err, vars) => {
      const status = (err as { status?: number } | null)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 409) keys.current.delete(vars.id);
    },
  });
  return mutation;
}

export function usePassEvidence(passId: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<EvidenceDto[]>({
    queryKey: gateKeys.evidence(scope, passId ?? ''),
    queryFn: async () => (await evidenceApi.list('gate_pass', passId as string)).items,
    enabled: ready && !!passId,
  });
}

// ── Evidence photos ─────────────────────────────────────────────────────────

const SCAN_POLLS = 8;
const SCAN_WAIT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PHOTO_MIME: readonly string[] = ['image/png', 'image/jpeg'];

/** Waits until the uploaded file is scanned Clean; an evidence row can only point at a Clean file. */
async function waitUntilClean(fileId: string): Promise<void> {
  for (let i = 0; i < SCAN_POLLS; i++) {
    const f = await filesApi.get(fileId);
    if (f.scanStatus === 'Clean' && f.storageState === 'Verified') return;
    if (f.scanStatus === 'Rejected' || f.scanStatus === 'Failed' || f.storageState === 'Failed') {
      throw new Error('The photo was rejected by the file check.');
    }
    await sleep(SCAN_WAIT_MS);
  }
  throw new Error('The photo is still being checked. Try attaching it again in a moment.');
}

export interface EvidenceOwnerRef { gatePassId?: string; inspectionId?: string; inspectionResultId?: string }

/** Uploads a PNG/JPEG, waits for the file check and attaches it as evidence to exactly one owner. */
export async function attachEvidencePhoto(file: File, owner: EvidenceOwnerRef, photoRole: string, caption?: string): Promise<EvidenceDto> {
  if (!PHOTO_MIME.includes(file.type)) throw new Error('Photos must be PNG or JPEG images.');
  const uploaded = await filesApi.upload(file, file.name, file.type as FileMimeType);
  await waitUntilClean(uploaded.id);
  return evidenceApi.create(
    { fileId: uploaded.id, ...owner, photoRole, caption: caption || null, capturedAt: new Date().toISOString() },
    newSubmissionId(),
  );
}

export function useAttachGatePassPhoto() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return useMutation({
    mutationFn: ({ passId, file, photoRole }: { passId: string; file: File; photoRole: string }) =>
      attachEvidencePhoto(file, { gatePassId: passId }, photoRole),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: gateKeys.evidence(scope, v.passId) }); },
  });
}

// ── Gate pass PDF ───────────────────────────────────────────────────────────

const GATE_PASS_TEMPLATE = 'gate-pass-v1';
const GATE_PASS_SNAPSHOT_SCHEMA = '1';

/**
 * Renders the Gate Pass PDF in the browser, uploads it through `/files` and records it as a GATE_PASS document.
 * Rendering stays local (`gatePassPdf`); the server keeps the stored copy and the version history.
 */
export function useSaveGatePassPdf() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  const submission = useSubmission();
  return useMutation({
    mutationFn: async ({ pass, record, ctx }: { pass: GatePassDto; record: GateRecord; ctx: GatePassPdfCtx }) => {
      const blob = await gatePassPdf(record, ctx);
      const file = await filesApi.upload(blob, `${pass.reference.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, 'application/pdf');
      await waitUntilClean(file.id);
      const doc = await documentsApi.generate(
        {
          documentType: 'GATE_PASS',
          ownerId: pass.id,
          templateVersion: GATE_PASS_TEMPLATE,
          snapshotSchemaVersion: GATE_PASS_SNAPSHOT_SCHEMA,
          dataSnapshot: {
            reference: pass.reference, status: pass.status, direction: pass.direction, movementPurpose: pass.movementPurpose,
            fleetNo: pass.fleetNoSnapshot, driverName: pass.driverName, truckPlate: pass.truckPlate, destination: pass.destination,
            bookingId: pass.bookingId, movementOccurredAt: pass.movement?.occurredAt ?? null, companyName: ctx.companyName,
            links: ctx.links,
          },
          fileId: file.id,
        },
        submission.id(),
      );
      submission.renew();
      return doc;
    },
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['documents', scope.orgId, v.pass.id] }); },
  });
}

// ── Return-intake inspections ───────────────────────────────────────────────

/** The RETURN INTAKE inspections (created by Gate IN completion), newest first. */
export function useReturnIntakes() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<InspectionDto[]>({
    queryKey: inspectionKeys.list(scope, { type: RETURN_INTAKE_TYPE }),
    queryFn: async () => (await listAll((page, pageSize) => inspectionsApi.list({ page, pageSize, sort: '-createdAt' })))
      .filter((i) => i.inspectionType === RETURN_INTAKE_TYPE),
    enabled: ready,
  });
}

/** One inspection with its checklist results. */
export function useInspectionDetail(id: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<InspectionDto>({
    queryKey: inspectionKeys.detail(scope, id ?? ''),
    queryFn: () => inspectionsApi.get(id as string),
    enabled: ready && !!id,
  });
}

export function useInspectionEvidence(id: string | null) {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<EvidenceDto[]>({
    queryKey: inspectionKeys.evidence(scope, id ?? ''),
    queryFn: async () => (await evidenceApi.list('inspection', id as string)).items,
    enabled: ready && !!id,
  });
}

export function useSaveInspectionResults() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion, results }: { id: string; rowVersion: number; results: InspectionAnswerInput[] }) =>
      inspectionsApi.saveResults(id, rowVersion, results),
    onSuccess: inv.inspections,
  });
}

export function useUpdateInspection() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: InspectionPatchDto }) =>
      inspectionsApi.update(id, rowVersion, patch),
    onSuccess: inv.inspections,
  });
}

export function useSubmitInspection() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) => inspectionsApi.submit(id, rowVersion),
    onSuccess: inv.hold,
  });
}

export function useReleaseIntakeHold() {
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ id, rowVersion, reason, evidenceReviewed }: { id: string; rowVersion: number; reason: string; evidenceReviewed: boolean }) =>
      inspectionsApi.releaseHold(id, rowVersion, { reason, evidenceReviewed }),
    onSuccess: inv.hold,
  });
}

export function useAttachInspectionPhoto() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  const inv = useInvalidateGate();
  return useMutation({
    mutationFn: ({ inspectionId, file, photoRole }: { inspectionId: string; file: File; photoRole: string }) =>
      attachEvidencePhoto(file, { inspectionId }, photoRole),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.evidence(scope, v.inspectionId) });
      inv.inspections();
    },
  });
}
