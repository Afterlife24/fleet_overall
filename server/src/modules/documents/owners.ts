import type { Principal } from '../../auth/principal.js';
import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import { BOOKING_OWNER_SQL } from '../bookings/model.js';
import { ownRecordsOnly } from '../quotations/index.js';
import { assertInScope } from '../shared/branchScope.js';

export const DOCUMENT_TYPES = [
  'QUOTATION', 'HIRE_AGREEMENT', 'LPO', 'INVOICE', 'DN', 'CN', 'HMQD', 'MQD', 'HTPS', 'TPS', 'GATE_PASS', 'INSPECTION',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The record a document belongs to. Each kind maps to exactly one owner column of `documents`. */
export const OWNER_KINDS = [
  'quotation', 'hire_agreement', 'customer_lpo', 'invoice', 'delivery_note', 'collection_note',
  'mqd_report', 'service_report', 'gate_pass', 'inspection',
] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const OWNER_COLUMN: Record<OwnerKind, string> = {
  quotation: 'quotation_id',
  hire_agreement: 'hire_agreement_id',
  customer_lpo: 'customer_lpo_id',
  invoice: 'invoice_id',
  delivery_note: 'delivery_note_id',
  collection_note: 'collection_note_id',
  mqd_report: 'mqd_report_id',
  service_report: 'service_report_id',
  gate_pass: 'gate_pass_id',
  inspection: 'inspection_id',
};

export const OWNER_OF_TYPE: Record<DocumentType, OwnerKind> = {
  QUOTATION: 'quotation',
  HIRE_AGREEMENT: 'hire_agreement',
  LPO: 'customer_lpo',
  INVOICE: 'invoice',
  DN: 'delivery_note',
  CN: 'collection_note',
  HMQD: 'mqd_report',
  MQD: 'mqd_report',
  HTPS: 'service_report',
  TPS: 'service_report',
  GATE_PASS: 'gate_pass',
  INSPECTION: 'inspection',
};

/** Report documents are tied to a phase: HMQD/HTPS to HIRE, MQD/TPS to COLLECTION. */
export const PHASE_OF_TYPE: Partial<Record<DocumentType, 'HIRE' | 'COLLECTION'>> = {
  HMQD: 'HIRE', MQD: 'COLLECTION', HTPS: 'HIRE', TPS: 'COLLECTION',
};

const CHAIN_QUOTATION = new Set<OwnerKind>(['quotation', 'hire_agreement', 'customer_lpo', 'invoice']);

const BOOKING_KINDS = new Set<OwnerKind>(['delivery_note', 'collection_note', 'mqd_report', 'service_report']);
const NO_USER = 'NULL::uuid AS sales_user_id';
const NO_PHASE = 'NULL::text AS phase';
/** Own-records owner of a booking: its agreement quotation's sales user, or the booking creator when it has no agreement. */
const BOOKING_OWN_JOINS = 'LEFT JOIN hire_agreements ha ON ha.org_id = b.org_id AND ha.id = b.hire_agreement_id LEFT JOIN quotations qq ON qq.org_id = ha.org_id AND qq.id = ha.quotation_id';
const BOOKING_OWN_USER = 'CASE WHEN ha.id IS NOT NULL THEN qq.sales_user_id ELSE b.created_by END AS sales_user_id';
const VIA_BOOKING = (alias: string) => `JOIN bookings b ON b.org_id = ${alias}.org_id AND b.id = ${alias}.booking_id`;

const OWNER_SQL: Record<OwnerKind, string> = {
  quotation: `SELECT quotation_no AS no, branch_id, sales_user_id, ${NO_PHASE} FROM quotations WHERE id = $1`,
  hire_agreement: `SELECT h.agreement_no AS no, q.branch_id, q.sales_user_id, ${NO_PHASE}
    FROM hire_agreements h JOIN quotations q ON q.org_id = h.org_id AND q.id = h.quotation_id WHERE h.id = $1`,
  customer_lpo: `SELECT l.lpo_no AS no, q.branch_id, q.sales_user_id, ${NO_PHASE}
    FROM customer_lpos l JOIN quotations q ON q.org_id = l.org_id AND q.id = l.quotation_id WHERE l.id = $1`,
  invoice: `SELECT i.invoice_no AS no, q.branch_id, q.sales_user_id, ${NO_PHASE}
    FROM invoices i JOIN quotations q ON q.org_id = i.org_id AND q.id = i.quotation_id WHERE i.id = $1`,
  delivery_note: `SELECT d.number AS no, b.branch_id, ${BOOKING_OWN_USER}, ${NO_PHASE} FROM delivery_notes d ${VIA_BOOKING('d')} ${BOOKING_OWN_JOINS} WHERE d.id = $1`,
  collection_note: `SELECT c.number AS no, b.branch_id, ${BOOKING_OWN_USER}, ${NO_PHASE} FROM collection_notes c ${VIA_BOOKING('c')} ${BOOKING_OWN_JOINS} WHERE c.id = $1`,
  mqd_report: `SELECT m.number AS no, b.branch_id, ${BOOKING_OWN_USER}, m.phase FROM mqd_reports m ${VIA_BOOKING('m')} ${BOOKING_OWN_JOINS} WHERE m.id = $1`,
  service_report: `SELECT t.number AS no, b.branch_id, ${BOOKING_OWN_USER}, t.phase
    FROM third_party_service_reports t ${VIA_BOOKING('t')} ${BOOKING_OWN_JOINS} WHERE t.id = $1`,
  gate_pass: `SELECT gp.reference AS no, gp.branch_id, ${BOOKING_OWN_USER}, ${NO_PHASE}, (b.id IS NOT NULL) AS booking_scoped
    FROM gate_passes gp LEFT JOIN bookings b ON b.org_id = gp.org_id AND b.id = gp.booking_id ${BOOKING_OWN_JOINS} WHERE gp.id = $1`,
  inspection: `SELECT i.reference AS no, i.branch_id, ${BOOKING_OWN_USER}, ${NO_PHASE}, (b.id IS NOT NULL) AS booking_scoped
    FROM inspections i LEFT JOIN bookings b ON b.org_id = i.org_id AND b.id = i.booking_id ${BOOKING_OWN_JOINS} WHERE i.id = $1`,
};

export interface ResolvedOwner {
  kind: OwnerKind;
  id: string;
  /** The owner's business number, copied to documents.document_no. */
  number: string;
  branchId: string | null;
  phase: string | null;
}

/**
 * Loads an owner record and proves the Principal may see it: company through RLS (another company's
 * row does not exist), branch scope through the owner's branch (booking, quotation or own branch) and,
 * for own-records roles, the quotation chain owner's sales user. Anything out of reach is 404.
 */
export async function resolveOwner(
  tx: TxClient,
  principal: Principal,
  kind: OwnerKind,
  id: string,
  action: 'documents.read' | 'documents.write' | 'inspections.read' | 'inspections.write' | 'gate.read' | 'gate.write' = 'documents.read',
): Promise<ResolvedOwner> {
  const res = await tx.query<{ no: string; branch_id: string | null; sales_user_id: string | null; phase: string | null; booking_scoped?: boolean }>(OWNER_SQL[kind], [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Record not found');
  assertInScope(principal, action, row.branch_id);
  const chained = CHAIN_QUOTATION.has(kind) || BOOKING_KINDS.has(kind) || row.booking_scoped === true;
  if (chained && ownRecordsOnly(principal) && row.sales_user_id !== principal.userId) {
    throw new AppError('NOT_FOUND', 'Record not found');
  }
  return { kind, id, number: row.no, branchId: row.branch_id, phase: row.phase };
}

/** The booking must exist in the Principal's company and branch scope; otherwise it does not exist for them. */
export async function loadBooking(
  tx: TxClient,
  principal: Principal,
  bookingId: string,
  action: 'documents.read' | 'documents.write',
): Promise<{ id: string; branchId: string; deliveryAddress: string }> {
  const res = await tx.query<{ id: string; branch_id: string; delivery_address: string }>(
    'SELECT id, branch_id, delivery_address FROM bookings WHERE id = $1',
    [bookingId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Booking not found');
  assertInScope(principal, action, row.branch_id);
  if (ownRecordsOnly(principal)) {
    const own = await tx.query<{ owner: string | null }>(`SELECT ${BOOKING_OWNER_SQL} AS owner FROM bookings b WHERE b.id = $1`, [bookingId]);
    if (own.rows[0]?.owner !== principal.userId) throw new AppError('NOT_FOUND', 'Booking not found');
  }
  return { id: row.id, branchId: row.branch_id, deliveryAddress: row.delivery_address };
}
