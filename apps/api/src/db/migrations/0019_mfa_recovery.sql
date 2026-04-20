create table if not exists mfa_recovery_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists mfa_recovery_code_user_idx on mfa_recovery_code (user_id) where used_at is null;
