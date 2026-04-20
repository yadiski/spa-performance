/**
 * restore-drill.ts — Post-restore integrity verification script.
 *
 * Intended to run in a staging/CI environment against a freshly-restored
 * copy of a production snapshot. Does NOT perform the restore itself —
 * that's a Railway ops step. Verifies post-restore integrity.
 *
 * Usage:
 *   bun apps/api/src/scripts/restore-drill.ts
 *
 * Exit codes:
 *   0 — verification passed
 *   1 — verification failed (first failure location logged to stderr)
 *
 * Environment:
 *   DATABASE_URL            — points at the restored staging DB
 *   VERIFY_ALERT_EMAILS     — comma-separated list of emails to notify
 *                             (optional; requires RESEND_API_KEY + RESEND_FROM_EMAIL)
 */

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'development';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { verifyChain } from '../audit/verifier';
import { db } from '../db/client';
import { sendEmail } from '../notifications/resend';

export type DrillResult =
  | { ok: true; from: string; to: string; message: string }
  | { ok: false; from: string; to: string; failedId?: bigint; message: string };

/**
 * Verifies the audit chain from `from` (inclusive) to `to` (inclusive).
 * Pure read — no mutations.
 */
export async function verifyRestoredState(from: string, to: string): Promise<DrillResult> {
  const result = await verifyChain(db, from, to);
  if (result.ok) {
    return {
      ok: true,
      from,
      to,
      message: `Audit chain intact from ${from} to ${to}`,
    };
  }
  return {
    ok: false,
    from,
    to,
    failedId: result.failedId,
    message: `Audit chain broken at id=${result.failedId} (range ${from}→${to})`,
  };
}

async function notifyAlertEmails(result: DrillResult): Promise<void> {
  const raw = process.env.VERIFY_ALERT_EMAILS ?? '';
  const emails = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length === 0) return;

  const subject = result.ok
    ? `[restore-drill] Audit chain verified OK (${result.from} → ${result.to})`
    : `[restore-drill] FAILED — ${result.message}`;

  const text = [
    `Restore drill result: ${result.ok ? 'PASS' : 'FAIL'}`,
    `Range: ${result.from} → ${result.to}`,
    `Detail: ${result.message}`,
  ].join('\n');

  const html = `<p><strong>Restore drill: ${result.ok ? 'PASS' : 'FAIL'}</strong></p>
<p>Range: ${result.from} → ${result.to}</p>
<p>${result.message}</p>`;

  for (const to of emails) {
    try {
      await sendEmail({ to, subject, text, html });
    } catch (err) {
      console.error(`[restore-drill] failed to notify ${to}:`, err);
    }
  }
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  console.log(`[restore-drill] Verifying audit chain from ${thirtyDaysAgo} to ${today} …`);

  const result = await verifyRestoredState(thirtyDaysAgo, today);

  if (result.ok) {
    console.log(`[restore-drill] PASS — ${result.message}`);
  } else {
    console.error(`[restore-drill] FAIL — ${result.message}`);
  }

  await notifyAlertEmails(result);

  process.exit(result.ok ? 0 : 1);
}

// Only auto-run when executed directly, not when imported in tests
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('restore-drill.ts')
) {
  main().catch((err) => {
    console.error('[restore-drill] unexpected error:', err);
    process.exit(1);
  });
}
