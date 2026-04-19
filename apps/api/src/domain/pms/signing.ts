import type { SignPmsComment } from '@spa/shared';
import { eq, sql } from 'drizzle-orm';
import { canonicalJson, concatBytes, sha256 } from '../../audit/hash';
import { writeAudit } from '../../audit/log';
import type { Actor } from '../../auth/middleware';
import type { DB } from '../../db/client';
import { pmsComment } from '../../db/schema';

type Result = { ok: true; hash: Uint8Array } | { ok: false; error: string };

/**
 * Sign a pms_comment. Captures name, server ts, IP, UA and chains to prior signed
 * comment hash on the same PMS. Only the record's author can sign it (enforced by
 * role + pms-ownership checks at the route boundary).
 */
export async function signPmsComment(db: DB, actor: Actor, input: SignPmsComment): Promise<Result> {
  return await db.transaction(async (tx) => {
    const [comment] = await tx.select().from(pmsComment).where(eq(pmsComment.id, input.commentId));
    if (!comment) return { ok: false, error: 'comment_not_found' };
    if (comment.signedAt) return { ok: false, error: 'already_signed' };

    // Read the last signed comment on the same PMS to derive prev hash
    const prevRes = await tx.execute(sql`
      select signature_hash from pms_comment
      where pms_id = ${comment.pmsId} and signed_at is not null
      order by signed_at desc
      limit 1 for update
    `);
    const prevRows = (
      Array.isArray(prevRes) ? prevRes : ((prevRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ signature_hash: Uint8Array | null }>;
    const prevRaw = prevRows[0]?.signature_hash;
    const prevHash: Uint8Array = prevRaw
      ? prevRaw instanceof Uint8Array
        ? prevRaw
        : new Uint8Array(prevRaw as unknown as ArrayBufferLike)
      : new Uint8Array(32);

    const signedAt = new Date().toISOString();
    // NOTE: typedName is intentionally excluded from the chain hash — it lives only
    // in the audit log payload. The hash covers only fields that can be reproduced
    // from stored DB columns, enabling the chain verifier to recompute without
    // consulting the audit log.
    const canonical = canonicalJson({
      pmsId: comment.pmsId,
      role: comment.role,
      body: comment.body,
      signedBy: actor.userId,
      signedAt,
      ip: actor.ip,
      ua: actor.ua,
    });
    const hash = await sha256(concatBytes(prevHash, canonical));

    await tx
      .update(pmsComment)
      .set({
        signedBy: actor.userId,
        signedAt: new Date(signedAt),
        ip: actor.ip,
        ua: actor.ua,
        signatureHash: hash,
        prevSignatureHash: prevHash,
      })
      .where(eq(pmsComment.id, comment.id));

    await writeAudit(tx, {
      eventType: 'pms.comment.signed',
      actorId: actor.userId,
      actorRole: actor.roles[0] ?? null,
      targetType: 'pms',
      targetId: comment.pmsId,
      payload: {
        commentId: comment.id,
        role: comment.role,
        typedName: input.typedName,
      },
      ip: actor.ip,
      ua: actor.ua,
    });

    return { ok: true, hash };
  });
}
