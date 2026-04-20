process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { applyBatch, revertBatch, stageBatch } from '../src/domain/staff/bulk-import';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCsv(rows: Array<Record<string, string>>): string {
  const cols = [
    'employee_no',
    'email',
    'name',
    'designation',
    'department_code',
    'grade_code',
    'manager_employee_no',
    'hire_date',
    'roles',
  ];
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => r[c] ?? '').join(','));
  return [header, ...lines].join('\n');
}

const ACTOR = '00000000-0000-0000-0000-000000000001';

const BASE_ROW = {
  employee_no: 'E001',
  email: 'alice@test.com',
  name: 'Alice',
  designation: 'Director',
  department_code: 'EXEC',
  grade_code: 'E12',
  manager_employee_no: '',
  hire_date: '2020-01-01',
  roles: 'hra',
};

// ── Fixtures ──────────────────────────────────────────────────────────────

let orgId: string;

beforeEach(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table staff_import_stage, staff_import_batch, staff_role, staff, grade, department, organization, "user" cascade`;
  await client.end({ timeout: 2 });

  const [o] = await db.insert(s.organization).values({ name: 'TestOrg' }).returning();
  orgId = o!.id;

  await db.insert(s.department).values([
    { orgId, code: 'EXEC', name: 'Executive' },
    { orgId, code: 'IT', name: 'Information Tech' },
  ]);
  await db.insert(s.grade).values([
    { orgId, code: 'E12', rank: '12' },
    { orgId, code: 'E09', rank: '9' },
  ]);
});

afterEach(async () => {
  // Truncate audit_log rows written during test to avoid cross-test hash issues
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await client`truncate table audit_log`;
  await client.end({ timeout: 2 });
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('stageBatch', () => {
  it('valid CSV → no errors, status validated', async () => {
    const csv = makeCsv([BASE_ROW]);
    const result = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.batchId).toBeTruthy();

    const batchRes = await db.execute(
      sql`select status from staff_import_batch where id = ${result.batchId}`,
    );
    const batches = Array.isArray(batchRes)
      ? batchRes
      : ((batchRes as { rows?: unknown[] }).rows ?? []);
    expect((batches[0] as { status: string }).status).toBe('validated');
  });

  it('missing required field → error reported, status failed', async () => {
    const csv = makeCsv([{ ...BASE_ROW, email: '' }]); // email blank → invalid email
    const result = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.column).toBeTruthy();

    const batchRes = await db.execute(
      sql`select status from staff_import_batch where id = ${result.batchId}`,
    );
    const batches = Array.isArray(batchRes)
      ? batchRes
      : ((batchRes as { rows?: unknown[] }).rows ?? []);
    expect((batches[0] as { status: string }).status).toBe('failed');
  });

  it('unknown department_code → error on that row', async () => {
    const csv = makeCsv([{ ...BASE_ROW, department_code: 'BOGUS' }]);
    const result = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    expect(result.errors.some((e) => e.column === 'department_code')).toBe(true);
  });

  it('manager chain cycle → error', async () => {
    const csv = makeCsv([
      { ...BASE_ROW, employee_no: 'E001', email: 'a@t.com', manager_employee_no: 'E002' },
      { ...BASE_ROW, employee_no: 'E002', email: 'b@t.com', manager_employee_no: 'E001' },
    ]);
    const result = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    expect(result.errors.some((e) => e.message.includes('cycle'))).toBe(true);
  });

  it('duplicate employee_no in CSV → error', async () => {
    const csv = makeCsv([
      { ...BASE_ROW, employee_no: 'E001', email: 'a@t.com' },
      { ...BASE_ROW, employee_no: 'E001', email: 'b@t.com' },
    ]);
    const result = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    expect(result.errors.some((e) => e.column === 'employee_no')).toBe(true);
  });

  it('same CSV staged twice → second returns same batchId (idempotency — already applied)', async () => {
    const csv = makeCsv([BASE_ROW]);

    // Stage + apply first batch
    const first = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });
    await applyBatch(db, { batchId: first.batchId, actorUserId: ACTOR });

    // Stage again
    const second = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });
    expect(second.batchId).toBe(first.batchId);
    expect(second.errors).toHaveLength(0);
  });
});

describe('applyBatch', () => {
  it('happy path → rows inserted, snapshot captured', async () => {
    const csv = makeCsv([BASE_ROW]);
    const { batchId } = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });

    const result = await applyBatch(db, { batchId, actorUserId: ACTOR });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('apply failed');
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);

    // Staff row should exist
    const staffRes = await db.execute(sql`select employee_no from staff where org_id = ${orgId}`);
    const rows = Array.isArray(staffRes)
      ? staffRes
      : ((staffRes as { rows?: unknown[] }).rows ?? []);
    expect(rows.length).toBe(1);
    expect((rows[0] as { employee_no: string }).employee_no).toBe('E001');

    // snapshot_before should be recorded
    const batchRes = await db.execute(
      sql`select snapshot_before from staff_import_batch where id = ${batchId}`,
    );
    const batches = Array.isArray(batchRes)
      ? batchRes
      : ((batchRes as { rows?: unknown[] }).rows ?? []);
    // snapshot_before is [] for brand-new insertions (no prior state)
    expect((batches[0] as { snapshot_before: unknown }).snapshot_before).toBeTruthy();
  });

  it('apply on non-validated batch → error', async () => {
    // Insert a batch directly in 'failed' status
    const batchRes = await db.execute(
      sql`insert into staff_import_batch (org_id, requested_by, csv_hash, row_count, status)
          values (${orgId}, ${ACTOR}, 'abc', 0, 'failed') returning id`,
    );
    const batchId = (
      (Array.isArray(batchRes) ? batchRes : ((batchRes as { rows?: unknown[] }).rows ?? []))[0] as {
        id: string;
      }
    ).id;

    const result = await applyBatch(db, { batchId, actorUserId: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('should have failed');
    expect(result.error).toContain('failed');
  });
});

describe('revertBatch', () => {
  it('revert of new insertions → rows deleted', async () => {
    const csv = makeCsv([BASE_ROW]);
    const { batchId } = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });
    await applyBatch(db, { batchId, actorUserId: ACTOR });

    // Staff should exist
    const beforeRevert = await db.execute(sql`select id from staff where org_id = ${orgId}`);
    const before = Array.isArray(beforeRevert)
      ? beforeRevert
      : ((beforeRevert as { rows?: unknown[] }).rows ?? []);
    expect(before.length).toBe(1);

    const result = await revertBatch(db, { batchId, actorUserId: ACTOR });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('revert failed');
    expect(result.reverted).toBe(1);

    // Staff should be gone
    const afterRevert = await db.execute(sql`select id from staff where org_id = ${orgId}`);
    const after = Array.isArray(afterRevert)
      ? afterRevert
      : ((afterRevert as { rows?: unknown[] }).rows ?? []);
    expect(after.length).toBe(0);
  });

  it('revert restores prior staff values when updating existing', async () => {
    // Pre-create a staff row
    const [dept] = await db
      .select()
      .from(s.department)
      .where(sql`code = 'EXEC' and org_id = ${orgId}`);
    const [grade] = await db.select().from(s.grade).where(sql`code = 'E12' and org_id = ${orgId}`);

    const [userRow] = await db
      .insert(s.user)
      .values({ email: 'alice@test.com', name: 'Alice Original' })
      .returning();
    await db.insert(s.staff).values({
      orgId,
      userId: userRow!.id,
      employeeNo: 'E001',
      name: 'Alice Original',
      designation: 'Engineer',
      departmentId: dept!.id,
      gradeId: grade!.id,
      managerId: null,
      hireDate: '2015-01-01',
    });

    // Apply a CSV that updates that employee
    const csv = makeCsv([{ ...BASE_ROW, name: 'Alice Updated', designation: 'Director' }]);
    const { batchId } = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });
    await applyBatch(db, { batchId, actorUserId: ACTOR });

    // Verify update was applied
    const afterApply = await db.execute(
      sql`select name, designation from staff where employee_no = 'E001' and org_id = ${orgId}`,
    );
    const updatedRows = Array.isArray(afterApply)
      ? afterApply
      : ((afterApply as { rows?: unknown[] }).rows ?? []);
    expect((updatedRows[0] as { designation: string }).designation).toBe('Director');

    // Revert
    const result = await revertBatch(db, { batchId, actorUserId: ACTOR });
    expect(result.ok).toBe(true);

    // Verify prior values restored
    const afterRevert = await db.execute(
      sql`select name, designation from staff where employee_no = 'E001' and org_id = ${orgId}`,
    );
    const revertedRows = Array.isArray(afterRevert)
      ? afterRevert
      : ((afterRevert as { rows?: unknown[] }).rows ?? []);
    expect((revertedRows[0] as { designation: string }).designation).toBe('Engineer');
  });

  it('revertBatch after 24h → error', async () => {
    const csv = makeCsv([BASE_ROW]);
    const { batchId } = await stageBatch(db, { orgId, actorUserId: ACTOR, csv });
    await applyBatch(db, { batchId, actorUserId: ACTOR });

    // Artificially move applied_at 25 hours into the past
    await db.execute(
      sql`update staff_import_batch set applied_at = now() - interval '25 hours' where id = ${batchId}`,
    );

    const result = await revertBatch(db, { batchId, actorUserId: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('should have failed');
    expect(result.error).toContain('expired');
  });
});
