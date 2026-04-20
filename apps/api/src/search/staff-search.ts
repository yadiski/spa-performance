import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/middleware';
import type { DB } from '../db/client';
import { staffReadScope } from '../rbac/scope';

export interface StaffSearchInput {
  q: string;
  limit: number;
  offset: number;
}

export interface StaffSearchHit {
  id: string;
  name: string;
  employeeNo: string;
  email: string;
  departmentName: string;
  designation: string;
  score: number;
}

function dbRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function searchStaff(
  db: DB,
  actor: Actor,
  input: StaffSearchInput,
): Promise<{ items: StaffSearchHit[]; total: number }> {
  const scopePredicate = await staffReadScope(db, actor);

  const limit = Math.min(input.limit, 100);
  const offset = input.offset;
  const q = input.q.trim();

  if (q === '') {
    // Empty query: top-N scoped staff by name
    // NOTE: staffReadScope references the bare table name "staff" (not aliased),
    // so our FROM clause must not alias it.
    const rows = dbRows<{
      id: string;
      name: string;
      employee_no: string;
      email: string;
      department_name: string;
      designation: string;
    }>(
      await db.execute(sql`
        SELECT
          staff.id,
          staff.name,
          staff.employee_no,
          "user".email,
          department.name AS department_name,
          staff.designation
        FROM staff
        JOIN "user" ON "user".id = staff.user_id
        JOIN department ON department.id = staff.department_id
        WHERE ${scopePredicate}
        ORDER BY staff.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
    );

    const totalRows = dbRows<{ n: string }>(
      await db.execute(sql`
        SELECT count(*)::text AS n FROM staff WHERE ${scopePredicate}
      `),
    );

    const total = Number(totalRows[0]?.n ?? 0);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        employeeNo: r.employee_no,
        email: r.email,
        departmentName: r.department_name,
        designation: r.designation,
        score: 1,
      })),
      total,
    };
  }

  // Trigram search — use similarity threshold OR ilike for prefix matches
  const rows = dbRows<{
    id: string;
    name: string;
    employee_no: string;
    email: string;
    department_name: string;
    designation: string;
    score: string;
  }>(
    await db.execute(sql`
      SELECT
        staff.id,
        staff.name,
        staff.employee_no,
        "user".email,
        department.name AS department_name,
        staff.designation,
        similarity(lower(staff.search_text), lower(${q})) AS score
      FROM staff
      JOIN "user" ON "user".id = staff.user_id
      JOIN department ON department.id = staff.department_id
      WHERE ${scopePredicate}
        AND (
          lower(staff.search_text) % lower(${q})
          OR lower(staff.search_text) LIKE lower(${q}) || '%'
          OR lower(staff.search_text) LIKE '% ' || lower(${q}) || '%'
        )
      ORDER BY similarity(lower(staff.search_text), lower(${q})) DESC, staff.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `),
  );

  const totalRows = dbRows<{ n: string }>(
    await db.execute(sql`
      SELECT count(*)::text AS n
      FROM staff
      WHERE ${scopePredicate}
        AND (
          lower(staff.search_text) % lower(${q})
          OR lower(staff.search_text) LIKE lower(${q}) || '%'
          OR lower(staff.search_text) LIKE '% ' || lower(${q}) || '%'
        )
    `),
  );

  const total = Number(totalRows[0]?.n ?? 0);

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      employeeNo: r.employee_no,
      email: r.email,
      departmentName: r.department_name,
      designation: r.designation,
      score: Number(r.score),
    })),
    total,
  };
}
