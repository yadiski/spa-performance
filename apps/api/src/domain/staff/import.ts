import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import * as s from '../../db/schema';

const rowSchema = z.object({
  employee_no: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  designation: z.string().min(1),
  department_code: z.string().min(1),
  grade_code: z.string().min(1),
  manager_employee_no: z.string().optional().default(''),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roles: z.string().optional().default(''),
});

export type ImportReport = {
  created: number;
  updated: number;
  errors: string[];
};

function extractRows(execResult: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(execResult)) return execResult as Array<Record<string, unknown>>;
  const rows = (execResult as { rows?: unknown[] } | undefined)?.rows;
  return (rows ?? []) as Array<Record<string, unknown>>;
}

export async function importStaffCsv(orgId: string, csv: string): Promise<ImportReport> {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return { created: 0, updated: 0, errors: ['empty csv'] };
  const header = lines[0]!.split(',').map((h) => h.trim());
  const data = lines.slice(1).map((l) => {
    const vals = l.split(',');
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (vals[i] ?? '').trim();
    });
    return obj;
  });

  const report: ImportReport = { created: 0, updated: 0, errors: [] };
  const empToStaffId = new Map<string, string>();

  // Pass 1: upsert staff (without manager linkage)
  for (const raw of data) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      report.errors.push(
        `row ${raw.employee_no ?? '?'}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
      continue;
    }
    const r = parsed.data;

    await db.transaction(async (tx) => {
      const [dept] = await tx
        .select()
        .from(s.department)
        .where(sql`code = ${r.department_code} and org_id = ${orgId}`);
      const [grade] = await tx
        .select()
        .from(s.grade)
        .where(sql`code = ${r.grade_code} and org_id = ${orgId}`);
      if (!dept || !grade) {
        report.errors.push(`row ${r.employee_no}: missing dept or grade`);
        return;
      }

      // user upsert by email
      const existingUser = extractRows(
        await tx.execute(sql`select id from "user" where email = ${r.email}`),
      );
      let userId = existingUser[0]?.id as string | undefined;
      if (!userId) {
        const [u] = await tx.insert(s.user).values({ email: r.email, name: r.name }).returning();
        userId = u!.id;
      }

      // staff upsert by employee_no
      const existingStaff = extractRows(
        await tx.execute(sql`select id from staff where employee_no = ${r.employee_no}`),
      );
      let staffId: string;
      if (existingStaff[0]) {
        staffId = existingStaff[0].id as string;
        await tx
          .update(s.staff)
          .set({
            name: r.name,
            designation: r.designation,
            departmentId: dept.id,
            gradeId: grade.id,
            updatedAt: new Date(),
          })
          .where(sql`id = ${staffId}`);
        report.updated += 1;
      } else {
        const [st] = await tx
          .insert(s.staff)
          .values({
            orgId,
            userId: userId!,
            employeeNo: r.employee_no,
            name: r.name,
            designation: r.designation,
            departmentId: dept.id,
            gradeId: grade.id,
            managerId: null,
            hireDate: r.hire_date,
          })
          .returning();
        staffId = st!.id;
        report.created += 1;
      }
      empToStaffId.set(r.employee_no, staffId);

      // roles: replace-all
      if (r.roles) {
        await tx.delete(s.staffRole).where(sql`staff_id = ${staffId}`);
        for (const role of r.roles
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean)) {
          await tx.insert(s.staffRole).values({ staffId, role: role as never });
        }
      }
    });
  }

  // Pass 2: link managers
  for (const raw of data) {
    if (!raw.manager_employee_no) continue;
    const childId = empToStaffId.get(raw.employee_no!);
    const mgrId = empToStaffId.get(raw.manager_employee_no);
    if (!childId || !mgrId) {
      report.errors.push(`row ${raw.employee_no}: manager ${raw.manager_employee_no} not found`);
      continue;
    }
    await db.execute(sql`update staff set manager_id = ${mgrId} where id = ${childId}`);
  }

  return report;
}
