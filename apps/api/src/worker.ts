import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';
import { boss, startBoss } from './jobs/queue';

const QUEUE = 'audit.anchor.daily';

await startBoss();
// pg-boss v10: queues must exist before schedule() or work() can reference them.
await boss.createQueue(QUEUE);
await boss.work(QUEUE, async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
await boss.schedule(QUEUE, '5 0 * * *');
console.log('worker ready — queue:', QUEUE);
