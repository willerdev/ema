-- Password reset codes + cap airfarming drop interest at 57.9%.

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_user_active
  on public.password_reset_codes (user_id, expires_at desc)
  where used_at is null;

-- Cap tier defaults and enforce max 57.9% on bands and scheduled drops.
update public.airfarming_drop_bands
set percent = least(percent, 57.9), updated_at = now()
where percent > 57.9;

alter table if exists public.airfarming_drop_bands
  drop constraint if exists airfarming_drop_bands_percent_check;

alter table if exists public.airfarming_drop_bands
  add constraint airfarming_drop_bands_percent_check
  check (percent >= 0.01 and percent <= 57.9);

update public.airfarming_drops
set percent = least(percent, 57.9)
where percent > 57.9;

alter table if exists public.airfarming_drops
  drop constraint if exists airfarming_drops_percent_check;

alter table if exists public.airfarming_drops
  add constraint airfarming_drops_percent_check
  check (percent >= 0.01 and percent <= 57.9);
