import { REFRESH_QUEUE, refreshDashboardViews } from './dashboards/aggregates';
import { db } from './db/client';
import { runAuditAnchorAlert } from './jobs/audit-anchor-alert';
import { runAuditArchiveJob } from './jobs/audit-archive';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';
import { runGeneratePmsPdf } from './jobs/generate-pms-pdf';
import type { GenerateXlsxJob } from './jobs/generate-xlsx';
import { runGenerateXlsx } from './jobs/generate-xlsx';
import { runQuarterlyAccessReview } from './jobs/quarterly-access-review';
import { boss, startBoss } from './jobs/queue';
import { runRetentionAiCache } from './jobs/retention-ai-cache';
import { runRetentionAuth } from './jobs/retention-auth';
import { runRetentionExports } from './jobs/retention-exports';
import { runRetentionPerformance } from './jobs/retention-performance';
import { runRetentionTerminatedStaff } from './jobs/retention-terminated-staff';
import type { SendEmailJob } from './jobs/send-email';
import { runSendEmail } from './jobs/send-email';

const ANCHOR_QUEUE = 'audit.anchor.daily';
const ANCHOR_ALERT_QUEUE = 'audit.anchor_alert';
const ARCHIVE_QUEUE = 'audit.archive';
const PDF_QUEUE = 'pms.generate_pdf';
const EMAIL_QUEUE = 'notifications.send_email';
const XLSX_QUEUE = 'exports.generate_xlsx';
const RETENTION_AUTH_QUEUE = 'retention.auth';
const RETENTION_EXPORTS_QUEUE = 'retention.exports';
const RETENTION_AI_CACHE_QUEUE = 'retention.ai_cache';
const RETENTION_PERFORMANCE_QUEUE = 'retention.performance';
const RETENTION_STAFF_QUEUE = 'retention.terminated_staff';
const ACCESS_REVIEW_QUEUE = 'compliance.access_review';

await startBoss();
// pg-boss v10: queues must exist before schedule() or work() can reference them.
await boss.createQueue(ANCHOR_QUEUE);
await boss.work(ANCHOR_QUEUE, async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
await boss.schedule(ANCHOR_QUEUE, '5 0 * * *');

await boss.createQueue(ANCHOR_ALERT_QUEUE);
await boss.work(ANCHOR_ALERT_QUEUE, async () => {
  await runAuditAnchorAlert(db);
});
await boss.schedule(ANCHOR_ALERT_QUEUE, '10 0 * * *');

await boss.createQueue(ARCHIVE_QUEUE);
await boss.work(ARCHIVE_QUEUE, async () => {
  await runAuditArchiveJob(db);
});
await boss.schedule(ARCHIVE_QUEUE, '0 2 * * *');

await boss.createQueue(PDF_QUEUE);
await boss.work<{ cycleId: string; snapshotId: string; actorId: string }>(
  PDF_QUEUE,
  async (jobs) => {
    for (const job of jobs) {
      await runGeneratePmsPdf(db, job.data.cycleId, job.data.snapshotId, job.data.actorId);
    }
  },
);

await boss.createQueue(EMAIL_QUEUE);
await boss.work<SendEmailJob>(EMAIL_QUEUE, async (jobs) => {
  for (const j of jobs) {
    await runSendEmail(j.data);
  }
});

await boss.createQueue(XLSX_QUEUE);
await boss.work<GenerateXlsxJob>(XLSX_QUEUE, async (jobs) => {
  for (const job of jobs) {
    await runGenerateXlsx(db, job.data.exportJobId);
  }
});

await boss.createQueue(REFRESH_QUEUE);
await boss.work(REFRESH_QUEUE, async () => {
  await refreshDashboardViews(db);
});
await boss.schedule(REFRESH_QUEUE, '*/10 * * * *');

// ── Retention jobs ────────────────────────────────────────────────────────────
// auth: daily — 90-day hot window is relatively short
await boss.createQueue(RETENTION_AUTH_QUEUE);
await boss.work(RETENTION_AUTH_QUEUE, async () => {
  await runRetentionAuth(db);
});
await boss.schedule(RETENTION_AUTH_QUEUE, '0 3 * * *'); // 03:00 UTC daily

// exports: daily — 1-year window; mark old files as expired + delete R2 object
await boss.createQueue(RETENTION_EXPORTS_QUEUE);
await boss.work(RETENTION_EXPORTS_QUEUE, async () => {
  await runRetentionExports(db);
});
await boss.schedule(RETENTION_EXPORTS_QUEUE, '30 3 * * *'); // 03:30 UTC daily

// ai-cache: monthly — 7-year window; won't meaningfully fire until ~2033
await boss.createQueue(RETENTION_AI_CACHE_QUEUE);
await boss.work(RETENTION_AI_CACHE_QUEUE, async () => {
  await runRetentionAiCache(db);
});
await boss.schedule(RETENTION_AI_CACHE_QUEUE, '0 4 1 * *'); // 04:00 UTC 1st of month

// performance: weekly — 7-year window; heavy archival job
await boss.createQueue(RETENTION_PERFORMANCE_QUEUE);
await boss.work(RETENTION_PERFORMANCE_QUEUE, async () => {
  await runRetentionPerformance(db);
});
await boss.schedule(RETENTION_PERFORMANCE_QUEUE, '0 5 * * 0'); // 05:00 UTC every Sunday

// terminated staff: weekly — 7-year window; anonymises old terminated staff
await boss.createQueue(RETENTION_STAFF_QUEUE);
await boss.work(RETENTION_STAFF_QUEUE, async () => {
  await runRetentionTerminatedStaff(db);
});
await boss.schedule(RETENTION_STAFF_QUEUE, '0 6 * * 0'); // 06:00 UTC every Sunday

// ── Quarterly access review ───────────────────────────────────────────────────
// cron: 0 0 1 1,4,7,10 * — 1st of Jan/Apr/Jul/Oct at 00:00 UTC
await boss.createQueue(ACCESS_REVIEW_QUEUE);
await boss.work(ACCESS_REVIEW_QUEUE, async () => {
  await runQuarterlyAccessReview();
});
await boss.schedule(ACCESS_REVIEW_QUEUE, '0 0 1 1,4,7,10 *');

console.log(
  'worker ready — queues:',
  ANCHOR_QUEUE,
  ANCHOR_ALERT_QUEUE,
  ARCHIVE_QUEUE,
  PDF_QUEUE,
  EMAIL_QUEUE,
  XLSX_QUEUE,
  REFRESH_QUEUE,
  RETENTION_AUTH_QUEUE,
  RETENTION_EXPORTS_QUEUE,
  RETENTION_AI_CACHE_QUEUE,
  RETENTION_PERFORMANCE_QUEUE,
  RETENTION_STAFF_QUEUE,
  ACCESS_REVIEW_QUEUE,
);
