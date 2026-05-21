-- Scheduled drop pauses: per-user window (+ optional balance tiers) and global windows.

alter table if exists public.airfarming_state
  add column if not exists drops_pause_from timestamptz,
  add column if not exists drops_pause_until timestamptz,
  add column if not exists drops_pause_band_indexes smallint[];

comment on column public.airfarming_state.drops_pause_from is 'Start of scheduled drop pause (UTC).';
comment on column public.airfarming_state.drops_pause_until is 'End of scheduled drop pause (UTC).';
comment on column public.airfarming_state.drops_pause_band_indexes is
  'Balance tier indexes (0–3) paused during the window; null or empty = all tiers.';

create table if not exists public.airfarming_global_pause (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  band_indexes smallint[],
  note text,
  created_at timestamptz not null default now(),
  constraint airfarming_global_pause_range check (ends_at > starts_at)
);

create index if not exists idx_airfarming_global_pause_active
  on public.airfarming_global_pause (starts_at, ends_at);
