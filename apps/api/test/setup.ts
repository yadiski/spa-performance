import { afterAll, beforeAll } from 'bun:test';
import postgres from 'postgres';

const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const schema = `test_${crypto.randomUUID().replace(/-/g, '_').slice(0, 12)}`;

let adminSql: ReturnType<typeof postgres>;
let testSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  adminSql = postgres(adminUrl, { max: 1 });
  await adminSql.unsafe(`create schema if not exists ${schema}`);
  const testUrl = `${adminUrl}?search_path=${schema}`;
  testSql = postgres(testUrl, { max: 5 });
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.TEST_SCHEMA = schema;
  globalThis.__testSql = testSql;
});

afterAll(async () => {
  await testSql?.end({ timeout: 2 });
  await adminSql.unsafe(`drop schema if exists ${schema} cascade`);
  await adminSql.end({ timeout: 2 });
});

declare global {
  // eslint-disable-next-line no-var
  var __testSql: ReturnType<typeof postgres>;
}
