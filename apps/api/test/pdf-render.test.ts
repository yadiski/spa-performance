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
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { renderPmsPdf } from '../src/pdf/render-pms';

describe('renderPmsPdf', () => {
  let cycleId: string;
  let pmsId: string;
  let kraIds: string[];

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
    await client`truncate table cycle_amendment, pms_final_snapshot cascade`;
    await client`truncate table pms_comment, personal_growth, career_development, staff_contribution, behavioural_rating, pms_kra_rating, pms_assessment cascade`;
    await client`truncate table mid_year_checkpoint cascade`;
    await client`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await client`truncate table staff_role, staff, grade, department, organization, "user" cascade`;
    await client.end({ timeout: 2 });

    const dims = await db.select().from(s.behaviouralDimension);
    if (dims.length === 0) {
      throw new Error('behavioural_dimension empty — run seed-behavioural-dims.ts first');
    }

    const [org] = await db
      .insert(s.organization)
      .values({ name: 'Invenio Potential Sdn. Bhd.' })
      .returning();
    const [dept] = await db
      .insert(s.department)
      .values({ orgId: org!.id, code: 'IT', name: 'Information Technology' })
      .returning();
    const [grade] = await db
      .insert(s.grade)
      .values({ orgId: org!.id, code: 'E10', rank: '10' })
      .returning();
    const [u] = await db.insert(s.user).values({ email: 'ally@t', name: 'Ally Staff' }).returning();
    const [mgrU] = await db.insert(s.user).values({ email: 'mgr@t', name: 'Mgr' }).returning();
    const [mgrSt] = await db
      .insert(s.staff)
      .values({
        userId: mgrU!.id,
        orgId: org!.id,
        employeeNo: 'M1',
        name: 'Manager Senior',
        designation: 'Manager',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: null,
        hireDate: '2020-01-01',
      })
      .returning();
    const [st] = await db
      .insert(s.staff)
      .values({
        userId: u!.id,
        orgId: org!.id,
        employeeNo: 'E0001',
        name: 'Ally Staff',
        designation: 'Engineer',
        departmentId: dept!.id,
        gradeId: grade!.id,
        managerId: mgrSt!.id,
        hireDate: '2022-01-01',
      })
      .returning();
    const [cy] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: st!.id,
        fy: 2026,
        state: 'pms_finalized',
      })
      .returning();
    cycleId = cy!.id;

    const mk = (order: number, weight = 50) => ({
      cycleId: cy!.id,
      perspective: KraPerspective.Financial,
      description: `KRA ${order + 1} deliverable — ship feature X`,
      weightPct: weight,
      measurement: 'Milestones',
      target: 'All by Q4',
      order,
      rubric1to5: ['a', 'b', 'c', 'd', 'e'],
    });
    const k1 = await db.insert(s.kra).values(mk(0)).returning();
    const k2 = await db.insert(s.kra).values(mk(1)).returning();
    kraIds = [k1[0]!.id, k2[0]!.id];

    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();
    pmsId = pms!.id;
    await db.insert(s.pmsKraRating).values([
      {
        pmsId,
        kraId: kraIds[0]!,
        resultAchieved: 'Delivered all milestones',
        finalRating: 4,
        comment: 'Solid work',
      },
      { pmsId, kraId: kraIds[1]!, resultAchieved: 'Partial', finalRating: 3, comment: null },
    ]);

    // one behavioural rating as sanity
    const dimResults = await db
      .select()
      .from(s.behaviouralDimension)
      .where(sql`code = 'communication_skills'`)
      .limit(1)
      .catch(async () => {
        return await db.select().from(s.behaviouralDimension).limit(1);
      });
    const dim = dimResults[0];
    if (dim) {
      const anchors = dim.anchors as string[];
      await db.insert(s.behaviouralRating).values({
        pmsId,
        dimensionCode: dim.code,
        rating1to5: 4,
        rubricAnchorText: anchors[3]!,
        comment: 'Consistent',
      });
    }

    await db.insert(s.staffContribution).values({
      pmsId,
      whenDate: 'Q2 2026',
      achievement: 'Led internal training',
      weightPct: 3,
    });
    await db.insert(s.careerDevelopment).values({
      pmsId,
      potentialWindow: PotentialWindow.OneToTwoYears,
      readyIn: null,
      comments: 'Growing into lead role',
    });
    await db.insert(s.personalGrowth).values({
      pmsId,
      trainingNeeds: 'Advanced system design',
      comments: null,
    });
    await db.insert(s.pmsComment).values({
      pmsId,
      role: PmsCommentRole.Appraiser,
      body: 'Clear trajectory. Keep it up.',
    });
    await db.insert(s.pmsFinalSnapshot).values({
      pmsId,
      finalizedAt: new Date('2026-01-15T00:00:00Z'),
      finalizedBy: '00000000-0000-0000-0000-000000000000',
      scoreTotal: '3.80',
      scoreBreakdown: { kra: 2.45, behavioural: 1.0, contribution: 0.15, total: 3.8 },
    });
  });

  it('renders a PDF buffer > 1KB for a finalized cycle', async () => {
    const pdf = await renderPmsPdf(db, cycleId);
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1024);
    // PDF magic: "%PDF"
    const header = new TextDecoder().decode(pdf.slice(0, 4));
    expect(header).toBe('%PDF');
  });

  it('render is deterministic for the same cycle id', async () => {
    // render twice and diff the bytes (excluding CreationDate which @react-pdf bakes in)
    const a = await renderPmsPdf(db, cycleId);
    const b = await renderPmsPdf(db, cycleId);

    const ax = new TextDecoder('latin1').decode(a);
    const bx = new TextDecoder('latin1').decode(b);
    // Remove CreationDate + ModDate entries and the raw date value objects
    // (PDF stores the date as a bare "(D:...)" string object on a separate line)
    const clean = (x: string) =>
      x
        .replace(/\/CreationDate\s*\([^)]*\)/gs, '')
        .replace(/\/ModDate\s*\([^)]*\)/gs, '')
        // strip bare date objects like "(D:20260420031220Z)" that appear in xref stream
        .replace(/\(D:[0-9Z+:'-]{1,30}\)/g, '')
        // strip /ID array which is derived from creation time and is thus non-deterministic
        .replace(/\/ID\s*\[<[0-9a-f]+>\s*<[0-9a-f]+>\]/gi, '');
    expect(clean(ax)).toBe(clean(bx));
  });

  it('throws cycle_not_found for unknown cycle', async () => {
    let threw = false;
    try {
      await renderPmsPdf(db, '00000000-0000-0000-0000-000000000000');
    } catch (e) {
      threw = true;
      expect(e instanceof Error && e.message === 'cycle_not_found').toBe(true);
    }
    expect(threw).toBe(true);
  });
});
