const REDACTED = '[REDACTED]';
const SECRET_KEY = /password|passwd|token|secret|authorization|api[_-]?key|credential|private[_-]?key|(^|[_-])signature$/i; // not "signatureText": a typed approver name is business data
const SIGNED_URL = /X-Amz-(Signature|Credential|Security-Token)=/i;
const MAX_DEPTH = 20;

/**
 * Returns a deep copy where values under password/token/secret-like keys (any depth) and signed
 * URLs are replaced by a fixed marker. All other keys and values are preserved unchanged.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return SIGNED_URL.test(value) ? REDACTED : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}
