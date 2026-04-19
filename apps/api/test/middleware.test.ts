process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('requireAuth middleware', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await app.request('/api/v1/me');
    expect(res.status).toBe(401);
  });
});
