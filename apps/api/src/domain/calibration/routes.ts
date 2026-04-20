import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { writeAudit } from '../../audit/log';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import { calibrationNote } from '../../db/schema';

export const calibrationRoutes = new Hono();

calibrationRoutes.use('*', requireAuth);

const noteBody = z.object({
  gradeId: z.string().uuid(),
  fy: z.number().int(),
  subjectKey: z.string().min(1),
  subjectName: z.string().min(1),
  subjectStaffId: z.string().uuid().nullish(),
  note: z.string().min(1).max(4000),
});

const listQuery = z.object({
  gradeId: z.string().uuid(),
  fy: z.coerce.number().int(),
});

function requireHra(roles: string[]): void {
  if (!roles.includes('hra')) {
    throw new HTTPException(403, { message: 'hra role required' });
  }
}

async function resolveOrgId(userId: string): Promise<string | null> {
  const res = await db.execute(sql`
    select org_id from staff where user_id = ${userId} limit 1
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    org_id: string;
  }>;
  return rows[0]?.org_id ?? null;
}

// POST /api/v1/calibration/notes — upsert one note per (org, grade, fy, subjectKey)
calibrationRoutes.post('/notes', zValidator('json', noteBody), async (c) => {
  const actor = c.get('actor');
  requireHra(actor.roles);
  const orgId = await resolveOrgId(actor.userId);
  if (!orgId) throw new HTTPException(403, { message: 'no org context' });

  const b = c.req.valid('json');

  const [existing] = await db
    .select({ id: calibrationNote.id })
    .from(calibrationNote)
    .where(
      and(
        eq(calibrationNote.orgId, orgId),
        eq(calibrationNote.gradeId, b.gradeId),
        eq(calibrationNote.fy, b.fy),
        eq(calibrationNote.subjectKey, b.subjectKey),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(calibrationNote)
        .set({
          note: b.note,
          subjectName: b.subjectName,
          subjectStaffId: b.subjectStaffId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(calibrationNote.id, existing.id));
    } else {
      await tx.insert(calibrationNote).values({
        orgId,
        gradeId: b.gradeId,
        fy: b.fy,
        subjectKey: b.subjectKey,
        subjectName: b.subjectName,
        subjectStaffId: b.subjectStaffId ?? null,
        note: b.note,
        createdByUserId: actor.userId,
      });
    }
    await writeAudit(tx, {
      eventType: existing ? 'calibration.note.updated' : 'calibration.note.created',
      actorId: actor.userId,
      actorRole: 'hra',
      targetType: 'grade',
      targetId: b.gradeId,
      payload: { fy: b.fy, subjectKey: b.subjectKey, subjectStaffId: b.subjectStaffId ?? null },
      ip: actor.ip,
      ua: actor.ua,
    });
  });

  return c.json({ ok: true });
});

// GET /api/v1/calibration/notes?gradeId=&fy=
calibrationRoutes.get('/notes', zValidator('query', listQuery), async (c) => {
  const actor = c.get('actor');
  requireHra(actor.roles);
  const orgId = await resolveOrgId(actor.userId);
  if (!orgId) return c.json({ items: [] });

  const q = c.req.valid('query');
  const items = await db
    .select()
    .from(calibrationNote)
    .where(
      and(
        eq(calibrationNote.orgId, orgId),
        eq(calibrationNote.gradeId, q.gradeId),
        eq(calibrationNote.fy, q.fy),
      ),
    )
    .orderBy(desc(calibrationNote.createdAt));

  return c.json({ items });
});
