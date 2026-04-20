create table if not exists user_invite (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null,           -- sha256 of the random token
  invited_by_user_id uuid not null,
  org_id uuid not null,
  staff_id uuid,                      -- pre-created staff row (optional for now)
  roles text[] not null default '{}',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_invite_token_idx on user_invite (token_hash) where accepted_at is null;
create index if not exists user_invite_email_idx on user_invite (email);
