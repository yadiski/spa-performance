-- Migration 0021: add request_id to audit_log for cross-correlation with HTTP logs
-- Idempotent: uses IF NOT EXISTS patterns throughout.

--> statement-breakpoint
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_request_id_idx ON audit_log (request_id) WHERE request_id IS NOT NULL;
