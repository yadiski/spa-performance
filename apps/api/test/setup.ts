import { afterAll, beforeAll } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

const url = process.env.DATABASE_URL;
const migrationsDir = resolve(import.meta.dir, '../src/db/migrations');
const seedJsonPath = resolve(import.meta.dir, '../../../infra/seeds/behavioural-dimensions.json');

let adminSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  adminSql = postgres(url, { max: 1 });

  await adminSql`create table if not exists __test_migrations (tag text primary key, applied_at timestamptz default now())`;
  const applied = new Set(
    ((await adminSql`select tag from __test_migrations`) as Array<{ tag: string }>).map(
      (r) => r.tag,
    ),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(resolve(migrationsDir, file), 'utf-8');
    for (const stmt of body.split(/-->\s*statement-breakpoint/)) {
      const trimmed = stmt.trim();
      if (trimmed) await adminSql.unsafe(trimmed);
    }
    await adminSql`insert into __test_migrations (tag) values (${file})`;
  }

  const seedRaw = readFileSync(seedJsonPath, 'utf-8');
  const { dimensions } = JSON.parse(seedRaw) as {
    dimensions: Array<{
      code: string;
      title: string;
      description: string;
      order: number;
      anchors: string[];
    }>;
  };
  for (const d of dimensions) {
    await adminSql`
      insert into behavioural_dimension (code, title, description, "order", anchors)
      values (${d.code}, ${d.title}, ${d.description}, ${d.order}, ${JSON.stringify(d.anchors)}::jsonb)
      on conflict (code) do update set
        title = excluded.title,
        description = excluded.description,
        "order" = excluded."order",
        anchors = excluded.anchors,
        updated_at = now()
    `;
  }
});

afterAll(async () => {
  await adminSql?.end({ timeout: 2 });
});
