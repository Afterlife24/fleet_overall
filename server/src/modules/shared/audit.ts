import type { TxClient } from '../../db/tx.js';
import { redactSecrets } from './redact.js';

export { redactSecrets } from './redact.js';

export interface AuditEvent {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  correlationId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

/** Inserts an audit event in the caller's transaction; secrets are redacted before insert. */
export async function recordAudit(tx: TxClient, orgId: string, event: AuditEvent): Promise<void> {
  const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(redactSecrets(v)));
  await tx.query(
    `INSERT INTO audit_events
       (org_id, actor_user_id, action, entity_type, entity_id, reason, before_data, after_data, correlation_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $2)`,
    [
      orgId,
      event.actorUserId ?? null,
      event.action,
      event.entityType,
      event.entityId ?? null,
      event.reason ?? null,
      json(event.before),
      json(event.after),
      event.correlationId,
    ],
  );
}
