-- Per-user pause: no new drops scheduled and due drops are not settled while paused.

alter table if exists public.airfarming_state
  add column if not exists drops_paused boolean not null default false;

comment on column public.airfarming_state.drops_paused is
  'When true, airfarming drops are not settled and new drops are not scheduled for this user.';
