import type { Sql } from 'postgres';

/**
 * Runs a callback inside a transaction and ALWAYS rolls back.
 */
export async function inRollback<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = globalThis.__testSql;
  let value!: T;
  try {
    await sql.begin(async (tx) => {
      value = await fn(tx as unknown as Sql);
      throw new Error('__rollback__');
    });
  } catch (e) {
    if (e instanceof Error && e.message === '__rollback__') return value;
    throw e;
  }
  return value;
}
