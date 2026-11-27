import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { assertAttachable } from '../files/index.js';
import { recordAudit } from '../shared/audit.js';
import { assertInScope } from '../shared/branchScope.js';
import { isoDate, text } from '../shared/fields.js';
import { parseQuery, principalWith, requireAction, setVersionHeader, uuidParam } from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

export const MACHINE_DOCUMENT_TYPES = ['Registration', 'Insurance', 'Certificate', 'Manual', 'Permit'] as const;
export type MachineDocumentType = (typeof MACHINE_DOCUMENT_TYPES)[number];

interface DocRow {
  id: string;
  machine_id: string;
  file_id: string;
  name: string;
  document_type: MachineDocumentType;
  uploaded_at: Date;
  expires_on: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface MachineDocumentDto {
  id: string;
  machineId: string;
  fileId: string;
  name: string;
  documentType: MachineDocumentType;
  uploadedAt: string;
  expiresOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS = `id, machine_id, file_id, name, document_type, uploaded_at, to_char(expires_on, 'YYYY-MM-DD') AS expires_on,
  active, created_at, updated_at, row_version`;

function toDto(r: DocRow): MachineDocumentDto {
  return {
    id: r.id,
    machineId: r.machine_id,
    fileId: r.file_id,
    name: r.name,
    documentType: r.document_type,
    uploadedAt: r.uploaded_at.toISOString(),
    expiresOn: r.expires_on,
    active: r.active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const createSchema = z
  .object({
    fileId: z.uuid(),
    name: text(200),
    documentType: z.enum(MACHINE_DOCUMENT_TYPES),
    expiresOn: z.union([isoDate, z.null()]).optional(),
  })
  .strict();

const listSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  documentType: z.enum(MACHINE_DOCUMENT_TYPES).optional(),
});

/**
 * Authorization of a document is the authorization of its machine: another company's machine is invisible (RLS, 404)
 * and a machine outside the Principal's branch scope is 404 as well.
 */
async function assertMachineVisible(tx: TxClient, principal: Principal, machineId: string, action: 'machines.read' | 'machines.write'): Promise<void> {
  const res = await tx.query<{ branch_id: string }>('SELECT branch_id FROM machines WHERE id = $1', [machineId]);
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Machine not found');
  assertInScope(principal, action, res.rows[0].branch_id);
}

async function loadDoc(tx: TxClient, machineId: string, id: string, lock: boolean): Promise<DocRow> {
  const res = await tx.query<DocRow>(
    `SELECT ${COLUMNS} FROM machine_documents WHERE id = $1 AND machine_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [id, machineId],
  );
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Machine document not found');
  return res.rows[0];
}

/** Machine documents: list/read (machines.read); create and deactivate (machines.write). */
export function machineDocumentsRouter(): Router {
  const router = Router();

  router.get('/machines/:id/documents', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const machineId = uuidParam(req);
    const query = parseQuery(req, listSchema);
    const items = await withTransaction(principal.orgId, async (tx) => {
      await assertMachineVisible(tx, principal, machineId, 'machines.read');
      const params: unknown[] = [machineId];
      const where = ['machine_id = $1'];
      if (query.active) {
        params.push(query.active === 'true');
        where.push(`active = $${params.length}`);
      }
      if (query.documentType) {
        params.push(query.documentType);
        where.push(`document_type = $${params.length}`);
      }
      const rows = await tx.query<DocRow>(
        `SELECT ${COLUMNS} FROM machine_documents WHERE ${where.join(' AND ')} ORDER BY uploaded_at DESC, id`,
        params,
      );
      return rows.rows.map(toDto);
    });
    res.json({ items, documentTypes: MACHINE_DOCUMENT_TYPES });
  });

  router.get('/machines/:id/documents/:docId', async (req, res) => {
    const principal = principalWith(req, 'machines.read');
    const machineId = uuidParam(req);
    const docId = uuidParam(req, 'docId');
    const dto = await withTransaction(principal.orgId, async (tx) => {
      await assertMachineVisible(tx, principal, machineId, 'machines.read');
      return toDto(await loadDoc(tx, machineId, docId, false));
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/machines/:id/documents', requireAction('machines.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const machineId = uuidParam(req);
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    const result = await withTransaction(principal.orgId, (tx) =>
      runIdempotent(tx, principal.orgId, 'machine_documents.create', ctx, async () => {
        await assertMachineVisible(tx, principal, machineId, 'machines.write');
        // 404 for another company's file, 422 FILE_INVALID unless the file is Verified and Clean.
        await assertAttachable(tx, input.fileId);
        const ins = await tx.query<DocRow>(
          `INSERT INTO machine_documents (org_id, machine_id, file_id, name, document_type, expires_on, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING ${COLUMNS}`,
          [principal.orgId, machineId, input.fileId, input.name, input.documentType, input.expiresOn ?? null, principal.userId],
        );
        const dto = toDto(ins.rows[0]);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'machine_document.created',
          entityType: 'machine_document',
          entityId: dto.id,
          correlationId: req.correlationId,
          after: { machineId, fileId: dto.fileId, name: dto.name, documentType: dto.documentType, expiresOn: dto.expiresOn },
        });
        return { status: 201, body: dto };
      }),
    );
    res.status(result.status).json(result.body);
  });

  // Documents are deactivated, never deleted, so history of what was on file is kept.
  router.delete('/machines/:id/documents/:docId', async (req, res) => {
    const principal = principalWith(req, 'machines.write');
    const machineId = uuidParam(req);
    const docId = uuidParam(req, 'docId');
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      await assertMachineVisible(tx, principal, machineId, 'machines.write');
      const before = toDto(await loadDoc(tx, machineId, docId, true));
      if (before.rowVersion !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      await versionedUpdate(tx, {
        table: 'machine_documents', orgId: principal.orgId, id: docId, expectedVersion: expected,
        set: { active: false, updated_at: new Date(), updated_by: principal.userId },
      });
      const after = toDto(await loadDoc(tx, machineId, docId, false));
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: 'machine_document.deactivated',
        entityType: 'machine_document',
        entityId: docId,
        correlationId: req.correlationId,
        before: { active: before.active },
        after: { active: after.active },
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
