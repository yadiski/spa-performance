import { runAuditArchive } from '../audit/archive';
import type { DB } from '../db/client';

export async function runAuditArchiveJob(db: DB): Promise<void> {
  const result = await runAuditArchive(db);
  if (!result.ok) {
    throw new Error(`audit archive job failed: ${result.error}`);
  }
  console.log(
    `audit archive job complete — rows archived: ${result.rowsArchived}, last key: ${result.key ?? 'none'}`,
  );
}
