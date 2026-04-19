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
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
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
  const { computeScore } = await import('./scoring');
  const breakdown = await computeScore(db, c.req.param('cycleId'));
  return c.json({ breakdown });
});

pmsRoutes.post('/sign', zValidator('json', signZod), async (c) => {
  const actor = c.get('actor');
  const r = await signPmsComment(db, actor, c.req.valid('json'));
  return r.ok ? c.json({ ok: true }) : c.json({ code: r.error, message: r.error }, 409);
});

pmsRoutes.get('/:cycleId/verify-signatures', async (c) => {
  const { pmsAssessment } = await import('../../db/schema');
  const { eq: eqFn } = await import('drizzle-orm');
  const [pms] = await db
    .select()
    .from(pmsAssessment)
    .where(eqFn(pmsAssessment.cycleId, c.req.param('cycleId')));
  if (!pms) return c.json({ ok: false, error: 'pms_not_found' }, 404);
  const result = await verifyPmsSignatureChain(db, pms.id);
  return c.json(result);
});
