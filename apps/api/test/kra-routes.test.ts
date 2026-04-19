process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { app } from '../src/http/app';

describe('POST /api/v1/kra/*', () => {
  it('401 without cookie on /draft', async () => {
    const res = await app.request('/api/v1/kra/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('401 without cookie on /submit/:id', async () => {
    const res = await app.request('/api/v1/kra/submit/00000000-0000-0000-0000-000000000000', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('401 without cookie on /approve', async () => {
    const res = await app.request('/api/v1/kra/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycleId: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(401);
  });
});
