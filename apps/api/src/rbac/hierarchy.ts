import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';

export type StaffRow = { id: string; name: string; employeeNo: string; depth: number };

export async function directReports(db: DB, managerId: string): Promise<StaffRow[]> {
  const rows = await db.execute<StaffRow>(sql`
    select id, name, employee_no as "employeeNo", 1 as depth
    from staff
    where manager_id = ${managerId}
    order by name asc
  `);
  // execute returns an array or result with rows property depending on driver
  return Array.isArray(rows) ? rows : (rows as any)?.rows || [];
}

export async function transitiveReports(db: DB, managerId: string, maxDepth: number): Promise<StaffRow[]> {
  const rows = await db.execute<StaffRow>(sql`
    with recursive tree as (
      select id, name, employee_no, manager_id, 1 as depth
      from staff where manager_id = ${managerId}
      union all
      select s.id, s.name, s.employee_no, s.manager_id, tree.depth + 1
      from staff s join tree on s.manager_id = tree.id
      where tree.depth < ${maxDepth}
    )
    select id, name, employee_no as "employeeNo", depth from tree
    order by depth, name
  `);
  // execute returns an array or result with rows property depending on driver
  return Array.isArray(rows) ? rows : (rows as any)?.rows || [];
}
