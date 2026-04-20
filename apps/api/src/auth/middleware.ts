import type { Role } from '@spa/shared';
import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client';
import { auth } from './better-auth';

export type Actor = {
  userId: string;
  staffId: string | null;
  roles: Role[];
  email: string;
  ip: string | null;
  ua: string | null;
  impersonating?: { targetUserId: string; sessionId: string };
};

declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor;
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: 'unauthenticated' });

  const staffResult = await db.execute(sql`
    select id as staff_id from staff where user_id = ${session.user.id} limit 1
  `);
  const staffRows = (
    Array.isArray(staffResult) ? staffResult : ((staffResult as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ staff_id: string }>;
  const staffId = staffRows[0]?.staff_id ?? null;

  let roles: Role[] = [];
  if (staffId) {
    const rolesResult = await db.execute(
      sql`select role from staff_role where staff_id = ${staffId}`,
    );
    const roleRows = (
      Array.isArray(rolesResult) ? rolesResult : ((rolesResult as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ role: Role }>;
    roles = roleRows.map((r) => r.role);
  }

  c.set('actor', {
    userId: session.user.id,
    staffId,
    roles,
    email: session.user.email,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  await next();
});
