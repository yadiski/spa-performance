process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { NotificationKind } from '@spa/shared';
import { renderEmail } from '../src/domain/notifications/templates';
import * as resend from '../src/notifications/resend';

// Stub sendEmail before importing the job so the module never calls Resend.
const sendEmailSpy = spyOn(resend, 'sendEmail').mockImplementation(async () => ({
  id: 'stubbed-id',
}));

import { runSendEmail } from '../src/jobs/send-email';

afterAll(() => {
  sendEmailSpy.mockRestore();
});

describe('runSendEmail', () => {
  it('calls sendEmail with the rendered subject, text, and html for the given kind and payload', async () => {
    sendEmailSpy.mockClear();

    const to = 'recipient@example.com';
    const kind = NotificationKind.PmsFinalized;
    const payload = { staffName: 'Alice', appraisalPeriod: 'FY2025' };

    await runSendEmail({ to, kind, payload });

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);

    const expected = renderEmail(kind, payload);
    const [call] = sendEmailSpy.mock.calls as Array<
      [{ to: string; subject: string; text: string; html: string }]
    >;
    expect(call![0]).toEqual({ to, ...expected });
  });

  it('propagates errors thrown by sendEmail without swallowing them', async () => {
    sendEmailSpy.mockClear();
    sendEmailSpy.mockImplementationOnce(async () => {
      throw new Error('delivery failure');
    });

    await expect(
      runSendEmail({
        to: 'fail@example.com',
        kind: NotificationKind.PmsSelfReviewSubmitted,
        payload: {},
      }),
    ).rejects.toThrow('delivery failure');
  });
});
