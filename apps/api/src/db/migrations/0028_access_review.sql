create table if not exists access_review_cycle (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  generated_at timestamptz not null default now(),
  status text not null default 'pending',  -- 'pending'|'in_progress'|'completed'
  completed_at timestamptz,
  created_by_system boolean not null default true
);
create table if not exists access_review_item (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references access_review_cycle(id) on delete cascade,
  user_id uuid not null,
  snapshot jsonb not null,              -- { email, name, roles, lastLoginAt, rolesUnchangedDays }
  decision text,                        -- 'approved'|'revoked'|'deferred' (null = pending)
  decision_reason text,
  decided_by_user_id uuid,
  decided_at timestamptz
);
create index if not exists access_review_item_cycle_idx on access_review_item (cycle_id, decision);

-- user_onboarding_status tracks first-login completion
create table if not exists user_onboarding_status (
  user_id uuid primary key,
  onboarded_at timestamptz not null default now()
);
