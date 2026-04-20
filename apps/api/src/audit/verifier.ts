import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { canonicalJson, concatBytes, sha256 } from './hash';

export type VerifyResult = { ok: true } | { ok: false; failedId: bigint };

export async function verifyChain(db: DB, fromDate: string, toDate: string): Promise<VerifyResult> {
  // Anchor the date bounds in UTC so the caller's ISO date slices align with
  // how ts is stored, regardless of the Postgres session TZ.
  const res = await db.execute(sql`
    select id, ts, event_type, actor_id, payload, prev_hash, hash
    from audit_log
    where ts >= (${fromDate} || ' 00:00:00+00')::timestamptz
      and ts <  (${toDate}   || ' 00:00:00+00')::timestamptz + interval '1 day'
    order by id asc
  `);
  // drizzle/postgres-js returns an array-like result (not { rows: [...] })
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: bigint;
    ts: Date | string;
    event_type: string;
    actor_id: string | null;
    payload: unknown;
    prev_hash: Uint8Array | Buffer;
    hash: Uint8Array | Buffer;
  }>;

  let prev: Uint8Array | null = null;
  for (const r of rows) {
    // Normalize bytea columns — postgres-js may return Buffer
    const rowPrevHash =
      r.prev_hash instanceof Uint8Array
        ? r.prev_hash
        : new Uint8Array(r.prev_hash as unknown as ArrayBufferLike);
    const rowHash =
      r.hash instanceof Uint8Array ? r.hash : new Uint8Array(r.hash as unknown as ArrayBufferLike);

    if (prev && !buffersEqual(prev, rowPrevHash)) return { ok: false, failedId: r.id };

    // Normalize ts: driver may return Date object or string; re-stringify to ISO ms precision
    const tsStr = new Date(r.ts as string | Date).toISOString();

    const canonical = canonicalJson({
      ts: tsStr,
      eventType: r.event_type,
      actorId: r.actor_id,
      payload: r.payload,
    });
    const recomputed = await sha256(concatBytes(rowPrevHash, canonical));
    if (!buffersEqual(recomputed, rowHash)) return { ok: false, failedId: r.id };
    prev = rowHash;
  }
  return { ok: true };
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
