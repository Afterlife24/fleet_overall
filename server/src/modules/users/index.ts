import { Router } from 'express';
import { z } from 'zod';
import { ACTION_CODES, isActionCode, type Principal } from '../../auth/principal.js';
import { APP_CODES, isAppCode } from '../../constants/appCatalog.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import {
  likePattern, mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam,
  type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

// ---------------------------------------------------------------- roles

/** Permission codes the server allows on a role (Requirement 9.5). */
export const PERMISSION_CODES: readonly string[] = ACTION_CODES;

/** Keeps only codes in the allowlist, de-duplicated, in input order. */
export function allowlisted(codes: readonly string[], isAllowed: (code: string) => boolean): string[] {
  return [...new Set(codes.filter(isAllowed))];
}

/**
 * Validates role permission and app codes against the server allowlists.
 * Unknown codes -> 422 with a field error per offending code.
 */
export function validateRoleCodes(input: { permissions: readonly string[]; appCodes: readonly string[] }): void {
  const errors: Record<string, string> = {};
  for (const c of input.permissions) if (!isActionCode(c)) errors[`permissions.${c}`] = 'unknown_code';
  for (const c of input.appCodes) if (!isAppCode(c)) errors[`appCodes.${c}`] = 'unknown_code';
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Unknown permission or app codes', errors);
  }
}

export { APP_CODES };

interface RoleRow {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  app_codes: string[];
  active: boolean;
  row_version: string;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  appCodes: string[];
  active: boolean;
  rowVersion: number;
}

function roleToDto(r: RoleRow): RoleDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    // Stored values outside the allowlists are never exposed.
    permissions: allowlisted(r.permissions, isActionCode),
    appCodes: allowlisted(r.app_codes, isAppCode),
    active: r.active,
    rowVersion: Number(r.row_version),
  };
}

// ---------------------------------------------------------------- users

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
type UserStatus = (typeof USER_STATUSES)[number];

interface UserRow {
  id: string;
  role_id: string;
  role_code: string;
  branch_id: string | null;
  normalized_email: string;
  display_name: string;
  phone: string | null;
  is_owner: boolean;
  all_branches: boolean;
  status: UserStatus;
  avatar_color: string | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  roleId: string;
  roleCode: string;
  branchId: string | null;
  allBranches: boolean;
  isOwner: boolean;
  status: UserStatus;
  avatarColor: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const USER_SELECT = `SELECT u.id, u.role_id, r.code AS role_code, u.branch_id, u.normalized_email, u.display_name, u.phone,
       u.is_owner, u.all_branches, u.status, u.avatar_color, u.last_login_at, u.created_at, u.updated_at, u.row_version
  FROM users u JOIN roles r ON r.org_id = u.org_id AND r.id = u.role_id`;

function userToDto(r: UserRow): UserDto {
  return {
    id: r.id,
    email: r.normalized_email,
    displayName: r.display_name,
    phone: r.phone,
    roleId: r.role_id,
    roleCode: r.role_code,
    branchId: r.branch_id,
    allBranches: r.all_branches,
    isOwner: r.is_owner,
    status: r.status,
    avatarColor: r.avatar_color,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) =>
  z.union([z.string().trim().max(max).transform((v) => (v === '' ? null : v)), z.null()]);

const createSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    displayName: text(200),
    phone: nullableText(50).optional(),
    roleId: z.uuid(),
    branchId: z.union([z.uuid(), z.null()]).optional(),
    allBranches: z.boolean().optional(),
    /** Identity provider subject to bind; when absent the user is created as an invitation placeholder. */
    authSubject: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    displayName: text(200),
    phone: nullableText(50),
    roleId: z.uuid(),
    branchId: z.union([z.uuid(), z.null()]),
    allBranches: z.boolean(),
  })
  .partial()
  .strict();

const statusSchema = z.object({ status: z.enum(USER_STATUSES), reason: z.string().trim().max(500).optional() }).strict();

const listSchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
  branchId: z.uuid().optional(),
  roleId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = { name: 'u.display_name', email: 'u.normalized_email', status: 'u.status', createdAt: 'u.created_at' };
const DUPLICATES = { uq_users_normalized_email: 'email', uq_users_auth_subject: 'authSubject' };

async function assertRole(tx: TxClient, roleId: string): Promise<void> {
  const res = await tx.query<{ active: boolean }>('SELECT active FROM roles WHERE id = $1', [roleId]);
  if (!res.rows[0] || !res.rows[0].active) {
    throw new AppError('VALIDATION_ERROR', 'Role not found', { roleId: 'not_found' });
  }
}

async function assertBranch(tx: TxClient, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  const res = await tx.query<{ active: boolean }>('SELECT active FROM branches WHERE id = $1', [branchId]);
  if (!res.rows[0] || !res.rows[0].active) {
    throw new AppError('VALIDATION_ERROR', 'Branch not found', { branchId: 'not_found' });
  }
}

async function loadUser(tx: TxClient, id: string, lock: boolean): Promise<UserRow> {
  const res = await tx.query<UserRow>(`${USER_SELECT} WHERE u.id = $1${lock ? ' FOR UPDATE OF u' : ''}`, [id]);
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'User not found');
  return res.rows[0];
}

const accessOf = (u: UserDto) => ({ roleId: u.roleId, roleCode: u.roleCode, branchId: u.branchId, allBranches: u.allBranches });

/** Roles (users.manage) and users (users.manage). */
export function usersRouter(): Router {
  const router = Router();

  router.get('/roles', async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const rows = await withTransaction(principal.orgId, async (tx) => {
      const r = await tx.query<RoleRow>(
        'SELECT id, code, name, permissions, app_codes, active, row_version FROM roles ORDER BY name, id',
      );
      return r.rows;
    });
    res.json({ items: rows.map(roleToDto), permissionCodes: PERMISSION_CODES, appCodes: APP_CODES });
  });

  router.get('/users', async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'u.display_name', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (query.status) add('u.status = ?', query.status);
    if (query.branchId) add('u.branch_id = ?', query.branchId);
    if (query.roleId) add('u.role_id = ?', query.roleId);
    if (query.q) add(`(u.display_name ILIKE ? ESCAPE '\\' OR u.normalized_email ILIKE ? ESCAPE '\\')`, likePattern(query.q));
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${clause}`, params);
      const rows = await tx.query<UserRow>(
        `${USER_SELECT} ${clause} ORDER BY ${sort.column} ${sort.direction}, u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(userToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<UserDto>;
    });
    res.json(body);
  });

  router.get('/users/:id', async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const id = uuidParam(req);
    const dto = userToDto(await withTransaction(principal.orgId, (tx) => loadUser(tx, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/users', requireAction('users.manage'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'users.create', ctx, async () => {
          await assertRole(tx, input.roleId);
          await assertBranch(tx, input.branchId);
          const provider = input.authSubject ? 'oidc' : 'invited';
          const subject = input.authSubject ?? `invite:${input.email}`;
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO users (org_id, role_id, branch_id, normalized_email, display_name, phone, auth_provider, auth_subject,
                                all_branches, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
            [
              principal.orgId, input.roleId, input.branchId ?? null, input.email, input.displayName, input.phone ?? null,
              provider, subject, input.allBranches ?? false, principal.userId,
            ],
          );
          const dto = userToDto(await loadUser(tx, ins.rows[0].id, false));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'user.created',
            entityType: 'user',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: { email: dto.email, status: dto.status, ...accessOf(dto) },
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, DUPLICATES, 'A user with this email already exists');
    }
    res.status(result.status).json(result.body);
  });

  const changeUser = async (
    principal: Principal,
    id: string,
    expected: number,
    change: (tx: TxClient, before: UserDto) => Promise<Record<string, unknown>>,
    audit: (before: UserDto, after: UserDto, tx: TxClient) => Promise<void>,
  ): Promise<UserDto> =>
    withTransaction(principal.orgId, async (tx) => {
      const before = userToDto(await loadUser(tx, id, true));
      if (before.rowVersion !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      const set = await change(tx, before);
      await versionedUpdate(tx, {
        table: 'users', orgId: principal.orgId, id, expectedVersion: expected,
        set: { ...set, updated_at: new Date(), updated_by: principal.userId },
      });
      const after = userToDto(await loadUser(tx, id, false));
      await audit(before, after, tx);
      return after;
    });

  router.patch('/users/:id', async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const dto = await changeUser(
      principal, id, expected,
      async (tx) => {
        if (patch.roleId !== undefined) await assertRole(tx, patch.roleId);
        if (patch.branchId !== undefined) await assertBranch(tx, patch.branchId);
        const set: Record<string, unknown> = {};
        if (patch.displayName !== undefined) set.display_name = patch.displayName;
        if (patch.phone !== undefined) set.phone = patch.phone;
        if (patch.roleId !== undefined) set.role_id = patch.roleId;
        if (patch.branchId !== undefined) set.branch_id = patch.branchId;
        if (patch.allBranches !== undefined) set.all_branches = patch.allBranches;
        return set;
      },
      async (before, after, tx) => {
        const a = accessOf(before);
        const b = accessOf(after);
        if (a.roleId !== b.roleId || a.branchId !== b.branchId || a.allBranches !== b.allBranches) {
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'user.access_changed',
            entityType: 'user',
            entityId: id,
            correlationId: req.correlationId,
            before: a,
            after: b,
          });
        }
        if (before.displayName !== after.displayName || before.phone !== after.phone) {
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'user.updated',
            entityType: 'user',
            entityId: id,
            correlationId: req.correlationId,
            before: { displayName: before.displayName, phone: before.phone },
            after: { displayName: after.displayName, phone: after.phone },
          });
        }
      },
    );
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.patch('/users/:id/status', async (req, res) => {
    const principal = principalWith(req, 'users.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = statusSchema.parse(req.body ?? {});
    if (id === principal.userId && input.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_ERROR', 'You cannot deactivate or suspend your own account', { status: 'self_change' });
    }
    const dto = await changeUser(
      principal, id, expected,
      async () => ({ status: input.status }),
      async (before, after, tx) => {
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: 'user.status_changed',
          entityType: 'user',
          entityId: id,
          correlationId: req.correlationId,
          reason: input.reason,
          before: { status: before.status },
          after: { status: after.status },
        });
      },
    );
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
