import type { NotificationKind } from '@spa/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { notification, staff, user } from '../../db/schema';
import { boss } from '../../jobs/queue';

type TxLike = Parameters<Parameters<DB['transaction']>[0]>[0];

export interface DispatchRecipient {
  staffId: string;
}

export interface DispatchInput {
  kind: NotificationKind;
  payload: Record<string, unknown>;
  recipients: DispatchRecipient[];
  targetType?: 'cycle' | 'pms' | 'mid_year';
  targetId?: string;
}

export async function dispatchNotifications(
  tx: TxLike,
  input: DispatchInput,
): Promise<{ inserted: number }> {
  if (input.recipients.length === 0) {
    return { inserted: 0 };
  }

  await tx.insert(notification).values(
    input.recipients.map((r) => ({
      recipientStaffId: r.staffId,
      kind: input.kind,
      payload: input.payload,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
    })),
  );

  // boss.send uses pg-boss's own connection pool — it does NOT participate in the caller's tx.
  // If the caller's tx rolls back after dispatcher succeeds, the in-app notification row disappears
  // but the email job is already queued. Accepted trade-off: emails represent user-visible events
  // that already happened; a rollback-then-email-fires case is rare and detectable via audit log divergence.
  for (const r of input.recipients) {
    const rows = await tx
      .select({ email: user.email })
      .from(staff)
      .innerJoin(user, eq(staff.userId, user.id))
      .where(eq(staff.id, r.staffId))
      .limit(1);

    const email = rows[0]?.email;
    if (!email) {
      console.warn('dispatchNotifications: no email resolved for staff', { staffId: r.staffId });
      continue;
    }

    await boss.send('notifications.send_email', {
      to: email,
      kind: input.kind,
      payload: input.payload,
    });
  }

  return { inserted: input.recipients.length };
}
