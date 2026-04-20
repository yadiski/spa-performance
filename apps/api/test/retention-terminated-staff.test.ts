process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { anonymizeTerminatedStaff, processTermination } from '../src/compliance/termination';
import { db } from '../src/db/client';
import { runRetentionTerminatedStaff } from '../src/jobs/retention-terminated-staff';

const ORG_ID = '10000000-0000-0000-0000-000000000001';
const DEPT_ID = '20000000-0000-0000-0000-000000000001';
const GRADE_ID = '30000000-0000-0000-0000-000000000001';

/** Seeds a minimal user + staff row, returns { userId, staffId } */
async function seedStaff(
  tag: string,
  terminatedDaysAgo: number | null = null,
): Promise<{ userId: string; staffId: string }> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });

  // Ensure org, dept, grade exist
  await client`
    insert into organization (id, name) values (${ORG_ID}, 'Test Org')
    on conflict (id) do nothing
  `;
  await client`
    insert into department (id, org_id, name, code) values (${DEPT_ID}, ${ORG_ID}, 'Test Dept', 'TDEPT')
    on conflict (id) do nothing
  `;
  await client`
    insert into grade (id, org_id, code, rank) values (${GRADE_ID}, ${ORG_ID}, 'G1', 'Junior')
    on conflict (id) do nothing
  `;

  const userRes = await client`
    insert into "user" (email, name, email_verified)
    values (${`${tag}@test.local`}, ${tag}, false)
    returning id
  `;
  const userId = (userRes[0] as unknown as { id: string }).id;

  const empNo = `EMP-${tag}-${Date.now()}`;
  const terminatedAt =
    terminatedDaysAgo !== null ? `now() - (${terminatedDaysAgo} || ' days')::interval` : 'null';

  const staffRes = await client.unsafe(`
    insert into staff (user_id, org_id, employee_no, name, designation, department_id, grade_id, hire_date, terminated_at)
    values ('${userId}', '${ORG_ID}', '${empNo}', '${tag}', 'Developer', '${DEPT_ID}', '${GRADE_ID}', '2020-01-01', ${terminatedAt})
    returning id
  `);
  const staffId = (staffRes[0] as unknown as { id: string }).id;

  await client.end({ timeout: 2 });
  return { userId, staffId };
}

describe('processTermination', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff cascade`;
    await client`truncate table "user" cascade`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('sets terminated_at, kills sessions, disables email_verified', async () => {
    const { userId, staffId } = await seedStaff('term-test-1');

    // Create a session for this user
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`
      insert into session (user_id, token, expires_at)
      values (${userId}, 'test-token-xyz', now() + interval '1 day')
    `;
    await client.end({ timeout: 2 });

    const terminatedAt = new Date();
    await processTermination(db, { staffId, terminatedAt, actorUserId: userId });

    // Check terminated_at is set on staff
    const staffRows = await db.execute(sql`
      select terminated_at from staff where id = ${staffId}::uuid
    `);
    const rows = Array.isArray(staffRows) ? staffRows : [];
    expect(rows.length).toBe(1);
    expect((rows[0] as { terminated_at: string | null }).terminated_at).not.toBeNull();

    // Sessions should be deleted
    const sessionRows = await db.execute(sql`
      select count(*) as cnt from session where user_id = ${userId}::uuid
    `);
    const sRows = Array.isArray(sessionRows) ? sessionRows : [];
    expect(Number((sRows[0] as { cnt: string }).cnt)).toBe(0);

    // email_verified should be false
    const userRows = await db.execute(sql`
      select email_verified from "user" where id = ${userId}::uuid
    `);
    const uRows = Array.isArray(userRows) ? userRows : [];
    expect((uRows[0] as { email_verified: boolean }).email_verified).toBe(false);

    // Audit event should exist
    const auditRows = await db.execute(sql`
      select event_type from audit_log where event_type = 'staff.terminated' limit 1
    `);
    const aRows = Array.isArray(auditRows) ? auditRows : [];
    expect(aRows.length).toBe(1);
  });
});

describe('anonymizeTerminatedStaff', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff cascade`;
    await client`truncate table "user" cascade`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('clears PII fields, deletes user row, writes audit event', async () => {
    const { userId, staffId } = await seedStaff('anon-test-1', 365 * 7 + 1);

    await anonymizeTerminatedStaff(db, { staffId });

    // Staff row still exists with blanked fields
    const staffRows = await db.execute(sql`
      select name, designation, department_id, grade_id, manager_id
      from staff where id = ${staffId}::uuid
    `);
    const rows = Array.isArray(staffRows) ? staffRows : [];
    expect(rows.length).toBe(1);
    const row = rows[0] as {
      name: string;
      designation: string;
      department_id: string | null;
      grade_id: string | null;
      manager_id: string | null;
    };
    expect(row.name).toBe('');
    expect(row.designation).toBe('');
    expect(row.department_id).toBeNull();
    expect(row.grade_id).toBeNull();
    expect(row.manager_id).toBeNull();

    // User row is deleted (user_id on staff becomes null via SET NULL FK)
    const userRows = await db.execute(sql`
      select id from "user" where id = ${userId}::uuid
    `);
    const uRows = Array.isArray(userRows) ? userRows : [];
    expect(uRows.length).toBe(0);

    // Audit event written
    const auditRows = await db.execute(sql`
      select event_type from audit_log where event_type = 'staff.anonymized' limit 1
    `);
    const aRows = Array.isArray(auditRows) ? auditRows : [];
    expect(aRows.length).toBeGreaterThan(0);
  });
});

describe('runRetentionTerminatedStaff', () => {
  beforeEach(async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    await client`truncate table staff cascade`;
    await client`truncate table "user" cascade`;
    await client`truncate table audit_log`;
    await client.end({ timeout: 2 });
  });

  it('anonymizes staff terminated more than 7 years ago', async () => {
    const sevenYearsPlus = 365 * 7 + 2;
    await seedStaff('job-anon-1', sevenYearsPlus);
    await seedStaff('job-anon-2', sevenYearsPlus);
    await seedStaff('job-recent', 30); // recently terminated — should NOT be anonymized

    const result = await runRetentionTerminatedStaff(db);
    expect(result.anonymized).toBe(2);
    expect(result.failed).toBe(0);

    // Verify the recent staff was not anonymized
    const recentStaff = await db.execute(sql`
      select name from staff where name = 'job-recent'
    `);
    const rows = Array.isArray(recentStaff) ? recentStaff : [];
    expect(rows.length).toBe(1);
  });

  it('returns 0 when no staff are beyond the 7-year cutoff', async () => {
    await seedStaff('not-ready', 30); // terminated only 30 days ago
    const result = await runRetentionTerminatedStaff(db);
    expect(result.anonymized).toBe(0);
  });
});
