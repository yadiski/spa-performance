import { zValidator } from '@hono/zod-validator';
import {
  finalizePms as finalizeZod,
  openPmsWindow,
  pmsCycleAction,
  saveBehaviouralRatings,
  saveCareerDevelopment,
  savePersonalGrowth,
  savePmsComment,
  savePmsKraRatings,
  saveStaffContributions,
  signPmsComment as signZod,
} from '@spa/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import {
  behaviouralDimension,
  behaviouralRating,
  careerDevelopment,
  performanceCycle,
  personalGrowth,
  pmsAssessment,
  pmsComment,
  pmsFinalSnapshot,
  pmsKraRating,
  staffContribution,
} from '../../db/schema';
import { staffReadScope } from '../../rbac/scope';
import { getSignedUrl } from '../../storage/r2';
import { openPmsWindow as openPmsWindowSvc } from '../cycle/windows';
import {
  saveBehaviouralRatings as saveBehaviouralRatingsSvc,
  saveCareerDevelopment as saveCareerDevelopmentSvc,
  savePersonalGrowth as savePersonalGrowthSvc,
  savePmsComment as savePmsCommentSvc,
  savePmsKraRatings as savePmsKraRatingsSvc,
  saveStaffContributions as saveStaffContributionsSvc,
} from './service';
import { verifyPmsSignatureChain } from './signature-verifier';
import { signPmsComment } from './signing';
import {
  finalizePms as finalizePmsSvc,
  reopenPms as reopenPmsSvc,
  returnToAppraisee,
  returnToAppraiser,
  submitAppraiserRating,
  submitNextLevel,
  submitSelfReview,
} from './transitions';

export const pmsRoutes = new Hono();
pmsRoutes.use('*', requireAuth);

pmsRoutes.post('/kra-ratings', zValidator('json', savePmsKraRatings), async (c) => {
  const actor = c.get('actor');
  const r = await savePmsKraRatingsSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/behavioural', zValidator('json', saveBehaviouralRatings), async (c) => {
  const actor = c.get('actor');
  const r = await saveBehaviouralRatingsSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/contributions', zValidator('json', saveStaffContributions), async (c) => {
  const actor = c.get('actor');
  const r = await saveStaffContributionsSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/career', zValidator('json', saveCareerDevelopment), async (c) => {
  const actor = c.get('actor');
  const r = await saveCareerDevelopmentSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/growth', zValidator('json', savePersonalGrowth), async (c) => {
  const actor = c.get('actor');
  const r = await savePersonalGrowthSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/comment', zValidator('json', savePmsComment), async (c) => {
  const actor = c.get('actor');
  const r = await savePmsCommentSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/open-window', zValidator('json', openPmsWindow), async (c) => {
  const actor = c.get('actor');
  const r = await openPmsWindowSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/submit-self-review', zValidator('json', pmsCycleAction), async (c) => {
  const actor = c.get('actor');
  const r = await submitSelfReview(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/submit-appraiser', zValidator('json', pmsCycleAction), async (c) => {
  const actor = c.get('actor');
  const r = await submitAppraiserRating(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/return-to-appraisee', zValidator('json', pmsCycleAction), async (c) => {
  const actor = c.get('actor');
  const r = await returnToAppraisee(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/submit-next-level', zValidator('json', pmsCycleAction), async (c) => {
  const actor = c.get('actor');
  const r = await submitNextLevel(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/return-to-appraiser', zValidator('json', pmsCycleAction), async (c) => {
  const actor = c.get('actor');
  const r = await returnToAppraiser(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.post('/finalize', zValidator('json', finalizeZod), async (c) => {
  const actor = c.get('actor');
  const r = await finalizePmsSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

const reopenSchema = z.object({
  cycleId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

pmsRoutes.post('/reopen', zValidator('json', reopenSchema), async (c) => {
  const actor = c.get('actor');
  const r = await reopenPmsSvc(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.get('/:cycleId/score', async (c) => {
  const actor = c.get('actor');
  const cycleId = c.req.param('cycleId');

  // Ownership check: actor must be in scope for the cycle's staff member
  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return c.json({ code: 'cycle_not_found', message: 'cycle_not_found' }, 404);

  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ code: 'forbidden', message: 'forbidden' }, 403);

  const { computeScore } = await import('./scoring');
  const breakdown = await computeScore(db, cycleId);
  return c.json({ breakdown });
});

pmsRoutes.post('/sign', zValidator('json', signZod), async (c) => {
  const actor = c.get('actor');
  const r = await signPmsComment(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.get('/:cycleId/verify-signatures', async (c) => {
  const actor = c.get('actor');
  const cycleId = c.req.param('cycleId');

  // Ownership check: actor must be in scope for the cycle's staff member
  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return c.json({ ok: false, error: 'cycle_not_found' }, 404);

  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ ok: false, error: 'forbidden' }, 403);

  const { pmsAssessment: pmsAssessmentSchema } = await import('../../db/schema');
  const { eq: eqFn } = await import('drizzle-orm');
  const [pms] = await db
    .select()
    .from(pmsAssessmentSchema)
    .where(eqFn(pmsAssessmentSchema.cycleId, cycleId));
  if (!pms) return c.json({ ok: false, error: 'pms_not_found' }, 404);
  const result = await verifyPmsSignatureChain(db, pms.id);
  return c.json(result);
});

/** GET /api/v1/pms/behavioural-dimensions — rubric catalogue (any authenticated user) */
pmsRoutes.get('/behavioural-dimensions', async (c) => {
  const dims = await db
    .select()
    .from(behaviouralDimension)
    .orderBy(asc(behaviouralDimension.order));
  return c.json({
    items: dims.map((d) => ({
      code: d.code,
      title: d.title,
      description: d.description,
      order: d.order,
      anchors: d.anchors as string[],
    })),
  });
});

/** GET /api/v1/pms/:cycleId/state — full PMS form state for actor-accessible cycles */
pmsRoutes.get('/:cycleId/state', async (c) => {
  const actor = c.get('actor');
  const cycleId = c.req.param('cycleId');

  // Load cycle
  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return c.json({ code: 'cycle_not_found', message: 'cycle_not_found' }, 404);

  // Access check: actor must be the appraisee, the direct manager, next-level, or HRA
  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ code: 'forbidden', message: 'forbidden' }, 403);

  // Load pms_assessment (may not exist yet)
  const [pms] = await db.select().from(pmsAssessment).where(eq(pmsAssessment.cycleId, cycleId));

  if (!pms) {
    return c.json({
      cycle: { id: cycle.id, state: cycle.state, staffId: cycle.staffId, fy: cycle.fy },
      pms: null,
      kraRatings: [],
      behavioural: [],
      contributions: [],
      career: null,
      growth: null,
      comments: [],
    });
  }

  const [kraRatings, behaviouralRatings, contributions, careerRow, growthRow, comments] =
    await Promise.all([
      db.select().from(pmsKraRating).where(eq(pmsKraRating.pmsId, pms.id)),
      db.select().from(behaviouralRating).where(eq(behaviouralRating.pmsId, pms.id)),
      db.select().from(staffContribution).where(eq(staffContribution.pmsId, pms.id)),
      db.select().from(careerDevelopment).where(eq(careerDevelopment.pmsId, pms.id)),
      db.select().from(personalGrowth).where(eq(personalGrowth.pmsId, pms.id)),
      db.select().from(pmsComment).where(eq(pmsComment.pmsId, pms.id)),
    ]);

  return c.json({
    cycle: { id: cycle.id, state: cycle.state, staffId: cycle.staffId, fy: cycle.fy },
    pms: { id: pms.id },
    kraRatings: kraRatings.map((r) => ({
      kraId: r.kraId,
      selfRating: null,
      finalRating: r.finalRating,
      resultAchieved: r.resultAchieved,
    })),
    behavioural: behaviouralRatings.map((r) => ({
      dimensionCode: r.dimensionCode,
      rating: r.rating1to5,
      anchorText: r.rubricAnchorText,
    })),
    contributions: contributions.map((c) => ({
      id: c.id,
      whenDate: c.whenDate,
      achievement: c.achievement,
      weightPct: c.weightPct,
    })),
    career:
      careerRow[0] != null
        ? { potentialWindow: careerRow[0].potentialWindow, notes: careerRow[0].comments }
        : null,
    growth:
      growthRow[0] != null
        ? { goals: growthRow[0].trainingNeeds, notes: growthRow[0].comments }
        : null,
    comments: comments.map((cm) => ({
      role: cm.role,
      body: cm.body,
      signedBy: cm.signedBy,
      signedAt: cm.signedAt,
    })),
  });
});

pmsRoutes.get('/:cycleId/pdf', async (c) => {
  const actor = c.get('actor');
  const cycleId = c.req.param('cycleId');

  const [cycle] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cycle) return c.json({ code: 'cycle_not_found', message: 'cycle_not_found' }, 404);

  const scope = await staffReadScope(db, actor);
  const accessible = await db.execute(
    sql`select 1 from staff where id = ${cycle.staffId} and (${scope})`,
  );
  const accessRows = Array.isArray(accessible)
    ? accessible
    : ((accessible as { rows?: unknown[] }).rows ?? []);
  if (accessRows.length === 0) return c.json({ code: 'forbidden', message: 'forbidden' }, 403);

  const [pms] = await db.select().from(pmsAssessment).where(eq(pmsAssessment.cycleId, cycleId));
  if (!pms) return c.json({ code: 'PDF_NOT_READY', message: 'PDF_NOT_READY' }, 404);

  const [snapshot] = await db
    .select()
    .from(pmsFinalSnapshot)
    .where(eq(pmsFinalSnapshot.pmsId, pms.id))
    .orderBy(sql`finalized_at desc`)
    .limit(1);

  if (!snapshot?.pdfR2Key) {
    return c.json({ code: 'PDF_NOT_READY', message: 'PDF_NOT_READY' }, 404);
  }

  const url = await getSignedUrl(snapshot.pdfR2Key, 86400);
  const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

  return c.json({ url, expiresAt });
});
