import { Router } from 'express';
import { reportsRouter } from './reports.js';
import { versionsRouter } from './versions.js';

export type { DeliveryNoteDto, MqdReportDto, ServiceReportDto, ServiceLineDto } from './reports.js';
export type { DocumentDto, DocumentVersionDto, DocumentFileDto, EvidenceDto } from './versions.js';
export { loadAttachableFile, snapshotHash, canonicalJson } from './versions.js';
export { resolveOwner, OWNER_KINDS, DOCUMENT_TYPES } from './owners.js';

/**
 * Documents module: Delivery Notes, HIRE/COLLECTION MQD and third-party service reports, document headers and
 * immutable versions, signed copies and evidence. Mount after the auth middleware (documents.* / files.* actions).
 */
export function documentsRouter(): Router {
  const router = Router();
  router.use(reportsRouter());
  router.use(versionsRouter());
  return router;
}
