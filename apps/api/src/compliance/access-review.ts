import { NotificationKind } from '@spa/shared';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/log';
import type { DB } from '../db/client';
import { boss } from '../jobs/queue';
import type { SendEmailJob } from '../jobs/send-email';

const EMAIL_QUEUE = 'notifications.send_email';

interface QuarterInfo {
  label: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
}

function currentQuarter(now: Date = new Date()): QuarterInfo {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  let quarter: number;
  let periodStart: string;
  let periodEnd: string;

  if (month <= 3) {
    quarter = 1;
    periodStart = `${year}-01-01`;
    periodEnd = `${year}-03-31`;
  } else if (month <= 6) {
    quarter = 2;
    periodStart = `${year}-04-01`;
    periodEnd = `${year}-06-30`;
  } else if (month <= 9) {
    quarter = 3;
    periodStart = `${year}-07-01`;
    periodEnd = `${year}-09-30`;
  } else {
    quarter = 4;
    periodStart = `${year}-10-01`;
    periodEnd = `${year}-12-31`;
  }

  return { label: `Q${quarter} ${year}`, periodStart, periodEnd };
}

export async function generateAccessReview(
  db: DB,
): Promise<{ cycleId: string; itemCount: number }> {
  const quarter = currentQuarter();

  const cycleId = await db.transaction(async (tx) => {
    // Create cycle
    const cycleRes = await tx.execute(sql`
      insert into access_review_cycle (period_start, period_end, status, created_by_system)
      values (
        ${quarter.periodStart}::date,
        ${quarter.periodEnd}::date,
        'pending',
        true
      )
      returning id
    `);
    const cycleRows = (
      Array.isArray(cycleRes) ? cycleRes : ((cycleRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string }>;
    const id = cycleRows[0]!.id;

    // Snapshot all active users (non-terminated staff with a user account)
    const usersRes = await tx.execute(sql`
      select
        u.id as user_id,
        u.email,
        u.name,
        coalesce(
          (select max(s.updated_at) from session s where s.user_id = u.id),
          null
        ) as last_login_at,
        coalesce(
          array_agg(sr.role::text order by sr.created_at) filter (where sr.id is not null),
          '{}'::text[]
        ) as roles,
        coalesce(
          extract(day from now() - min(sr.created_at))::int,
          0
        ) as roles_unchanged_days
      from "user" u
      left join staff st on st.user_id = u.id
      left join staff_role sr on sr.staff_id = st.id
      where (st.terminated_at is null or st.id is null)
      group by u.id, u.email, u.name
    `);
    const userRows = (
      Array.isArray(usersRes) ? usersRes : ((usersRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      user_id: string;
      email: string;
      name: string;
      last_login_at: Date | null;
      roles: string[];
      roles_unchanged_days: number;
    }>;

    // Insert review items
    for (const user of userRows) {
      const snapshot = {
        email: user.email,
        name: user.name,
        roles: user.roles ?? [],
        lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
        rolesUnchangedDays: user.roles_unchanged_days ?? 0,
      };

      await tx.execute(sql`
        insert into access_review_item (cycle_id, user_id, snapshot)
        values (${id}::uuid, ${user.user_id}::uuid, ${JSON.stringify(snapshot)}::jsonb)
      `);
    }

    // Update cycle to in_progress
    await tx.execute(sql`
      update access_review_cycle set status = 'in_progress' where id = ${id}::uuid
    `);

    await writeAudit(tx, {
      eventType: 'access_review.generated',
      actorId: null,
      actorRole: 'system',
      targetType: 'access_review_cycle',
      targetId: id,
      payload: { quarter: quarter.label, itemCount: userRows.length },
      ip: null,
      ua: null,
    });

    return id;
  });

  // Count items for this cycle
  const countRes = await db.execute(sql`
    select count(*)::int as cnt from access_review_item where cycle_id = ${cycleId}::uuid
  `);
  const countRows = (
    Array.isArray(countRes) ? countRes : ((countRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ cnt: number }>;
  const itemCount = countRows[0]?.cnt ?? 0;

  // Notify all HRAs and IT admins
  const adminRes = await db.execute(sql`
    select distinct u.email
    from "user" u
    join staff st on st.user_id = u.id
    join staff_role sr on sr.staff_id = st.id
    where sr.role in ('hra', 'it_admin')
      and (st.terminated_at is null)
  `);
  const adminRows = (
    Array.isArray(adminRes) ? adminRes : ((adminRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ email: string }>;

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const reviewUrl = `${webOrigin}/admin/access-review`;

  for (const admin of adminRows) {
    const emailJob: SendEmailJob = {
      to: admin.email,
      kind: NotificationKind.AccessReviewGenerated,
      payload: {
        periodLabel: quarter.label,
        itemCount,
        reviewUrl,
      },
    };
    await boss.send(EMAIL_QUEUE, emailJob);
  }

  return { cycleId, itemCount };
}

export async function applyAccessReviewDecision(
  db: DB,
  opts: {
    itemId: string;
    decision: 'approved' | 'revoked' | 'deferred';
    reason?: string;
    actorUserId: string;
  },
): Promise<void> {
  const { itemId, decision, reason, actorUserId } = opts;

  await db.transaction(async (tx) => {
    // Fetch item to get user_id
    const itemRes = await tx.execute(sql`
      select id, user_id, cycle_id, decision from access_review_item where id = ${itemId}::uuid limit 1
    `);
    const itemRows = (
      Array.isArray(itemRes) ? itemRes : ((itemRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ id: string; user_id: string; cycle_id: string; decision: string | null }>;
    const item = itemRows[0];
    if (!item) throw new Error('Review item not found');
    if (item.decision) throw new Error('Decision already recorded for this item');

    // Set decision
    await tx.execute(sql`
      update access_review_item
      set
        decision = ${decision},
        decision_reason = ${reason ?? null},
        decided_by_user_id = ${actorUserId}::uuid,
        decided_at = now()
      where id = ${itemId}::uuid
    `);

    if (decision === 'revoked') {
      // Remove all staff_role rows
      await tx.execute(sql`
        delete from staff_role
        where staff_id in (
          select id from staff where user_id = ${item.user_id}::uuid
        )
      `);

      // Kill all sessions
      await tx.execute(sql`
        delete from session where user_id = ${item.user_id}::uuid
      `);

      await writeAudit(tx, {
        eventType: 'access_review.revoked',
        actorId: actorUserId,
        actorRole: null,
        targetType: 'user',
        targetId: item.user_id,
        payload: { itemId, cycleId: item.cycle_id, reason: reason ?? null },
        ip: null,
        ua: null,
      });
    } else {
      await writeAudit(tx, {
        eventType: `access_review.${decision}`,
        actorId: actorUserId,
        actorRole: null,
        targetType: 'user',
        targetId: item.user_id,
        payload: { itemId, cycleId: item.cycle_id, reason: reason ?? null },
        ip: null,
        ua: null,
      });
    }

    // Check if entire cycle is complete
    const pendingRes = await tx.execute(sql`
      select count(*)::int as cnt
      from access_review_item
      where cycle_id = ${item.cycle_id}::uuid and decision is null
    `);
    const pendingRows = (
      Array.isArray(pendingRes) ? pendingRes : ((pendingRes as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ cnt: number }>;
    const pendingCount = pendingRows[0]?.cnt ?? 1;

    if (pendingCount === 0) {
      await tx.execute(sql`
        update access_review_cycle
        set status = 'completed', completed_at = now()
        where id = ${item.cycle_id}::uuid
      `);
    }
  });
}
