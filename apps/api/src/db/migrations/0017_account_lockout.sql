create table if not exists auth_failed_attempt (
  id bigserial primary key,
  user_id uuid,
  email_tried text,
  ip inet,
  ua text,
  occurred_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists auth_failed_attempt_user_idx on auth_failed_attempt (user_id, occurred_at desc);
--> statement-breakpoint
create index if not exists auth_failed_attempt_email_idx on auth_failed_attempt (email_tried, occurred_at desc);
--> statement-breakpoint
create table if not exists account_lockout (
  user_id uuid primary key,
  locked_at timestamptz not null default now(),
  locked_until timestamptz not null,
  locked_by_system boolean not null default true,
  unlock_reason text
);
