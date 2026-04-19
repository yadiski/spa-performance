process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { KraPerspective, PmsCommentRole, PotentialWindow } from '@spa/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import {
  saveBehaviouralRatings,
  saveCareerDevelopment,
  savePersonalGrowth,
  savePmsComment,
  savePmsKraRatings,
  saveStaffContributions,
} from '../src/domain/pms/service';

function mkActor(o: Partial<Actor>): Actor {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    staffId: null,
    roles: [],
    email: 'x@t',
    ip: null,
    ua: null,
    ...o,
  };
}

describe('pms save services', () => {
  let cycleId: string;
  let mgrUserId: string;
  let mgrStaffId: string;
  let staffUserId: string;
  let staffStaffId: string;
  let kraIds: string[];

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    // Ensure behavioural_dimension seed survives the truncate (it's not in the truncate list because we want
    // to keep the 22 dims. The beforeEach of schema-tests truncates specific tables, avoiding this one.)
    // If empty, re-run the seed script once manually before this test run.
    const dimsCount = await db.select().from(s.behaviouralDimension);
    if (dimsCount.length === 0) {
      throw new Error(
        'behavioural_dimension is empty — run: bun apps/api/src/scripts/seed-behavioural-dims.ts',
      );
    }

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [d] = await db
      .insert(s.department)
      .values({ orgId: o!.id, code: 'IT', name: 'IT' })
      .returning();
    const [g] = await db
      .insert(s.grade)
      .values({ orgId: o!.id, code: 'E10', rank: '10' })
      .returning();

    const [mgrU] = await db.insert(s.user).values({ email: 'mgr@t', name: 'MGR' }).returning();
    const [stU] = await db.insert(s.user).values({ email: 'st@t', name: 'Staff' }).returning();
    mgrUserId = mgrU!.id;
    staffUserId = stU!.id;

    const [mgrSt] = await db
      .insert(s.staff)
      .values({
        userId: mgrU!.id,
        orgId: o!.id,
        employeeNo: 'MGR1',
        name: 'MGR',
        designation: 'Manager',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    mgrStaffId = mgrSt!.id;
    const [staffSt] = await db
      .insert(s.staff)
      .values({
        userId: stU!.id,
        orgId: o!.id,
        employeeNo: 'ST1',
        name: 'Staff',
        designation: 'Engineer',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: mgrSt!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    staffStaffId = staffSt!.id;

    await db.insert(s.staffRole).values([
      { staffId: mgrSt!.id, role: 'appraiser' },
      { staffId: staffSt!.id, role: 'staff' },
    ]);

    const [cy] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: staffStaffId,
        fy: 2026,
        state: 'pms_awaiting_appraiser',
      })
      .returning();
    cycleId = cy!.id;

    const kraIn = (order: number, weight = 50) => ({
      cycleId: cy!.id,
      perspective: KraPerspective.Financial,
      description: `KRA ${order + 1}`,
      weightPct: weight,
      measurement: 'm',
      target: 't',
      order,
      rubric1to5: ['a', 'b', 'c', 'd', 'e'],
    });
    const k1 = await db.insert(s.kra).values(kraIn(0)).returning();
    const k2 = await db.insert(s.kra).values(kraIn(1)).returning();
    kraIds = [k1[0]!.id, k2[0]!.id];
  });

  const mgrActor = () => mkActor({ userId: mgrUserId, staffId: mgrStaffId, roles: ['appraiser'] });
  const staffActor = () =>
    mkActor({ userId: staffUserId, staffId: staffStaffId, roles: ['staff'] });

  it('savePmsKraRatings stores ratings', async () => {
    const r = await savePmsKraRatings(db, mgrActor(), {
      cycleId,
      ratings: [
        { kraId: kraIds[0]!, resultAchieved: 'delivered', finalRating: 4 },
        { kraId: kraIds[1]!, resultAchieved: 'partial', finalRating: 3, comment: 'room to grow' },
      ],
    });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(s.pmsKraRating);
    expect(rows.length).toBe(2);
  });

  it('savePmsKraRatings rejects non-manager', async () => {
    const r = await savePmsKraRatings(db, staffActor(), {
      cycleId,
      ratings: [{ kraId: kraIds[0]!, resultAchieved: 'x', finalRating: 4 }],
    });
    expect(r.ok).toBe(false);
  });

  it('saveBehaviouralRatings requires matching anchor text', async () => {
    // Find a real dim + anchor to use
    const [dim] = await db
      .select()
      .from(s.behaviouralDimension)
      .where(sql`code = 'communication_skills'`);
    const anchors = dim!.anchors as string[];
    const r = await saveBehaviouralRatings(db, mgrActor(), {
      cycleId,
      ratings: [
        { dimensionCode: 'communication_skills', rating1to5: 4, rubricAnchorText: anchors[3]! },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('saveBehaviouralRatings rejects wrong anchor text', async () => {
    const r = await saveBehaviouralRatings(db, mgrActor(), {
      cycleId,
      ratings: [
        { dimensionCode: 'communication_skills', rating1to5: 4, rubricAnchorText: 'bogus' },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('saveStaffContributions with weights summing to 5%', async () => {
    const r = await saveStaffContributions(db, mgrActor(), {
      cycleId,
      contributions: [
        { whenDate: 'Feb 2026', achievement: 'Org-wide training', weightPct: 3 },
        { whenDate: 'Aug 2026', achievement: 'Mentorship program', weightPct: 2 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('saveCareerDevelopment upserts one row per pms', async () => {
    const r1 = await saveCareerDevelopment(db, mgrActor(), {
      cycleId,
      potentialWindow: PotentialWindow.OneToTwoYears,
      comments: 'strong trajectory',
    });
    expect(r1.ok).toBe(true);
    const r2 = await saveCareerDevelopment(db, mgrActor(), {
      cycleId,
      potentialWindow: PotentialWindow.Now,
      comments: 'promote',
    });
    expect(r2.ok).toBe(true);
    const rows = await db.select().from(s.careerDevelopment);
    expect(rows.length).toBe(1);
    expect(rows[0]?.potentialWindow).toBe('now');
  });

  it('savePersonalGrowth upserts one row per pms', async () => {
    const r = await savePersonalGrowth(db, mgrActor(), {
      cycleId,
      trainingNeeds: 'Cloud architecture',
    });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(s.personalGrowth);
    expect(rows.length).toBe(1);
  });

  it('savePmsComment (appraiser) creates unsigned row', async () => {
    const r = await savePmsComment(db, mgrActor(), {
      cycleId,
      role: PmsCommentRole.Appraiser,
      body: 'Overall steady performance.',
    });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(s.pmsComment);
    expect(rows.length).toBe(1);
    expect(rows[0]?.signedAt).toBeNull();
  });

  it('savePmsComment (appraisee) rejects when not owner', async () => {
    // Create a different user/staff
    const [other] = await db.insert(s.user).values({ email: 'other@t', name: 'Other' }).returning();
    const otherActor = mkActor({ userId: other!.id, staffId: null, roles: ['staff'] });
    const r = await savePmsComment(db, otherActor, {
      cycleId,
      role: PmsCommentRole.Appraisee,
      body: 'hi',
    });
    expect(r.ok).toBe(false);
  });
});
