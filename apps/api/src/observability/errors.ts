/**
 * Pluggable error capture client.
 *
 * The default implementation logs to stderr as structured JSON — no external dependency.
 * If a real Sentry DSN is provided AND @sentry/bun is installed, replace the default
 * by calling setErrorClient() from index.ts:
 *
 *   import * as Sentry from '@sentry/bun';
 *   Sentry.init({ dsn: process.env.SENTRY_DSN, ... });
 *   setErrorClient({
 *     captureException(err, ctx) { Sentry.captureException(err, { extra: ctx }); }
 *   });
 *
 * TODO: Install @sentry/bun and wire this up when a DSN is provisioned.
 *
 * PII redaction: userId and requestId are safe to include (non-PII identifiers).
 * Tags object is caller-controlled; callers must not place passwords/tokens in tags.
 */

/** Fields that are redacted from error context before logging. */
const REDACT_KEYS = new Set([
  'password',
  'totp_code',
  'totpCode',
  'session_token',
  'sessionToken',
  'authorization',
  'Authorization',
]);

function redactTags(tags?: Record<string, string>): Record<string, string> | undefined {
  if (!tags) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

export interface ErrorClient {
  captureException(
    err: unknown,
    ctx?: { userId?: string; requestId?: string; tags?: Record<string, string> },
  ): void;
}

/** Default stub: logs to stderr as structured JSON. */
const defaultClient: ErrorClient = {
  captureException(err, ctx) {
    const payload = {
      ts: new Date().toISOString(),
      level: 'error',
      event: 'unhandled_exception',
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      userId: ctx?.userId,
      requestId: ctx?.requestId,
      tags: redactTags(ctx?.tags),
    };
    // Use process.stderr so it doesn't mix with structured stdout logs
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  },
};

export let errorClient: ErrorClient = defaultClient;

export function setErrorClient(client: ErrorClient): void {
  errorClient = client;
}
