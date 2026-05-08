create table if not exists public.users (
  id uuid primary key,
  email text unique not null,
  password_hash text not null,
  alpaca_api_key text default '' not null,
  alpaca_secret_key text default '' not null,
  created_at timestamptz default now() not null
);

create table if not exists public.wallets (
  id uuid primary key,
  user_id uuid unique not null references public.users(id) on delete cascade,
  balance numeric(18,2) default 0 not null,
  created_at timestamptz default now() not null
);

create table if not exists public.transactions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdraw')),
  amount numeric(18,2) not null check (amount > 0),
  status text not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_transactions_user_id on public.transactions(user_id);
create index if not exists idx_transactions_created_at on public.transactions(created_at desc);

create table if not exists public.mt5_accounts (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  metaapi_account_id text default '' not null,
  login text not null,
  password text not null,
  server text not null,
  account_name text default '' not null,
  cached_balance numeric(18,2),
  cached_equity numeric(18,2),
  cached_currency text,
  balance_last_updated_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_mt5_accounts_user_id on public.mt5_accounts(user_id);

-- Tatum Virtual Accounts (Ethereum mainnet: ETH + USDT)
create table if not exists public.tatum_crypto_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  tatum_customer_id text,
  created_at timestamptz default now() not null
);

create table if not exists public.tatum_virtual_accounts (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  currency text not null check (currency in ('ETH', 'USDT')),
  chain text not null default 'ETHEREUM',
  tatum_account_id text not null,
  deposit_address text not null,
  derivation_index integer not null,
  created_at timestamptz default now() not null,
  unique (user_id, currency, chain)
);

create index if not exists idx_tatum_virtual_accounts_user_id on public.tatum_virtual_accounts(user_id);
create index if not exists idx_tatum_virtual_accounts_deposit_lower on public.tatum_virtual_accounts(lower(deposit_address));

create table if not exists public.tatum_onchain_txs (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  asset text not null,
  amount_display text not null,
  tx_hash text not null,
  log_index integer,
  from_address text,
  to_address text,
  status text not null default 'confirmed',
  dedupe_key text not null unique,
  created_at timestamptz default now() not null
);

create index if not exists idx_tatum_onchain_txs_user_created on public.tatum_onchain_txs(user_id, created_at desc);