-- Admin-editable drop balance ranges per tier + platform caps (percent & profit).

alter table if exists public.airfarming_drop_bands
  add column if not exists min_balance numeric(18, 2),
  add column if not exists max_balance numeric(18, 2);

update public.airfarming_drop_bands set min_balance = 100, max_balance = 145 where band_index = 0 and min_balance is null;
update public.airfarming_drop_bands set min_balance = 100, max_balance = 112 where band_index = 1 and min_balance is null;
update public.airfarming_drop_bands set min_balance = 1000, max_balance = 2400 where band_index = 2 and min_balance is null;
update public.airfarming_drop_bands set min_balance = 10000, max_balance = 16000 where band_index = 3 and min_balance is null;

alter table if exists public.airfarming_drop_bands
  alter column min_balance set not null,
  alter column max_balance set not null;

alter table if exists public.airfarming_drop_bands
  drop constraint if exists airfarming_drop_bands_balance_range_check;

alter table if exists public.airfarming_drop_bands
  add constraint airfarming_drop_bands_balance_range_check
  check (min_balance >= 0 and max_balance >= min_balance);

create table if not exists public.airfarming_platform_settings (
  id text primary key default 'default' check (id = 'default'),
  max_percent numeric(10, 2) not null default 57.9 check (max_percent >= 0.01 and max_percent <= 100),
  max_profit_per_drop numeric(18, 2) not null default 5000 check (max_profit_per_drop > 0),
  updated_at timestamptz not null default now()
);

insert into public.airfarming_platform_settings (id, max_percent, max_profit_per_drop)
values ('default', 57.9, 5000)
on conflict (id) do nothing;

comment on table public.airfarming_platform_settings is
  'Singleton platform caps for airfarming drop percent and profit per payout.';
comment on column public.airfarming_drop_bands.min_balance is
  'Minimum airfarming balance required to qualify for drops in this tier.';
comment on column public.airfarming_drop_bands.max_balance is
  'Maximum airfarming balance allowed in the eligible window for this tier.';
