-- Migration 0015: audit_archive_manifest table for cold-storage archival records
-- Idempotent: uses IF NOT EXISTS patterns throughout.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_archive_manifest (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  r2_key       text        NOT NULL UNIQUE,
  sha256       text        NOT NULL,
  row_count    integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_archive_manifest_period_idx
  ON audit_archive_manifest (period_start, period_end);
