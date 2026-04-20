create table if not exists http_rate_limit (
  bucket_key text primary key,
  requests int not null default 0,
  last_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists http_rate_limit_last_at_idx on http_rate_limit (last_at);
