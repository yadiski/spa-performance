create table if not exists staff_import_batch (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  requested_by uuid not null,
  csv_hash text not null,
  row_count int not null,
  status text not null default 'pending',
  validation_errors jsonb not null default '[]',
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  reverted_at timestamptz,
  snapshot_before jsonb
);
--> statement-breakpoint
create index if not exists staff_import_batch_csv_hash_idx on staff_import_batch (csv_hash);
--> statement-breakpoint
create table if not exists staff_import_stage (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references staff_import_batch(id) on delete cascade,
  row_num int not null,
  employee_no text not null,
  email text not null,
  name text not null,
  designation text not null,
  department_code text not null,
  grade_code text not null,
  manager_employee_no text,
  hire_date date not null,
  roles text not null,
  validation_error text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists staff_import_stage_batch_idx on staff_import_stage (batch_id);
