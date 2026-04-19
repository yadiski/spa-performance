import { zValidator } from '@hono/zod-validator';
import {
  saveBehaviouralRatings,
  saveCareerDevelopment,
  savePersonalGrowth,
  savePmsComment,
  savePmsKraRatings,
  saveStaffContributions,
} from '@spa/shared';
import { Hono } from 'hono';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db/client';
import {
  saveBehaviouralRatings as saveBehaviouralRatingsSvc,
  saveCareerDevelopment as saveCareerDevelopmentSvc,
  savePersonalGrowth as savePersonalGrowthSvc,
  savePmsComment as savePmsCommentSvc,
  savePmsKraRatings as savePmsKraRatingsSvc,
  saveStaffContributions as saveStaffContributionsSvc,
} from './service';

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
