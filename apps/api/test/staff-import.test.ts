process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { importStaffCsv } from '../src/domain/staff/import';

const csvPath = resolve(import.meta.dir, '../../../infra/seeds/sample-staff.csv');

describe('importStaffCsv', () => {
  let orgId: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    orgId = o!.id;
    await db.insert(s.department).values([
      { orgId, code: 'EXEC', name: 'Executive' },
      { orgId, code: 'OPS', name: 'Operations' },
      { orgId, code: 'IT', name: 'Information Tech' },
    ]);
    await db.insert(s.grade).values([
      { orgId, code: 'E12', rank: '12' },
      { orgId, code: 'E11', rank: '11' },
      { orgId, code: 'E09', rank: '9' },
      { orgId, code: 'E07', rank: '7' },
    ]);
  });

  it('imports all 4 staff and links manager chain', async () => {
    const csv = readFileSync(csvPath, 'utf-8');
    const report = await importStaffCsv(orgId, csv);

    expect(report.created).toBe(4);
    expect(report.updated).toBe(0);
    expect(report.errors).toEqual([]);

    const staffRows = await db.select().from(s.staff).orderBy(s.staff.employeeNo);
    expect(staffRows.length).toBe(4);

    const byEmp: Record<string, (typeof staffRows)[number]> = {};
    for (const row of staffRows) byEmp[row.employeeNo] = row;

    expect(byEmp.E001?.managerId).toBeNull();
    expect(byEmp.E002?.managerId).toBe(byEmp.E001!.id);
    expect(byEmp.E003?.managerId).toBe(byEmp.E002!.id);
    expect(byEmp.E004?.managerId).toBe(byEmp.E003!.id);

    const roles = await db.select().from(s.staffRole);
    const byStaff: Record<string, string[]> = {};
    for (const r of roles) {
      if (!byStaff[r.staffId]) byStaff[r.staffId] = [];
      byStaff[r.staffId]!.push(r.role);
    }
    expect(byStaff[byEmp.E001!.id]?.sort()).toEqual(['hra']);
    expect(byStaff[byEmp.E002!.id]?.sort()).toEqual(['appraiser', 'next_level']);
    expect(byStaff[byEmp.E004!.id]?.sort()).toEqual(['staff']);
  });

  it('re-import is idempotent: second run reports updated=4, created=0', async () => {
    const csv = readFileSync(csvPath, 'utf-8');
    await importStaffCsv(orgId, csv);
    const second = await importStaffCsv(orgId, csv);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(4);
    expect(second.errors).toEqual([]);
  });

  it('reports missing department code as error', async () => {
    const badCsv = `employee_no,email,name,designation,department_code,grade_code,manager_employee_no,hire_date,roles
E999,x@t,X,Role,BOGUS,E07,,2022-01-01,staff`;
    const report = await importStaffCsv(orgId, badCsv);
    expect(report.created).toBe(0);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});
