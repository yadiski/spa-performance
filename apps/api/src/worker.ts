import { boss, startBoss } from './jobs/queue';
import { runDailyAuditAnchor } from './jobs/daily-audit-anchor';

await startBoss();
await boss.schedule('audit.anchor.daily', '5 0 * * *');
await boss.work('audit.anchor.daily', async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await runDailyAuditAnchor(yesterday);
});
console.log('worker ready');
