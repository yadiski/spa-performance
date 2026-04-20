import { REFRESH_QUEUE, refreshDashboardViews } from './dashboards/aggregates';
import { db } from './db/client';
import { runAuditAnchorAlert } from './jobs/audit-anchor-alert';
import { runAuditArchiveJob } from './jobs/audit-archive';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';
import { runGeneratePmsPdf } from './jobs/generate-pms-pdf';
import type { GenerateXlsxJob } from './jobs/generate-xlsx';
import { runGenerateXlsx } from './jobs/generate-xlsx';
import { boss, startBoss } from './jobs/queue';
import type { SendEmailJob } from './jobs/send-email';
import { runSendEmail } from './jobs/send-email';

const ANCHOR_QUEUE = 'audit.anchor.daily';
const ANCHOR_ALERT_QUEUE = 'audit.anchor_alert';
const ARCHIVE_QUEUE = 'audit.archive';
const PDF_QUEUE = 'pms.generate_pdf';
const EMAIL_QUEUE = 'notifications.send_email';
const XLSX_QUEUE = 'exports.generate_xlsx';

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

console.log(
  'worker ready — queues:',
  ANCHOR_QUEUE,
  ANCHOR_ALERT_QUEUE,
  ARCHIVE_QUEUE,
  PDF_QUEUE,
  EMAIL_QUEUE,
  XLSX_QUEUE,
  REFRESH_QUEUE,
);
