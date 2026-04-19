import { sql } from 'drizzle-orm';
import { canonicalJson, concatBytes, sha256 } from './hash';

export type AuditInput = {
  eventType: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  ua: string | null;
};

/**
 * Must be called inside the same transaction as the domain mutation.
 * Locks the last row for SELECT to serialize chain writes.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle tx type varies
export async function writeAudit(tx: any, input: AuditInput): Promise<Uint8Array> {
  const res = await tx.execute(sql`
    select hash from audit_log order by id desc limit 1 for update
  `);
  // drizzle/postgres-js returns an array-like result (not { rows: [...] })
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ hash: Uint8Array }>;
  const last = rows[0];

  // Normalize prev hash — postgres-js may return Buffer, convert to Uint8Array
  const rawPrev = last?.hash;
  const prevHash: Uint8Array = rawPrev
    ? rawPrev instanceof Uint8Array
      ? rawPrev
      : new Uint8Array(rawPrev as unknown as ArrayBufferLike)
    : new Uint8Array(32);

  // Use millisecond-precision ISO string for deterministic hashing.
  // We pass this same string to Postgres so the stored ts matches exactly.
  const ts = new Date().toISOString();
  const canonical = canonicalJson({
    ts,
    eventType: input.eventType,
    actorId: input.actorId,
    payload: input.payload,
  });
  const hash = await sha256(concatBytes(prevHash, canonical));
  const chainRoot = hash;

  await tx.execute(sql`
    insert into audit_log (ts, event_type, actor_id, actor_role, target_type, target_id, payload, ip, ua, prev_hash, hash, chain_root)
    values (${ts}::timestamptz, ${input.eventType}, ${input.actorId}, ${input.actorRole}, ${input.targetType}, ${input.targetId},
            ${JSON.stringify(input.payload)}::jsonb, ${input.ip}::inet, ${input.ua}, ${prevHash}, ${hash}, ${chainRoot})
  `);
  return hash;
}
