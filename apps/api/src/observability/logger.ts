/**
 * Structured JSON logger with PII redaction.
 *
 * PII fields that are ALWAYS redacted:
 *   password, totp_code, totpCode, session_token, sessionToken, authorization
 *
 * `email` is kept by default; pass `__redactEmail: true` in the event to redact it.
 *
 * Output: one JSON line per event to stdout via console.log.
 * No external logger library — zero additional dependencies.
 */

export interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  requestId?: string;
  userId?: string;
  /** Set to true to redact the email field in this specific event. */
  __redactEmail?: boolean;
  [key: string]: unknown;
}

/** Fields that are always replaced with '[REDACTED]' before emission. */
const ALWAYS_REDACT = new Set([
  'password',
  'totp_code',
  'totpCode',
  'session_token',
  'sessionToken',
  'authorization',
  'Authorization',
]);

function redact(event: LogEvent): Record<string, unknown> {
  const redactEmail = event.__redactEmail === true;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(event)) {
    if (k === '__redactEmail') continue; // internal control flag — don't emit
    if (ALWAYS_REDACT.has(k)) {
      out[k] = '[REDACTED]';
    } else if (redactEmail && k === 'email') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }

  return out;
}

export function log(event: LogEvent): void {
  const payload = redact(event);
  // Ensure timestamp is always present
  if (!payload.ts) {
    payload.ts = new Date().toISOString();
  }
  console.log(JSON.stringify(payload));
}

export function logDebug(msg: string, fields?: Record<string, unknown>): void {
  log({ level: 'debug', msg, ...fields });
}

export function logInfo(msg: string, fields?: Record<string, unknown>): void {
  log({ level: 'info', msg, ...fields });
}

export function logWarn(msg: string, fields?: Record<string, unknown>): void {
  log({ level: 'warn', msg, ...fields });
}

export function logError(msg: string, fields?: Record<string, unknown>): void {
  log({ level: 'error', msg, ...fields });
}
