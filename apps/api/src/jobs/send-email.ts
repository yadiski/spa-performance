import type { NotificationKind } from '@spa/shared';
import { renderEmail } from '../domain/notifications/templates';
import { sendEmail } from '../notifications/resend';

export interface SendEmailJob {
  to: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}

export async function runSendEmail(job: SendEmailJob): Promise<void> {
  const rendered = renderEmail(job.kind, job.payload);
  await sendEmail({ to: job.to, ...rendered });
}
