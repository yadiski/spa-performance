/**
 * T7 — Session timeout and kill-all-sessions tests
 */
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { app } from '../src/http/app';

const PW = 'correct-horse-battery-staple-sessions-T7!';

async function signUp(email: string): Promise<void> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name: 'Session Test' }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
}

async function signIn(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  return res.headers.get('set-cookie') ?? '';
}

describe('session management', () => {
  let cookie: string;
  const ts = Date.now();
  const email = `session-test-${ts}@t.local`;

  beforeAll(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table "user" cascade`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });

    await signUp(email);
    cookie = await signIn(email);
  });

  it('can access /api/v1/me with valid session', async () => {
    const res = await app.request('/api/v1/me', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/v1/auth/logout-all kills all sessions for self', async () => {
    // Get a second session
    const cookie2 = await signIn(email);
    expect(cookie2).not.toBe('');

    // Logout all sessions using first cookie
    const res = await app.request('/api/v1/auth/logout-all', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Both sessions should now be invalid
    const meRes = await app.request('/api/v1/me', {
      headers: { cookie: cookie2 },
    });
    expect(meRes.status).toBe(401);
  });

  it('POST /api/v1/admin/auth/logout-user requires it_admin', async () => {
    // Re-sign in since we killed all sessions above
    cookie = await signIn(email);

    const res = await app.request('/api/v1/admin/auth/logout-user', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001', reason: 'test' }),
    });
    // Should be 403 (no it_admin role) since this user has no role
    expect(res.status).toBe(403);
  });

  it('POST /api/v1/auth/logout-all without auth returns 401', async () => {
    const res = await app.request('/api/v1/auth/logout-all', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});
