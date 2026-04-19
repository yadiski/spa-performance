import { describe, expect, it, beforeEach } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as s from '../src/db/schema';
import { directReports, transitiveReports } from '../src/rbac/hierarchy';

describe('hierarchy resolvers', () => {
  const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/spa';
  const client = postgres(adminUrl, { max: 1 });
  const db = drizzle(client, { schema: s });
  let ceoStaff: string, vpStaff: string, mgrStaff: string, icStaff: string;

  beforeEach(async () => {
    // cascade-truncate everything that depends on user/org/dept/grade
    await client.unsafe(`truncate table staff_role, staff, grade, department, organization, "user" cascade`);

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [d] = await db.insert(s.department).values({ orgId: o!.id, name: 'IT', code: 'IT' }).returning();
    const [g] = await db.insert(s.grade).values({ orgId: o!.id, code: 'E10', rank: '10' }).returning();

    const mkUser = async (email: string, name: string) => {
      const [u] = await db.insert(s.user).values({ email, name }).returning();
      return u!.id;
    };
    const mkStaff = async (userId: string, employeeNo: string, name: string, mgr: string | null) => {
      const [x] = await db
        .insert(s.staff)
        .values({
          userId,
          orgId: o!.id,
          employeeNo,
          name,
          designation: 'role',
          departmentId: d!.id,
          gradeId: g!.id,
          managerId: mgr,
          hireDate: '2020-01-01',
        })
        .returning();
      return x!.id;
    };

    ceoStaff = await mkStaff(await mkUser('ceo@t', 'CEO'), 'E001', 'CEO', null);
    vpStaff = await mkStaff(await mkUser('vp@t', 'VP'), 'E002', 'VP', ceoStaff);
    mgrStaff = await mkStaff(await mkUser('mgr@t', 'MGR'), 'E003', 'MGR', vpStaff);
    icStaff = await mkStaff(await mkUser('ic@t', 'IC'), 'E004', 'IC', mgrStaff);
  });

  it('directReports returns only immediate reports', async () => {
    const reports = await directReports(db, vpStaff);
    expect(reports.map((r) => r.id)).toEqual([mgrStaff]);
  });

  it('transitiveReports with depth 2 returns 2 levels', async () => {
    const reports = await transitiveReports(db, vpStaff, 2);
    expect(reports.map((r) => r.id).sort()).toEqual([mgrStaff, icStaff].sort());
  });

  it('directReports on leaf returns empty', async () => {
    const reports = await directReports(db, icStaff);
    expect(reports).toEqual([]);
  });
});
