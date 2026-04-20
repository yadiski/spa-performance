import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';

const CODE_COUNT = 10;
const CODE_SEGMENT_LENGTH = 4;
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateCode(): string {
  const segments: string[] = [];
  for (let i = 0; i < 3; i++) {
    const bytes = randomBytes(3); // 3 bytes = enough for 4 base32 chars
    let segment = '';
    let buf = 0;
    let bits = 0;
    for (const byte of bytes) {
      buf = (buf << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        segment += BASE32_CHARS[(buf >> bits) & 31];
      }
    }
    // Pad to CODE_SEGMENT_LENGTH if needed
    while (segment.length < CODE_SEGMENT_LENGTH) {
      segment += BASE32_CHARS[0];
    }
    segments.push(segment.slice(0, CODE_SEGMENT_LENGTH));
  }
  return segments.join('-');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase(), 'utf8').digest('hex');
}

export async function generateRecoveryCodes(db: DB, userId: string): Promise<string[]> {
  const codes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < CODE_COUNT; i++) {
    const code = generateCode();
    codes.push(code);
    hashes.push(hashCode(code));
  }

  // Delete old unused codes for this user
  await db.execute(sql`
    delete from mfa_recovery_code where user_id = ${userId}::uuid and used_at is null
  `);

  // Insert new codes
  for (const h of hashes) {
    await db.execute(sql`
      insert into mfa_recovery_code (user_id, code_hash)
      values (${userId}::uuid, ${h})
    `);
  }

  return codes;
}

export async function consumeRecoveryCode(
  db: DB,
  userId: string,
  code: string,
): Promise<{ ok: true } | { ok: false }> {
  const h = hashCode(code.trim().toUpperCase());

  return await db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      update mfa_recovery_code
      set used_at = now()
      where user_id = ${userId}::uuid
        and code_hash = ${h}
        and used_at is null
      returning id
    `);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
    }>;

    if (rows.length === 0) {
      return { ok: false };
    }

    await writeAudit(tx, {
      eventType: 'auth.mfa.recovery_used',
      actorId: userId,
      actorRole: null,
      targetType: 'user',
      targetId: userId,
      payload: { codeId: rows[0]!.id },
      ip: null,
      ua: null,
    });

    return { ok: true };
  });
}
