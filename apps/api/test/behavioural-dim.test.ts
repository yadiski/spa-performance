process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { behaviouralDimension } from '../src/db/schema';

describe('behavioural_dimension seed', () => {
  it('has exactly 22 dimensions loaded', async () => {
    const rows = await db.select().from(behaviouralDimension);
    expect(rows.length).toBe(22);
  });

  it('every dimension has exactly 5 anchor strings', async () => {
    const rows = await db.select().from(behaviouralDimension);
    for (const row of rows) {
      expect(Array.isArray(row.anchors)).toBe(true);
      const anchors = row.anchors as unknown as string[];
      expect(anchors.length).toBe(5);
      for (const anchor of anchors) {
        expect(typeof anchor).toBe('string');
        expect(anchor.length).toBeGreaterThan(0);
      }
    }
  });

  it('codes are unique + non-empty', async () => {
    const rows = await db.select().from(behaviouralDimension);
    const codes = rows.map((r) => r.code);
    expect(new Set(codes).size).toBe(22);
    for (const code of codes) expect(code.length).toBeGreaterThan(0);
  });

  it('has communication_skills dimension with expected anchors', async () => {
    const [row] = await db
      .select()
      .from(behaviouralDimension)
      .where(sql`code = 'communication_skills'`);
    expect(row?.title).toBe('Communication Skills');
    expect((row?.anchors as string[]).length).toBe(5);
  });
});
