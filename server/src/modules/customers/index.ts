import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertActiveBranch, assertInScope, assertWritableBranch, branchScopeClause, loadFieldDefs } from '../shared/branchScope.js';
import { validateCustomAttributes } from '../shared/customAttributes.js';
import { decimal, nullableText, pick, text } from '../shared/fields.js';
import {
  likePattern, mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam,
  type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLACKLISTED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Entity type of custom field definitions that apply to customers. */
export const CUSTOMER_ENTITY = 'customer';

type CustomerRow = {
  id: string;
  customer_code: string;
  fleet_log_code: string | null;
  name: string;
  tax_registration_no: string | null;
  attn: string | null;
  email: string | null;
  phone: string;
  address: string;
  billing_address: string | null;
  credit_limit: string;
  credit_hold: boolean;
  status: CustomerStatus;
  branch_id: string | null;
  ani_ravali_active: boolean;
  crm_ha_reference: string | null;
  notes: string | null;
  custom_attributes: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface CustomerDto {
  id: string;
  customerCode: string;
  fleetLogCode: string | null;
  name: string;
  taxRegistrationNo: string | null;
  attn: string | null;
  email: string | null;
  phone: string;
  address: string;
  billingAddress: string | null;
  creditLimit: string;
  creditHold: boolean;
  status: CustomerStatus;
  branchId: string | null;
  aniRavaliActive: boolean;
  crmHaReference: string | null;
  notes: string | null;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS = `id, customer_code, fleet_log_code, name, tax_registration_no, attn, email, phone, address, billing_address,
  credit_limit, credit_hold, status, branch_id, ani_ravali_active, crm_ha_reference, notes, custom_attributes,
  created_at, updated_at, row_version`;

export function customerToDto(r: CustomerRow): CustomerDto {
  return {
    id: r.id,
    customerCode: r.customer_code,
    fleetLogCode: r.fleet_log_code,
    name: r.name,
    taxRegistrationNo: r.tax_registration_no,
    attn: r.attn,
    email: r.email,
    phone: r.phone,
    address: r.address,
    billingAddress: r.billing_address,
    creditLimit: r.credit_limit,
    creditHold: r.credit_hold,
    status: r.status,
    branchId: r.branch_id,
    aniRavaliActive: r.ani_ravali_active,
    crmHaReference: r.crm_ha_reference,
    notes: r.notes,
    customAttributes: r.custom_attributes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const fields = {
  customerCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/),
  fleetLogCode: z.union([z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/), z.null()]),
  name: text(200),
  taxRegistrationNo: nullableText(100),
  attn: nullableText(200),
  email: z.union([z.string().trim().toLowerCase().pipe(z.email().max(254)), z.null()]),
  phone: text(50),
  address: text(500),
  billingAddress: nullableText(500),
  creditLimit: decimal(14, 6),
  creditHold: z.boolean(),
  status: z.enum(CUSTOMER_STATUSES),
  branchId: z.union([z.uuid(), z.null()]),
  aniRavaliActive: z.boolean(),
  crmHaReference: nullableText(100),
  notes: z.union([z.string().trim().max(4000).transform((v) => (v === '' ? null : v)), z.null()]),
  customAttributes: z.record(z.string(), z.unknown()),
};

const createSchema = z
  .object({
    customerCode: fields.customerCode.optional(),
    fleetLogCode: fields.fleetLogCode.optional(),
    name: fields.name,
    taxRegistrationNo: fields.taxRegistrationNo.optional(),
    attn: fields.attn.optional(),
    email: fields.email.optional(),
    phone: fields.phone,
    address: fields.address,
    billingAddress: fields.billingAddress.optional(),
    creditLimit: fields.creditLimit.optional(),
    creditHold: fields.creditHold.optional(),
    status: fields.status.optional(),
    branchId: fields.branchId.optional(),
    aniRavaliActive: fields.aniRavaliActive.optional(),
    crmHaReference: fields.crmHaReference.optional(),
    notes: fields.notes.optional(),
    customAttributes: fields.customAttributes.optional(),
  })
  .strict();

const updateSchema = z
  .object({ ...fields, customerCode: fields.customerCode })
  .partial()
  .strict();

const listSchema = z.object({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  branchId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});

const SORTS = { name: 'lower(name)', code: 'customer_code', status: 'status', createdAt: 'created_at' };

const COLUMN_BY_FIELD: Record<string, string> = {
  fleetLogCode: 'fleet_log_code',
  name: 'name',
  taxRegistrationNo: 'tax_registration_no',
  attn: 'attn',
  email: 'email',
  phone: 'phone',
  address: 'address',
  billingAddress: 'billing_address',
  creditLimit: 'credit_limit',
  creditHold: 'credit_hold',
  status: 'status',
  branchId: 'branch_id',
  aniRavaliActive: 'ani_ravali_active',
  crmHaReference: 'crm_ha_reference',
  notes: 'notes',
};

const DUPLICATES = { uq_customers_code: 'customerCode', uq_customers_fleet_log_code: 'fleetLogCode' };
const DUPLICATE_MESSAGE = 'A customer with this code already exists';

async function loadCustomer(tx: TxClient, principal: Principal, id: string, lock: boolean): Promise<CustomerRow> {
  const res = await tx.query<CustomerRow>(`SELECT ${COLUMNS} FROM customers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Customer not found');
  assertInScope(principal, 'customers.read', row.branch_id);
  return row;
}

/** Allocates CUSTOMER numbers until one is not already used by an explicitly supplied code. */
async function nextFreeCode(tx: TxClient, orgId: string): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const code = await allocateNumber(tx, orgId, 'CUSTOMER');
    const taken = await tx.query('SELECT 1 FROM customers WHERE customer_code = $1', [code]);
    if (taken.rowCount === 0) return code;
  }
  throw new AppError('INTERNAL_ERROR', 'Could not allocate a customer code');
}

/** Customers: list/read (customers.read); create, update, archive (customers.write). */
export function customersRouter(): Router {
  const router = Router();

  router.get('/customers', async (req, res) => {
    const principal = principalWith(req, 'customers.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'lower(name)', direction: 'ASC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'branch_id', params, true);
    if (scope) where.push(scope);
    if (query.status) {
      params.push(query.status);
      where.push(`status = $${params.length}`);
    }
    if (query.branchId) {
      params.push(query.branchId);
      where.push(`branch_id = $${params.length}`);
    }
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`(name ILIKE $${params.length} ESCAPE '\\' OR customer_code ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM customers ${clause}`, params);
      const rows = await tx.query<CustomerRow>(
        `SELECT ${COLUMNS} FROM customers ${clause} ORDER BY ${sort.column} ${sort.direction}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(customerToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<CustomerDto>;
    });
    res.json(body);
  });

  router.get('/customers/:id', async (req, res) => {
    const principal = principalWith(req, 'customers.read');
    const id = uuidParam(req);
    const dto = customerToDto(await withTransaction(principal.orgId, (tx) => loadCustomer(tx, principal, id, false)));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/customers', requireAction('customers.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'customers.write');
    const input = createSchema.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'customers.create', ctx, async () => {
          assertWritableBranch(principal, 'customers.write', input.branchId ?? null);
          await assertActiveBranch(tx, input.branchId);
          const attrs = validateCustomAttributes(await loadFieldDefs(tx, CUSTOMER_ENTITY), input.customAttributes);
          const code = input.customerCode ?? (await nextFreeCode(tx, principal.orgId));
          const ins = await tx.query<CustomerRow>(
            `INSERT INTO customers (org_id, customer_code, fleet_log_code, name, tax_registration_no, attn, email, phone, address,
                                    billing_address, credit_limit, credit_hold, status, branch_id, ani_ravali_active,
                                    crm_ha_reference, notes, custom_attributes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $19)
             RETURNING ${COLUMNS}`,
            [
              principal.orgId, code, input.fleetLogCode ?? null, input.name, input.taxRegistrationNo ?? null, input.attn ?? null,
              input.email ?? null, input.phone, input.address, input.billingAddress ?? null, input.creditLimit ?? '0',
              input.creditHold ?? false, input.status ?? 'ACTIVE', input.branchId ?? null, input.aniRavaliActive ?? false,
              input.crmHaReference ?? null, input.notes ?? null, JSON.stringify(attrs), principal.userId,
            ],
          );
          const dto = customerToDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'customer.created',
            entityType: 'customer',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, DUPLICATES, DUPLICATE_MESSAGE);
    }
    res.status(result.status).json(result.body);
  });

  const applyUpdate = async (
    principal: Principal,
    id: string,
    expected: number,
    patch: z.infer<typeof updateSchema>,
    correlationId: string,
    auditAction?: string,
  ): Promise<CustomerDto> => {
    try {
      return await withTransaction(principal.orgId, async (tx) => {
        const before = customerToDto(await loadCustomer(tx, principal, id, true));
        if (before.rowVersion !== expected) {
          throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        }
        if (patch.customerCode !== undefined && patch.customerCode !== before.customerCode) {
          throw new AppError('IMMUTABLE_FIELD', 'customerCode cannot be changed', { customerCode: 'immutable' });
        }
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        const keys: string[] = [];
        for (const [field, value] of Object.entries(patch)) {
          if (field === 'customerCode' || field === 'customAttributes') continue;
          set[COLUMN_BY_FIELD[field]] = value;
          keys.push(field);
        }
        if (patch.branchId !== undefined && patch.branchId !== before.branchId) {
          assertWritableBranch(principal, 'customers.write', patch.branchId);
          await assertActiveBranch(tx, patch.branchId);
        }
        if (patch.customAttributes !== undefined) {
          set.custom_attributes = JSON.stringify(
            validateCustomAttributes(await loadFieldDefs(tx, CUSTOMER_ENTITY), patch.customAttributes),
          );
          keys.push('customAttributes');
        }
        const { row } = await versionedUpdate<CustomerRow>(tx, {
          table: 'customers', orgId: principal.orgId, id, expectedVersion: expected, set,
        });
        const after = customerToDto(row);
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId,
          action: auditAction ?? 'customer.updated',
          entityType: 'customer',
          entityId: id,
          correlationId,
          before: pick(before, keys),
          after: pick(after, keys),
        });
        return after;
      });
    } catch (err) {
      return mapUniqueViolation(err, DUPLICATES, DUPLICATE_MESSAGE);
    }
  };

  router.patch('/customers/:id', async (req, res) => {
    const principal = principalWith(req, 'customers.write');
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

  // Customers are archived (status INACTIVE), never hard-deleted: quotations, agreements, LPOs and invoices reference them.
  router.delete('/customers/:id', async (req, res) => {
    const principal = principalWith(req, 'customers.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await applyUpdate(principal, id, expected, { status: 'INACTIVE' }, req.correlationId, 'customer.archived');
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
