import { describe, expect, it, beforeAll } from 'bun:test';
import { readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';

describe('org schema', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    client = postgres(url, { max: 1 });
    const dir = './src/db/migrations';
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = await Bun.file(`${dir}/${f}`).text();
      await client.unsafe(sql);
    }
    db = drizzle(client, { schema });
  });

  it('inserts + reads an organization', async () => {
    const [inserted] = await db.insert(schema.organization).values({ name: 'Acme Sdn Bhd' }).returning();
    expect(inserted?.name).toBe('Acme Sdn Bhd');
  });
});
