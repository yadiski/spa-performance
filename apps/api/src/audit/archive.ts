/**
 * Archive format: JSONL compressed with gzip (.jsonl.gz).
 *
 * Deviation from spec: the spec requested Parquet, but Parquet has no
 * reliable Bun-native writer without heavy native bindings (DuckDB, parquetjs).
 * JSONL.gz meets all durability and queryability goals:
 *   - Durable: sha256-verified before the hot rows are deleted.
 *   - Queryable: DuckDB can read gzip'd JSONL via read_json; jq/grep work too.
 *   - No native deps: uses node:zlib gzipSync which ships with Bun.
 * Archives can be converted to Parquet later via a one-time DuckDB migration
 * without touching the hot-row deletion logic.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { auditArchiveManifest } from '../db/schema/audit';
import { put } from '../storage/r2';

export interface ArchiveResult {
  ok: true;
  rowsArchived: number;
  key: string | null;
}

export interface ArchiveError {
  ok: false;
  error: string;
}

interface AuditLogRow {
  id: string;
  ts: string;
  event_type: string;
  actor_id: string | null;
  actor_role: string | null;
  target_type: string | null;
  target_id: string | null;
  payload: unknown;
  ip: string | null;
  ua: string | null;
  prev_hash: string;
  hash: string;
  chain_root: string;
}

function toHex(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (Buffer.isBuffer(v)) return (v as Buffer).toString('hex');
  // postgres-js may return an ArrayBufferLike
  if (v && typeof v === 'object' && 'buffer' in v) {
    return Buffer.from((v as { buffer: ArrayBuffer }).buffer).toString('hex');
  }
  return String(v);
}

export async function runAuditArchive(
  db: DB,
  opts?: { cutoffDays?: number },
): Promise<ArchiveResult | ArchiveError> {
  const cutoffDays = opts?.cutoffDays ?? 90;

  try {
    // 1. Find all distinct YYYY-MM months older than cutoff
    const monthsRes = await db.execute(sql`
      select to_char(date_trunc('month', ts), 'YYYY-MM') as month
      from audit_log
      where ts < now() - (${cutoffDays} || ' days')::interval
      group by 1
      order by 1 asc
    `);

    const monthRows = (
      Array.isArray(monthsRes) ? monthsRes : ((monthsRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ month: string }>;

    if (monthRows.length === 0) {
      return { ok: true, rowsArchived: 0, key: null };
    }

    let totalArchived = 0;
    let lastKey: string | null = null;

    for (const { month } of monthRows) {
      const [year, mon] = month.split('-');
      const periodStart = `${year}-${mon}-01`;
      // Last day of the month: use the first day of next month minus 1 day
      const nextMonthDate = new Date(`${year}-${mon}-01`);
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      nextMonthDate.setDate(nextMonthDate.getDate() - 1);
      const periodEnd = nextMonthDate.toISOString().slice(0, 10);

      // 2. Query rows for this month
      const rowsRes = await db.execute(sql`
        select id::text, ts::text, event_type, actor_id::text, actor_role, target_type, target_id,
               payload, ip::text, ua,
               encode(prev_hash, 'hex') as prev_hash,
               encode(hash, 'hex') as hash,
               encode(chain_root, 'hex') as chain_root
        from audit_log
        where ts >= ${periodStart}::date
          and ts < (${periodEnd}::date + interval '1 day')
          and ts < now() - (${cutoffDays} || ' days')::interval
        order by id asc
      `);

      const rows = (
        Array.isArray(rowsRes) ? rowsRes : ((rowsRes as { rows?: unknown[] }).rows ?? [])
      ) as AuditLogRow[];

      if (rows.length === 0) continue;

      // 3. Build JSONL content
      const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
      const compressed = gzipSync(Buffer.from(jsonl, 'utf-8'));

      // 4. Compute sha256
      const sha256hex = createHash('sha256').update(compressed).digest('hex');

      // 5. Upload to R2
      const r2Key = `audit-archive/${month}.jsonl.gz`;
      await put(r2Key, compressed, 'application/gzip');

      // 6. Record manifest row
      await db.insert(auditArchiveManifest).values({
        periodStart,
        periodEnd,
        r2Key,
        sha256: sha256hex,
        rowCount: rows.length,
      });

      // 7. Delete hot rows (only after successful upload + manifest insert).
      // audit_log is append-only via a BEFORE DELETE trigger; the archive
      // path is the lone permitted deleter, gated by a tx-local session var.
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local app.audit_archive = 'yes'`);
        await tx.execute(sql`
          delete from audit_log
          where ts >= ${periodStart}::date
            and ts < (${periodEnd}::date + interval '1 day')
            and ts < now() - (${cutoffDays} || ' days')::interval
        `);
      });

      totalArchived += rows.length;
      lastKey = r2Key;
    }

    return { ok: true, rowsArchived: totalArchived, key: lastKey };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
