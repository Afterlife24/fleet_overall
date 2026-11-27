import { AppError } from '../../errors.js';

export const FLEET_QR_PREFIX = 'AXLEOPS-FLEET';
export const GATE_QR_PREFIX = 'AXLEOPS-GATE';
export const MAX_QR_LENGTH = 512;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedQr =
  | { kind: 'FLEET'; orgId: string; machineId: string; fleetNo: string }
  | { kind: 'GATE_PASS'; orgId: string; passId: string; reference: string };

const invalid = (message = 'The QR code is not valid for this company'): AppError =>
  new AppError('QR_INVALID', message, { payload: 'qr_invalid' });

/**
 * Strict parse of the two canonical formats (same shapes as src/services/collectionCore.ts and gatePassCore.ts):
 *   `AXLEOPS-FLEET:<orgId>:<machineId>:<fleetNo>` (fleetNo is the remainder and may itself contain colons)
 *   `AXLEOPS-GATE:<orgId>:<gatePassId>:<reference>` (exactly four parts)
 * Company and entity ids must be UUIDs. Anything else throws QR_INVALID.
 */
export function parseQr(raw: unknown): ParsedQr {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_QR_LENGTH) throw invalid('The QR code format is not recognised');
  if (raw.startsWith(`${FLEET_QR_PREFIX}:`)) {
    const rest = raw.slice(FLEET_QR_PREFIX.length + 1);
    const i1 = rest.indexOf(':');
    const i2 = i1 < 0 ? -1 : rest.indexOf(':', i1 + 1);
    if (i1 < 0 || i2 < 0) throw invalid('The QR code format is not recognised');
    const orgId = rest.slice(0, i1);
    const machineId = rest.slice(i1 + 1, i2);
    const fleetNo = rest.slice(i2 + 1);
    if (!UUID_RE.test(orgId) || !UUID_RE.test(machineId) || fleetNo.trim() === '') {
      throw invalid('The QR code format is not recognised');
    }
    return { kind: 'FLEET', orgId: orgId.toLowerCase(), machineId: machineId.toLowerCase(), fleetNo };
  }
  if (raw.startsWith(`${GATE_QR_PREFIX}:`)) {
    const parts = raw.split(':');
    if (parts.length !== 4 || parts.some((p) => p === '') || !UUID_RE.test(parts[1]) || !UUID_RE.test(parts[2])) {
      throw invalid('The QR code format is not recognised');
    }
    return { kind: 'GATE_PASS', orgId: parts[1].toLowerCase(), passId: parts[2].toLowerCase(), reference: parts[3] };
  }
  throw invalid('The QR code format is not recognised');
}

export const normalizeFleetNo = (s: string): string => s.trim().toLowerCase();

export { invalid as qrInvalid };
