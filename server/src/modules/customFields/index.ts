import { Router } from 'express';
import { z } from 'zod';
import { isAppCode } from '../../constants/appCatalog.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from '../shared/customAttributes.js';
import {
  mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';

type FieldRow = {
  id: string;
  app_code: string;
  entity_type: string;
  field_key: string;
  label: string;
  field_type: CustomFieldType;
  required: boolean;
  options: string[];
  display_order: number;
  system_field: boolean;
  in_table: boolean;
  filterable: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  row_version: string;
}

export interface CustomFieldDto {
  id: string;
  appCode: string;
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[];
  displayOrder: number;
  systemField: boolean;
  inTable: boolean;
  filterable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const COLUMNS =
  'id, app_code, entity_type, field_key, label, field_type, required, options, display_order, system_field, in_table, filterable, active, created_at, updated_at, row_version';

function toDto(r: FieldRow): CustomFieldDto {
  return {
    id: r.id,
    appCode: r.app_code,
    entityType: r.entity_type,
    fieldKey: r.field_key,
    label: r.label,
    fieldType: r.field_type,
    required: r.required,
    options: r.options,
    displayOrder: r.display_order,
    systemField: r.system_field,
    inTable: r.in_table,
    filterable: r.filterable,
    active: r.active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const appCode = z.string().refine(isAppCode, 'unknown app');
const fieldType = z.enum(CUSTOM_FIELD_TYPES);
const options = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .refine((a) => new Set(a).size === a.length, 'duplicate options');

const createSchema = z
  .object({
    appCode,
    entityType: z.string().regex(IDENTIFIER),
    fieldKey: z.string().regex(IDENTIFIER),
    label: z.string().trim().min(1).max(100),
    fieldType,
    required: z.boolean().optional(),
    options: options.optional(),
    displayOrder: z.number().int().min(0).max(10_000).optional(),
    inTable: z.boolean().optional(),
    filterable: z.boolean().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    // Identity of the definition: accepted only when unchanged, so clients can round-trip a full DTO.
    appCode: z.string(),
    entityType: z.string(),
    fieldKey: z.string(),
    label: z.string().trim().min(1).max(100),
    fieldType,
    required: z.boolean(),
    options,
    displayOrder: z.number().int().min(0).max(10_000),
    inTable: z.boolean(),
    filterable: z.boolean(),
    active: z.boolean(),
  })
  .partial();

const listSchema = z.object({
  appCode: z.string().optional(),
  entityType: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
});

const DUPLICATE = { uq_custom_field_definitions_key: 'fieldKey' };

/** SELECT fields need options; every other type must have none. */
function assertOptionsMatchType(type: CustomFieldType, opts: readonly string[]): void {
  if (type === 'SELECT' && opts.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'SELECT fields need at least one option', { options: 'required' });
  }
  if (type !== 'SELECT' && opts.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Only SELECT fields have options', { options: 'not_allowed' });
  }
}

async function loadField(tx: TxClient, id: string): Promise<FieldRow> {
  const res = await tx.query<FieldRow>(`SELECT ${COLUMNS} FROM custom_field_definitions WHERE id = $1 FOR UPDATE`, [id]);
  if (!res.rows[0]) throw new AppError('NOT_FOUND', 'Custom field not found');
  return res.rows[0];
}

/** Custom field definitions: list (company.read); create, update, deactivate (settings.manage). */
export function customFieldsRouter(): Router {
  const router = Router();

  router.get('/custom-fields', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const query = parseQuery(req, listSchema);
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.appCode) { params.push(query.appCode); where.push(`app_code = $${params.length}`); }
    if (query.entityType) { params.push(query.entityType); where.push(`entity_type = $${params.length}`); }
    if (query.active) { params.push(query.active === 'true'); where.push(`active = $${params.length}`); }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await withTransaction(principal.orgId, async (tx) => {
      const r = await tx.query<FieldRow>(
        `SELECT ${COLUMNS} FROM custom_field_definitions ${clause} ORDER BY app_code, entity_type, display_order, field_key`,
        params,
      );
      return r.rows;
    });
    res.json({ items: rows.map(toDto), fieldTypes: CUSTOM_FIELD_TYPES });
  });

  router.get('/custom-fields/:id', async (req, res) => {
    const principal = principalWith(req, 'company.read');
    const id = uuidParam(req);
    const row = await withTransaction(principal.orgId, async (tx) => {
      const r = await tx.query<FieldRow>(`SELECT ${COLUMNS} FROM custom_field_definitions WHERE id = $1`, [id]);
      return r.rows[0];
    });
    if (!row) throw new AppError('NOT_FOUND', 'Custom field not found');
    const dto = toDto(row);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/custom-fields', requireAction('settings.manage'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const input = createSchema.parse(req.body ?? {});
    const opts = input.options ?? [];
    assertOptionsMatchType(input.fieldType, opts);
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'custom_fields.create', ctx, async () => {
          // system_field is never client-settable: custom fields created through the API are not system fields.
          const ins = await tx.query<FieldRow>(
            `INSERT INTO custom_field_definitions
               (org_id, app_code, entity_type, field_key, label, field_type, required, options, display_order,
                system_field, in_table, filterable, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, false, $10, $11, $12, $12)
             RETURNING ${COLUMNS}`,
            [
              principal.orgId, input.appCode, input.entityType, input.fieldKey, input.label, input.fieldType,
              input.required ?? false, JSON.stringify(opts), input.displayOrder ?? 0, input.inTable ?? true,
              input.filterable ?? false, principal.userId,
            ],
          );
          const dto = toDto(ins.rows[0]);
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId,
            action: 'custom_field.created',
            entityType: 'custom_field_definition',
            entityId: dto.id,
            correlationId: req.correlationId,
            after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, DUPLICATE, 'A field with this key already exists for this app and entity type');
    }
    res.status(result.status).json(result.body);
  });

  const change = async (
    orgId: string,
    userId: string,
    id: string,
    expected: number,
    correlationId: string,
    patch: z.infer<typeof updateSchema>,
  ): Promise<CustomFieldDto> =>
    withTransaction(orgId, async (tx) => {
      const row = await loadField(tx, id);
      if (Number(row.row_version) !== expected) {
        throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      }
      const before = toDto(row);
      if (
        (patch.appCode !== undefined && patch.appCode !== before.appCode) ||
        (patch.entityType !== undefined && patch.entityType !== before.entityType) ||
        (patch.fieldKey !== undefined && patch.fieldKey !== before.fieldKey)
      ) {
        throw new AppError('IMMUTABLE_FIELD', 'appCode, entityType and fieldKey cannot be changed', {
          fieldKey: 'immutable',
        });
      }
      if (before.systemField) {
        if (patch.fieldType !== undefined && patch.fieldType !== before.fieldType) {
          throw new AppError('VALIDATION_ERROR', 'The type of a system field cannot be changed', { fieldType: 'system_field' });
        }
        if (patch.active === false) {
          throw new AppError('VALIDATION_ERROR', 'A system field cannot be deleted or deactivated', { active: 'system_field' });
        }
      }
      const type = patch.fieldType ?? before.fieldType;
      const opts = patch.options ?? (type === before.fieldType ? before.options : []);
      assertOptionsMatchType(type, opts);

      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: userId };
      const diff: Record<string, [unknown, unknown]> = {};
      const apply = (field: keyof CustomFieldDto, column: string, value: unknown, dbValue: unknown = value): void => {
        if (value === undefined || JSON.stringify(value) === JSON.stringify(before[field])) return;
        set[column] = dbValue;
        diff[field] = [before[field], value];
      };
      apply('label', 'label', patch.label);
      apply('fieldType', 'field_type', patch.fieldType);
      apply('required', 'required', patch.required);
      apply('options', 'options', opts, JSON.stringify(opts));
      apply('displayOrder', 'display_order', patch.displayOrder);
      apply('inTable', 'in_table', patch.inTable);
      apply('filterable', 'filterable', patch.filterable);
      apply('active', 'active', patch.active);

      const { row: updated } = await versionedUpdate<FieldRow>(tx, {
        table: 'custom_field_definitions', orgId, id, expectedVersion: expected, set,
      });
      const after = toDto(updated);
      const action =
        patch.active === false && before.active ? 'custom_field.deactivated' : patch.active === true && !before.active ? 'custom_field.activated' : 'custom_field.updated';
      await recordAudit(tx, orgId, {
        actorUserId: userId,
        action,
        entityType: 'custom_field_definition',
        entityId: id,
        correlationId,
        before: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v[0]])),
        after: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v[1]])),
      });
      return after;
    });

  router.patch('/custom-fields/:id', async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    }
    const dto = await change(principal.orgId, principal.userId, id, expected, req.correlationId, patch);
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // Definitions are deactivated, never deleted, so stored custom_attributes keep their meaning.
  router.delete('/custom-fields/:id', async (req, res) => {
    const principal = principalWith(req, 'settings.manage');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const dto = await change(principal.orgId, principal.userId, id, expected, req.correlationId, { active: false });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
