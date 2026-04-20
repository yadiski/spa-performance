process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it, mock, spyOn } from 'bun:test';

describe('storage/r2', () => {
  it('put — throws when R2 env vars are missing', async () => {
    const saved = {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: process.env.R2_BUCKET,
    };
    // biome-ignore lint/performance/noDelete: truly removing env vars to test missing-vars guard
    delete process.env.R2_ACCOUNT_ID;
    // biome-ignore lint/performance/noDelete: truly removing env vars to test missing-vars guard
    delete process.env.R2_ACCESS_KEY_ID;
    // biome-ignore lint/performance/noDelete: truly removing env vars to test missing-vars guard
    delete process.env.R2_SECRET_ACCESS_KEY;
    // biome-ignore lint/performance/noDelete: truly removing env vars to test missing-vars guard
    delete process.env.R2_BUCKET;

    let threw = false;
    try {
      const { put } = await import('../src/storage/r2');
      await put('test/key.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');
    } catch (e) {
      threw = true;
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toContain('R2 env vars missing');
    }

    if (saved.R2_ACCOUNT_ID !== undefined) process.env.R2_ACCOUNT_ID = saved.R2_ACCOUNT_ID;
    if (saved.R2_ACCESS_KEY_ID !== undefined) process.env.R2_ACCESS_KEY_ID = saved.R2_ACCESS_KEY_ID;
    if (saved.R2_SECRET_ACCESS_KEY !== undefined)
      process.env.R2_SECRET_ACCESS_KEY = saved.R2_SECRET_ACCESS_KEY;
    if (saved.R2_BUCKET !== undefined) process.env.R2_BUCKET = saved.R2_BUCKET;

    expect(threw).toBe(true);
  });

  it('put — computes correct sha256 for known input', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET = 'test-bucket';

    const { S3Client } = await import('@aws-sdk/client-s3');
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    spyOn(S3Client.prototype, 'send' as any).mockImplementation(mock(async () => ({})));

    const { put } = await import('../src/storage/r2');

    // Known sha256: echo -n "hello" | sha256sum = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const bytes = new TextEncoder().encode('hello');
    const { sha256 } = await put('test/key.pdf', bytes, 'application/pdf');

    expect(sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('getSignedUrl — returns a presigned URL string', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET = 'test-bucket';

    const { getSignedUrl } = await import('../src/storage/r2');
    const url = await getSignedUrl('pms/cycle-123/snap-456.pdf', 3600);

    expect(typeof url).toBe('string');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('X-Amz-Signature');
  });
});
