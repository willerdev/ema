-- Platform-provisioned live trading wallets and market prices.

create table if not exists public.live_trading_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mt5_account_id uuid not null unique references public.mt5_accounts(id) on delete cascade,
  balance numeric(18, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_trading_wallets_user on public.live_trading_wallets (user_id);

create table if not exists public.live_trading_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mt5_account_id uuid not null references public.mt5_accounts(id) on delete cascade,
  direction text not null check (direction in ('to_live', 'to_cash')),
  amount numeric(18, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_live_trading_transfers_user_created
  on public.live_trading_transfers (user_id, created_at desc);

create table if not exists public.market_prices (
  symbol text primary key,
  bid numeric(18, 8),
  ask numeric(18, 8),
  updated_at timestamptz not null default now()
);

alter table public.mt5_accounts
  add column if not exists is_platform_provisioned boolean not null default false,
  add column if not exists bot_type text check (bot_type is null or bot_type in ('synthetix_ea', 'quantix_ea')),
  add column if not exists platform_login integer;

create sequence if not exists public.platform_mt5_login_seq start 900100 increment 1;

comment on table public.live_trading_wallets is 'User-funded balance allocated to a platform-provisioned trading account.';
comment on table public.market_prices is 'Latest quote feed from price EA webhook.';
