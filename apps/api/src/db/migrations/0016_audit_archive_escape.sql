-- Migration 0016: allow audit_log deletion only inside the archive escape
-- hatch. Updates remain blocked unconditionally. A tx that has set
-- `app.audit_archive = 'yes'` via SET LOCAL is permitted to delete; all
-- other sessions still hit the append-only guard.

create or replace function audit_log_reject_mut() returns trigger as $$
begin
  if TG_OP = 'DELETE' and current_setting('app.audit_archive', true) = 'yes' then
    return OLD;
  end if;
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;
