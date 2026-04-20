-- Migration 0022: retention_archive_manifest — tracks archived performance records
-- Idempotent: uses IF NOT EXISTS patterns throughout.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS retention_archive_manifest (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     uuid        NOT NULL,
  r2_key       text        NOT NULL UNIQUE,
  sha256       text        NOT NULL,
  row_count    integer     NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS retention_archive_manifest_cycle_id_idx
  ON retention_archive_manifest (cycle_id);
