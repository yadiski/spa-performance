import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgres'),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  API_PORT: z.coerce.number().int().min(1).max(65535),
  WEB_ORIGIN: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Comma-separated list of additional allowed CORS origins (e.g. staging front-ends). */
  ADDITIONAL_CORS_ORIGINS: z.string().optional(),
  /** Sentry DSN — optional; when set wire up @sentry/bun in index.ts. */
  SENTRY_DSN: z.string().optional(),
  /** Shared secret for /api/v1/healthz/deep — pass via X-Health-Token header. */
  HEALTH_CHECK_TOKEN: z.string().optional(),
});
export type Env = z.infer<typeof schema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid env: ${msg}`);
  }
  return result.data;
}
