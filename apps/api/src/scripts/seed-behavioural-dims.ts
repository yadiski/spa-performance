#!/usr/bin/env bun
/**
 * Idempotent upsert of all 22 behavioural dimensions into the database.
 * Run from apps/api/: `bun src/scripts/seed-behavioural-dims.ts`
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { behaviouralDimension } from '../db/schema';

type Dim = {
  code: string;
  title: string;
  description: string;
  order: number;
  anchors: string[];
};

const json = readFileSync('../../infra/seeds/behavioural-dimensions.json', 'utf-8');
const { dimensions } = JSON.parse(json) as { dimensions: Dim[] };

if (dimensions.length !== 22) {
  throw new Error(`expected 22 dimensions, got ${dimensions.length}`);
}

for (const d of dimensions) {
  if (d.anchors.length !== 5) {
    throw new Error(`dimension ${d.code} must have exactly 5 anchors, got ${d.anchors.length}`);
  }
}

console.log(`[seed] upserting ${dimensions.length} behavioural dimensions…`);

for (const d of dimensions) {
  await db
    .insert(behaviouralDimension)
    .values({
      code: d.code,
      title: d.title,
      description: d.description,
      order: d.order,
      anchors: d.anchors,
    })
    .onConflictDoUpdate({
      target: behaviouralDimension.code,
      set: {
        title: d.title,
        description: d.description,
        order: d.order,
        anchors: d.anchors,
        updatedAt: new Date(),
      },
    });
}

const result = await db.execute(sql`select count(*)::int as n from behavioural_dimension`);
const rows = (
  Array.isArray(result) ? result : ((result as { rows?: Array<{ n: number }> }).rows ?? [])
) as Array<{ n: number }>;
console.log(`[seed] done — ${rows.length > 0 ? rows[0]?.n : '?'} dimensions in DB`);
process.exit(0);
