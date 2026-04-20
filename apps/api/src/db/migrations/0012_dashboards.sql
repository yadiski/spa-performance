-- Migration 0012: dashboard materialized views
-- note: materialized views cannot use CREATE IF NOT EXISTS, so we drop and recreate.
-- The __test_migrations journal ensures this only runs once per test run.

-- ── mv_cycle_summary ──────────────────────────────────────────────────────────
-- Per-cycle computed score, state, last-updated.
-- score_total is NULL for non-finalized cycles.
-- Unique index on cycle_id required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_cycle_summary CASCADE;
--> statement-breakpoint
CREATE MATERIALIZED VIEW mv_cycle_summary AS
  SELECT
    pc.id            AS cycle_id,
    pc.staff_id,
    s.org_id,
    s.department_id,
    s.grade_id,
    pc.fy,
    pc.state,
    pfs.score_total::numeric(4,2) AS score_total,
    pc.pms_finalized_at            AS finalized_at,
    pc.updated_at
  FROM performance_cycle pc
  JOIN staff s ON s.id = pc.staff_id
  LEFT JOIN pms_assessment pa ON pa.cycle_id = pc.id
  LEFT JOIN LATERAL (
    SELECT score_total
    FROM pms_final_snapshot
    WHERE pms_id = pa.id
    ORDER BY created_at DESC
    LIMIT 1
  ) pfs ON true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mv_cycle_summary_idx ON mv_cycle_summary (cycle_id);

-- ── mv_dept_rollup ────────────────────────────────────────────────────────────
-- Per-department: total cycles, finalized, avg score.
-- Aggregated from mv_cycle_summary.
-- Unique index on (department_id, org_id) required for CONCURRENTLY refresh.
--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_dept_rollup CASCADE;
--> statement-breakpoint
CREATE MATERIALIZED VIEW mv_dept_rollup AS
  SELECT
    cs.department_id,
    cs.org_id,
    count(*)                                    AS total_cycles,
    count(*) FILTER (WHERE cs.state = 'pms_finalized') AS finalized_cycles,
    round(avg(cs.score_total) FILTER (WHERE cs.score_total IS NOT NULL), 2) AS avg_score,
    now()                                       AS updated_at
  FROM mv_cycle_summary cs
  GROUP BY cs.department_id, cs.org_id;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mv_dept_rollup_idx ON mv_dept_rollup (department_id, org_id);

-- ── mv_org_rollup ─────────────────────────────────────────────────────────────
-- Org-wide stats per FY.
-- state_counts is a JSONB mapping each state to its count.
-- Unique index on (org_id, fy) required for CONCURRENTLY refresh.
--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_org_rollup CASCADE;
--> statement-breakpoint
CREATE MATERIALIZED VIEW mv_org_rollup AS
  SELECT
    agg.org_id,
    agg.fy,
    agg.total_cycles,
    agg.finalized_cycles,
    agg.avg_score,
    sc.state_counts,
    now() AS updated_at
  FROM (
    SELECT
      org_id,
      fy,
      count(*)                                         AS total_cycles,
      count(*) FILTER (WHERE state = 'pms_finalized')  AS finalized_cycles,
      round(avg(score_total) FILTER (WHERE score_total IS NOT NULL), 2) AS avg_score
    FROM mv_cycle_summary
    GROUP BY org_id, fy
  ) agg
  JOIN (
    SELECT
      org_id,
      fy,
      jsonb_object_agg(state, n) AS state_counts
    FROM (
      SELECT org_id, fy, state, count(*) AS n
      FROM mv_cycle_summary
      GROUP BY org_id, fy, state
    ) state_cnt
    GROUP BY org_id, fy
  ) sc ON sc.org_id = agg.org_id AND sc.fy = agg.fy;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mv_org_rollup_idx ON mv_org_rollup (org_id, fy);
