-- Optional: add airfarming + contracts tables to an existing database that already ran an older schema.sql.
-- Safe to run multiple times (IF NOT EXISTS).

create table if not exists public.airfarming_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  week_start date not null,
  weekly_event_target integer not null check (weekly_event_target between 2 and 4),
  weekly_events_used integer not null default 0,
  event_offsets_hours jsonb not null default '[]'::jsonb,
  last_event_at timestamptz,
  updated_at timestamptz default now() not null
);

create table if not exists public.airfarming_events (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  percent numeric(10,2) not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_airfarming_events_user_created on public.airfarming_events(user_id, created_at desc);

create table if not exists public.contract_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  balance numeric(18,8) not null default 0,
  updated_at timestamptz default now() not null
);

create table if not exists public.contract_accruals (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  accrual_date date not null,
  rate numeric(12,8) not null,
  amount numeric(18,8) not null,
  balance_after numeric(18,8) not null,
  unique (user_id, accrual_date)
);

create index if not exists idx_contract_accruals_user on public.contract_accruals(user_id, accrual_date desc);

-- Optional crypto wallet cache columns for throttled on-chain balance refreshes.
alter table if exists public.crypto_ethereum_wallets
  add column if not exists cached_eth_balance text default '0' not null;

alter table if exists public.crypto_ethereum_wallets
  add column if not exists cached_usdt_balance text default '0' not null;

alter table if exists public.crypto_ethereum_wallets
  add column if not exists balances_updated_at timestamptz;

alter table if exists public.crypto_ethereum_wallets
  add column if not exists balance_sync_status text default 'idle' not null;

alter table if exists public.crypto_ethereum_wallets
  add column if not exists balance_sync_message text;
