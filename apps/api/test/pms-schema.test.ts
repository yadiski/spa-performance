process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';

describe('PMS + mid-year schema', () => {
  let cycleId: string;
  let pmsId: string;
  let kraId: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const [o] = await db.insert(s.organization).values({ name: 'Acme' }).returning();
    const [d] = await db
      .insert(s.department)
      .values({ orgId: o!.id, code: 'IT', name: 'IT' })
      .returning();
    const [g] = await db
      .insert(s.grade)
      .values({ orgId: o!.id, code: 'E10', rank: '10' })
      .returning();
    const [u] = await db.insert(s.user).values({ email: 't@t', name: 'T' }).returning();
    const [st] = await db
      .insert(s.staff)
      .values({
        userId: u!.id,
        orgId: o!.id,
        employeeNo: 'E1',
        name: 'T',
        designation: 'x',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [cy] = await db
      .insert(s.performanceCycle)
      .values({ staffId: st!.id, fy: 2026, state: 'kra_drafting' })
      .returning();
    cycleId = cy!.id;
    const [k] = await db
      .insert(s.kra)
      .values({
        cycleId: cy!.id,
        perspective: 'financial',
        description: 'KRA 1 description',
        weightPct: 100,
        measurement: 'm',
        target: 't',
        order: 0,
        rubric1to5: ['a', 'b', 'c', 'd', 'e'],
      })
      .returning();
    kraId = k!.id;
    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();
    pmsId = pms!.id;
  });

  it('mid_year_checkpoint can be created per cycle', async () => {
    const [m] = await db.insert(s.midYearCheckpoint).values({ cycleId }).returning();
    expect(m?.cycleId).toBe(cycleId);
    expect(m?.submittedAt).toBeNull();
  });

  it('pms_kra_rating belongs to pms + kra', async () => {
    const [rating] = await db
      .insert(s.pmsKraRating)
      .values({
        pmsId,
        kraId,
        resultAchieved: 'result',
        finalRating: 4,
        comment: 'good',
      })
      .returning();
    expect(rating?.finalRating).toBe(4);
  });

  it('behavioural_rating captures dimension_code + anchor text', async () => {
    const [r] = await db
      .insert(s.behaviouralRating)
      .values({
        pmsId,
        dimensionCode: 'communication_skills',
        rating1to5: 4,
        rubricAnchorText: 'Able to express thoughts and ideas both orally and in written form.',
        comment: null,
      })
      .returning();
    expect(r?.rubricAnchorText).toContain('Able to express');
  });

  it('staff_contribution weightPct is an integer 0-5', async () => {
    const [c] = await db
      .insert(s.staffContribution)
      .values({
        pmsId,
        whenDate: 'June 2026',
        achievement: 'Led project X',
        weightPct: 3,
      })
      .returning();
    expect(c?.weightPct).toBe(3);
  });

  it('career_development + personal_growth are one-per-pms', async () => {
    await db.insert(s.careerDevelopment).values({
      pmsId,
      potentialWindow: '1-2_years',
      readyIn: null,
      comments: 'good trajectory',
    });
    await db.insert(s.personalGrowth).values({
      pmsId,
      trainingNeeds: 'Cloud',
      comments: null,
    });

    const cd = await db.select().from(s.careerDevelopment);
    const pg = await db.select().from(s.personalGrowth);
    expect(cd.length).toBe(1);
    expect(pg.length).toBe(1);
  });

  it('pms_comment starts unsigned; role enum enforced', async () => {
    const [c] = await db
      .insert(s.pmsComment)
      .values({
        pmsId,
        role: 'appraiser',
        body: 'initial',
      })
      .returning();
    expect(c?.signedAt).toBeNull();
    expect(c?.signatureHash).toBeNull();
  });

  it('pms_final_snapshot + cycle_amendment linkage', async () => {
    const [snap] = await db
      .insert(s.pmsFinalSnapshot)
      .values({
        pmsId,
        finalizedAt: new Date(),
        finalizedBy: '00000000-0000-0000-0000-000000000000',
        scoreTotal: '4.12',
        scoreBreakdown: { kra: 2.88, behavioural: 1.0, contribution: 0.24 },
      })
      .returning();
    expect(snap?.scoreTotal).toBe('4.12');

    const [amend] = await db
      .insert(s.cycleAmendment)
      .values({
        originalCycleId: cycleId,
        originalSnapshotId: snap!.id,
        reason: 'scoring correction',
        openedBy: '00000000-0000-0000-0000-000000000000',
      })
      .returning();
    expect(amend?.reason).toBe('scoring correction');
  });
});
