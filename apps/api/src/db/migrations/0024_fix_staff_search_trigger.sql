-- Migration 0024: fix staff_refresh_search trigger to handle null user_id
-- Needed for the anonymization flow where staff.user_id is set to null.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION staff_refresh_search() RETURNS trigger AS $$
BEGIN
  NEW.search_text := coalesce(NEW.name, '') || ' ' || coalesce(NEW.employee_no, '') || ' ' || coalesce(
    (SELECT email FROM "user" WHERE id = NEW.user_id),
    ''
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
