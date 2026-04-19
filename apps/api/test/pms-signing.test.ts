process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { PmsCommentRole } from '@spa/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Actor } from '../src/auth/middleware';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { verifyPmsSignatureChain } from '../src/domain/pms/signature-verifier';
import { signPmsComment } from '../src/domain/pms/signing';

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

describe('pms signing + signature chain verifier', () => {
  let pmsId: string;
  let appraiserUserId: string;
  let appraiseeUserId: string;
  let nextLevelUserId: string;
  let c1: string;
  let c2: string;
  let c3: string;

  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table audit_log`;
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

    const [u1] = await db.insert(s.user).values({ email: 'staff@t', name: 'Staff' }).returning();
    const [u2] = await db.insert(s.user).values({ email: 'mgr@t', name: 'Mgr' }).returning();
    const [u3] = await db.insert(s.user).values({ email: 'nl@t', name: 'NL' }).returning();
    appraiseeUserId = u1!.id;
    appraiserUserId = u2!.id;
    nextLevelUserId = u3!.id;

    const [st1] = await db
      .insert(s.staff)
      .values({
        userId: u1!.id,
        orgId: o!.id,
        employeeNo: 'S1',
        name: 'Staff',
        designation: 'e',
        departmentId: d!.id,
        gradeId: g!.id,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    const [cy] = await db
      .insert(s.performanceCycle)
      .values({
        staffId: st1!.id,
        fy: 2026,
        state: 'pms_awaiting_hra',
      })
      .returning();
    const [pms] = await db.insert(s.pmsAssessment).values({ cycleId: cy!.id }).returning();
    pmsId = pms!.id;

    const [c1row] = await db
      .insert(s.pmsComment)
      .values({
        pmsId,
        role: PmsCommentRole.Appraisee,
        body: 'Self comment',
      })
      .returning();
    const [c2row] = await db
      .insert(s.pmsComment)
      .values({
        pmsId,
        role: PmsCommentRole.Appraiser,
        body: 'Appraiser comment',
      })
      .returning();
    const [c3row] = await db
      .insert(s.pmsComment)
      .values({
        pmsId,
        role: PmsCommentRole.NextLevel,
        body: 'Next-level comment',
      })
      .returning();
    c1 = c1row!.id;
    c2 = c2row!.id;
    c3 = c3row!.id;
  });

  it('signs a comment and writes signature + prev_signature', async () => {
    const actor = mkActor({ userId: appraiseeUserId, ip: '1.1.1.1', ua: 'bun-test' });
    const r = await signPmsComment(db, actor, { commentId: c1, typedName: 'Staff Person' });
    expect(r.ok).toBe(true);

    const [row] = await db.select().from(s.pmsComment).where(sql`id = ${c1}`);
    expect(row?.signedAt).not.toBeNull();
    expect(row?.signedBy).toBe(appraiseeUserId);
    expect(row?.signatureHash).not.toBeNull();
    expect(row?.prevSignatureHash).not.toBeNull();
    // first row prev = 32 zero bytes
    const prev = row!.prevSignatureHash as Uint8Array;
    const isZero = prev instanceof Uint8Array ? Array.from(prev).every((b) => b === 0) : false;
    expect(isZero).toBe(true);
  });

  it('chain hashes link: sig2.prev === sig1.hash', async () => {
    await signPmsComment(db, mkActor({ userId: appraiseeUserId, ip: '1.1.1.1', ua: 'ua-1' }), {
      commentId: c1,
      typedName: 'Staff Person',
    });
    await signPmsComment(db, mkActor({ userId: appraiserUserId, ip: '1.1.1.2', ua: 'ua-2' }), {
      commentId: c2,
      typedName: 'Mgr Person',
    });
    await signPmsComment(db, mkActor({ userId: nextLevelUserId, ip: '1.1.1.3', ua: 'ua-3' }), {
      commentId: c3,
      typedName: 'NL Person',
    });

    const result = await verifyPmsSignatureChain(db, pmsId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toBe(3);
  });

  it('double-sign fails with already_signed', async () => {
    await signPmsComment(db, mkActor({ userId: appraiseeUserId }), {
      commentId: c1,
      typedName: 'Staff Person',
    });
    const r2 = await signPmsComment(db, mkActor({ userId: appraiseeUserId }), {
      commentId: c1,
      typedName: 'Staff Person',
    });
    expect(r2.ok).toBe(false);
  });

  it('verifier fails if body is tampered after signing', async () => {
    await signPmsComment(db, mkActor({ userId: appraiseeUserId }), {
      commentId: c1,
      typedName: 'Staff Person',
    });
    await signPmsComment(db, mkActor({ userId: appraiserUserId }), {
      commentId: c2,
      typedName: 'Mgr Person',
    });

    // Tamper — edit body directly in DB (bypassing service)
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await client`update pms_comment set body = 'TAMPERED' where id = ${c2}`;
    } finally {
      await client.end({ timeout: 2 });
    }

    const result = await verifyPmsSignatureChain(db, pmsId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedCommentId).toBe(c2);
  });

  it('empty chain is valid (no signed comments)', async () => {
    const result = await verifyPmsSignatureChain(db, pmsId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toBe(0);
  });
});
