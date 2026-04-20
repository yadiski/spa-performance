import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { DB } from '../db/client';

export interface PmsOrgSnapshotRow {
  employeeNo: string;
  staffName: string;
  department: string;
  grade: string;
  fy: number;
  state: string;
  scoreTotal: string | null;
  kraScore: number | null;
  behaviouralScore: number | null;
  contributionScore: number | null;
  finalizedAt: string | null;
  appraiser: string | null; // name of manager
  nextLevel: string | null; // name of manager's manager
}

export async function generatePmsOrgSnapshot(
  db: DB,
  opts: { orgId: string; fy?: number },
): Promise<{ bytes: Buffer; rowCount: number; sha256: string }> {
  // We need self-joins for appraiser (staff.manager) and next_level (appraiser.manager).
  // Drizzle doesn't natively alias the same table twice in a join, so we use raw SQL.
  const fyFilter = opts.fy != null ? `AND pc.fy = ${Number(opts.fy)}` : '';

  const rows = await db.execute<{
    employee_no: string;
    staff_name: string;
    department_name: string;
    grade_code: string;
    fy: number;
    state: string;
    score_total: string | null;
    kra_score: string | null;
    behavioural_score: string | null;
    contribution_score: string | null;
    finalized_at: string | null;
    appraiser_name: string | null;
    next_level_name: string | null;
  }>(sql`
    SELECT
      s.employee_no,
      s.name           AS staff_name,
      d.name           AS department_name,
      g.code           AS grade_code,
      pc.fy,
      pc.state,
      pfs.score_total,
      (pfs.score_breakdown->>'kra')::numeric           AS kra_score,
      (pfs.score_breakdown->>'behavioural')::numeric   AS behavioural_score,
      (pfs.score_breakdown->>'contribution')::numeric  AS contribution_score,
      pfs.finalized_at,
      mgr.name         AS appraiser_name,
      nextlvl.name     AS next_level_name
    FROM performance_cycle pc
    JOIN staff s            ON s.id = pc.staff_id
    JOIN department d       ON d.id = s.department_id
    JOIN grade g            ON g.id = s.grade_id
    LEFT JOIN staff mgr     ON mgr.id = s.manager_id
    LEFT JOIN staff nextlvl ON nextlvl.id = mgr.manager_id
    LEFT JOIN pms_assessment pa ON pa.cycle_id = pc.id
    LEFT JOIN LATERAL (
      SELECT score_total, score_breakdown, finalized_at
      FROM pms_final_snapshot
      WHERE pms_id = pa.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pfs ON true
    WHERE s.org_id = ${opts.orgId}
      AND pc.state = 'pms_finalized'
      ${sql.raw(fyFilter)}
    ORDER BY s.employee_no
  `);

  const data: PmsOrgSnapshotRow[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    employeeNo: r.employee_no,
    staffName: r.staff_name,
    department: r.department_name,
    grade: r.grade_code,
    fy: r.fy,
    state: r.state,
    scoreTotal: r.score_total != null ? Number(r.score_total).toFixed(2) : null,
    kraScore: r.kra_score != null ? Number(r.kra_score) : null,
    behaviouralScore: r.behavioural_score != null ? Number(r.behavioural_score) : null,
    contributionScore: r.contribution_score != null ? Number(r.contribution_score) : null,
    finalizedAt: r.finalized_at != null ? new Date(r.finalized_at).toISOString() : null,
    appraiser: r.appraiser_name ?? null,
    nextLevel: r.next_level_name ?? null,
  }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PMS System';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('PMS Snapshot');

  // Column definitions
  ws.columns = [
    { header: 'Employee No', key: 'employeeNo', width: 15 },
    { header: 'Name', key: 'staffName', width: 28 },
    { header: 'Department', key: 'department', width: 22 },
    { header: 'Grade', key: 'grade', width: 10 },
    { header: 'FY', key: 'fy', width: 8 },
    { header: 'State', key: 'state', width: 18 },
    { header: 'Score Total', key: 'scoreTotal', width: 13 },
    { header: 'KRA Score', key: 'kraScore', width: 12 },
    { header: 'Behavioural Score', key: 'behaviouralScore', width: 18 },
    { header: 'Contribution Score', key: 'contributionScore', width: 19 },
    { header: 'Finalized At', key: 'finalizedAt', width: 24 },
    { header: 'Appraiser', key: 'appraiser', width: 22 },
    { header: 'Next Level', key: 'nextLevel', width: 22 },
  ];

  // Bold + fill header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EAF6' },
  };
  headerRow.alignment = { vertical: 'middle' };

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Add data rows
  for (const row of data) {
    const added = ws.addRow({
      employeeNo: row.employeeNo,
      staffName: row.staffName,
      department: row.department,
      grade: row.grade,
      fy: row.fy,
      state: row.state,
      scoreTotal: row.scoreTotal ?? '',
      kraScore: row.kraScore != null ? Number(row.kraScore.toFixed(2)) : '',
      behaviouralScore: row.behaviouralScore != null ? Number(row.behaviouralScore.toFixed(2)) : '',
      contributionScore:
        row.contributionScore != null ? Number(row.contributionScore.toFixed(2)) : '',
      finalizedAt: row.finalizedAt ?? '',
      appraiser: row.appraiser ?? '',
      nextLevel: row.nextLevel ?? '',
    });

    // Format numeric columns to 2dp display
    for (const colKey of ['scoreTotal', 'kraScore', 'behaviouralScore', 'contributionScore']) {
      const col = ws.columns.find((c) => c.key === colKey);
      if (col?.number != null) {
        const cell = added.getCell(col.number);
        if (typeof cell.value === 'number') {
          cell.numFmt = '0.00';
        }
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Buffer.from(buffer);
  const hash = createHash('sha256').update(bytes).digest('hex');

  return { bytes, rowCount: data.length, sha256: hash };
}
