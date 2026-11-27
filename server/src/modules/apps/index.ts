import { Router } from 'express';
import { z } from 'zod';
import { APP_CATALOG, dependentsOf, getCatalogApp, withDependencies } from '../../constants/appCatalog.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { principalWith, setVersionHeader } from '../shared/http.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

type OrgAppRow = {
  id: string;
  app_code: string;
  active: boolean;
  onboarded: boolean;
  row_version: string;
}

export interface OrgAppDto {
  appCode: string;
  name: string;
  category: string;
  depends: string[];
  active: boolean;
  onboarded: boolean;
  /** Null until the organization has a row for this app (never activated or configured). */
  rowVersion: number | null;
}

function toDto(code: string, row: OrgAppRow | undefined): OrgAppDto {
  const app = getCatalogApp(code);
  if (!app) throw new AppError('NOT_FOUND', 'App not found');
  return {
    appCode: code,
    name: app.name,
    category: app.category,
    depends: [...app.depends],
    active: row?.active ?? false,
    onboarded: row?.onboarded ?? false,
    rowVersion: row ? Number(row.row_version) : null,
  };
}

const patchSchema = z.object({ active: z.boolean(), onboarded: z.boolean() }).partial().strict();

async function loadRows(tx: TxClient, lock: boolean): Promise<Map<string, OrgAppRow>> {
  const res = await tx.query<OrgAppRow>(
    `SELECT id, app_code, active, onboarded, row_version FROM organization_apps${lock ? ' FOR UPDATE' : ''}`,
  );
  return new Map(res.rows.map((r) => [r.app_code, r]));
}

/** Activates an app without a version check (used for dependencies pulled in by another activation). */
async function activateDependency(tx: TxClient, orgId: string, userId: string, code: string): Promise<void> {
  await tx.query(
    `INSERT INTO organization_apps (org_id, app_code, active, created_by, updated_by)
     VALUES ($1, $2, true, $3, $3)
     ON CONFLICT (org_id, app_code) DO UPDATE
       SET active = true, updated_at = now(), updated_by = $3, row_version = organization_apps.row_version + 1`,
    [orgId, code, userId],
  );
}

/**
 * Organization apps: `GET /apps` (company.read) and `PATCH /apps/:appCode` (settings.manage).
 * Activation also activates dependencies; deactivation is refused while an active app depends on it.
 * Deactivation only flips the flag, so all transactional and master records are retained.
 */
export function appsRouter(): Router {
  const router = Router();

  router.get('/apps', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const rows = await withTransaction(principal.orgId, (tx) => loadRows(tx, false));
    res.json({ items: APP_CATALOG.map((a) => toDto(a.id, rows.get(a.id))) });
  });

  router.patch('/apps/:appCode', async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const code = String(req.params.appCode);
    if (!getCatalogApp(code)) throw new AppError('NOT_FOUND', 'App not found');
    const patch = patchSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const header = req.headers['if-match'];

    const result = await withTransaction(principal.orgId, async (tx) => {
      const rows = await loadRows(tx, true);
      const existing = rows.get(code);
      // A row exists only after the first change, so the version is required from then on.
      const expected = existing || header !== undefined ? parseIfMatch(header) : undefined;
      if (existing) {
        if (Number(existing.row_version) !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
      } else if (expected !== undefined) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }

      const before = toDto(code, existing);
      const activeIds = [...rows.values()].filter((r) => r.active).map((r) => r.app_code);
      const alsoActivated: string[] = [];

      if (patch.active === false && before.active) {
        const blockers = dependentsOf(code, activeIds);
        if (blockers.length > 0) {
          throw new AppError('VALIDATION_ERROR', `Active apps depend on this app: ${blockers.join(', ')}`, {
            active: 'has_dependents',
          });
        }
      }
      if (patch.active === true) {
        for (const dep of withDependencies(code)) {
          if (dep === code || activeIds.includes(dep)) continue;
          await activateDependency(tx, principal.orgId, principal.userId, dep);
          alsoActivated.push(dep);
        }
      }

      let row: OrgAppRow;
      if (existing) {
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        if (patch.active !== undefined) set.active = patch.active;
        if (patch.onboarded !== undefined) set.onboarded = patch.onboarded;
        row = (
          await versionedUpdate<OrgAppRow>(tx, {
            table: 'organization_apps', orgId: principal.orgId, id: existing.id, expectedVersion: Number(existing.row_version), set,
          })
        ).row;
      } else {
        const ins = await tx.query<OrgAppRow>(
          `INSERT INTO organization_apps (org_id, app_code, active, onboarded, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, app_code, active, onboarded, row_version`,
          [principal.orgId, code, patch.active ?? false, patch.onboarded ?? false, principal.userId],
        );
        row = ins.rows[0];
      }
      const after = toDto(code, row);
      const action =
        patch.active === true && !before.active ? 'app.activated' : patch.active === false && before.active ? 'app.deactivated' : 'app.updated';
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action,
        entityType: 'organization_app',
        entityId: row.id,
        correlationId: req.correlationId,
        before: { appCode: code, active: before.active, onboarded: before.onboarded },
        after: { appCode: code, active: after.active, onboarded: after.onboarded, alsoActivated },
      });
      return { ...after, alsoActivated };
    });
    if (result.rowVersion !== null) setVersionHeader(res, result.rowVersion);
    res.json(result);
  });

  return router;
}
