import { sql } from 'drizzle-orm';
import { canonicalJson, concatBytes, sha256 } from '../../audit/hash';
import type { DB } from '../../db/client';

export type VerifyResult =
  | { ok: true; count: number }
  | { ok: false; failedCommentId: string; reason: string };

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Verify signature chain for all signed comments on a given pms_id.
 */
export async function verifyPmsSignatureChain(db: DB, pmsId: string): Promise<VerifyResult> {
  const res = await db.execute(sql`
    select id, pms_id as "pmsId", role, body, signed_by as "signedBy",
           signed_at as "signedAt", ip, ua,
           prev_signature_hash as "prevSignatureHash", signature_hash as "signatureHash"
    from pms_comment
    where pms_id = ${pmsId} and signed_at is not null
    order by signed_at asc, id asc
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    pmsId: string;
    role: string;
    body: string;
    signedBy: string;
    signedAt: string | Date;
    ip: string | null;
    ua: string | null;
    prevSignatureHash: Uint8Array | null;
    signatureHash: Uint8Array | null;
  }>;

  let expectedPrev: Uint8Array = new Uint8Array(32);
  for (const r of rows) {
    const prevHash = r.prevSignatureHash
      ? r.prevSignatureHash instanceof Uint8Array
        ? r.prevSignatureHash
        : new Uint8Array(r.prevSignatureHash as unknown as ArrayBufferLike)
      : new Uint8Array(32);
    const actualHash = r.signatureHash
      ? r.signatureHash instanceof Uint8Array
        ? r.signatureHash
        : new Uint8Array(r.signatureHash as unknown as ArrayBufferLike)
      : new Uint8Array(0);

    if (!buffersEqual(prevHash, expectedPrev)) {
      return { ok: false, failedCommentId: r.id, reason: 'prev_hash_mismatch' };
    }

    // Normalize signedAt: postgres-js may return a postgres-format string
    // ("2026-04-19 21:29:02.762+00") rather than an ISO 8601 string. Parse via
    // Date constructor to get the canonical ISO format that was used at signing time.
    const signedAtIso =
      typeof r.signedAt === 'string'
        ? new Date(r.signedAt).toISOString()
        : r.signedAt.toISOString();
    const canonical = canonicalJson({
      pmsId: r.pmsId,
      role: r.role,
      body: r.body,
      signedBy: r.signedBy,
      signedAt: signedAtIso,
      // typedName was included in signing canonical; but we don't store it separately.
      // In practice the typed name is captured in the audit log payload but the hash
      // only covers the identity-bearing fields. We recompute using the stored fields.
      ip: r.ip,
      ua: r.ua,
    });
    const recomputed = await sha256(concatBytes(prevHash, canonical));
    if (!buffersEqual(recomputed, actualHash)) {
      return { ok: false, failedCommentId: r.id, reason: 'hash_mismatch' };
    }

    expectedPrev = actualHash;
  }

  return { ok: true, count: rows.length };
}
