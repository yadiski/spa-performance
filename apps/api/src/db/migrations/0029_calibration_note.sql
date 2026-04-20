-- Migration 0029: HRA calibration override notes
-- When the HRA flags a staff rating as an outlier during the calibration
-- view, they can attach a note explaining the intent / decision. Stored
-- server-side so every HRA sees the same history. Idempotent re-apply.

--> statement-breakpoint
create table if not exists calibration_note (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null,
  grade_id        uuid        not null,
  fy              integer     not null,
  subject_staff_id uuid,              -- resolved staff, or null if we only know the anonymous key
  subject_key     text        not null, -- anonymous hash used in AI outputs
  subject_name    text        not null, -- de-anonymized name at save time
  note            text        not null,
  created_by_user_id uuid     not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

--> statement-breakpoint
create index if not exists calibration_note_cohort_idx
  on calibration_note (grade_id, fy, created_at desc);

--> statement-breakpoint
create index if not exists calibration_note_subject_idx
  on calibration_note (subject_key, created_at desc);
