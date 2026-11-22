// Pure core for Gate Pass QR payloads and scan routing. No value imports, no stores, DOM or clock.

export const GATE_QR_PREFIX = 'AXLEOPS-GATE';
const FLEET_QR_PREFIX = 'AXLEOPS-FLEET';

export interface GatePassLite {
  id: string;
  orgId: string;
  reference: string;
}

/** `AXLEOPS-GATE:<orgId>:<gateEntryId>:<reference>` (same shape for Gate IN and Gate OUT). */
export const buildGatePayload = (p: { orgId: string; id: string; reference: string }): string =>
  `${GATE_QR_PREFIX}:${p.orgId}:${p.id}:${p.reference}`;

export type GateParse =
  | { ok: true; orgId: string; id: string; reference: string }
  | { ok: false; error: 'FORMAT' };

/** Exactly four non-empty colon-separated parts, the first being the gate prefix. */
export function parseGatePayload(raw: string): GateParse {
  if (typeof raw !== 'string') return { ok: false, error: 'FORMAT' };
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== GATE_QR_PREFIX || parts.some((p) => p === '')) {
    return { ok: false, error: 'FORMAT' };
  }
  return { ok: true, orgId: parts[1], id: parts[2], reference: parts[3] };
}

export type ScanKind = 'FLEET' | 'GATE' | 'OTHER';

export function classifyScan(raw: string): ScanKind {
  if (typeof raw !== 'string') return 'OTHER';
  if (raw.startsWith(`${FLEET_QR_PREFIX}:`)) return 'FLEET';
  if (raw.startsWith(`${GATE_QR_PREFIX}:`)) return 'GATE';
  return 'OTHER';
}

export type GatePassScanError = 'FORMAT' | 'OTHER_ORG' | 'NOT_FOUND';

export type GatePassScan =
  | { ok: true; pass: GatePassLite }
  | { ok: false; error: GatePassScanError };

/**
 * Precedence: format, then company, then lookup by id. The reference part is carried but not
 * required to match, so a regenerated reference never blocks a scan.
 */
export function resolveGatePassScan(
  raw: string,
  currentOrgId: string,
  passes: readonly GatePassLite[],
): GatePassScan {
  const parsed = parseGatePayload(raw);
  if (!parsed.ok) return { ok: false, error: 'FORMAT' };
  if (parsed.orgId !== currentOrgId) return { ok: false, error: 'OTHER_ORG' };
  const pass = passes.find((p) => p.id === parsed.id && p.orgId === currentOrgId);
  if (!pass) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, pass };
}

export const GATE_PASS_SCAN_MESSAGES: Record<GatePassScanError, string> = {
  FORMAT: 'This gate pass QR code has an unrecognized format.',
  OTHER_ORG: 'This gate pass QR code belongs to another company.',
  NOT_FOUND: 'No gate pass matches this QR code.',
};

/** `<reference>.png`, characters outside [A-Za-z0-9._-] replaced by `_`. */
export const pngFileName = (reference: string): string =>
  `${String(reference).replace(/[^A-Za-z0-9._-]/g, '_')}.png`;
