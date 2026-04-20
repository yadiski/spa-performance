/**
 * bulk-import.ts — Staging-table-based bulk staff import with validation,
 * idempotency, and 24-hour reversal.
 *
 * Three public functions:
 *   stageBatch  — parse CSV → validate → write staging rows → return errors
 *   applyBatch  — snapshot prior state → upsert staff → mark applied
 *   revertBatch — restore snapshot → mark reverted (within 24h window)
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../../audit/log';
import type { DB } from '../../db/client';

/**
 * Build an IN (...) clause from a list of string values.
 * Uses drizzle's sql.join to safely parameterise each value.
 */
function sqlIn(values: string[]) {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

// ---------------------------------------------------------------------------
// Known role values (mirrors roleEnum in schema/staff.ts)
// ---------------------------------------------------------------------------
const KNOWN_ROLES = new Set([
  'staff',
  'appraiser',
  'next_level',
  'department_head',
  'hr_manager',
  'hra',
  'it_admin',
]);

// ---------------------------------------------------------------------------
// CSV row schema — same fields as the existing importStaffCsv, plus validation
// ---------------------------------------------------------------------------
const csvRowSchema = z.object({
  employee_no: z.string().min(1, 'employee_no is required'),
  email: z.string().email('invalid email'),
  name: z.string().min(1, 'name is required'),
  designation: z.string().min(1, 'designation is required'),
  department_code: z.string().min(1, 'department_code is required'),
  grade_code: z.string().min(1, 'grade_code is required'),
  manager_employee_no: z.string().optional().default(''),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'hire_date must be YYYY-MM-DD'),
  roles: z.string().optional().default(''),
});

type CsvRow = z.infer<typeof csvRowSchema>;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface StageBatchInput {
  orgId: string;
  actorUserId: string;
  csv: string;
}

export interface ValidationError {
  row: number;
  column?: string | undefined;
  message: string;
}

export interface StageBatchResult {
  batchId: string;
  csvHash: string;
  rowCount: number;
  errors: ValidationError[];
}

export interface ApplyBatchInput {
  batchId: string;
  actorUserId: string;
}

export interface RevertBatchInput {
  batchId: string;
  actorUserId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashCsv(csv: string): string {
  return createHash('sha256').update(csv, 'utf-8').digest('hex');
}

function parseCsvRaw(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line, _i) => {
    // Handle quoted fields containing commas by simple split (sufficient for this format)
    const vals = line.split(',');
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]!] = (vals[i] ?? '').trim();
    }
    return obj;
  });
}

function extractRows(execResult: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(execResult)) return execResult as Array<Record<string, unknown>>;
  const rows = (execResult as { rows?: unknown[] } | undefined)?.rows;
  return (rows ?? []) as Array<Record<string, unknown>>;
}

/**
 * Detect cycles in the manager chain using Kahn's algorithm (topological sort).
 * Nodes: all employee_no values (from CSV + existing staff).
 * Edges: child → manager (i.e., manager must come before child).
 * Returns the set of employee_nos involved in cycles.
 */
function detectManagerCycles(
  csvRows: Array<{ employee_no: string; manager_employee_no?: string | undefined }>,
  existingManagerMap: Map<string, string | null>,
): Set<string> {
  // Build a graph: node → set of its direct reports (reverse of manager chain)
  const children = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  const allNodes = new Set<string>();
  for (const r of csvRows) {
    allNodes.add(r.employee_no);
  }
  for (const [k] of existingManagerMap) {
    allNodes.add(k);
  }

  for (const node of allNodes) {
    children.set(node, new Set());
    inDegree.set(node, 0);
  }

  // Build edges using CSV rows first, then fill in existing staff not in CSV
  const managerOf = new Map<string, string | null>();
  for (const r of csvRows) {
    const mgr = r.manager_employee_no?.trim() || null;
    managerOf.set(r.employee_no, mgr);
  }
  for (const [empNo, mgr] of existingManagerMap) {
    if (!managerOf.has(empNo)) {
      managerOf.set(empNo, mgr);
    }
  }

  for (const [empNo, mgr] of managerOf) {
    if (mgr && allNodes.has(mgr)) {
      children.get(mgr)!.add(empNo);
      inDegree.set(empNo, (inDegree.get(empNo) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const child of children.get(node) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  // Any node not processed is in a cycle
  const cycleNodes = new Set<string>();
  if (processed < allNodes.size) {
    for (const [node, deg] of inDegree) {
      if (deg > 0) cycleNodes.add(node);
    }
  }
  return cycleNodes;
}

// ---------------------------------------------------------------------------
// stageBatch
// ---------------------------------------------------------------------------

export async function stageBatch(db: DB, input: StageBatchInput): Promise<StageBatchResult> {
  const { orgId, actorUserId, csv } = input;
  const csvHash = hashCsv(csv);

  // ── Idempotency check ────────────────────────────────────────────────────
  const existingRes = await db.execute(
    sql`select id, status from staff_import_batch where org_id = ${orgId} and csv_hash = ${csvHash} limit 1`,
  );
  const existing = extractRows(existingRes)[0] as { id: string; status: string } | undefined;

  if (existing && existing.status === 'applied') {
    return {
      batchId: existing.id,
      csvHash,
      rowCount: 0,
      errors: [],
    };
  }

  // ── Parse CSV ────────────────────────────────────────────────────────────
  const rawRows = parseCsvRaw(csv);

  // ── Per-row validation ───────────────────────────────────────────────────
  const errors: ValidationError[] = [];
  const validRows: Array<CsvRow & { rowNum: number }> = [];

  // Collect all department / grade codes for bulk lookup
  const deptCodes = new Set<string>();
  const gradeCodes = new Set<string>();
  const employeeNosInCsv = new Set<string>();
  const duplicateEmpNos = new Set<string>();

  for (const raw of rawRows) {
    const deptCode = (raw.department_code ?? '').trim();
    const gradeCode = (raw.grade_code ?? '').trim();
    const empNo = (raw.employee_no ?? '').trim();
    if (deptCode) deptCodes.add(deptCode);
    if (gradeCode) gradeCodes.add(gradeCode);
    if (empNo) {
      if (employeeNosInCsv.has(empNo)) duplicateEmpNos.add(empNo);
      else employeeNosInCsv.add(empNo);
    }
  }

  // Fetch valid department codes from DB
  let validDeptCodes = new Set<string>();
  if (deptCodes.size > 0) {
    const deptRes = await db.execute(
      sql`select code from department where org_id = ${orgId} and code in (${sqlIn([...deptCodes])})`,
    );
    validDeptCodes = new Set(extractRows(deptRes).map((r) => r.code as string));
  }

  // Fetch valid grade codes from DB
  let validGradeCodes = new Set<string>();
  if (gradeCodes.size > 0) {
    const gradeRes = await db.execute(
      sql`select code from grade where org_id = ${orgId} and code in (${sqlIn([...gradeCodes])})`,
    );
    validGradeCodes = new Set(extractRows(gradeRes).map((r) => r.code as string));
  }

  // Fetch existing active staff for manager resolution
  const existingStaffRes = await db.execute(
    sql`select employee_no from staff where org_id = ${orgId} and terminated_at is null`,
  );
  const existingEmpNos = new Set(extractRows(existingStaffRes).map((r) => r.employee_no as string));

  // Fetch existing manager map for cycle detection
  const existingManagerRes = await db.execute(
    sql`select s.employee_no, m.employee_no as manager_employee_no
        from staff s
        left join staff m on m.id = s.manager_id
        where s.org_id = ${orgId} and s.terminated_at is null`,
  );
  const existingManagerMap = new Map<string, string | null>(
    extractRows(existingManagerRes).map((r) => [
      r.employee_no as string,
      (r.manager_employee_no as string | null) ?? null,
    ]),
  );

  // Validate each row
  const rowValidationErrors = new Map<number, string[]>();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]!;
    const rowNum = i + 2; // 1-indexed, skipping header
    const rowErrors: string[] = [];

    const parsed = csvRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        rowErrors.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
        errors.push({
          row: rowNum,
          column: issue.path[0] as string | undefined,
          message: issue.message,
        });
      }
    } else {
      const r = parsed.data;

      // Department code
      if (!validDeptCodes.has(r.department_code)) {
        const msg = `department_code "${r.department_code}" not found for this org`;
        rowErrors.push(msg);
        errors.push({ row: rowNum, column: 'department_code', message: msg });
      }

      // Grade code
      if (!validGradeCodes.has(r.grade_code)) {
        const msg = `grade_code "${r.grade_code}" not found for this org`;
        rowErrors.push(msg);
        errors.push({ row: rowNum, column: 'grade_code', message: msg });
      }

      // Duplicate employee_no in CSV
      if (duplicateEmpNos.has(r.employee_no)) {
        const msg = `employee_no "${r.employee_no}" appears more than once in this CSV`;
        rowErrors.push(msg);
        errors.push({ row: rowNum, column: 'employee_no', message: msg });
      }

      // Manager must exist in CSV or in existing active staff (or be blank)
      if (r.manager_employee_no) {
        const mgrInCsv = employeeNosInCsv.has(r.manager_employee_no);
        const mgrInDb = existingEmpNos.has(r.manager_employee_no);
        if (!mgrInCsv && !mgrInDb) {
          const msg = `manager_employee_no "${r.manager_employee_no}" not found in CSV or existing staff`;
          rowErrors.push(msg);
          errors.push({ row: rowNum, column: 'manager_employee_no', message: msg });
        }
      }

      // Roles validation
      if (r.roles) {
        const roleList = r.roles
          .split(/[;,]/)
          .map((x) => x.trim())
          .filter(Boolean);
        for (const role of roleList) {
          if (!KNOWN_ROLES.has(role)) {
            const msg = `unknown role "${role}"`;
            rowErrors.push(msg);
            errors.push({ row: rowNum, column: 'roles', message: msg });
          }
        }
      }

      if (rowErrors.length === 0) {
        validRows.push({ ...r, rowNum });
      }
    }

    if (rowErrors.length > 0) {
      rowValidationErrors.set(rowNum, rowErrors);
    }
  }

  // ── Manager cycle detection (on the full CSV graph) ──────────────────────
  if (errors.length === 0) {
    const cycleNodes = detectManagerCycles(
      rawRows.map((r) => ({
        employee_no: (r.employee_no ?? '').trim(),
        manager_employee_no: (r.manager_employee_no ?? '').trim() || undefined,
      })),
      existingManagerMap,
    );

    for (let i = 0; i < rawRows.length; i++) {
      const empNo = (rawRows[i]!.employee_no ?? '').trim();
      if (cycleNodes.has(empNo)) {
        const rowNum = i + 2;
        const msg = `employee_no "${empNo}" is part of a manager chain cycle`;
        errors.push({ row: rowNum, column: 'manager_employee_no', message: msg });
      }
    }
  }

  const hasErrors = errors.length > 0;
  const status = hasErrors ? 'failed' : 'validated';

  // ── Create batch row ─────────────────────────────────────────────────────
  const batchRes = await db.execute(
    sql`insert into staff_import_batch (org_id, requested_by, csv_hash, row_count, status, validation_errors)
        values (${orgId}, ${actorUserId}, ${csvHash}, ${rawRows.length}, ${status}, ${JSON.stringify(errors)}::jsonb)
        returning id`,
  );
  const batchId = (extractRows(batchRes)[0] as { id: string }).id;

  // ── Insert staged rows ───────────────────────────────────────────────────
  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]!;
    const rowNum = i + 2;
    const validationError = (rowValidationErrors.get(rowNum) ?? []).join('; ') || null;

    const parsed = csvRowSchema.safeParse(raw);
    // Use parsed values if valid, else raw strings for storage
    const r = parsed.success
      ? parsed.data
      : {
          employee_no: raw.employee_no ?? '',
          email: raw.email ?? '',
          name: raw.name ?? '',
          designation: raw.designation ?? '',
          department_code: raw.department_code ?? '',
          grade_code: raw.grade_code ?? '',
          manager_employee_no: raw.manager_employee_no ?? '',
          hire_date: raw.hire_date ?? '',
          roles: raw.roles ?? '',
        };

    await db.execute(
      sql`insert into staff_import_stage
          (batch_id, row_num, employee_no, email, name, designation, department_code, grade_code, manager_employee_no, hire_date, roles, validation_error)
          values (${batchId}, ${rowNum}, ${r.employee_no}, ${r.email}, ${r.name}, ${r.designation},
                  ${r.department_code}, ${r.grade_code}, ${r.manager_employee_no || null}, ${r.hire_date},
                  ${r.roles}, ${validationError})`,
    );
  }

  return {
    batchId,
    csvHash,
    rowCount: rawRows.length,
    errors,
  };
}

// ---------------------------------------------------------------------------
// applyBatch
// ---------------------------------------------------------------------------

export async function applyBatch(
  db: DB,
  input: ApplyBatchInput,
): Promise<{ ok: true; created: number; updated: number } | { ok: false; error: string }> {
  const { batchId, actorUserId } = input;

  // Load batch
  const batchRes = await db.execute(
    sql`select * from staff_import_batch where id = ${batchId} limit 1`,
  );
  const batch = extractRows(batchRes)[0] as
    | { id: string; org_id: string; status: string }
    | undefined;

  if (!batch) return { ok: false, error: 'batch not found' };
  if (batch.status !== 'validated') {
    return { ok: false, error: `batch status is "${batch.status}", must be "validated" to apply` };
  }

  // Load staged rows (only valid ones — no validation_error)
  const stageRes = await db.execute(
    sql`select * from staff_import_stage where batch_id = ${batchId} and validation_error is null order by row_num`,
  );
  const rows = extractRows(stageRes) as Array<{
    employee_no: string;
    email: string;
    name: string;
    designation: string;
    department_code: string;
    grade_code: string;
    manager_employee_no: string | null;
    hire_date: string;
    roles: string;
  }>;

  const orgId = batch.org_id;

  // ── Snapshot prior state ─────────────────────────────────────────────────
  const empNos = rows.map((r) => r.employee_no);
  let snapshotBefore: Array<Record<string, unknown>> = [];

  if (empNos.length > 0) {
    const snapRes = await db.execute(
      sql`select s.*, array_agg(sr.role) filter (where sr.role is not null) as roles_array
          from staff s
          left join staff_role sr on sr.staff_id = s.id
          where s.employee_no in (${sqlIn(empNos)}) and s.org_id = ${orgId}
          group by s.id`,
    );
    snapshotBefore = extractRows(snapRes);
  }

  // ── Transactional upsert ─────────────────────────────────────────────────
  let created = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    const empToStaffId = new Map<string, string>();

    // Pass 1: upsert staff rows (without manager linkage)
    for (const r of rows) {
      const deptRes = await tx.execute(
        sql`select id from department where code = ${r.department_code} and org_id = ${orgId} limit 1`,
      );
      const deptId = (extractRows(deptRes)[0] as { id: string } | undefined)?.id;

      const gradeRes = await tx.execute(
        sql`select id from grade where code = ${r.grade_code} and org_id = ${orgId} limit 1`,
      );
      const gradeId = (extractRows(gradeRes)[0] as { id: string } | undefined)?.id;

      if (!deptId || !gradeId) continue; // already validated, shouldn't happen

      // User upsert by email
      const userRes = await tx.execute(sql`select id from "user" where email = ${r.email} limit 1`);
      let userId = (extractRows(userRes)[0] as { id: string } | undefined)?.id;
      if (!userId) {
        const newUserRes = await tx.execute(
          sql`insert into "user" (email, name) values (${r.email}, ${r.name}) returning id`,
        );
        userId = (extractRows(newUserRes)[0] as { id: string }).id;
      }

      // Staff upsert by employee_no
      const existingRes = await tx.execute(
        sql`select id from staff where employee_no = ${r.employee_no} limit 1`,
      );
      const existingStaff = extractRows(existingRes)[0] as { id: string } | undefined;

      let staffId: string;
      if (existingStaff) {
        staffId = existingStaff.id;
        await tx.execute(
          sql`update staff set name = ${r.name}, designation = ${r.designation},
              department_id = ${deptId}, grade_id = ${gradeId}, updated_at = now()
              where id = ${staffId}`,
        );
        updated++;
      } else {
        const newStaffRes = await tx.execute(
          sql`insert into staff (org_id, user_id, employee_no, name, designation, department_id, grade_id, manager_id, hire_date)
              values (${orgId}, ${userId}, ${r.employee_no}, ${r.name}, ${r.designation},
                      ${deptId}, ${gradeId}, null, ${r.hire_date})
              returning id`,
        );
        staffId = (extractRows(newStaffRes)[0] as { id: string }).id;
        created++;
      }

      empToStaffId.set(r.employee_no, staffId);

      // Roles: replace-all
      await tx.execute(sql`delete from staff_role where staff_id = ${staffId}`);
      const roleList = r.roles
        .split(/[;,]/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const role of roleList) {
        await tx.execute(sql`insert into staff_role (staff_id, role) values (${staffId}, ${role})`);
      }
    }

    // Pass 2: link managers
    for (const r of rows) {
      if (!r.manager_employee_no) continue;
      const childId = empToStaffId.get(r.employee_no);
      const mgrId = empToStaffId.get(r.manager_employee_no);
      if (!childId) continue;

      if (mgrId) {
        await tx.execute(sql`update staff set manager_id = ${mgrId} where id = ${childId}`);
      } else {
        // Manager already in DB
        const mgrRes = await tx.execute(
          sql`select id from staff where employee_no = ${r.manager_employee_no} and org_id = ${orgId} limit 1`,
        );
        const dbMgrId = (extractRows(mgrRes)[0] as { id: string } | undefined)?.id;
        if (dbMgrId) {
          await tx.execute(sql`update staff set manager_id = ${dbMgrId} where id = ${childId}`);
        }
      }
    }

    // Update batch: snapshot + status + applied_at
    await tx.execute(
      sql`update staff_import_batch
          set status = 'applied', applied_at = now(), snapshot_before = ${JSON.stringify(snapshotBefore)}::jsonb
          where id = ${batchId}`,
    );

    // Audit event
    await writeAudit(tx, {
      eventType: 'staff_import.applied',
      actorId: actorUserId,
      actorRole: 'hra',
      targetType: 'staff_import_batch',
      targetId: batchId,
      payload: { batchId, created, updated },
      ip: null,
      ua: null,
    });
  });

  return { ok: true, created, updated };
}

// ---------------------------------------------------------------------------
// revertBatch
// ---------------------------------------------------------------------------

export async function revertBatch(
  db: DB,
  input: RevertBatchInput,
): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  const { batchId, actorUserId } = input;

  // Load batch
  const batchRes = await db.execute(
    sql`select * from staff_import_batch where id = ${batchId} limit 1`,
  );
  const batch = extractRows(batchRes)[0] as
    | {
        id: string;
        org_id: string;
        status: string;
        applied_at: Date | string | null;
        snapshot_before: unknown;
      }
    | undefined;

  if (!batch) return { ok: false, error: 'batch not found' };
  if (batch.status !== 'applied') {
    return { ok: false, error: `batch status is "${batch.status}", must be "applied" to revert` };
  }

  // Check 24-hour window
  if (!batch.applied_at) {
    return { ok: false, error: 'applied_at is null — cannot determine revert window' };
  }
  const appliedAt = new Date(batch.applied_at as string | Date);
  const windowExpiry = new Date(appliedAt.getTime() + 24 * 60 * 60 * 1000);
  if (new Date() > windowExpiry) {
    return { ok: false, error: 'revert window expired (24 hours after apply)' };
  }

  const orgId = batch.org_id;
  const snapshot = (batch.snapshot_before ?? []) as Array<Record<string, unknown>>;

  // Load the employee_nos that were part of this batch
  const stageRes = await db.execute(
    sql`select employee_no from staff_import_stage where batch_id = ${batchId} and validation_error is null`,
  );
  const batchEmpNos = new Set(extractRows(stageRes).map((r) => r.employee_no as string));

  // Build a lookup of prior state by employee_no
  const priorByEmpNo = new Map<string, Record<string, unknown>>();
  for (const row of snapshot) {
    priorByEmpNo.set(row.employee_no as string, row);
  }

  let reverted = 0;

  await db.transaction(async (tx) => {
    for (const empNo of batchEmpNos) {
      const prior = priorByEmpNo.get(empNo);

      if (!prior) {
        // This employee was newly created by the batch → delete
        await tx.execute(sql`delete from staff where employee_no = ${empNo} and org_id = ${orgId}`);
      } else {
        // Employee existed before → restore prior values
        await tx.execute(
          sql`update staff set
              name = ${prior.name as string},
              designation = ${prior.designation as string},
              department_id = ${prior.department_id as string},
              grade_id = ${prior.grade_id as string},
              manager_id = ${prior.manager_id as string | null},
              hire_date = ${prior.hire_date as string},
              updated_at = now()
              where employee_no = ${empNo} and org_id = ${orgId}`,
        );

        // Restore roles
        const staffRes = await tx.execute(
          sql`select id from staff where employee_no = ${empNo} and org_id = ${orgId} limit 1`,
        );
        const staffId = (extractRows(staffRes)[0] as { id: string } | undefined)?.id;
        if (staffId) {
          await tx.execute(sql`delete from staff_role where staff_id = ${staffId}`);
          const priorRoles = (prior.roles_array as string[] | null) ?? [];
          for (const role of priorRoles) {
            await tx.execute(
              sql`insert into staff_role (staff_id, role) values (${staffId}, ${role})`,
            );
          }
        }
      }
      reverted++;
    }

    // Mark batch reverted
    await tx.execute(
      sql`update staff_import_batch set status = 'reverted', reverted_at = now() where id = ${batchId}`,
    );

    // Audit event
    await writeAudit(tx, {
      eventType: 'staff_import.reverted',
      actorId: actorUserId,
      actorRole: 'hra',
      targetType: 'staff_import_batch',
      targetId: batchId,
      payload: { batchId, reverted },
      ip: null,
      ua: null,
    });
  });

  return { ok: true, reverted };
}
