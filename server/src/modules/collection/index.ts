import { Router } from 'express';
import { z } from 'zod';
import type { Principal } from '../../auth/principal.js';
import { withTransaction, type TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { recordAudit } from '../shared/audit.js';
import { BOOKING_OWNER_SQL } from '../bookings/model.js';
import { ownRecordsOnly } from '../quotations/index.js';
import { assertInScope, branchScopeClause } from '../shared/branchScope.js';
import { nullableText, pick } from '../shared/fields.js';
import {
  likePattern, parseQuery, pgError, principalWith, requireAction, setVersionHeader, uuidParam, type Page,
} from '../shared/http.js';
import { getIdempotency, idempotencyMiddleware, runIdempotent } from '../shared/idempotency.js';
import { allocateNumber } from '../shared/numberAllocator.js';
import { parsePagination, parseSort } from '../shared/pagination.js';
import { parseIfMatch, versionedUpdate } from '../shared/rowVersion.js';
import { JOB_COLUMNS, transportJobToDto, type JobRow, type TransportJobDto } from '../transport/index.js';

export const MQD_COLLECTION_SCHEMA_VERSION = 'collection-mqd-v1';
const NOTE_STATUSES = ['Draft', 'Scheduled', 'Picked Up', 'Collected', 'Closed', 'Cancelled'] as const;
type NoteStatus = (typeof NOTE_STATUSES)[number];
/** Statuses in which the note's address, driver, vehicle, schedule, remarks and invoice may still change. */
const EDITABLE: readonly NoteStatus[] = ['Draft', 'Scheduled', 'Picked Up'];

// ---------------------------------------------------------------------------------------------------------
// Rows and DTOs
// ---------------------------------------------------------------------------------------------------------

interface NoteRow {
  id: string; number: string; booking_id: string; machine_id: string; branch_id: string; related_invoice_id: string | null;
  note_date: string; collection_address: string; driver_name: string; vehicle_text: string; status: NoteStatus;
  scheduled_collection_at: Date | null; picked_up_at: Date | null; collected_movement_id: string | null;
  collected_at: Date | null; closed_at: Date | null; remarks: string | null; created_at: Date; updated_at: Date; row_version: string;
}
export interface CollectionNoteDto {
  id: string; number: string; bookingId: string; machineId: string; branchId: string; relatedInvoiceId: string | null;
  noteDate: string; collectionAddress: string; driverName: string; vehicleText: string; status: NoteStatus;
  scheduledCollectionAt: string | null; pickedUpAt: string | null; collectedMovementId: string | null;
  collectedAt: string | null; closedAt: string | null; remarks: string | null; createdAt: string; updatedAt: string; rowVersion: number;
}
const NOTE_COLUMNS = `cn.id, cn.number, cn.booking_id, cn.machine_id, b.branch_id, cn.related_invoice_id,
  to_char(cn.note_date, 'YYYY-MM-DD') AS note_date, cn.collection_address, cn.driver_name, cn.vehicle_text, cn.status,
  cn.scheduled_collection_at, cn.picked_up_at, cn.collected_movement_id, cn.collected_at, cn.closed_at, cn.remarks,
  cn.created_at, cn.updated_at, cn.row_version`;
const NOTE_FROM = 'collection_notes cn JOIN bookings b ON b.org_id = cn.org_id AND b.id = cn.booking_id';
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
export function collectionNoteToDto(r: NoteRow): CollectionNoteDto {
  return {
    id: r.id, number: r.number, bookingId: r.booking_id, machineId: r.machine_id, branchId: r.branch_id,
    relatedInvoiceId: r.related_invoice_id, noteDate: r.note_date, collectionAddress: r.collection_address,
    driverName: r.driver_name, vehicleText: r.vehicle_text, status: r.status, scheduledCollectionAt: iso(r.scheduled_collection_at),
    pickedUpAt: iso(r.picked_up_at), collectedMovementId: r.collected_movement_id, collectedAt: iso(r.collected_at),
    closedAt: iso(r.closed_at), remarks: r.remarks, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    rowVersion: Number(r.row_version),
  };
}

interface MqdRow {
  id: string; number: string; booking_id: string; collection_note_id: string; phase: string; report_date: string;
  hirer_name: string; form_schema_version: string; fields: Record<string, unknown>; notes: string | null;
  created_at: Date; updated_at: Date; row_version: string;
}
export interface MqdReportDto {
  id: string; number: string; bookingId: string; collectionNoteId: string; phase: string; reportDate: string;
  hirerName: string; formSchemaVersion: string; fields: Record<string, unknown>; notes: string | null;
  createdAt: string; updatedAt: string; rowVersion: number;
}
const MQD_COLUMNS = `id, number, booking_id, collection_note_id, phase, to_char(report_date, 'YYYY-MM-DD') AS report_date, hirer_name,
  form_schema_version, fields, notes, created_at, updated_at, row_version`;
const mqdToDto = (r: MqdRow): MqdReportDto => ({
  id: r.id, number: r.number, bookingId: r.booking_id, collectionNoteId: r.collection_note_id, phase: r.phase, reportDate: r.report_date,
  hirerName: r.hirer_name, formSchemaVersion: r.form_schema_version, fields: r.fields, notes: r.notes,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
});

interface TpsRow {
  id: string; number: string; booking_id: string; collection_note_id: string; phase: string; currency_code: string;
  notes: string | null; approved_by: string | null; approved_name: string | null; signature_text: string | null;
  total_amount: string; created_at: Date; updated_at: Date; row_version: string;
}
export interface ServiceReportDto {
  id: string; number: string; bookingId: string; collectionNoteId: string; phase: string; currencyCode: string;
  notes: string | null; approvedBy: string | null; approvedName: string | null; signatureText: string | null;
  totalAmount: string; createdAt: string; updatedAt: string; rowVersion: number;
}
const TPS_COLUMNS = `id, number, booking_id, collection_note_id, phase, currency_code, notes, approved_by, approved_name,
  signature_text, total_amount, created_at, updated_at, row_version`;
const tpsToDto = (r: TpsRow): ServiceReportDto => ({
  id: r.id, number: r.number, bookingId: r.booking_id, collectionNoteId: r.collection_note_id, phase: r.phase,
  currencyCode: r.currency_code, notes: r.notes, approvedBy: r.approved_by, approvedName: r.approved_name,
  signatureText: r.signature_text, totalAmount: r.total_amount, createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(), rowVersion: Number(r.row_version),
});

export interface CollectionBundleDto {
  collectionNote: CollectionNoteDto;
  mqdReport: MqdReportDto | null;
  serviceReport: ServiceReportDto | null;
  transportJob: TransportJobDto | null;
}

// ---------------------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------------------

const dateTime = z.iso.datetime({ offset: true });
const initiateSchema = z
  .object({
    scheduledCollectionAt: dateTime.optional(),
    collectionAddress: z.string().trim().min(1).max(500).optional(),
    driverId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    driverName: z.string().trim().max(200).optional(),
    vehicleText: z.string().trim().max(200).optional(),
    relatedInvoiceId: z.uuid().optional(),
    remarks: nullableText(4000).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    collectionAddress: z.string().trim().min(1).max(500),
    driverId: z.union([z.uuid(), z.null()]),
    vehicleId: z.union([z.uuid(), z.null()]),
    driverName: z.string().trim().max(200),
    vehicleText: z.string().trim().max(200),
    scheduledCollectionAt: z.union([dateTime, z.null()]),
    remarks: nullableText(4000),
    relatedInvoiceId: z.union([z.uuid(), z.null()]),
  })
  .partial()
  .strict();

const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

const listSchema = z.object({
  bookingId: z.uuid().optional(),
  machineId: z.uuid().optional(),
  status: z.enum(NOTE_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
  sort: z.unknown().optional(),
});
const SORTS = { createdAt: 'cn.created_at', number: 'cn.number', noteDate: 'cn.note_date', status: 'cn.status' };

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

async function loadNote(
  tx: TxClient,
  principal: Principal,
  id: string,
  opts: { lock?: boolean; action?: 'collection.read' | 'collection.write' } = {},
): Promise<NoteRow> {
  // FOR UPDATE OF cn locks only the note, not the booking it is joined to.
  const res = await tx.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM ${NOTE_FROM} WHERE cn.id = $1${opts.lock ? ' FOR UPDATE OF cn' : ''}`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Collection note not found');
  assertInScope(principal, opts.action ?? 'collection.read', row.branch_id);
  if (ownRecordsOnly(principal)) {
    const own = await tx.query<{ owner: string | null }>(`SELECT ${BOOKING_OWNER_SQL} AS owner FROM ${NOTE_FROM} WHERE cn.id = $1`, [id]);
    if (own.rows[0]?.owner !== principal.userId) throw new AppError('NOT_FOUND', 'Collection note not found');
  }
  return row;
}

async function loadBundle(tx: TxClient, note: NoteRow): Promise<CollectionBundleDto> {
  // Sequential: one transaction client runs one query at a time.
  const mqd = await tx.query<MqdRow>(`SELECT ${MQD_COLUMNS} FROM mqd_reports WHERE collection_note_id = $1 AND phase = 'COLLECTION'`, [note.id]);
  const tps = await tx.query<TpsRow>(`SELECT ${TPS_COLUMNS} FROM third_party_service_reports WHERE collection_note_id = $1 AND phase = 'COLLECTION'`, [note.id]);
  const job = await tx.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM transport_jobs WHERE collection_note_id = $1 ORDER BY created_at LIMIT 1`, [note.id]);
  return {
    collectionNote: collectionNoteToDto(note),
    mqdReport: mqd.rows[0] ? mqdToDto(mqd.rows[0]) : null,
    serviceReport: tps.rows[0] ? tpsToDto(tps.rows[0]) : null,
    transportJob: job.rows[0] ? transportJobToDto(job.rows[0]) : null,
  };
}

/** The invoice, when given, must be an invoice of the booking's agreement quotation. It is never required. */
async function assertInvoiceOfBooking(tx: TxClient, bookingId: string, invoiceId: string | null | undefined): Promise<void> {
  if (!invoiceId) return;
  const res = await tx.query(
    `SELECT 1 FROM bookings b
       JOIN hire_agreements h ON h.org_id = b.org_id AND h.id = b.hire_agreement_id
       JOIN invoices i ON i.org_id = h.org_id AND i.quotation_id = h.quotation_id
      WHERE b.id = $1 AND i.id = $2`,
    [bookingId, invoiceId],
  );
  if (res.rowCount === 0) {
    throw new AppError('BUSINESS_RULE', 'The invoice does not belong to the booking quotation', { relatedInvoiceId: 'not_booking_invoice' });
  }
}

function mapInvoiceViolation(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === '23514' && (constraint === undefined || constraint === 'trg_collection_notes_invoice')) {
    throw new AppError('BUSINESS_RULE', 'The invoice does not belong to the booking quotation', { relatedInvoiceId: 'not_booking_invoice' });
  }
  throw err;
}

async function driverName(tx: TxClient, principal: Principal, driverId: string): Promise<string> {
  const res = await tx.query<{ name: string; branch_id: string }>('SELECT name, branch_id FROM drivers WHERE id = $1', [driverId]);
  const row = res.rows[0];
  if (!row || (!principal.allBranches && row.branch_id !== principal.branchId)) {
    throw new AppError('VALIDATION_ERROR', 'Driver not found', { driverId: 'not_found' });
  }
  return row.name;
}

async function vehicleRegistration(tx: TxClient, principal: Principal, vehicleId: string): Promise<string> {
  const res = await tx.query<{ registration_no: string; branch_id: string }>(
    'SELECT registration_no, branch_id FROM transport_vehicles WHERE id = $1', [vehicleId],
  );
  const row = res.rows[0];
  if (!row || (!principal.allBranches && row.branch_id !== principal.branchId)) {
    throw new AppError('VALIDATION_ERROR', 'Vehicle not found', { vehicleId: 'not_found' });
  }
  return row.registration_no;
}

interface BookingLock {
  id: string; reference: string; branch_id: string; machine_id: string; customer_id: string; status: string;
  departed_at: Date | null; returned_at: Date | null; delivery_address: string; contact_phone: string;
  off_hire_requested_at: Date | null; hire_agreement_id: string | null;
}

// ---------------------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------------------

/** Collection initiation and collection notes. Read: collection.read. Write: collection.write. */
export function collectionRouter(): Router {
  const router = Router();

  router.post(
    '/bookings/:id/collection',
    requireAction('collection.write'),
    idempotencyMiddleware({ required: true }),
    async (req, res) => {
      const principal = principalWith(req, 'collection.write');
      const bookingId = uuidParam(req);
      const input = initiateSchema.parse(req.body ?? {});
      const ctx = getIdempotency(res);
      let result;
      try {
        result = await withTransaction(principal.orgId, (tx) =>
          runIdempotent(tx, principal.orgId, 'collection.initiate', ctx, async () => {
            const lock = await tx.query<BookingLock>(
              `SELECT id, reference, branch_id, machine_id, customer_id, status, departed_at, returned_at, delivery_address,
                      contact_phone, off_hire_requested_at, hire_agreement_id
                 FROM bookings WHERE id = $1 FOR UPDATE`,
              [bookingId],
            );
            const booking = lock.rows[0];
            if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
            assertInScope(principal, 'collection.write', booking.branch_id);

            // Repeat initiation: the open note and its documents are returned, nothing new is created.
            const open = await tx.query<NoteRow>(
              `SELECT ${NOTE_COLUMNS} FROM ${NOTE_FROM}
                WHERE cn.booking_id = $1 AND cn.status NOT IN ('Closed', 'Cancelled') ORDER BY cn.created_at LIMIT 1`,
              [bookingId],
            );
            if (open.rows[0]) return { status: 200, body: await loadBundle(tx, open.rows[0]) };

            if (booking.status !== 'On Hire' || !booking.departed_at || booking.returned_at) {
              throw new AppError('BUSINESS_RULE', 'Collection can only be initiated for a booking that is On Hire', { bookingId: 'not_on_hire' });
            }
            await assertInvoiceOfBooking(tx, bookingId, input.relatedInvoiceId);
            const driver = input.driverId ? await driverName(tx, principal, input.driverId) : undefined;
            const vehicle = input.vehicleId ? await vehicleRegistration(tx, principal, input.vehicleId) : undefined;

            const ctxRes = await tx.query<{
              fleet_no: string; asset_no: string; serial_no: string; make: string; model: string; customer_name: string;
              agreement_no: string | null; quotation_id: string | null; quotation_no: string | null; sales_name: string | null;
              branch_name: string; branch_address: string; currency_code: string; today: string; hour: number; schedule_date: string;
            }>(
              `SELECT m.fleet_no, m.asset_no, m.serial_no, mm.make, mm.model, c.name AS customer_name, h.agreement_no,
                      h.quotation_id, q.quotation_no, u.display_name AS sales_name, br.name AS branch_name, br.address AS branch_address,
                      o.currency_code,
                      to_char(now() AT TIME ZONE o.timezone, 'YYYY-MM-DD') AS today,
                      extract(hour FROM coalesce($6::timestamptz, now()) AT TIME ZONE o.timezone)::int AS hour,
                      to_char(coalesce($6::timestamptz, now()) AT TIME ZONE o.timezone, 'YYYY-MM-DD') AS schedule_date
                 FROM machines m
                 JOIN machine_models mm ON mm.org_id = m.org_id AND mm.id = m.model_id
                 JOIN customers c ON c.id = $2
                 JOIN branches br ON br.id = $4
                 JOIN organizations o ON o.id = $5
                 LEFT JOIN hire_agreements h ON h.id = $3
                 LEFT JOIN quotations q ON q.id = h.quotation_id
                 LEFT JOIN users u ON u.id = q.sales_user_id
                WHERE m.id = $1`,
              [booking.machine_id, booking.customer_id, booking.hire_agreement_id, booking.branch_id, principal.orgId, input.scheduledCollectionAt ?? null],
            );
            const c = ctxRes.rows[0];
            if (!c) throw new AppError('INTERNAL_ERROR', 'Booking context could not be loaded');

            const address = input.collectionAddress ?? booking.delivery_address;
            const driverText = input.driverName ?? driver ?? '';
            const vehicleText = input.vehicleText ?? vehicle ?? '';
            const status: NoteStatus = input.scheduledCollectionAt ? 'Scheduled' : 'Draft';

            const cnNumber = await allocateNumber(tx, principal.orgId, 'CN');
            const noteIns = await tx.query<{ id: string }>(
              `INSERT INTO collection_notes (org_id, number, booking_id, machine_id, related_invoice_id, note_date, collection_address,
                                             driver_name, vehicle_text, status, scheduled_collection_at, remarks, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
              [principal.orgId, cnNumber, bookingId, booking.machine_id, input.relatedInvoiceId ?? null, c.today, address, driverText,
                vehicleText, status, input.scheduledCollectionAt ?? null, input.remarks ?? null, principal.userId],
            );
            const noteId = noteIns.rows[0].id;

            const mqdNumber = await allocateNumber(tx, principal.orgId, 'MQD');
            const mqdFields = {
              collectionNoteNumber: cnNumber,
              bookingReference: booking.reference,
              fleetNo: c.fleet_no,
              assetNo: c.asset_no,
              serialNo: c.serial_no,
              machineDescription: `${c.make} ${c.model}`,
              customerName: c.customer_name,
              hireAgreementNo: c.agreement_no,
              quotationNo: c.quotation_no,
              site: address,
            };
            await tx.query(
              `INSERT INTO mqd_reports (org_id, number, booking_id, collection_note_id, phase, report_date, hirer_name,
                                        form_schema_version, fields, created_by, updated_by)
               VALUES ($1, $2, $3, $4, 'COLLECTION', $5, $6, $7, $8::jsonb, $9, $9)`,
              [principal.orgId, mqdNumber, bookingId, noteId, c.today, c.customer_name, MQD_COLLECTION_SCHEMA_VERSION,
                JSON.stringify(mqdFields), principal.userId],
            );

            const tpsNumber = await allocateNumber(tx, principal.orgId, 'TPS');
            await tx.query(
              `INSERT INTO third_party_service_reports (org_id, number, booking_id, collection_note_id, phase, currency_code, created_by, updated_by)
               VALUES ($1, $2, $3, $4, 'COLLECTION', $5, $6, $6)`,
              [principal.orgId, tpsNumber, bookingId, noteId, c.currency_code, principal.userId],
            );

            const jobRef = await allocateNumber(tx, principal.orgId, 'TRANSPORT');
            const serial = await tx.query<{ n: string }>(
              'SELECT count(*) AS n FROM transport_jobs WHERE schedule_date = $1::date AND shift = $2',
              [c.schedule_date, c.hour < 12 ? 'Morning' : 'Evening'],
            );
            await tx.query(
              `INSERT INTO transport_jobs (org_id, reference, branch_id, machine_id, booking_id, quotation_id, collection_note_id,
                  driver_id, vehicle_id, planner_name, schedule_date, shift, transport_team, schedule_serial, fleet_no_snapshot,
                  origin, destination, transport_text, type_code, contact_text, salesperson_code, client_text, scheduled_at,
                  status, currency_code, auto_generated, source_key, remarks, created_by, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,'Collection',$13,$14,$15,$16,'Collection','O',$17,$18,$19,
                       coalesce($20::timestamptz, now()),'Scheduled',$21,true,$22,$23,$24,$24)`,
              [
                principal.orgId, jobRef, booking.branch_id, booking.machine_id, bookingId, c.quotation_id, noteId,
                input.driverId ?? null, input.vehicleId ?? null, principal.displayName, c.schedule_date,
                c.hour < 12 ? 'Morning' : 'Evening', Math.min(Number(serial.rows[0].n) + 1, 9999), c.fleet_no, address,
                c.branch_name, booking.contact_phone, c.sales_name ?? 'N/A', c.customer_name,
                input.scheduledCollectionAt ?? null, c.currency_code, `collection:${noteId}`, input.remarks ?? null, principal.userId,
              ],
            );

            if (!booking.off_hire_requested_at) {
              await tx.query(
                `UPDATE bookings SET off_hire_requested_at = now(), updated_at = now(), updated_by = $2, row_version = row_version + 1
                  WHERE id = $1 AND off_hire_requested_at IS NULL`,
                [bookingId, principal.userId],
              );
            }

            const note = await loadNote(tx, principal, noteId, { action: 'collection.write' });
            const bundle = await loadBundle(tx, note);
            await recordAudit(tx, principal.orgId, {
              actorUserId: principal.userId, action: 'collection.initiated', entityType: 'collection_note', entityId: noteId,
              correlationId: req.correlationId,
              after: {
                collectionNote: bundle.collectionNote, mqdReportId: bundle.mqdReport?.id, serviceReportId: bundle.serviceReport?.id,
                transportJobId: bundle.transportJob?.id,
              },
            });
            return { status: 201, body: bundle };
          }),
        );
      } catch (err) {
        mapInvoiceViolation(err);
      }
      res.status(result.status).json(result.body);
    },
  );

  router.get('/collection-notes', async (req, res) => {
    const principal = principalWith(req, 'collection.read');
    const query = parseQuery(req, listSchema);
    const { page, pageSize, limit, offset } = parsePagination(query as { page?: unknown; pageSize?: unknown });
    const sort = parseSort(query.sort, SORTS, { column: 'cn.created_at', direction: 'DESC' });
    const where: string[] = [];
    const params: unknown[] = [];
    const scope = branchScopeClause(principal, 'b.branch_id', params, false);
    if (scope) where.push(scope);
    if (ownRecordsOnly(principal)) {
      params.push(principal.userId);
      where.push(`(${BOOKING_OWNER_SQL}) = $${params.length}`);
    }
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    eq('cn.booking_id', query.bookingId);
    eq('cn.machine_id', query.machineId);
    eq('cn.status', query.status);
    if (query.q) {
      params.push(likePattern(query.q));
      where.push(`cn.number ILIKE $${params.length} ESCAPE '\\'`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const body = await withTransaction(principal.orgId, async (tx) => {
      const total = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${NOTE_FROM} ${clause}`, params);
      const rows = await tx.query<NoteRow>(
        `SELECT ${NOTE_COLUMNS} FROM ${NOTE_FROM} ${clause} ORDER BY ${sort.column} ${sort.direction}, cn.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { items: rows.rows.map(collectionNoteToDto), page, pageSize, total: Number(total.rows[0].n) } satisfies Page<CollectionNoteDto>;
    });
    res.json(body);
  });

  router.get('/collection-notes/:id', async (req, res) => {
    const principal = principalWith(req, 'collection.read');
    const id = uuidParam(req);
    const bundle = await withTransaction(principal.orgId, async (tx) => loadBundle(tx, await loadNote(tx, principal, id)));
    setVersionHeader(res, bundle.collectionNote.rowVersion);
    res.json(bundle);
  });

  router.patch('/collection-notes/:id', async (req, res) => {
    const principal = principalWith(req, 'collection.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const patch = updateSchema.parse(req.body ?? {});
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR', 'No fields to update', { body: 'empty' });
    let bundle: CollectionBundleDto;
    try {
      bundle = await withTransaction(principal.orgId, async (tx) => {
        const beforeRow = await loadNote(tx, principal, id, { lock: true, action: 'collection.write' });
        const before = collectionNoteToDto(beforeRow);
        if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
        if (!EDITABLE.includes(before.status)) {
          throw new AppError('BUSINESS_RULE', `A ${before.status.toLowerCase()} collection note cannot be edited`, { status: 'not_editable' });
        }
        if (patch.relatedInvoiceId !== undefined) await assertInvoiceOfBooking(tx, before.bookingId, patch.relatedInvoiceId);
        const set: Record<string, unknown> = { updated_at: new Date(), updated_by: principal.userId };
        if (patch.collectionAddress !== undefined) set.collection_address = patch.collectionAddress;
        if (patch.remarks !== undefined) set.remarks = patch.remarks;
        if (patch.relatedInvoiceId !== undefined) set.related_invoice_id = patch.relatedInvoiceId;
        if (patch.driverName !== undefined) set.driver_name = patch.driverName;
        else if (patch.driverId) set.driver_name = await driverName(tx, principal, patch.driverId);
        else if (patch.driverId === null && patch.driverName === undefined) set.driver_name = '';
        if (patch.vehicleText !== undefined) set.vehicle_text = patch.vehicleText;
        else if (patch.vehicleId) set.vehicle_text = await vehicleRegistration(tx, principal, patch.vehicleId);
        else if (patch.vehicleId === null) set.vehicle_text = '';
        if (patch.driverId) await driverName(tx, principal, patch.driverId);
        if (patch.vehicleId) await vehicleRegistration(tx, principal, patch.vehicleId);
        if (patch.scheduledCollectionAt !== undefined) {
          set.scheduled_collection_at = patch.scheduledCollectionAt;
          if (before.status === 'Draft' && patch.scheduledCollectionAt) set.status = 'Scheduled';
          if (before.status === 'Scheduled' && !patch.scheduledCollectionAt) set.status = 'Draft';
        }
        await versionedUpdate(tx, { table: 'collection_notes', orgId: principal.orgId, id, expectedVersion: expected, set });

        // Keep the linked, still-open transport job in step with the note.
        const jobSet: string[] = [];
        const jobParams: unknown[] = [id];
        const add = (column: string, value: unknown) => { jobParams.push(value); jobSet.push(`${column} = $${jobParams.length}`); };
        if (patch.driverId !== undefined) add('driver_id', patch.driverId);
        if (patch.vehicleId !== undefined) add('vehicle_id', patch.vehicleId);
        if (patch.collectionAddress !== undefined) add('origin', patch.collectionAddress);
        if (patch.scheduledCollectionAt) add('scheduled_at', patch.scheduledCollectionAt);
        if (jobSet.length > 0) {
          jobParams.push(principal.userId);
          await tx.query(
            `UPDATE transport_jobs SET ${jobSet.join(', ')}, updated_at = now(), updated_by = $${jobParams.length}, row_version = row_version + 1
              WHERE collection_note_id = $1 AND status NOT IN ('Completed', 'Cancelled')`,
            jobParams,
          );
        }

        const after = await loadNote(tx, principal, id, { action: 'collection.write' });
        const afterDto = collectionNoteToDto(after);
        const keys = Object.keys(set).filter((k) => k !== 'updated_at' && k !== 'updated_by');
        const camel = (s: string) => s.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase());
        await recordAudit(tx, principal.orgId, {
          actorUserId: principal.userId, action: 'collection_note.updated', entityType: 'collection_note', entityId: id,
          correlationId: req.correlationId, before: pick(before, keys.map(camel)), after: pick(afterDto, keys.map(camel)),
        });
        return loadBundle(tx, after);
      });
    } catch (err) {
      mapInvoiceViolation(err);
    }
    setVersionHeader(res, bundle.collectionNote.rowVersion);
    res.json(bundle);
  });

  // Pickup is a record of the truck loading the machine. It is not a gate receipt: the booking's returned_at and billing are untouched.
  router.post('/collection-notes/:id/picked-up', async (req, res) => {
    const principal = principalWith(req, 'collection.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    z.object({}).strict().parse(req.body ?? {});
    const bundle = await withTransaction(principal.orgId, async (tx) => {
      const before = collectionNoteToDto(await loadNote(tx, principal, id, { lock: true, action: 'collection.write' }));
      if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      if (before.status !== 'Draft' && before.status !== 'Scheduled') {
        throw new AppError('INVALID_TRANSITION', `Cannot mark a ${before.status} collection note as picked up`);
      }
      await versionedUpdate(tx, {
        table: 'collection_notes', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Picked Up', picked_up_at: new Date(), updated_at: new Date(), updated_by: principal.userId },
      });
      const after = await loadNote(tx, principal, id, { action: 'collection.write' });
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'collection_note.picked_up', entityType: 'collection_note', entityId: id,
        correlationId: req.correlationId, before: { status: before.status }, after: { status: after.status, pickedUpAt: iso(after.picked_up_at) },
      });
      return loadBundle(tx, after);
    });
    setVersionHeader(res, bundle.collectionNote.rowVersion);
    res.json(bundle);
  });

  router.post('/collection-notes/:id/cancel', async (req, res) => {
    const principal = principalWith(req, 'collection.write');
    const id = uuidParam(req);
    const expected = parseIfMatch(req.headers['if-match']);
    const input = cancelSchema.parse(req.body ?? {});
    const bundle = await withTransaction(principal.orgId, async (tx) => {
      const before = collectionNoteToDto(await loadNote(tx, principal, id, { lock: true, action: 'collection.write' }));
      if (before.rowVersion !== expected) throw new AppError('STALE_VERSION', 'The record was changed by someone else; reload and retry');
      if (!EDITABLE.includes(before.status)) {
        throw new AppError('INVALID_TRANSITION', `Cannot cancel a ${before.status} collection note`);
      }
      await versionedUpdate(tx, {
        table: 'collection_notes', orgId: principal.orgId, id, expectedVersion: expected,
        set: { status: 'Cancelled', updated_at: new Date(), updated_by: principal.userId },
      });
      // The auto-generated job is no longer needed; a job already completed stays as history.
      await tx.query(
        `UPDATE transport_jobs SET status = 'Cancelled', updated_at = now(), updated_by = $2, row_version = row_version + 1
          WHERE collection_note_id = $1 AND status NOT IN ('Completed', 'Cancelled')`,
        [id, principal.userId],
      );
      const after = await loadNote(tx, principal, id, { action: 'collection.write' });
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId, action: 'collection_note.cancelled', entityType: 'collection_note', entityId: id,
        correlationId: req.correlationId, reason: input.reason, before: { status: before.status }, after: { status: after.status },
      });
      return loadBundle(tx, after);
    });
    setVersionHeader(res, bundle.collectionNote.rowVersion);
    res.json(bundle);
  });

  return router;
}
