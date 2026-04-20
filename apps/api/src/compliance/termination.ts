import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';

/**
 * Process staff termination — called when HR sets terminated_at.
 *
 * Actions:
 *  1. Set staff.terminated_at (if not already set).
 *  2. Delete all sessions for that user.
 *  3. Set user.email_verified = false (prevents password-reset reactivation).
 *  4. Mark MFA recovery codes as used (invalidate).
 *  5. Write audit event staff.terminated.
 */
export async function processTermination(
  db: DB,
  opts: { staffId: string; terminatedAt: Date; actorUserId: string },
): Promise<void> {
  const { staffId, terminatedAt, actorUserId } = opts;

  await db.transaction(async (tx) => {
    // 1. Resolve the user_id for this staff member
    const staffRows = (await tx.execute(sql`
      select user_id from staff where id = ${staffId}::uuid limit 1
    `)) as Array<{ user_id: string }>;

    const firstRow = staffRows[0];
    if (!firstRow) {
      throw new Error(`processTermination: staff ${staffId} not found`);
    }
    const userId = firstRow.user_id;

    // 2. Set terminated_at on the staff row
    await tx.execute(sql`
      update staff
      set terminated_at = ${terminatedAt.toISOString()}::timestamptz,
          updated_at     = now()
      where id = ${staffId}::uuid
    `);

    // 3. Kill all sessions for this user
    await tx.execute(sql`
      delete from session where user_id = ${userId}::uuid
    `);

    // 4. Prevent future password-reset logins
    await tx.execute(sql`
      update "user"
      set email_verified = false,
          updated_at     = now()
      where id = ${userId}::uuid
    `);

    // 5. Invalidate MFA recovery codes (mark all as used now)
    await tx.execute(sql`
      update mfa_recovery_code
      set used_at = now()
      where user_id = ${userId}::uuid
        and used_at is null
    `);

    // 6. Audit
    await writeAudit(tx, {
      eventType: 'staff.terminated',
      actorId: actorUserId,
      actorRole: null,
      targetType: 'staff',
      targetId: staffId,
      payload: { terminatedAt: terminatedAt.toISOString(), userId },
      ip: null,
      ua: null,
    });
  });
}

/**
 * Anonymise a terminated staff member after 7 years have elapsed.
 *
 * Retained fields: id, employee_no, terminated_at, org_id.
 * Cleared fields:  name, designation, department_id, grade_id, manager_id.
 * The linked user row is deleted (cascade will clean sessions / accounts).
 *
 * Performance cycle rows and audit rows that reference the staff/user IDs
 * remain intact — those references point to now-deleted rows which is
 * acceptable for long-term archival purposes.
 */
export async function anonymizeTerminatedStaff(db: DB, opts: { staffId: string }): Promise<void> {
  const { staffId } = opts;

  await db.transaction(async (tx) => {
    // Resolve user_id before we delete the user row
    const staffRows = (await tx.execute(sql`
      select user_id from staff where id = ${staffId}::uuid limit 1
    `)) as Array<{ user_id: string | null }>;

    const firstAnonRow = staffRows[0];
    if (!firstAnonRow) {
      throw new Error(`anonymizeTerminatedStaff: staff ${staffId} not found`);
    }
    const userId = firstAnonRow.user_id;

    // Anonymise profile fields (keep id, employee_no, terminated_at, org_id).
    // Set user_id = null explicitly BEFORE deleting the user row so the
    // staff_refresh_search trigger (which looks up email via user_id) runs
    // while user_id is already null — the trigger handles null user_id gracefully
    // after migration 0024.
    await tx.execute(sql`
      update staff
      set name          = '',
          designation   = '',
          department_id = null,
          grade_id      = null,
          manager_id    = null,
          user_id       = null,
          updated_at    = now()
      where id = ${staffId}::uuid
    `);

    // Delete the user row (cascade: sessions, accounts, MFA rows).
    // staff.user_id is already null above, so the FK ON DELETE SET NULL
    // won't fire another UPDATE on staff.
    if (userId) {
      await tx.execute(sql`
        delete from "user" where id = ${userId}::uuid
      `);
    }

    // Audit
    await writeAudit(tx, {
      eventType: 'staff.anonymized',
      actorId: null,
      actorRole: 'system',
      targetType: 'staff',
      targetId: staffId,
      payload: { userId },
      ip: null,
      ua: null,
    });
  });
}
