// Preset env before imports (like other api tests)
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { app } from '../src/http/app';

describe('auth routes', () => {
  beforeAll(async () => {
    // Assume migrations already applied to public schema via drizzle-kit push.
    // Clean leftover rows from prior test runs.
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table "user" cascade`;
    await client.end({ timeout: 2 });
  });

  it('sign-up then sign-in produces a session cookie', async () => {
    const email = `u${Date.now()}@test.local`;
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'correct-horse-battery-staple-123',
        name: 'Test User',
      }),
    });
    expect(signUp.status).toBe(200);

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple-123' }),
    });
    expect(signIn.status).toBe(200);
    const setCookie = signIn.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('spa.session_token');
  });
});
