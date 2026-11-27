import { Decimal } from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { assertInScope, branchScopeClause } from '../shared/branchScope.js';
import { decimal, isoDate, nullableText, pick, text } from '../shared/fields.js';
import {
  mapUniqueViolation, parseQuery, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';
import { loadBooking } from './owners.js';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const AMOUNT_SCALE = 6;
const MAX_AMOUNT = new Money('1e14');

const PHASES = ['HIRE', 'COLLECTION'] as const;
type Phase = (typeof PHASES)[number];

const todayUtc = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const dateTime = z.iso.datetime({ offset: true });
const noteText = nullableText(4000);

interface ListQuery {
  page?: unknown;
  pageSize?: unknown;
  sort?: unknown;
}

/** Scope + filters for a list over a table joined to `bookings b`: branch scope plus equality filters. */
function listWhere(principal: Principal, filters: Array<[string, string | undefined]>): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = [];
  const scope = branchScopeClause(principal, 'b.branch_id', params, false);
  if (scope) where.push(scope);
  for (const [column, value] of filters) {
    if (value === undefined) continue;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function pageOf<R, D>(
  principal: Principal,
  query: ListQuery,
  spec: { columns: string; from: string; sorts: Record<string, string>; fallback: string; alias: string },
  where: { clause: string; params: unknown[] },
  toDto: (rows: R[], tx: TxClient) => Promise<D[]>,
): Promise<Page<D>> {
  const { page, pageSize, limit, offset } = parsePagination(query);
  const sort = parseSort(query.sort, spec.sorts, { column: spec.fallback, direction: 'DESC' });
  return withTransaction(principal.orgId, async (tx) => {
    const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${spec.from} ${where.clause}`, where.params);
    const rows = await tx.query<R & Record<string, unknown>>(
      `SELECT ${spec.columns} FROM ${spec.from} ${where.clause} ORDER BY ${sort.column} ${sort.direction}, ${spec.alias}.id LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`,
      [...where.params, limit, offset],
    );
    return { items: await toDto(rows.rows as R[], tx), page, pageSize, total: Number(total.rows[0].n) };
  });
}

/** Reads one row (with its booking branch) and proves it is in the Principal's branch scope; else 404. */
async function loadScoped<R extends { branch_id: string }>(
  tx: TxClient,
  principal: Principal,
  spec: { columns: string; from: string; alias: string; label: string },
  id: string,
  lock: boolean,
  action: 'documents.read' | 'documents.write',
): Promise<R> {
  const res = await tx.query<R>(
    `SELECT ${spec.columns} FROM ${spec.from} WHERE ${spec.alias}.id = $1${lock ? ` FOR UPDATE OF ${spec.alias}` : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', `${spec.label} not found`);
  assertInScope(principal, action, row.branch_id);
  return row;
}

function assertFresh(actual: number, expected: number): void {
  if (actual !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
}

function emptyPatch(patch: object): void {
  if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
}

/** Collection-scope check shared by MQD and TPS: HIRE has no collection note, COLLECTION has one of the same booking. */
async function assertScope(tx: TxClient, phase: Phase, bookingId: string, collectionNoteId: string | null | undefined): Promise<string | null> {
  if (phase === 'HIRE') {
    if (collectionNoteId) {
      throw new AppError('VALIDATION_ERROR', 'A HIRE report has no collection note', { collectionNoteId: 'not_allowed' });
    }
    return null;
  }
  if (!collectionNoteId) {
    throw new AppError('VALIDATION_ERROR', 'A COLLECTION report needs a collection note', { collectionNoteId: 'required' });
  }
  const res = await tx.query<{ booking_id: string }>('SELECT booking_id FROM collection_notes WHERE id = $1', [collectionNoteId]);
  if (!res.rows[0]) throw new AppError('VALIDATION_ERROR', 'Collection note not found', { collectionNoteId: 'not_found' });
  if (res.rows[0].booking_id !== bookingId) {
    throw new AppError('VALIDATION_ERROR', 'Collection note belongs to another booking', { collectionNoteId: 'booking_mismatch' });
  }
  return collectionNoteId;
}

async function existingReport(
  tx: TxClient, table: 'mqd_reports' | 'third_party_service_reports', bookingId: string, phase: Phase, noteId: string | null,
): Promise<string | undefined> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE booking_id = $1 AND phase = $2 AND collection_note_id IS NOT DISTINCT FROM $3`,
    [bookingId, phase, noteId],
  );
  return res.rows[0]?.id;
}

function duplicate(message: string, existingId: string): never {
  throw new AppError('DUPLICATE', message, { bookingId: 'duplicate', existingId });
}

// ---------------------------------------------------------------- Delivery notes

interface DnRow {
  id: string; number: string; booking_id: string; booking_reference: string; branch_id: string; note_date: string;
  delivery_address: string; delivered_at: Date | null; received_by_name: string | null; driver_name: string | null;
  notes: string | null; created_at: Date; updated_at: Date; row_version: string;
}

export interface DeliveryNoteDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  noteDate: string;
  deliveryAddress: string;
  deliveredAt: string | null;
  receivedByName: string | null;
  driverName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const DN_SPEC = {
  columns: `d.id, d.number, d.booking_id, b.reference AS booking_reference, b.branch_id, to_char(d.note_date, 'YYYY-MM-DD') AS note_date,
    d.delivery_address, d.delivered_at, d.received_by_name, d.driver_name, d.notes, d.created_at, d.updated_at, d.row_version`,
  from: 'delivery_notes d JOIN bookings b ON b.org_id = d.org_id AND b.id = d.booking_id',
  alias: 'd',
  label: 'Delivery note',
};

function dnToDto(r: DnRow): DeliveryNoteDto {
  return {
    id: r.id, number: r.number, bookingId: r.booking_id, bookingReference: r.booking_reference, noteDate: r.note_date,
    deliveryAddress: r.delivery_address, deliveredAt: iso(r.delivered_at), receivedByName: r.received_by_name,
    driverName: r.driver_name, notes: r.notes, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

const dnCreate = z
  .object({
    bookingId: z.uuid(),
    noteDate: isoDate.optional(),
    deliveryAddress: text(500).optional(),
    deliveredAt: z.union([dateTime, z.null()]).optional(),
    receivedByName: nullableText(200).optional(),
    driverName: nullableText(200).optional(),
    notes: noteText.optional(),
  })
  .strict();

const dnPatch = z
  .object({
    deliveredAt: z.union([dateTime, z.null()]),
    receivedByName: nullableText(200),
    driverName: nullableText(200),
    notes: noteText,
  })
  .partial()
  .strict();

const DN_COLUMN: Record<string, string> = {
  deliveredAt: 'delivered_at', receivedByName: 'received_by_name', driverName: 'driver_name', notes: 'notes',
};

const dnList = z.object({
  bookingId: z.uuid().optional(), page: z.unknown().optional(), pageSize: z.unknown().optional(), sort: z.unknown().optional(),
});

// ---------------------------------------------------------------- MQD reports

interface MqdRow {
  id: string; number: string; booking_id: string; booking_reference: string; branch_id: string; collection_note_id: string | null;
  phase: Phase; report_date: string; hirer_name: string; form_schema_version: string; fields: Record<string, unknown>;
  notes: string | null; created_at: Date; updated_at: Date; row_version: string;
}

export interface MqdReportDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  collectionNoteId: string | null;
  phase: Phase;
  reportDate: string;
  hirerName: string;
  formSchemaVersion: string;
  fields: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const MQD_SPEC = {
  columns: `m.id, m.number, m.booking_id, b.reference AS booking_reference, b.branch_id, m.collection_note_id, m.phase,
    to_char(m.report_date, 'YYYY-MM-DD') AS report_date, m.hirer_name, m.form_schema_version, m.fields, m.notes,
    m.created_at, m.updated_at, m.row_version`,
  from: 'mqd_reports m JOIN bookings b ON b.org_id = m.org_id AND b.id = m.booking_id',
  alias: 'm',
  label: 'MQD report',
};

function mqdToDto(r: MqdRow): MqdReportDto {
  return {
    id: r.id, number: r.number, bookingId: r.booking_id, bookingReference: r.booking_reference,
    collectionNoteId: r.collection_note_id, phase: r.phase, reportDate: r.report_date, hirerName: r.hirer_name,
    formSchemaVersion: r.form_schema_version, fields: r.fields, notes: r.notes, createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
  };
}

/** The questionnaire answers: a JSON object of bounded size. Its shape is owned by the versioned form schema. */
const fieldsObject = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 200_000, 'too large');

const mqdCreate = z
  .object({
    bookingId: z.uuid(),
    phase: z.enum(PHASES),
    collectionNoteId: z.union([z.uuid(), z.null()]).optional(),
    reportDate: isoDate.optional(),
    hirerName: text(200),
    formSchemaVersion: text(50),
    fields: fieldsObject,
    notes: noteText.optional(),
  })
  .strict();

const mqdPatch = z
  .object({ fields: fieldsObject, notes: noteText, hirerName: text(200), reportDate: isoDate, formSchemaVersion: text(50) })
  .partial()
  .strict();

const MQD_COLUMN: Record<string, string> = {
  fields: 'fields', notes: 'notes', hirerName: 'hirer_name', reportDate: 'report_date', formSchemaVersion: 'form_schema_version',
};

const reportList = z.object({
  bookingId: z.uuid().optional(),
  phase: z.enum(PHASES).optional(),
  collectionNoteId: z.uuid().optional(),
  page: z.unknown().optional(), pageSize: z.unknown().optional(), sort: z.unknown().optional(),
});

// ---------------------------------------------------------------- Third-party service reports

const SERVICE_TYPES = ['Transport', 'Crane', 'Escort', 'Inspection', 'Cleaning', 'Other'] as const;

interface TpsRow {
  id: string; number: string; booking_id: string; booking_reference: string; branch_id: string; collection_note_id: string | null;
  phase: Phase; currency_code: string; notes: string | null; approved_by: string | null; approved_name: string | null;
  signature_text: string | null; total_amount: string; created_at: Date; updated_at: Date; row_version: string;
}

interface TpsLineRow {
  id: string; report_id: string; line_no: number; provider: string; service_type: string; description: string;
  service_date: string; external_reference: string; quantity: string; rate: string; amount: string;
}

export interface ServiceLineDto {
  id: string;
  lineNo: number;
  provider: string;
  serviceType: (typeof SERVICE_TYPES)[number];
  description: string;
  serviceDate: string;
  externalReference: string;
  quantity: string;
  rate: string;
  amount: string;
}

export interface ServiceReportDto {
  id: string;
  number: string;
  bookingId: string;
  bookingReference: string;
  collectionNoteId: string | null;
  phase: Phase;
  currencyCode: string;
  notes: string | null;
  approvedBy: string | null;
  approvedName: string | null;
  signatureText: string | null;
  totalAmount: string;
  lines: ServiceLineDto[];
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const TPS_SPEC = {
  columns: `t.id, t.number, t.booking_id, b.reference AS booking_reference, b.branch_id, t.collection_note_id, t.phase, t.currency_code,
    t.notes, t.approved_by, t.approved_name, t.signature_text, t.total_amount, t.created_at, t.updated_at, t.row_version`,
  from: 'third_party_service_reports t JOIN bookings b ON b.org_id = t.org_id AND b.id = t.booking_id',
  alias: 't',
  label: 'Service report',
};

async function tpsToDtos(tx: TxClient, rows: TpsRow[]): Promise<ServiceReportDto[]> {
  const byReport = new Map<string, ServiceLineDto[]>();
  if (rows.length > 0) {
    const lines = await tx.query<TpsLineRow>(
      `SELECT id, report_id, line_no, provider, service_type, description, to_char(service_date, 'YYYY-MM-DD') AS service_date,
              external_reference, quantity, rate, amount
         FROM third_party_service_lines WHERE report_id = ANY($1::uuid[]) ORDER BY report_id, line_no`,
      [rows.map((r) => r.id)],
    );
    for (const l of lines.rows) {
      const list = byReport.get(l.report_id) ?? [];
      list.push({
        id: l.id, lineNo: l.line_no, provider: l.provider, serviceType: l.service_type as ServiceLineDto['serviceType'],
        description: l.description, serviceDate: l.service_date, externalReference: l.external_reference,
        quantity: l.quantity, rate: l.rate, amount: l.amount,
      });
      byReport.set(l.report_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id, number: r.number, bookingId: r.booking_id, bookingReference: r.booking_reference,
    collectionNoteId: r.collection_note_id, phase: r.phase, currencyCode: r.currency_code, notes: r.notes,
    approvedBy: r.approved_by, approvedName: r.approved_name, signatureText: r.signature_text, totalAmount: r.total_amount,
    lines: byReport.get(r.id) ?? [], createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  }));
}

const lineInput = z
  .object({
    provider: text(200),
    serviceType: z.enum(SERVICE_TYPES),
    description: text(1000),
    serviceDate: isoDate,
    externalReference: z.string().trim().max(200).default(''),
    quantity: decimal(12, 6).refine((v) => new Money(v).gt(0), 'must be positive'),
    rate: decimal(14, 6),
  })
  .strict();
type LineInput = z.infer<typeof lineInput>;

const linesInput = z.array(lineInput).max(200);

const tpsCreate = z
  .object({
    bookingId: z.uuid(),
    phase: z.enum(PHASES),
    collectionNoteId: z.union([z.uuid(), z.null()]).optional(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
    notes: noteText.optional(),
    approvedName: nullableText(200).optional(),
    signatureText: nullableText(200).optional(),
    lines: linesInput.default([]),
  })
  .strict();

const tpsPatch = z
  .object({
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    notes: noteText,
    approvedName: nullableText(200),
    signatureText: nullableText(200),
    lines: linesInput,
  })
  .partial()
  .strict();

const TPS_COLUMN: Record<string, string> = {
  currencyCode: 'currency_code', notes: 'notes', approvedName: 'approved_name', signatureText: 'signature_text',
};

/** amount = quantity x rate and total = sum of amounts, in decimal arithmetic at the column scale. The client never sends them. */
export function computeServiceLines(lines: readonly LineInput[]): { amounts: string[]; total: string } {
  let total = new Money(0);
  const amounts = lines.map((l, i) => {
    const amount = new Money(l.quantity).times(new Money(l.rate)).toDecimalPlaces(AMOUNT_SCALE);
    if (amount.gte(MAX_AMOUNT)) {
      throw new AppError('VALIDATION_ERROR', 'Line amount is too large', { [`lines.${i}.amount`]: 'too_large' });
    }
    total = total.plus(amount);
    return amount.toFixed(AMOUNT_SCALE);
  });
  if (total.gte(MAX_AMOUNT)) throw new AppError('VALIDATION_ERROR', 'Total amount is too large', { lines: 'total_too_large' });
  return { amounts, total: total.toFixed(AMOUNT_SCALE) };
}

async function replaceLines(tx: TxClient, principal: Principal, reportId: string, lines: readonly LineInput[], amounts: readonly string[]): Promise<void> {
  await tx.query('DELETE FROM third_party_service_lines WHERE report_id = $1', [reportId]);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    await tx.query(
      `INSERT INTO third_party_service_lines (org_id, report_id, line_no, provider, service_type, description, service_date,
                                              external_reference, quantity, rate, amount, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [principal.orgId, reportId, i + 1, l.provider, l.serviceType, l.description, l.serviceDate, l.externalReference,
        l.quantity, l.rate, amounts[i], principal.userId],
    );
  }
}

/** Mutable-document report endpoints: Delivery Notes, MQD reports and third-party service reports (documents.read / documents.write). */
export function reportsRouter(): Router {
  const router = Router();

  // ------------------------------------------------------------ Delivery notes
  router.get('/delivery-notes', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const query = parseQuery(req, dnList);
    res.json(
      await pageOf<DnRow, DeliveryNoteDto>(
        principal, query,
        { ...DN_SPEC, sorts: { createdAt: 'd.created_at', number: 'd.number', noteDate: 'd.note_date' }, fallback: 'd.created_at' },
        listWhere(principal, [['d.booking_id', query.bookingId]]),
        async (rows) => rows.map(dnToDto),
      ),
    );
  });

  router.get('/delivery-notes/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const id = uuidParam(req);
    const dto = dnToDto(await withTransaction(principal.orgId, (tx) => loadScoped<DnRow>(tx, principal, DN_SPEC, id, false, 'documents.read')));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  router.post('/delivery-notes', requireAction('documents.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const input = dnCreate.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'delivery_notes.create', ctx, async () => {
          const booking = await loadBooking(tx, principal, input.bookingId, 'documents.write');
          const dup = await tx.query<{ id: string }>('SELECT id FROM delivery_notes WHERE booking_id = $1', [booking.id]);
          if (dup.rows[0]) duplicate('This booking already has a delivery note', dup.rows[0].id);
          const number = await allocateNumber(tx, principal.orgId, 'DN');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO delivery_notes (org_id, number, booking_id, note_date, delivery_address, delivered_at, received_by_name,
                                         driver_name, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
            [principal.orgId, number, booking.id, input.noteDate ?? todayUtc(), input.deliveryAddress ?? booking.deliveryAddress,
              input.deliveredAt ?? null, input.receivedByName ?? null, input.driverName ?? null, input.notes ?? null, principal.userId],
          );
          const dto = dnToDto(await loadScoped<DnRow>(tx, principal, DN_SPEC, ins.rows[0].id, false, 'documents.write'));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'delivery_note.created', entityType: 'delivery_note', entityId: dto.id,
            correlationId: req.correlationId, after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, { uq_delivery_notes_booking: 'bookingId' }, 'This booking already has a delivery note');
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/delivery-notes/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = dnPatch.parse(req.body ?? {});
    emptyPatch(patch);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = dnToDto(await loadScoped<DnRow>(tx, principal, DN_SPEC, id, true, 'documents.write'));
      assertFresh(before.rowVersion, expected);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      for (const [k, v] of Object.entries(patch)) set[DN_COLUMN[k]] = v;
      await versionedUpdate(tx, { table: 'delivery_notes', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = dnToDto(await loadScoped<DnRow>(tx, principal, DN_SPEC, id, false, 'documents.write'));
      const keys = Object.keys(patch);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'delivery_note.updated', entityType: 'delivery_note', entityId: id,
        correlationId: req.correlationId, before: pick(before, keys), after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------------------------------------ MQD reports
  router.get('/mqd-reports', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const query = parseQuery(req, reportList);
    res.json(
      await pageOf<MqdRow, MqdReportDto>(
        principal, query,
        { ...MQD_SPEC, sorts: { createdAt: 'm.created_at', number: 'm.number', reportDate: 'm.report_date' }, fallback: 'm.created_at' },
        listWhere(principal, [['m.booking_id', query.bookingId], ['m.phase', query.phase], ['m.collection_note_id', query.collectionNoteId]]),
        async (rows) => rows.map(mqdToDto),
      ),
    );
  });

  router.get('/mqd-reports/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const id = uuidParam(req);
    const dto = mqdToDto(await withTransaction(principal.orgId, (tx) => loadScoped<MqdRow>(tx, principal, MQD_SPEC, id, false, 'documents.read')));
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  const mqdDuplicates = { uq_mqd_reports_scope_no_note: 'bookingId', uq_mqd_reports_scope_note: 'collectionNoteId' };
  router.post('/mqd-reports', requireAction('documents.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const input = mqdCreate.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'mqd_reports.create', ctx, async () => {
          const booking = await loadBooking(tx, principal, input.bookingId, 'documents.write');
          const noteId = await assertScope(tx, input.phase, booking.id, input.collectionNoteId);
          const dupId = await existingReport(tx, 'mqd_reports', booking.id, input.phase, noteId);
          if (dupId) duplicate('An MQD report already exists for this scope', dupId);
          const number = await allocateNumber(tx, principal.orgId, input.phase === 'HIRE' ? 'HMQD' : 'MQD');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO mqd_reports (org_id, number, booking_id, collection_note_id, phase, report_date, hirer_name,
                                      form_schema_version, fields, notes, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11) RETURNING id`,
            [principal.orgId, number, booking.id, noteId, input.phase, input.reportDate ?? todayUtc(), input.hirerName,
              input.formSchemaVersion, JSON.stringify(input.fields), input.notes ?? null, principal.userId],
          );
          const dto = mqdToDto(await loadScoped<MqdRow>(tx, principal, MQD_SPEC, ins.rows[0].id, false, 'documents.write'));
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'mqd_report.created', entityType: 'mqd_report', entityId: dto.id,
            correlationId: req.correlationId, after: { ...dto, fields: undefined },
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, mqdDuplicates, 'An MQD report already exists for this scope');
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/mqd-reports/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = mqdPatch.parse(req.body ?? {});
    emptyPatch(patch);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const before = mqdToDto(await loadScoped<MqdRow>(tx, principal, MQD_SPEC, id, true, 'documents.write'));
      assertFresh(before.rowVersion, expected);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      for (const [k, v] of Object.entries(patch)) set[MQD_COLUMN[k]] = k === 'fields' ? JSON.stringify(v) : v;
      await versionedUpdate(tx, { table: 'mqd_reports', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = mqdToDto(await loadScoped<MqdRow>(tx, principal, MQD_SPEC, id, false, 'documents.write'));
      const keys = Object.keys(patch).filter((k) => k !== 'fields');
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'mqd_report.updated', entityType: 'mqd_report', entityId: id,
        correlationId: req.correlationId,
        before: { ...pick(before, keys), fieldsChanged: patch.fields !== undefined },
        after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  // ------------------------------------------------------------ Third-party service reports
  router.get('/service-reports', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const query = parseQuery(req, reportList);
    res.json(
      await pageOf<TpsRow, ServiceReportDto>(
        principal, query,
        { ...TPS_SPEC, sorts: { createdAt: 't.created_at', number: 't.number', totalAmount: 't.total_amount' }, fallback: 't.created_at' },
        listWhere(principal, [['t.booking_id', query.bookingId], ['t.phase', query.phase], ['t.collection_note_id', query.collectionNoteId]]),
        (rows, tx) => tpsToDtos(tx, rows),
      ),
    );
  });

  router.get('/service-reports/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.read');
    const id = uuidParam(req);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const row = await loadScoped<TpsRow>(tx, principal, TPS_SPEC, id, false, 'documents.read');
      return (await tpsToDtos(tx, [row]))[0];
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  const tpsDuplicates = { uq_tps_reports_scope_no_note: 'bookingId', uq_tps_reports_scope_note: 'collectionNoteId' };
  router.post('/service-reports', requireAction('documents.write'), idempotencyMiddleware({ required: true }), async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const input = tpsCreate.parse(req.body ?? {});
    const ctx = getIdempotency(res);
    let result;
    try {
      result = await withTransaction(principal.orgId, (tx) =>
        runIdempotent(tx, principal.orgId, 'service_reports.create', ctx, async () => {
          const booking = await loadBooking(tx, principal, input.bookingId, 'documents.write');
          const noteId = await assertScope(tx, input.phase, booking.id, input.collectionNoteId);
          const dupId = await existingReport(tx, 'third_party_service_reports', booking.id, input.phase, noteId);
          if (dupId) duplicate('A service report already exists for this scope', dupId);
          const computed = computeServiceLines(input.lines);
          let currency = input.currencyCode;
          if (!currency) {
            const org = await tx.query<{ currency_code: string }>('SELECT currency_code FROM organizations WHERE id = $1', [principal.orgId]);
            currency = org.rows[0].currency_code;
          }
          const number = await allocateNumber(tx, principal.orgId, input.phase === 'HIRE' ? 'HTPS' : 'TPS');
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO third_party_service_reports (org_id, number, booking_id, collection_note_id, phase, currency_code, notes,
                                                      approved_name, signature_text, total_amount, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
            [principal.orgId, number, booking.id, noteId, input.phase, currency, input.notes ?? null, input.approvedName ?? null,
              input.signatureText ?? null, computed.total, principal.userId],
          );
          await replaceLines(tx, principal, ins.rows[0].id, input.lines, computed.amounts);
          const row = await loadScoped<TpsRow>(tx, principal, TPS_SPEC, ins.rows[0].id, false, 'documents.write');
          const dto = (await tpsToDtos(tx, [row]))[0];
          await recordAudit(tx, principal.orgId, {
            actorUserId: principal.userId, action: 'service_report.created', entityType: 'service_report', entityId: dto.id,
            correlationId: req.correlationId, after: dto,
          });
          return { status: 201, body: dto };
        }),
      );
    } catch (err) {
      mapUniqueViolation(err, tpsDuplicates, 'A service report already exists for this scope');
    }
    res.status(result.status).json(result.body);
  });

  router.patch('/service-reports/:id', async (req, res) => {
    const principal = principalWith(req, 'documents.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = tpsPatch.parse(req.body ?? {});
    emptyPatch(patch);
    const dto = await withTransaction(principal.orgId, async (tx) => {
      const beforeRow = await loadScoped<TpsRow>(tx, principal, TPS_SPEC, id, true, 'documents.write');
      const before = (await tpsToDtos(tx, [beforeRow]))[0];
      assertFresh(before.rowVersion, expected);
      const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
      for (const [k, v] of Object.entries(patch)) if (k !== 'lines') set[TPS_COLUMN[k]] = v;
      if (patch.lines !== undefined) {
        const computed = computeServiceLines(patch.lines);
        set.total_amount = computed.total;
        await replaceLines(tx, principal, id, patch.lines, computed.amounts);
      }
      await versionedUpdate(tx, { table: 'third_party_service_reports', orgId: principal.orgId, id, expectedVersion: expected, set });
      const after = (await tpsToDtos(tx, [await loadScoped<TpsRow>(tx, principal, TPS_SPEC, id, false, 'documents.write')]))[0];
      const keys = [...Object.keys(patch), ...(patch.lines === undefined ? [] : ['totalAmount'])];
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'service_report.updated', entityType: 'service_report', entityId: id,
        correlationId: req.correlationId, before: pick(before, keys), after: pick(after, keys),
      });
      return after;
    });
    setVersionHeader(res, dto.rowVersion);
    res.json(dto);
  });

  return router;
}
