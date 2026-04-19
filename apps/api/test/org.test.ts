process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as schema from '../src/db/schema';

describe('org schema', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });
  });

  it('inserts + reads an organization', async () => {
    const [inserted] = await db
      .insert(schema.organization)
      .values({ name: 'Acme Sdn Bhd' })
      .returning();
    expect(inserted?.name).toBe('Acme Sdn Bhd');
  });
});
