-- Migration 0013: staff full-text / trigram search
-- Uses trigger-based search_text column (PG 16 disallows subqueries in GENERATED columns).
-- The __test_migrations journal ensures this only runs once per test run.

--> statement-breakpoint
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN null;
END $$;

--> statement-breakpoint
ALTER TABLE staff ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE OR REPLACE FUNCTION staff_refresh_search() RETURNS trigger AS $$
BEGIN
  NEW.search_text := coalesce(NEW.name, '') || ' ' || coalesce(NEW.employee_no, '') || ' ' || (
    SELECT coalesce(email, '') FROM "user" WHERE id = NEW.user_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS staff_refresh_search_trg ON staff;

--> statement-breakpoint
CREATE TRIGGER staff_refresh_search_trg
  BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION staff_refresh_search();

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_name_trgm_idx
  ON staff USING gin (lower(name) gin_trgm_ops);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_search_text_trgm_idx
  ON staff USING gin (lower(search_text) gin_trgm_ops);

--> statement-breakpoint
-- Backfill existing rows by firing the trigger
UPDATE staff SET name = name;
