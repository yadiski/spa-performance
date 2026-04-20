import type { NotificationKind } from '@spa/shared';
import type { DB } from '../../db/client';
import { notification } from '../../db/schema';

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

  // TODO(T32): enqueue send-email per recipient

  return { inserted: input.recipients.length };
}
