import { createHash } from 'node:crypto';

export interface RedactOptions {
  /** When true, replace staffId with an anonymous token. Returns mapping for later de-anonymization. */
  anonymize?: boolean;
  /** When true, remove name fields recursively. */
  stripNames?: boolean;
}

export interface RedactResult<T> {
  redacted: T;
  /** Maps anonymous token -> original staffId. Empty when anonymize is false. */
  mapping: Record<string, string>;
}

// Fields that carry PII and should always be stripped.
const ALWAYS_STRIP_FIELDS = new Set(['email', 'ip', 'ua']);
const NAME_FIELDS = new Set(['name', 'firstName', 'lastName', 'fullName', 'displayName']);

/**
 * Anonymise a staffId to a short stable token. The same staffId always maps to the same token
 * within a single redaction call so that structural relationships are preserved.
 */
function anonymizeId(staffId: string, tokenMap: Map<string, string>): string {
  const existing = tokenMap.get(staffId);
  if (existing) return existing;
  const hash = createHash('sha256').update(`anon:${staffId}`).digest('hex').slice(0, 12);
  const token = `anon_${hash}`;
  tokenMap.set(staffId, token);
  return token;
}

function redactValue(
  value: unknown,
  key: string,
  opts: RedactOptions,
  tokenMap: Map<string, string>,
): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, opts, tokenMap));
  }

  if (typeof value === 'object') {
    return redactObject(value as Record<string, unknown>, opts, tokenMap);
  }

  // Scalar: handle staffId anonymization
  if (key === 'staffId' && opts.anonymize && typeof value === 'string') {
    return anonymizeId(value, tokenMap);
  }

  return value;
}

function redactObject(
  obj: Record<string, unknown>,
  opts: RedactOptions,
  tokenMap: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ALWAYS_STRIP_FIELDS.has(k)) continue;
    if (opts.stripNames && NAME_FIELDS.has(k)) continue;
    result[k] = redactValue(v, k, opts, tokenMap);
  }
  return result;
}

export function redactPII<T>(obj: T, opts?: RedactOptions): RedactResult<T> {
  const options: RedactOptions = opts ?? {};
  const tokenMap = new Map<string, string>();

  const redacted = redactObject(obj as Record<string, unknown>, options, tokenMap);

  // Build reverse mapping: token -> original staffId
  const mapping: Record<string, string> = {};
  for (const [original, token] of tokenMap.entries()) {
    mapping[token] = original;
  }

  return { redacted: redacted as T, mapping };
}
