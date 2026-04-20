/**
 * weekly-restore-drill.ts — pg-boss cron job wrapper for the restore drill.
 *
 * Registered as a weekly cron (Monday 06:00 UTC).
 * Only active when ENABLE_RESTORE_DRILL=true — production should never self-drill.
 *
 * Register in your worker startup:
 *
 *   import { registerRestoreDrillJob } from './jobs/weekly-restore-drill';
 *   await registerRestoreDrillJob(boss);
 */

import { sendEmail } from '../notifications/resend';
import { verifyRestoredState } from '../scripts/restore-drill';
import { boss } from './queue';

const JOB_NAME = 'restore.weekly_drill';

/** Monday 06:00 UTC */
const CRON_SCHEDULE = '0 6 * * 1';

export async function registerRestoreDrillJob(): Promise<void> {
  if (process.env.ENABLE_RESTORE_DRILL !== 'true') {
    console.log('[weekly-restore-drill] ENABLE_RESTORE_DRILL is not "true" — job not registered');
    return;
  }

  await boss.schedule(JOB_NAME, CRON_SCHEDULE, {}, { tz: 'UTC' });

  await boss.work(JOB_NAME, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    console.log(`[weekly-restore-drill] Running drill: ${thirtyDaysAgo} → ${today}`);

    const result = await verifyRestoredState(thirtyDaysAgo, today);

    if (result.ok) {
      console.log(`[weekly-restore-drill] PASS — ${result.message}`);
    } else {
      console.error(`[weekly-restore-drill] FAIL — ${result.message}`);
      await notifyFailure(result.message);
    }
  });

  console.log(`[weekly-restore-drill] Registered cron "${CRON_SCHEDULE}" as "${JOB_NAME}"`);
}

async function notifyFailure(reason: string): Promise<void> {
  const raw = process.env.VERIFY_ALERT_EMAILS ?? '';
  const emails = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    console.warn(
      '[weekly-restore-drill] VERIFY_ALERT_EMAILS not set — no failure notification sent',
    );
    return;
  }

  const subject = '[weekly-restore-drill] FAILED — audit chain broken';
  const text = `The weekly restore drill failed.\n\nReason: ${reason}\n\nPlease investigate immediately.`;
  const html = `<p><strong>Weekly restore drill FAILED</strong></p><p>Reason: ${reason}</p><p>Please investigate immediately.</p>`;

  for (const to of emails) {
    try {
      await sendEmail({ to, subject, text, html });
    } catch (err) {
      console.error(`[weekly-restore-drill] failed to notify ${to}:`, err);
    }
  }
}
