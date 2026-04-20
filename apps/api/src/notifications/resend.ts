import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    throw new Error('Resend env vars missing: RESEND_API_KEY is required');
  }
  if (!fromEmail) {
    throw new Error('Resend env vars missing: RESEND_FROM_EMAIL is required');
  }

  const client = new Resend(apiKey);

  const result = await client.emails.send({
    from: fromEmail,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  return { id: result.data!.id };
}
