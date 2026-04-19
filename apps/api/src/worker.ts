import { boss, startBoss } from './jobs/queue';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';

const QUEUE = 'audit.anchor.daily';

await startBoss();
// Register the worker first — this creates the queue if it doesn't exist in pg-boss v10.
await boss.work(QUEUE, async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
// Then schedule — the queue now exists, so this doesn't 23503 (foreign key violation).
await boss.schedule(QUEUE, '5 0 * * *');
console.log('worker ready — queue:', QUEUE);
