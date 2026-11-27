import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';

export interface SequenceRow {
  sequenceKind: string;
  sequenceYear: number;
  quotationId?: string;
  nextValue: bigint;
  minWidth: number;
  prefix: string;
}

/** Defaults used when a sequence row is created on first use. */
const SEQUENCE_DEFAULTS: Readonly<Record<string, { prefix: string; minWidth: number }>> = {
  CUSTOMER: { prefix: 'CUS-', minWidth: 4 },
  QUOTATION: { prefix: 'QT-', minWidth: 4 },
  AGREEMENT: { prefix: 'HA-', minWidth: 4 },
  BOOKING: { prefix: 'BK-', minWidth: 4 },
  TRANSPORT: { prefix: 'TR-', minWidth: 4 },
  GATE: { prefix: 'GP-', minWidth: 4 },
  CN: { prefix: 'CN-', minWidth: 4 },
  DN: { prefix: 'DN-', minWidth: 4 },
  HMQD: { prefix: 'HMQD-', minWidth: 4 },
  MQD: { prefix: 'MQD-', minWidth: 4 },
  HTPS: { prefix: 'HTPS-', minWidth: 4 },
  TPS: { prefix: 'TPS-', minWidth: 4 },
  INSPECTION: { prefix: 'INS-', minWidth: 4 },
  INVOICE: { prefix: '', minWidth: 2 }, // quote-specific suffix ("01", "02", ... "100"); the invoice route prepends the quote number
};
const FALLBACK_DEFAULTS = { prefix: '', minWidth: 4 };

/**
 * Pure formatter: prefix, then the year when the sequence is year-scoped (year > 0),
 * then the value zero-padded to at least minWidth digits. Depends on its arguments only.
 */
export function formatNumber(
  row: Pick<SequenceRow, 'prefix' | 'sequenceYear' | 'nextValue' | 'minWidth'>,
): string {
  const year = row.sequenceYear > 0 ? String(row.sequenceYear) : '';
  return `${row.prefix}${year}${row.nextValue.toString().padStart(row.minWidth, '0')}`;
}

export interface AllocateOptions {
  /** Year for organization-scoped kinds; defaults to the current UTC year. Ignored for INVOICE. */
  year?: number;
  /** Required for INVOICE (quote-specific sequence); ignored for other kinds. */
  quotationId?: string;
}

/**
 * Allocates the next number: creates the sequence row on first use, locks it with FOR UPDATE,
 * increments next_value and returns the formatted number. Runs in the caller's transaction, so a
 * rollback also rolls the increment back. Numbers are never reused.
 */
export async function allocateNumber(
  tx: TxClient,
  orgId: string,
  kind: string,
  opts: AllocateOptions = {},
): Promise<string> {
  const defaults = SEQUENCE_DEFAULTS[kind] ?? FALLBACK_DEFAULTS;
  const isInvoice = kind === 'INVOICE';
  if (isInvoice && !opts.quotationId) {
    throw new AppError('VALIDATION_ERROR', 'INVOICE numbering requires a quotation', { quotationId: 'required' });
  }
  const year = isInvoice ? 0 : (opts.year ?? new Date().getUTCFullYear());
  const quotationId = isInvoice ? (opts.quotationId as string) : null;

  if (quotationId) {
    await tx.query(
      `INSERT INTO number_sequences (org_id, sequence_kind, sequence_year, quotation_id, min_width, prefix)
       VALUES ($1, $2, 0, $3, $4, $5)
       ON CONFLICT (org_id, sequence_kind, quotation_id) WHERE quotation_id IS NOT NULL DO NOTHING`,
      [orgId, kind, quotationId, defaults.minWidth, defaults.prefix],
    );
  } else {
    await tx.query(
      `INSERT INTO number_sequences (org_id, sequence_kind, sequence_year, min_width, prefix)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, sequence_kind, sequence_year) WHERE quotation_id IS NULL DO NOTHING`,
      [orgId, kind, year, defaults.minWidth, defaults.prefix],
    );
  }

  const locked = quotationId
    ? await tx.query<{ id: string; next_value: string; min_width: number; prefix: string }>(
        `SELECT id, next_value, min_width, prefix FROM number_sequences
         WHERE org_id = $1 AND sequence_kind = $2 AND quotation_id = $3 FOR UPDATE`,
        [orgId, kind, quotationId],
      )
    : await tx.query<{ id: string; next_value: string; min_width: number; prefix: string }>(
        `SELECT id, next_value, min_width, prefix FROM number_sequences
         WHERE org_id = $1 AND sequence_kind = $2 AND sequence_year = $3 AND quotation_id IS NULL FOR UPDATE`,
        [orgId, kind, year],
      );
  const row = locked.rows[0];
  if (!row) throw new AppError('INTERNAL_ERROR', 'Number sequence could not be locked');

  await tx.query(
    `UPDATE number_sequences SET next_value = next_value + 1, updated_at = now(), row_version = row_version + 1
     WHERE org_id = $1 AND id = $2`,
    [orgId, row.id],
  );
  return formatNumber({
    prefix: row.prefix,
    sequenceYear: year,
    nextValue: BigInt(row.next_value),
    minWidth: row.min_width,
  });
}
