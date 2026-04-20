-- Migration 0023: make staff nullable fields for anonymization post-termination
-- Idempotent: uses IF EXISTS / TRY patterns.

--> statement-breakpoint
-- Allow user_id to be null (set to null when user row is deleted on anonymization)
ALTER TABLE staff ALTER COLUMN user_id DROP NOT NULL;

--> statement-breakpoint
-- Allow department_id to be null (cleared on anonymization)
ALTER TABLE staff ALTER COLUMN department_id DROP NOT NULL;

--> statement-breakpoint
-- Allow grade_id to be null (cleared on anonymization)
ALTER TABLE staff ALTER COLUMN grade_id DROP NOT NULL;

--> statement-breakpoint
-- Drop the RESTRICT FK on staff.user_id so we can delete user rows independently
-- during anonymization (the staff row is kept, user row is deleted).
-- We re-add as SET NULL so DB-level referential integrity is maintained.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_user_id_user_id_fk;

--> statement-breakpoint
ALTER TABLE staff ADD CONSTRAINT staff_user_id_user_id_fk
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
