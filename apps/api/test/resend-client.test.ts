process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it, mock, spyOn } from 'bun:test';
import { Resend } from 'resend';

type PostOverload = typeof Resend.prototype.post;
const postStub = mock(async () => ({
  data: { id: 'test-email-id-123' },
  error: null,
  headers: null,
}));
const postSpy = spyOn(Resend.prototype, 'post' as keyof Resend).mockImplementation(
  postStub as unknown as PostOverload,
);

describe('notifications/resend — sendEmail', () => {
  it('throws when RESEND_API_KEY is missing', async () => {
    const saved = process.env.RESEND_API_KEY;
    // biome-ignore lint/performance/noDelete: truly removing env var to test missing-vars guard
    delete process.env.RESEND_API_KEY;

    let threw = false;
    try {
      const { sendEmail } = await import('../src/notifications/resend');
      await sendEmail({ to: 'a@b.com', subject: 'test', text: 'hi', html: '<p>hi</p>' });
    } catch (e) {
      threw = true;
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toContain('RESEND_API_KEY');
    }

    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
    expect(threw).toBe(true);
  });

  it('throws when RESEND_FROM_EMAIL is missing', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const saved = process.env.RESEND_FROM_EMAIL;
    // biome-ignore lint/performance/noDelete: truly removing env var to test missing-vars guard
    delete process.env.RESEND_FROM_EMAIL;

    let threw = false;
    try {
      const { sendEmail } = await import('../src/notifications/resend');
      await sendEmail({ to: 'a@b.com', subject: 'test', text: 'hi', html: '<p>hi</p>' });
    } catch (e) {
      threw = true;
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toContain('RESEND_FROM_EMAIL');
    }

    if (saved !== undefined) process.env.RESEND_FROM_EMAIL = saved;
    expect(threw).toBe(true);
  });

  it('calls Resend with the correct payload shape and returns { id }', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'no-reply@example.com';

    postSpy.mockImplementationOnce(
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      mock(async () => ({ data: { id: 'email-abc-456' }, error: null, headers: null })) as any,
    );

    const { sendEmail } = await import('../src/notifications/resend');
    const result = await sendEmail({
      to: 'staff@example.com',
      subject: 'Hello',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
    });

    expect(result).toEqual({ id: 'email-abc-456' });
    expect(postSpy).toHaveBeenCalled();

    const lastCall = postSpy.mock.calls[postSpy.mock.calls.length - 1] as unknown as [
      string,
      Record<string, unknown>,
    ];
    const [path, payload] = lastCall;
    expect(path).toBe('/emails');
    expect(payload.from).toBe('no-reply@example.com');
    expect(payload.to).toEqual(['staff@example.com']);
    expect(payload.subject).toBe('Hello');
    expect(payload.text).toBe('Plain text body');
    expect(payload.html).toBe('<p>HTML body</p>');
  });

  it('throws when Resend returns an error response', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'no-reply@example.com';

    postSpy.mockImplementationOnce(
      mock(async () => ({
        data: null,
        error: { message: 'Invalid from address', statusCode: 422, name: 'invalid_from_address' },
        headers: null,
      })) as unknown as PostOverload,
    );

    const { sendEmail } = await import('../src/notifications/resend');

    let threw = false;
    try {
      await sendEmail({ to: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' });
    } catch (e) {
      threw = true;
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toContain('Invalid from address');
    }

    expect(threw).toBe(true);
  });
});
