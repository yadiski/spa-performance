import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { db } from '../db/client';
import { authIpRateLimit } from '../http/rate-limit';
import { acceptInvite, createInvite, verifyInviteToken } from './invite';
import { acceptPasswordReset, initiatePasswordReset } from './password-reset';

export const onboardingRoutes = new Hono();

// ── Invite ────────────────────────────────────────────────────────────────────

const createInviteSchema = z.object({
  email: z.string().email(),
  staffId: z.string().uuid().optional(),
  roles: z.array(z.string()).min(1),
  orgId: z.string().uuid(),
});

/** POST /api/v1/onboarding/invite — HRA or IT admin */
onboardingRoutes.post('/invite', requireAuth, zValidator('json', createInviteSchema), async (c) => {
  const actor = c.get('actor');
  if (!actor.roles.includes('hra') && !actor.roles.includes('it_admin')) {
    throw new HTTPException(403, { message: 'forbidden — hra or it_admin required' });
  }

  const { email, staffId, roles, orgId } = c.req.valid('json');

  try {
    const result = await createInvite({
      db,
      actor,
      email,
      ...(staffId !== undefined ? { staffId } : {}),
      roles,
      orgId,
    });
    return c.json({ inviteId: result.inviteId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create invite';
    throw new HTTPException(400, { message: msg });
  }
});

/** GET /api/v1/onboarding/invite/:token — unauthenticated, token is the auth */
onboardingRoutes.get('/invite/:token', async (c) => {
  const { token } = c.req.param();
  const result = await verifyInviteToken(db, token);
  if (!result.ok) {
    throw new HTTPException(404, { message: result.error });
  }
  return c.json({ email: result.email, roles: result.roles, expiresAt: result.expiresAt });
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12),
});

/** POST /api/v1/onboarding/accept — public */
onboardingRoutes.post('/accept', zValidator('json', acceptInviteSchema), async (c) => {
  const { token, password } = c.req.valid('json');
  const result = await acceptInvite(db, { token, password });
  if (!result.ok) {
    throw new HTTPException(400, { message: result.error });
  }
  return c.json({ ok: true, userId: result.userId });
});

// ── Password reset ────────────────────────────────────────────────────────────

const initiateResetSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/v1/onboarding/password-reset/initiate — always 200, prevents enumeration.
 * Rate-limited at the route layer.
 */
onboardingRoutes.post(
  '/password-reset/initiate',
  authIpRateLimit(),
  zValidator('json', initiateResetSchema),
  async (c) => {
    const { email } = c.req.valid('json');
    const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    await initiatePasswordReset(db, { email, ...(rawIp !== undefined ? { ip: rawIp } : {}) });
    return c.json({ ok: true });
  },
);

const acceptResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12),
});

/** POST /api/v1/onboarding/password-reset/accept */
onboardingRoutes.post(
  '/password-reset/accept',
  zValidator('json', acceptResetSchema),
  async (c) => {
    const { token, newPassword } = c.req.valid('json');
    const result = await acceptPasswordReset(db, { token, newPassword });
    if (!result.ok) {
      throw new HTTPException(400, { message: result.error });
    }
    return c.json({ ok: true });
  },
);

// ── First-login / onboarding status ──────────────────────────────────────────

/** GET /api/v1/onboarding/me — returns actor's staff row + roles (for checklist) */
onboardingRoutes.get('/me', requireAuth, async (c) => {
  const actor = c.get('actor');

  if (!actor.staffId) {
    return c.json({ staff: null, roles: actor.roles, onboarded: false });
  }

  const staffRes = await db.execute(sql`
    select
      s.id, s.employee_no, s.name, s.designation, s.hire_date,
      d.name as department_name,
      g.name as grade_name,
      m.name as manager_name
    from staff s
    left join department d on d.id = s.department_id
    left join grade g on g.id = s.grade_id
    left join staff m on m.id = s.manager_id
    where s.id = ${actor.staffId}::uuid
    limit 1
  `);
  const staffRows = (
    Array.isArray(staffRes) ? staffRes : ((staffRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<Record<string, unknown>>;

  const onboardedRes = await db.execute(sql`
    select onboarded_at from user_onboarding_status where user_id = ${actor.userId}::uuid limit 1
  `);
  const onboardedRows = (
    Array.isArray(onboardedRes) ? onboardedRes : ((onboardedRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ onboarded_at: Date }>;

  return c.json({
    staff: staffRows[0] ?? null,
    roles: actor.roles,
    onboarded: onboardedRows.length > 0,
    onboardedAt: onboardedRows[0]?.onboarded_at ?? null,
  });
});

/** POST /api/v1/onboarding/complete — marks onboarding complete */
onboardingRoutes.post('/complete', requireAuth, async (c) => {
  const actor = c.get('actor');

  await db.execute(sql`
    insert into user_onboarding_status (user_id, onboarded_at)
    values (${actor.userId}::uuid, now())
    on conflict (user_id) do nothing
  `);

  return c.json({ ok: true });
});
