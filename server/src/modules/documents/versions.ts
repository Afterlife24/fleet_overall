import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ActionCode, Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { isAvailable } from '../files/index.js';
import { recordAudit } from '../shared/audit.js';
import { nullableText, text } from '../shared/fields.js';
import { parseQuery, principalWith, requireAction, uuidParam } from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import {
  DOCUMENT_TYPES, OWNER_COLUMN, OWNER_KINDS, OWNER_OF_TYPE, PHASE_OF_TYPE, resolveOwner, type OwnerKind,
} from './owners.js';

const PDF = ['application/pdf'] as const;
const IMAGES = ['image/png', 'image/jpeg'] as const;
const ANY_FILE = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/** Stable JSON (sorted keys, undefined dropped) so equal snapshots hash equally whatever the key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function snapshotHash(snapshot: unknown): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

/**
 * The file must exist in the Principal's company (404 otherwise), be stored, verified and scanned Clean, and have
 * one of the allowed detected types; anything else is FILE_INVALID and nothing has been written yet.
 */
export async function loadAttachableFile(tx: TxClient, fileId: string, mimes: readonly string[]): Promise<{ id: string }> {
  const res = await tx.query<{ id: string; storage_state: string; scan_status: string; detected_mime: string | null }>(
    'SELECT id, storage_state, scan_status, detected_mime FROM files WHERE id = $1',
    [fileId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  if (!isAvailable(row)) throw new AppError('FILE_INVALID', 'File is not verified and cannot be attached', { fileId: 'not_clean' });
  if (!row.detected_mime || !mimes.includes(row.detected_mime)) {
    throw new AppError('FILE_INVALID', 'File type is not allowed here', { fileId: 'type' });
  }
  return { id: row.id };
}

// ---------------------------------------------------------------- DTOs

interface DocRow {
  id: string;
  document_type: string;
  document_no: string;
  current_version_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  row_version: string;
  [ownerColumn: string]: unknown;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_no: number;
  template_version: string;
  snapshot_schema_version: string;
  data_snapshot: Record<string, unknown>;
  snapshot_hash: string;
  generation_status: string;
  generated_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
}

interface DocFileRow {
  id: string;
  document_version_id: string;
  file_id: string;
  file_role: string;
  active: boolean;
  uploaded_by: string;
  attached_at: Date;
  replaced_at: Date | null;
  replacement_reason: string | null;
  original_name: string;
  detected_mime: string | null;
  byte_size: string | null;
  sha256: string | null;
}

export interface DocumentFileDto {
  id: string;
  fileId: string;
  fileRole: string;
  /** Inactive rows are replaced files: their bytes stay downloadable to authorized users. */
  active: boolean;
  uploadedBy: string;
  attachedAt: string;
  replacedAt: string | null;
  replacementReason: string | null;
  originalName: string;
  detectedMime: string | null;
  byteSize: number | null;
  sha256: string | null;
}

export interface DocumentVersionDto {
  id: string;
  versionNo: number;
  templateVersion: string;
  snapshotSchemaVersion: string;
  snapshotHash: string;
  generationStatus: string;
  generatedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  /** Only on the single-document read. */
  dataSnapshot?: Record<string, unknown>;
  files: DocumentFileDto[];
}

export interface DocumentDto {
  id: string;
  documentType: string;
  documentNo: string;
  ownerType: OwnerKind;
  ownerId: string;
  currentVersionId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  versions: DocumentVersionDto[];
}

const OWNER_COLUMNS = OWNER_KINDS.map((k) => OWNER_COLUMN[k]);
const DOC_COLUMNS = `id, document_type, document_no, current_version_id, status, created_at, updated_at, row_version, ${OWNER_COLUMNS.join(', ')}`;

function ownerOf(row: DocRow): { kind: OwnerKind; id: string } {
  for (const kind of OWNER_KINDS) {
    const id = row[OWNER_COLUMN[kind]];
    if (typeof id === 'string') return { kind, id };
  }
  throw new AppError('INTERNAL_ERROR', 'Document has no owner');
}

async function toDocumentDtos(tx: TxClient, rows: DocRow[], includeSnapshot: boolean): Promise<DocumentDto[]> {
  if (rows.length === 0) return [];
  const versions = await tx.query<VersionRow>(
    `SELECT id, document_id, version_no, template_version, snapshot_schema_version, ${includeSnapshot ? 'data_snapshot' : "'{}'::jsonb AS data_snapshot"},
            snapshot_hash, generation_status, generated_at, error_code, error_message, created_at
       FROM document_versions WHERE document_id = ANY($1::uuid[]) ORDER BY document_id, version_no DESC`,
    [rows.map((r) => r.id)],
  );
  const files = await tx.query<DocFileRow>(
    `SELECT df.id, df.document_version_id, df.file_id, df.file_role, df.active, df.uploaded_by, df.attached_at, df.replaced_at,
            df.replacement_reason, f.original_name, f.detected_mime, f.byte_size, f.sha256
       FROM document_files df JOIN files f ON f.org_id = df.org_id AND f.id = df.file_id
      WHERE df.document_version_id = ANY($1::uuid[]) ORDER BY df.attached_at, df.id`,
    [versions.rows.map((v) => v.id)],
  );
  const filesByVersion = new Map<string, DocumentFileDto[]>();
  for (const f of files.rows) {
    const list = filesByVersion.get(f.document_version_id) ?? [];
    list.push({
      id: f.id, fileId: f.file_id, fileRole: f.file_role, active: f.active, uploadedBy: f.uploaded_by,
      attachedAt: f.attached_at.toISOString(), replacedAt: f.replaced_at ? f.replaced_at.toISOString() : null,
      replacementReason: f.replacement_reason, originalName: f.original_name, detectedMime: f.detected_mime,
      byteSize: f.byte_size === null ? null : Number(f.byte_size), sha256: f.sha256,
    });
    filesByVersion.set(f.document_version_id, list);
  }
  const versionsByDoc = new Map<string, DocumentVersionDto[]>();
  for (const v of versions.rows) {
    const list = versionsByDoc.get(v.document_id) ?? [];
    list.push({
      id: v.id, versionNo: v.version_no, templateVersion: v.template_version, snapshotSchemaVersion: v.snapshot_schema_version,
      snapshotHash: v.snapshot_hash, generationStatus: v.generation_status,
      generatedAt: v.generated_at ? v.generated_at.toISOString() : null, errorCode: v.error_code, errorMessage: v.error_message,
      createdAt: v.created_at.toISOString(), ...(includeSnapshot ? { dataSnapshot: v.data_snapshot } : {}),
      files: filesByVersion.get(v.id) ?? [],
    });
    versionsByDoc.set(v.document_id, list);
  }
  return rows.map((r) => {
    const owner = ownerOf(r);
    return {
      id: r.id, documentType: r.document_type, documentNo: r.document_no, ownerType: owner.kind, ownerId: owner.id,
      currentVersionId: r.current_version_id, status: r.status, createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version), versions: versionsByDoc.get(r.id) ?? [],
    };
  });
}

/** Reads a document and proves its owner is visible to the Principal (company via RLS, branch via the owner); else 404. */
async function loadDocument(tx: TxClient, principal: Principal, id: string, action: 'documents.read' | 'documents.write', lock: boolean): Promise<DocRow> {
  const res = await tx.query<DocRow>(`SELECT ${DOC_COLUMNS} FROM documents WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Document not found');
  const owner = ownerOf(row);
  try {
    await resolveOwner(tx, principal, owner.kind, owner.id, action);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', 'Document not found');
    throw err;
  }
  return row;
}

// ---------------------------------------------------------------- Schemas

const generateSchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES),
    ownerId: z.uuid(),
    templateVersion: text(50),
    snapshotSchemaVersion: text(50),
    dataSnapshot: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 2_000_000, 'too large'),
    fileId: z.uuid().optional(),
    error: z.object({ code: text(100), message: text(1000) }).strict().optional(),
  })
  .strict();

const attachSchema = z
  .object({
    fileId: z.uuid(),
    fileRole: z.enum(['Signed Copy', 'Original']),
    replacementReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const listSchema = z.object({ ownerType: z.enum(OWNER_KINDS), ownerId: z.uuid() });

const EVIDENCE_OWNERS = ['mqd_report', 'inspection', 'inspection_result', 'gate_pass'] as const;
type EvidenceOwner = (typeof EVIDENCE_OWNERS)[number];
const EVIDENCE_COLUMN: Record<EvidenceOwner, string> = {
  mqd_report: 'mqd_report_id', inspection: 'inspection_id', inspection_result: 'inspection_result_id', gate_pass: 'gate_pass_id',
};
const EVIDENCE_BODY_KEY: Record<EvidenceOwner, string> = {
  mqd_report: 'mqdReportId', inspection: 'inspectionId', inspection_result: 'inspectionResultId', gate_pass: 'gatePassId',
};
const EVIDENCE_WRITE: Record<EvidenceOwner, ActionCode> = {
  mqd_report: 'documents.write', inspection: 'inspections.write', inspection_result: 'inspections.write', gate_pass: 'gate.write',
};
const EVIDENCE_READ: Record<EvidenceOwner, ActionCode> = {
  mqd_report: 'documents.read', inspection: 'inspections.read', inspection_result: 'inspections.read', gate_pass: 'gate.read',
};

const evidenceSchema = z
  .object({
    fileId: z.uuid(),
    mqdReportId: z.uuid().optional(),
    inspectionId: z.uuid().optional(),
    inspectionResultId: z.uuid().optional(),
    gatePassId: z.uuid().optional(),
    photoRole: text(100),
    caption: nullableText(4000).optional(),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    displayOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => [v.mqdReportId, v.inspectionId, v.inspectionResultId, v.gatePassId].filter((x) => x !== undefined).length === 1, {
    message: 'exactly one owner',
    path: ['owner'],
  });

const evidenceListSchema = z.object({ ownerType: z.enum(EVIDENCE_OWNERS), ownerId: z.uuid() });

interface EvidenceRow {
  id: string;
  file_id: string;
  mqd_report_id: string | null;
  inspection_id: string | null;
  inspection_result_id: string | null;
  gate_pass_id: string | null;
  photo_role: string;
  caption: string | null;
  captured_at: Date | null;
  display_order: number;
  created_at: Date;
  original_name: string;
  detected_mime: string | null;
  byte_size: string | null;
}

export interface EvidenceDto {
  id: string;
  fileId: string;
  ownerType: EvidenceOwner;
  ownerId: string;
  photoRole: string;
  caption: string | null;
  capturedAt: string | null;
  displayOrder: number;
  createdAt: string;
  originalName: string;
  detectedMime: string | null;
  byteSize: number | null;
}

const EVIDENCE_COLUMNS = `e.id, e.file_id, e.mqd_report_id, e.inspection_id, e.inspection_result_id, e.gate_pass_id, e.photo_role, e.caption,
  e.captured_at, e.display_order, e.created_at, f.original_name, f.detected_mime, f.byte_size`;
const EVIDENCE_FROM = 'evidence_attachments e JOIN files f ON f.org_id = e.org_id AND f.id = e.file_id';

function evidenceToDto(r: EvidenceRow): EvidenceDto {
  const ownerType = EVIDENCE_OWNERS.find((t) => r[EVIDENCE_COLUMN[t] as keyof EvidenceRow] !== null) as EvidenceOwner;
  return {
    id: r.id, fileId: r.file_id, ownerType, ownerId: r[EVIDENCE_COLUMN[ownerType] as keyof EvidenceRow] as string,
    photoRole: r.photo_role, caption: r.caption, capturedAt: r.captured_at ? r.captured_at.toISOString() : null,
    displayOrder: r.display_order, createdAt: r.created_at.toISOString(), originalName: r.original_name,
    detectedMime: r.detected_mime, byteSize: r.byte_size === null ? null : Number(r.byte_size),
  };
}

/** Proves the evidence owner is visible to the Principal; an inspection result is checked through its inspection. */
async function assertEvidenceOwner(tx: TxClient, principal: Principal, type: EvidenceOwner, id: string, write: boolean): Promise<void> {
  const action = (write ? EVIDENCE_WRITE : EVIDENCE_READ)[type];
  if (type === 'inspection_result') {
    const res = await tx.query<{ inspection_id: string }>('SELECT inspection_id FROM inspection_results WHERE id = $1', [id]);
    if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Record not found');
    await resolveOwner(tx, principal, 'inspection', res.rows[0].inspection_id, action as 'inspections.read' | 'inspections.write');
    return;
  }
  const kind: OwnerKind = type;
  await resolveOwner(tx, principal, kind, id, action as Parameters<typeof resolveOwner>[4]);
}

const evidenceAuth: RequestHandler = (req, _res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = EVIDENCE_OWNERS.find((t) => body[EVIDENCE_BODY_KEY[t]] !== undefined);
    principalWith(req, type ? EVIDENCE_WRITE[type] : 'documents.write');
    next();
  } catch (err) {
    next(err);
  }
};

/** Documents, versions, signed copies and evidence (documents.read / documents.write). Files themselves go through /files. */
export function versionsRouter(): Router {
  const router = Router();

  router.get('/documents', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const query = parseQuery(req, listSchema);
    const items = await withTransaction(principal.orgId, async (tx) => {
      await resolveOwner(tx, principal, query.ownerType, query.ownerId, 'documents.read');
      const rows = await tx.query<DocRow>(
        `SELECT ${DOC_COLUMNS} FROM documents WHERE ${OWNER_COLUMN[query.ownerType]} = $1 ORDER BY document_type, created_at, id`,
        [query.ownerId],
      );
      return toDocumentDtos(tx, rows.rows, false);
    });
    res.json({ items, total: items.length });
  });

  router.get('/documents/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const id = uuidParam(req);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const row = await loadDocument(tx, principal, id, 'documents.read', false);
      return (await toDocumentDtos(tx, [row], true))[0];
    });
    res.json(dto);
  });

  router.post('/documents/generate', requireAction('documents.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const input = generateSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const hash = snapshotHash(input.dataSnapshot);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'documents.generate', ctx, async () => {
        const type = input.documentType;
        const kind = OWNER_OF_TYPE[type];
        const owner = await resolveOwner(tx, principal, kind, input.ownerId, 'documents.write');
        const phase = PHASE_OF_TYPE[type];
        if (phase && owner.phase !== phase) {
          throw new AppError('VALIDATION_ERROR', `${type} documents belong to ${phase} reports`, { documentType: 'phase_mismatch' });
        }
        // Serializes concurrent generation for one owner and type; the partial unique index is the backstop.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`document:${input.ownerId}:${type}`]);
        const found = await tx.query<{ id: string; current_version_id: string | null }>(
          `SELECT id, current_version_id FROM documents WHERE ${OWNER_COLUMN[kind]} = $1 AND document_type = $2 AND status = 'Active' FOR UPDATE`,
          [input.ownerId, type],
        );
        let docId: string;
        let currentVersionId: string | null;
        if (found.rows[0]) {
          docId = found.rows[0].id;
          currentVersionId = found.rows[0].current_version_id;
        } else {
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO documents (org_id, document_type, document_no, ${OWNER_COLUMN[kind]}, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
            [principal.orgId, type, owner.number, input.ownerId, principal.userId],
          );
          docId = ins.rows[0].id;
          currentVersionId = null;
        }
        const versions = await tx.query<{ id: string; version_no: number; template_version: string; snapshot_hash: string; generation_status: string }>(
          'SELECT id, version_no, template_version, snapshot_hash, generation_status FROM document_versions WHERE document_id = $1 ORDER BY version_no DESC',
          [docId],
        );
        const same = (v: { template_version: string; snapshot_hash: string }) => v.snapshot_hash === hash && v.template_version === input.templateVersion;
        const current = versions.rows.find((v) => v.id === currentVersionId);
        const latest = versions.rows[0];
        const respond = async (status: number) => {
          const row = await loadDocument(tx, principal, docId, 'documents.write', false);
          return { status, body: (await toDocumentDtos(tx, [row], true))[0] };
        };

        // Same input as the stored good version: return it unchanged, so a re-download gives the stored bytes.
        if (current && current.generation_status === 'Generated' && same(current)) return respond(200);

        const retryFailed = latest && latest.generation_status === 'Failed' && same(latest) ? latest : undefined;
        if (input.fileId) {
          await loadAttachableFile(tx, input.fileId, PDF);
          let versionId: string;
          if (retryFailed) {
            versionId = retryFailed.id;
            await tx.query(
              `UPDATE document_versions SET generation_status = 'Generated', generated_at = now(), error_code = NULL, error_message = NULL,
                      updated_at = now(), updated_by = $2, row_version = row_version + 1 WHERE id = $1`,
              [versionId, principal.userId],
            );
          } else {
            const ins = await tx.query<{ id: string }>(
              `INSERT INTO document_versions (org_id, document_id, version_no, template_version, snapshot_schema_version, data_snapshot,
                                              snapshot_hash, generation_status, generated_at, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'Generated', now(), $8, $8) RETURNING id`,
              [principal.orgId, docId, (latest?.version_no ?? 0) + 1, input.templateVersion, input.snapshotSchemaVersion,
                JSON.stringify(input.dataSnapshot), hash, principal.userId],
            );
            versionId = ins.rows[0].id;
          }
          await tx.query(
            `INSERT INTO document_files (org_id, document_version_id, file_id, file_role, uploaded_by, created_by, updated_by)
             VALUES ($1, $2, $3, 'Generated PDF', $4, $4, $4)`,
            [principal.orgId, versionId, input.fileId, principal.userId],
          );
          await tx.query(
            'UPDATE documents SET current_version_id = $2, updated_at = now(), updated_by = $3, row_version = row_version + 1 WHERE id = $1',
            [docId, versionId, principal.userId],
          );
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'document.generated', entityType: 'document', entityId: docId,
            correlationId: req.correlationId,
            after: { documentType: type, versionId, templateVersion: input.templateVersion, snapshotHash: hash, fileId: input.fileId },
          });
          return respond(201);
        }

        // No file: a failed render is recorded and stays retryable. The current good version is not moved.
        if (!input.error) {
          throw new AppError('VALIDATION_ERROR', 'fileId or error is required', { fileId: 'required' });
        }
        let versionId: string;
        if (retryFailed) {
          versionId = retryFailed.id;
          await tx.query(
            `UPDATE document_versions SET error_code = $2, error_message = $3, updated_at = now(), updated_by = $4,
                    row_version = row_version + 1 WHERE id = $1`,
            [versionId, input.error.code, input.error.message, principal.userId],
          );
        } else {
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO document_versions (org_id, document_id, version_no, template_version, snapshot_schema_version, data_snapshot,
                                            snapshot_hash, generation_status, error_code, error_message, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'Failed', $8, $9, $10, $10) RETURNING id`,
            [principal.orgId, docId, (latest?.version_no ?? 0) + 1, input.templateVersion, input.snapshotSchemaVersion,
              JSON.stringify(input.dataSnapshot), hash, input.error.code, input.error.message, principal.userId],
          );
          versionId = ins.rows[0].id;
        }
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'document.generation_failed', entityType: 'document', entityId: docId,
          correlationId: req.correlationId, after: { documentType: type, versionId, errorCode: input.error.code },
        });
        return respond(201);
      }),
    );
    res.status(result.status).json(result.body);
  });

  router.post('/documents/:id/versions/:versionId/files', requireAction('documents.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const id = uuidParam(req);
    const versionId = uuidParam(req, 'versionId');
    const input = attachSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'documents.attach_file', ctx, async () => {
        const doc = await loadDocument(tx, principal, id, 'documents.write', true);
        if (doc.status !== 'Active') throw new AppError('BUSINESS_RULE', 'Document is archived', { documentId: 'archived' });
        const version = await tx.query<{ id: string }>('SELECT id FROM document_versions WHERE id = $1 AND document_id = $2', [versionId, id]);
        if (!version.rows[0]) throw new AppError('NOT_FOUND', 'Document version not found');
        // Validated before any write: an invalid or unverified file leaves the prior active file untouched.
        await loadAttachableFile(tx, input.fileId, ANY_FILE);
        const active = await tx.query<{ id: string; file_id: string }>(
          'SELECT id, file_id FROM document_files WHERE document_version_id = $1 AND file_role = $2 AND active FOR UPDATE',
          [versionId, input.fileRole],
        );
        const old = active.rows[0];
        if (old) {
          if (old.file_id === input.fileId) {
            throw new AppError('VALIDATION_ERROR', 'This file is already attached', { fileId: 'already_attached' });
          }
          if (!input.replacementReason) {
            throw new AppError('VALIDATION_ERROR', 'A reason is required to replace the active file', { replacementReason: 'required' });
          }
          await tx.query(
            `UPDATE document_files SET active = false, replaced_at = now(), replacement_reason = $2, updated_at = now(), updated_by = $3,
                    row_version = row_version + 1 WHERE id = $1`,
            [old.id, input.replacementReason, principal.userId],
          );
        }
        await tx.query(
          `INSERT INTO document_files (org_id, document_version_id, file_id, file_role, uploaded_by, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5, $5)`,
          [principal.orgId, versionId, input.fileId, input.fileRole, principal.userId],
        );
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: old ? 'document.file_replaced' : 'document.file_attached', entityType: 'document',
          entityId: id, correlationId: req.correlationId, reason: input.replacementReason,
          before: old ? { fileId: old.file_id } : undefined,
          after: { versionId, fileRole: input.fileRole, fileId: input.fileId },
        });
        const row = await loadDocument(tx, principal, id, 'documents.write', false);
        return { status: 201, body: (await toDocumentDtos(tx, [row], false))[0] };
      }),
    );
    res.status(result.status).json(result.body);
  });

  router.get('/evidence', async (req, res) => {
    const query = parseQuery(req, evidenceListSchema);
    const principal = principalWith(req, EVIDENCE_READ[query.ownerType]);
    const items = await withTransaction(principal.orgId, async (tx) => {
      await assertEvidenceOwner(tx, principal, query.ownerType, query.ownerId, false);
      const rows = await tx.query<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS} FROM ${EVIDENCE_FROM} WHERE e.${EVIDENCE_COLUMN[query.ownerType]} = $1 ORDER BY e.display_order, e.created_at, e.id`,
        [query.ownerId],
      );
      return rows.rows.map(evidenceToDto);
    });
    res.json({ items, total: items.length });
  });

  router.post('/evidence', evidenceAuth, idempotencyMiddleware({ required: true }), async (req, res) => {
    const input = evidenceSchema.parse(req.body ?? {});
    const type = EVIDENCE_OWNERS.find((t) => input[EVIDENCE_BODY_KEY[t] as keyof typeof input] !== undefined) as EvidenceOwner;
    const principal = principalWith(req, EVIDENCE_WRITE[type]);
    const ownerId = input[EVIDENCE_BODY_KEY[type] as keyof typeof input] as string;
    const ctx = getIdempotency(res);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'evidence.create', ctx, async () => {
        await assertEvidenceOwner(tx, principal, type, ownerId, true);
        await loadAttachableFile(tx, input.fileId, IMAGES);
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO evidence_attachments (org_id, file_id, ${EVIDENCE_COLUMN[type]}, photo_role, caption, captured_at, display_order,
                                             created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
          [principal.orgId, input.fileId, ownerId, input.photoRole, input.caption ?? null, input.capturedAt ?? null,
            input.displayOrder ?? 0, principal.userId],
        );
        const row = await tx.query<EvidenceRow>(`SELECT ${EVIDENCE_COLUMNS} FROM ${EVIDENCE_FROM} WHERE e.id = $1`, [ins.rows[0].id]);
        const dto = evidenceToDto(row.rows[0]);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'evidence.attached', entityType: 'evidence', entityId: dto.id,
          correlationId: req.correlationId, after: { ownerType: type, ownerId, fileId: dto.fileId, photoRole: dto.photoRole },
        });
        return { status: 201, body: dto };
      }),
    );
    res.status(result.status).json(result.body);
  });

  return router;
}
