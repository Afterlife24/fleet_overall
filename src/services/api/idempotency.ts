// One Idempotency-Key per submission: generated on first use, reused when the same submission is retried,
// and dropped once the server has given a definitive answer so the next submission gets a fresh key.
const keys = new Map<string, string>();

function newKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** The key for a submission; the same `submissionId` always yields the same key until `clearSubmission`. */
export function getOrCreateIdempotencyKey(submissionId: string): string {
  let key = keys.get(submissionId);
  if (!key) {
    key = newKey();
    keys.set(submissionId, key);
  }
  return key;
}

/** Forget a submission so its next use creates a new key. */
export function clearSubmission(submissionId: string): void {
  keys.delete(submissionId);
}

/** A fresh submission id for a form instance. */
export function newSubmissionId(): string {
  return newKey();
}
