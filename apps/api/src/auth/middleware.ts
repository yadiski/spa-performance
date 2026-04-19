import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { auth } from './better-auth';
import { db } from '../db/client';
import type { Role } from '@spa/shared';

export type Actor = {
  userId: string;
  staffId: string | null;
  roles: Role[];
  email: string;
  ip: string | null;
  ua: string | null;
};

declare module 'hono' {
  interface ContextVariableMap { actor: Actor }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: 'unauthenticated' });

  const { rows: staffRows } = await db.execute(sql`
    select id as staff_id from staff where user_id = ${session.user.id} limit 1
  `);
  const staffRow = (staffRows as Array<{ staff_id: string }>)[0];
  const staffId = staffRow?.staff_id ?? null;

  let roles: Role[] = [];
  if (staffId) {
    const { rows } = await db.execute(sql`select role from staff_role where staff_id = ${staffId}`);
    roles = (rows as Array<{ role: Role }>).map((r) => r.role);
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
