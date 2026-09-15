alter table public.reps
  add column if not exists is_current_member boolean not null default true,
  add column if not exists last_seen_at timestamptz;

create unique index if not exists idx_reps_current_district
  on public.reps (state, congressionaldistrict)
  where is_current_member = true;
