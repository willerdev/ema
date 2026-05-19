-- Optional auto-funding for airfarming drops.

alter table if exists public.airfarming_state
  add column if not exists auto_fund_enabled boolean not null default false;

alter table if exists public.airfarming_drops
  add column if not exists auto_funded_cash numeric(18, 2) not null default 0,
  add column if not exists auto_funded_crypto numeric(18, 2) not null default 0;
