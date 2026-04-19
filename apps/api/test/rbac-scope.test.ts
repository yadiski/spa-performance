process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { staffReadScope } from '../src/rbac/scope';
import type { Actor } from '../src/auth/middleware';

function mkActor(overrides: Partial<Actor>): Actor {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    staffId: null,
    roles: [],
    email: 'x@t',
    ip: null,
    ua: null,
    ...overrides,
  };
}

describe('staffReadScope', () => {
  let ceoStaff: string, vpStaff: string, mgrStaff: string, icStaff: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

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

  async function visibleIds(actor: Actor): Promise<string[]> {
    const pred = await staffReadScope(db, actor);
    const result = await db.execute(sql`select id from staff where ${pred}`);
    const rows: Array<{ id: string }> = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    return rows.map((r) => r.id).sort();
  }

  it('staff role only sees self', async () => {
    const ids = await visibleIds(mkActor({ roles: ['staff'], staffId: icStaff }));
    expect(ids).toEqual([icStaff]);
  });

  it('appraiser sees self + direct reports', async () => {
    const ids = await visibleIds(mkActor({ roles: ['appraiser'], staffId: vpStaff }));
    expect(ids).toEqual([vpStaff, mgrStaff].sort());
  });

  it('next_level sees self + two levels down', async () => {
    const ids = await visibleIds(mkActor({ roles: ['next_level'], staffId: vpStaff }));
    expect(ids).toEqual([vpStaff, mgrStaff, icStaff].sort());
  });

  it('hra sees all', async () => {
    const ids = await visibleIds(mkActor({ roles: ['hra'], staffId: null }));
    expect(ids.length).toBe(4);
  });

  it('actor with no roles and no staffId sees nothing', async () => {
    const ids = await visibleIds(mkActor({ roles: [], staffId: null }));
    expect(ids).toEqual([]);
  });

  it('department_head sees entire department', async () => {
    const ids = await visibleIds(mkActor({ roles: ['department_head'], staffId: vpStaff }));
    // Entire IT department = all 4 (they're all in same dept from seeding)
    expect(ids.length).toBe(4);
  });
});
