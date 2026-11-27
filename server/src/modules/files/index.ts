import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { authorize, type ActionCode, type Principal } from '../../auth/principal.js';
import { requirePrincipal } from '../../auth/middleware.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { assertSafeFilename, generateKey, type FileStorage } from '../../storage/fileStorage.js';
import {
  isDeclaredType,
  SIGNATURE_BYTES,
  validateUploadHead,
  type DeclaredType,
} from '../../storage/uploadValidator.js';
import type { VerificationAdapter } from '../../storage/verificationAdapter.js';
import { recordAudit } from '../shared/audit.js';
import { OWNER_COLUMN, OWNER_KINDS, resolveOwner, type OwnerKind } from '../documents/owners.js';

export interface FilesDeps {
  storage: FileStorage;
  verifier: VerificationAdapter;
  maxUploadBytes: number;
  /** Storage environment segment of generated keys (NODE_ENV). */
  environment: string;
}

interface FileRow {
  id: string;
  object_key: string;
  original_name: string;
  declared_mime: string;
  detected_mime: string | null;
  expected_size: string;
  byte_size: string | null;
  sha256: string | null;
  storage_state: string;
  scan_status: string;
  created_at: Date;
}

const COLUMNS =
  'id, object_key, original_name, declared_mime, detected_mime, expected_size, byte_size, sha256, storage_state, scan_status, created_at';

function toDto(r: FileRow) {
  return {
    id: r.id,
    originalName: r.original_name,
    declaredMime: r.declared_mime,
    detectedMime: r.detected_mime,
    expectedSize: Number(r.expected_size),
    byteSize: r.byte_size === null ? null : Number(r.byte_size),
    sha256: r.sha256,
    storageState: r.storage_state,
    scanStatus: r.scan_status,
    createdAt: r.created_at.toISOString(),
  };
}

function requireAction(principal: Principal, action: ActionCode): void {
  if (authorize(principal, action) !== 'allow') throw new AppError('FORBIDDEN', 'You do not have permission for this action');
}

/** A file can be attached to a business record or downloaded only when it is stored, verified and scanned Clean. */
export function isAvailable(row: Pick<FileRow, 'storage_state' | 'scan_status'>): boolean {
  return row.storage_state === 'Verified' && row.scan_status === 'Clean';
}

/**
 * For use by modules that attach files (LPO, signed copies, evidence). Runs in the caller's tenant
 * transaction; a file of another organization is invisible (404) and a non-Clean file is rejected (FILE_INVALID).
 */
export async function assertAttachable(tx: TxClient, fileId: string): Promise<void> {
  const res = await tx.query<FileRow>(`SELECT ${COLUMNS} FROM files WHERE id = $1`, [fileId]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  if (!isAvailable(row)) {
    throw new AppError('FILE_INVALID', 'File is not verified and cannot be attached', { file: 'not_clean' });
  }
}

async function loadFile(orgId: string, id: string): Promise<FileRow> {
  const row = await withTransaction(orgId, async (tx) => {
    const res = await tx.query<FileRow>(`SELECT ${COLUMNS} FROM files WHERE id = $1`, [id]);
    return res.rows[0];
  });
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  return row;
}

type OwnerCheck = { kind: OwnerKind; id: string; action: Parameters<typeof resolveOwner>[4] };

/**
 * Files attached to documents or evidence are readable only by users who can see one of the owner records
 * (company via RLS, branch scope, own-records). LPO and machine-document files keep their module's checks.
 * A file attached to nothing yet is readable only by its uploader.
 */
async function assertCanDownload(principal: Principal, fileId: string): Promise<void> {
  await withTransaction(principal.orgId, async (tx) => {
    const links = await tx.query<{ kind: string; owner_id: string }>(
      `SELECT 'doc' AS kind, d.id::text AS owner_id FROM document_files f
         JOIN document_versions v ON v.org_id = f.org_id AND v.id = f.document_version_id
         JOIN documents d ON d.org_id = v.org_id AND d.id = v.document_id WHERE f.file_id = $1
       UNION ALL SELECT 'mqd_report', e.mqd_report_id::text FROM evidence_attachments e WHERE e.file_id = $1 AND e.mqd_report_id IS NOT NULL
       UNION ALL SELECT 'inspection', e.inspection_id::text FROM evidence_attachments e WHERE e.file_id = $1 AND e.inspection_id IS NOT NULL
       UNION ALL SELECT 'inspection_result', e.inspection_result_id::text FROM evidence_attachments e WHERE e.file_id = $1 AND e.inspection_result_id IS NOT NULL
       UNION ALL SELECT 'gate_pass', e.gate_pass_id::text FROM evidence_attachments e WHERE e.file_id = $1 AND e.gate_pass_id IS NOT NULL
       UNION ALL SELECT 'other', l.id::text FROM customer_lpos l WHERE l.file_id = $1
       UNION ALL SELECT 'other', m.id::text FROM machine_documents m WHERE m.file_id = $1`,
      [fileId],
    );
    if (links.rows.length === 0) {
      const own = await tx.query('SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2', [fileId, principal.userId]);
      if ((own.rowCount ?? 0) === 0) throw new AppError('NOT_FOUND', 'File not found');
      return;
    }
    if (links.rows.some((l) => l.kind === 'other')) return;
    const checks: OwnerCheck[] = [];
    for (const l of links.rows) {
      if (l.kind === 'doc') {
        const d = await tx.query<Record<string, string | null> & { document_type: string }>(
          'SELECT * FROM documents WHERE id = $1', [l.owner_id],
        );
        const doc = d.rows[0];
        if (!doc) continue;
        const kind = OWNER_KINDS.find((k) => doc[OWNER_COLUMN[k]]);
        if (kind) checks.push({ kind, id: doc[OWNER_COLUMN[kind]] as string, action: 'documents.read' });
      } else if (l.kind === 'inspection_result') {
        const r = await tx.query<{ inspection_id: string }>('SELECT inspection_id FROM inspection_results WHERE id = $1', [l.owner_id]);
        if (r.rows[0]) checks.push({ kind: 'inspection', id: r.rows[0].inspection_id, action: 'inspections.read' });
      } else if (l.kind === 'inspection') {
        checks.push({ kind: 'inspection', id: l.owner_id, action: 'inspections.read' });
      } else if (l.kind === 'gate_pass') {
        checks.push({ kind: 'gate_pass', id: l.owner_id, action: 'gate.read' });
      } else {
        checks.push({ kind: 'mqd_report', id: l.owner_id, action: 'documents.read' });
      }
    }
    for (const c of checks) {
      try {
        await resolveOwner(tx, principal, c.kind, c.id, c.action);
        return;
      } catch {
        // try the next owner
      }
    }
    throw new AppError('NOT_FOUND', 'File not found');
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(req: Request): string {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'File not found');
  return id;
}

/** Gathers leading bytes (without consuming them) and returns a replayable body. */
async function peek(
  source: AsyncIterable<Uint8Array>,
  wanted: number,
): Promise<{ head: Uint8Array; body: AsyncIterable<Uint8Array> }> {
  const iterator = source[Symbol.asyncIterator]();
  const buffered: Uint8Array[] = [];
  let have = 0;
  let done = false;
  while (have < wanted && !done) {
    const next = await iterator.next();
    if (next.done) done = true;
    else {
      buffered.push(next.value);
      have += next.value.byteLength;
    }
  }
  const head = Buffer.concat(buffered).subarray(0, wanted);
  const body: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      yield* buffered;
      while (!done) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    },
  };
  return { head, body };
}

function safeDisposition(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name.slice(0, 120))}`;
}

async function markFailed(orgId: string, id: string, userId: string): Promise<void> {
  await withTransaction(orgId, async (tx) => {
    await tx.query(
      `UPDATE files SET storage_state = 'Failed', scan_status = 'Failed', updated_at = now(), updated_by = $2,
              row_version = row_version + 1 WHERE id = $1`,
      [id, userId],
    );
  }).catch(() => undefined);
}

async function upload(deps: FilesDeps, req: Request, res: Response): Promise<void> {
  const principal = requirePrincipal(req);
  requireAction(principal, 'files.write');

  const declared = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!isDeclaredType(declared)) {
    throw new AppError('FILE_INVALID', 'Only PDF, PNG and JPEG files are accepted', { 'Content-Type': 'unsupported' });
  }
  const lengthHeader = req.headers['content-length'];
  const expected = lengthHeader === undefined ? NaN : Number(lengthHeader);
  if (!Number.isInteger(expected)) {
    throw new AppError('VALIDATION_ERROR', 'Content-Length is required', { 'Content-Length': 'required' });
  }
  if (expected < 1 || expected > deps.maxUploadBytes) {
    throw new AppError('FILE_INVALID', 'File is empty or larger than the allowed size', { file: 'size' });
  }
  const originalName = typeof req.query.filename === 'string' ? req.query.filename : '';
  if (originalName === '') {
    throw new AppError('VALIDATION_ERROR', 'filename is required', { filename: 'required' });
  }
  assertSafeFilename(originalName);

  // Object key: server generated from the Principal's organization, never from client input.
  const fileId = randomUUID();
  const ext = declared === 'application/pdf' ? 'pdf' : declared === 'image/png' ? 'png' : 'jpg';
  const key = generateKey(deps.environment, principal.orgId, fileId, `original.${ext}`);

  // Signature check on the leading bytes before anything is stored.
  const { head, body } = await peek(req, SIGNATURE_BYTES);
  if (!validateUploadHead(head, expected, declared, deps.maxUploadBytes).ok) {
    throw new AppError('FILE_INVALID', 'File content does not match its declared type', { file: 'signature' });
  }

  const orgId = principal.orgId;
  await withTransaction(orgId, async (tx) => {
    await tx.query(
      `INSERT INTO files (id, org_id, object_key, original_name, declared_mime, expected_size, uploaded_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [fileId, orgId, key, originalName, declared, expected, principal.userId],
    );
  });

  let stored;
  try {
    stored = await deps.storage.put({ key, body, contentType: declared, maxBytes: deps.maxUploadBytes });
    if (stored.bytes !== expected) {
      await deps.storage.removeUnattached(key).catch(() => undefined);
      throw new AppError('FILE_INVALID', 'Uploaded size does not match Content-Length', { file: 'size' });
    }
  } catch (err) {
    await markFailed(orgId, fileId, principal.userId);
    throw err;
  }

  let verdict;
  try {
    verdict = await deps.verifier.scan({ fileId, key, bytes: stored.bytes, sha256: stored.sha256, mime: declared });
  } catch {
    verdict = { status: 'Failed' as const, auditMarker: `${deps.verifier.name}: scan error` };
  }

  const row = await withTransaction(orgId, async (tx) => {
    const updated = await tx.query<FileRow>(
      `UPDATE files SET storage_state = 'Verified', byte_size = $2, sha256 = $3, detected_mime = $4,
              verified_at = now(), uploaded_at = now(), scan_status = $5, updated_at = now(), updated_by = $6,
              row_version = row_version + 1
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [fileId, stored.bytes, stored.sha256, declared as DeclaredType, verdict.status, principal.userId],
    );
    await recordAudit(tx, orgId, {
      actorUserId: principal.userId,
      action: 'file.uploaded',
      entityType: 'file',
      entityId: fileId,
      correlationId: req.correlationId,
      after: { bytes: stored.bytes, sha256: stored.sha256, mime: declared, scanStatus: verdict.status },
    });
    await recordAudit(tx, orgId, {
      actorUserId: principal.userId,
      action: 'file.scanned',
      entityType: 'file',
      entityId: fileId,
      correlationId: req.correlationId,
      reason: verdict.auditMarker,
      after: { verifier: deps.verifier.name, scanStatus: verdict.status },
    });
    return updated.rows[0];
  });

  res.status(201).json(toDto(row));
}

/** Authenticated owner-scoped file endpoints. Mount after the auth middleware. */
export function filesRouter(deps: FilesDeps): Router {
  const router = Router();

  router.post('/files', (req, res) => upload(deps, req, res));

  router.get('/files/:id', async (req, res) => {
    const principal = requirePrincipal(req);
    requireAction(principal, 'files.read');
    const row = await loadFile(principal.orgId, parseId(req));
    await assertCanDownload(principal, row.id);
    res.json(toDto(row));
  });

  router.get('/files/:id/content', async (req, res) => {
    const principal = requirePrincipal(req);
    requireAction(principal, 'files.read');
    const row = await loadFile(principal.orgId, parseId(req));
    await assertCanDownload(principal, row.id);
    if (!isAvailable(row)) {
      throw new AppError('FORBIDDEN', 'File is not available for download', { file: 'not_clean' });
    }
    const stream = await deps.storage.read(row.object_key);
    res.status(200);
    res.setHeader('Content-Type', row.detected_mime ?? row.declared_mime);
    if (row.byte_size !== null) res.setHeader('Content-Length', row.byte_size);
    res.setHeader('Content-Disposition', safeDisposition(row.original_name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    for await (const chunk of stream) {
      if (!res.write(chunk)) await new Promise<void>((resolve) => res.once('drain', resolve));
    }
    res.end();
  });

  return router;
}
