import { Router } from 'express';
import { z } from 'zod';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import {
  likePattern, mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam,
  type Page,
} from '../shared/http.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

type BranchRow = {
  id: string;
  code: string;
  name: string;
  country_code: string;
  city: string;
  address: string;
  phone: string | null;
  manager_user_id: string | null;
  timezone: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface BranchDto {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  city: string;
  address: string;
  phone: string | null;
  managerUserId: string | null;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS =
  'id, code, name, country_code, city, address, phone, manager_user_id, timezone, active, created_at, updated_at, row_version';

export function branchToDto(r: BranchRow): BranchDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    countryCode: r.country_code,
    city: r.city,
    address: r.address,
    phone: r.phone,
    managerUserId: r.manager_user_id,
    timezone: r.timezone,
    active: r.active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) =>
  z.union([z.string().trim().max(max).transform((v) => (v === '' ? null : v)), z.null()]);

const fields = {
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/),
  name: text(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  city: text(100),
  address: text(500),
  phone: nullableText(50),
  managerUserId: z.union([z.uuid(), z.null()]),
  timezone: text(64).refine(isTimeZone, 'invalid timezone'),
};

const createSchema = z
  .object({
    code: fields.code,
    name: fields.name,
    countryCode: fields.countryCode,
    city: fields.city,
    address: fields.address,
    phone: fields.phone.optional(),
    managerUserId: fields.managerUserId.optional(),
    timezone: fields.timezone,
  })
  .strict();

const updateSchema = z
  .object({
    code: fields.code,
    name: fields.name,
    countryCode: fields.countryCode,
    city: fields.city,
    address: fields.address,
    phone: fields.phone,
    managerUserId: fields.managerUserId,
    timezone: fields.timezone,
    active: z.boolean(),
  })
  .partial()
  .strict();

const listSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = { code: 'code', name: 'name', city: 'city', createdAt: 'created_at' };

const COLUMN_BY_FIELD: Record<string, string> = {
  code: 'code',
  name: 'name',
  countryCode: 'country_code',
  city: 'city',
  address: 'address',
  phone: 'phone',
  managerUserId: 'manager_user_id',
  timezone: 'timezone',
  active: 'active',
};

const DUPLICATE_CODE = { uq_branches_code: 'code' };

async function assertManager(tx: TxClient, managerUserId: string | null | undefined): Promise<void> {
  if (!managerUserId) return;
  const res = await tx.query('SELECT 1 FROM users WHERE id = $1', [managerUserId]);
  if (res.rowCount === 0) throw new AppError('VALIDATION_ERROR', 'Manager not found', { managerUserId: 'not_found' });
}

async function loadBranch(tx: TxClient, id: string): Promise<BranchRow> {
  const res = await tx.query<BranchRow>(`SELECT ${COLUMNS} FROM branches WHERE id = $1 FOR UPDATE`, [id]);
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Branch not found');
  return res.rows[0];
}

/** Snapshot of the changed fields, used as audit before/after data. */
function pick(dto: BranchDto, keys: string[]): Record<string, unknown> {
  const d = dto as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, d[k]]));
}

/** Branches: list (company.read); create, update, deactivate (settings.manage). */
export function branchesRouter(): Router {
  const router = Router();

  router.get('/branches', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'code', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.active !== undefined) {
      params.push(query.active === 'true');
      where.push(`active = $${params.length}`);
    }
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`(code ILIKE $${params.length} ESCAPE '\\' OR name ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM branches ${clause}`, params);
      const rows = await tx.query<BranchRow>(
        `SELECT ${COLUMNS} FROM branches ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(branchToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<BranchDto>;
    });
    res.json(body);
  });

  router.get('/branches/:id', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const id = uuidParam(req);
    const row = await withTransaction(principal.orgId, async (tx) => {
      const r = await tx.query<BranchRow>(`SELECT ${COLUMNS} FROM branches WHERE id = $1`, [id]);
      return r.rows[0];
    });
    if (!row) throw new AppError('NOT_FOUND', 'Branch not found');
    const dto = branchToDto(row);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/branches', requireAction('settings.manage'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'branches.create', ctx, async () => {
          await assertManager(tx, input.managerUserId);
          const ins = await tx.query<BranchRow>(
            `INSERT INTO branches (org_id, code, name, country_code, city, address, phone, manager_user_id, timezone, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING ${COLUMNS}`,
            [
              principal.orgId, input.code, input.name, input.countryCode, input.city, input.address,
              input.phone ?? null, input.managerUserId ?? null, input.timezone, principal.userId,
            ],
          );
          const dto = branchToDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'branch.created',
            entityType: 'branch',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, DUPLICATE_CODE, 'A branch with this code already exists');
    }
    res.status(result.status).json(result.body);
  });

  const applyUpdate = async (
    principal: ReturnType<typeof principalWith>,
    id: string,
    expected: number,
    patch: z.infer<typeof updateSchema>,
    correlationId: string,
  ): Promise<BranchDto> => {
    try {
      return await withTransaction(principal.orgId, async (tx) => {
        const before = branchToDto(await loadBranch(tx, id));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        if (patch.managerUserId !== undefined) await assertManager(tx, patch.managerUserId);
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        for (const [field, value] of Object.entries(patch)) set[COLUMN_BY_FIELD[field]] = value;
        const { row } = await versionedUpdate<BranchRow>(tx, {
          table: 'branches', orgId: principal.orgId, id, expectedVersion: expected, set,
        });
        const after = branchToDto(row);
        const keys = Object.keys(patch);
        const action =
          patch.active === false && before.active ? 'branch.deactivated' : patch.active === true && !before.active ? 'branch.activated' : 'branch.updated';
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action,
          entityType: 'branch',
          entityId: id,
          correlationId,
          before: pick(before, keys),
          after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      return mapUniqueViolation(err, DUPLICATE_CODE, 'A branch with this code already exists');
    }
  };

  router.patch('/branches/:id', async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const dto = await applyUpdate(principal, id, expected, patch, req.correlationId);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // Branches are deactivated, never deleted: other records may reference them.
  router.delete('/branches/:id', async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await applyUpdate(principal, id, expected, { active: false }, req.correlationId);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
