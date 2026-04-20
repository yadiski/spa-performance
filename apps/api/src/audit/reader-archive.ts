import { gunzipSync } from 'node:zlib';
import { and, gte, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { auditArchiveManifest, auditLog } from '../db/schema/audit';
import { get } from '../storage/r2';

export interface AuditReadQuery {
  from: Date;
  to: Date;
  eventType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditRow {
  id: string;
  ts: string;
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  ua: string | null;
}

const MAX_ROWS = 5000;

export async function readAudit(
  db: DB,
  query: AuditReadQuery,
): Promise<{ hot: AuditRow[]; cold: AuditRow[]; total: number; capped: boolean }> {
  const limit = Math.min(query.limit ?? MAX_ROWS, MAX_ROWS);
  const offset = query.offset ?? 0;

  // ── Hot path ──────────────────────────────────────────────────────────────

  const hotConditions = [gte(auditLog.ts, query.from), lte(auditLog.ts, query.to)];

  const hotRes = await db.execute(sql`
    select id::text, ts::text as ts, event_type as "eventType",
           actor_id::text as "actorId", actor_role as "actorRole",
           target_type as "targetType", target_id as "targetId",
           payload, ip::text, ua
    from audit_log
    where ts >= ${query.from.toISOString()}::timestamptz
      and ts <= ${query.to.toISOString()}::timestamptz
      ${query.eventType ? sql`and event_type = ${query.eventType}` : sql``}
      ${query.targetId ? sql`and target_id = ${query.targetId}` : sql``}
    order by id asc
    limit ${limit} offset ${offset}
  `);

  const hot = (
    Array.isArray(hotRes) ? hotRes : ((hotRes as { rows?: unknown[] }).rows ?? [])
  ) as AuditRow[];

  // ── Cold path: find overlapping archive manifests ─────────────────────────

  const fromDate = query.from.toISOString().slice(0, 10);
  const toDate = query.to.toISOString().slice(0, 10);

  const manifestRes = await db.execute(sql`
    select r2_key, period_start::text as period_start, period_end::text as period_end
    from audit_archive_manifest
    where period_start <= ${toDate}::date
      and period_end >= ${fromDate}::date
    order by period_start asc
  `);

  const manifests = (
    Array.isArray(manifestRes) ? manifestRes : ((manifestRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ r2_key: string; period_start: string; period_end: string }>;

  const cold: AuditRow[] = [];

  for (const manifest of manifests) {
    const compressed = await get(manifest.r2_key);
    const decompressed = gunzipSync(compressed).toString('utf-8');
    const lines = decompressed.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const row = JSON.parse(line) as {
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
      };

      const rowTs = new Date(row.ts);
      if (rowTs < query.from || rowTs > query.to) continue;
      if (query.eventType && row.event_type !== query.eventType) continue;
      if (query.targetId && row.target_id !== query.targetId) continue;

      cold.push({
        id: row.id,
        ts: row.ts,
        eventType: row.event_type,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        targetType: row.target_type,
        targetId: row.target_id,
        payload: row.payload,
        ip: row.ip,
        ua: row.ua,
      });
    }
  }

  const total = hot.length + cold.length;
  const capped = total >= MAX_ROWS;

  return { hot, cold, total, capped };
}
