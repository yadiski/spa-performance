import { db } from './db/client';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';
import { runGeneratePmsPdf } from './jobs/generate-pms-pdf';
import { boss, startBoss } from './jobs/queue';

const ANCHOR_QUEUE = 'audit.anchor.daily';
const PDF_QUEUE = 'pms.generate_pdf';

await startBoss();
// pg-boss v10: queues must exist before schedule() or work() can reference them.
await boss.createQueue(ANCHOR_QUEUE);
await boss.work(ANCHOR_QUEUE, async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
await boss.schedule(ANCHOR_QUEUE, '5 0 * * *');

await boss.createQueue(PDF_QUEUE);
await boss.work<{ cycleId: string; snapshotId: string; actorId: string }>(
  PDF_QUEUE,
  async (jobs) => {
    for (const job of jobs) {
      await runGeneratePmsPdf(db, job.data.cycleId, job.data.snapshotId, job.data.actorId);
    }
  },
);

console.log('worker ready — queues:', ANCHOR_QUEUE, PDF_QUEUE);
