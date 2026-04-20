create table if not exists impersonation_session (
  id uuid primary key default gen_random_uuid(),
  impersonator_user_id uuid not null,
  target_user_id uuid not null,
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text,
  target_notified_at timestamptz
);
--> statement-breakpoint
create index if not exists impersonation_active_idx on impersonation_session (impersonator_user_id, ended_at) where ended_at is null;
