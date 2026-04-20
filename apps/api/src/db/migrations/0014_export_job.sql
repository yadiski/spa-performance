-- Migration 0014: export_job table for async XLSX generation
-- Idempotent: uses IF NOT EXISTS / DO NOTHING patterns throughout.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS export_job (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text        NOT NULL,
  requested_by   uuid        NOT NULL,
  org_id         uuid        NOT NULL,
  params         jsonb       NOT NULL DEFAULT '{}',
  status         text        NOT NULL DEFAULT 'queued',
  r2_key         text,
  sha256         text,
  error          text,
  row_count      int,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS export_job_requested_by_idx ON export_job (requested_by);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS export_job_org_id_idx ON export_job (org_id);
