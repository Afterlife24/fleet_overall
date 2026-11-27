export type DeclaredType = 'application/pdf' | 'image/png' | 'image/jpeg';

export const DECLARED_TYPES: readonly DeclaredType[] = ['application/pdf', 'image/png', 'image/jpeg'];
export const DEFAULT_MAX_UPLOAD_BYTES = 10_485_760;
/** Bytes needed to decide the signature. */
export const SIGNATURE_BYTES = 5;

export type ValidationResult = { ok: true } | { ok: false; code: 'FILE_INVALID' };

export function isDeclaredType(value: string): value is DeclaredType {
  return (DECLARED_TYPES as readonly string[]).includes(value);
}

const startsWith = (bytes: Uint8Array, sig: number[]): boolean =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/** Content type implied by the leading bytes, or undefined when not PDF/PNG/JPEG. */
export function detectMime(head: Uint8Array): DeclaredType | undefined {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  return undefined;
}

/** Signature and size check when only the leading bytes and the total size are known (streaming uploads). */
export function validateUploadHead(
  head: Uint8Array,
  totalBytes: number,
  declaredType: string,
  maxBytes: number,
): ValidationResult {
  if (!Number.isInteger(totalBytes) || totalBytes < 1 || totalBytes > maxBytes) return { ok: false, code: 'FILE_INVALID' };
  if (!isDeclaredType(declaredType) || detectMime(head) !== declaredType) return { ok: false, code: 'FILE_INVALID' };
  return { ok: true };
}

/** 1 <= size <= maxBytes and the leading-byte signature matches the declared type. */
export function validateUpload(bytes: Uint8Array, declaredType: string, maxBytes: number): ValidationResult {
  return validateUploadHead(bytes.subarray(0, SIGNATURE_BYTES), bytes.length, declaredType, maxBytes);
}
