create extension if not exists citext;

create table if not exists public.users (
  id uuid primary key,
  email text unique not null,
  password_hash text not null,
  alpaca_api_key text default '' not null,
  alpaca_secret_key text default '' not null,
  totp_enabled boolean default false not null,
  totp_secret_enc text,
  created_at timestamptz default now() not null,
  transfer_code citext unique
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
  type text not null check (type in ('deposit','withdraw','peer_send','peer_receive')),
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

-- MT5 EA: optional bearer token for /webhooks/mt5-ea/* (rotate via POST /mt5/accounts/:id/ea-webhook-token)
alter table public.mt5_accounts add column if not exists ea_webhook_token text;
create unique index if not exists idx_mt5_accounts_ea_webhook_token on public.mt5_accounts(ea_webhook_token)
  where ea_webhook_token is not null;

create table if not exists public.mt5_ea_telemetry (
  id uuid primary key default gen_random_uuid(),
  mt5_account_id uuid not null references public.mt5_accounts(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null
);

create index if not exists idx_mt5_ea_telemetry_account_created on public.mt5_ea_telemetry(mt5_account_id, created_at desc);

create table if not exists public.mt5_ea_commands (
  id uuid primary key default gen_random_uuid(),
  mt5_account_id uuid not null references public.mt5_accounts(id) on delete cascade,
  client_id text not null,
  side text not null check (side in ('buy', 'sell')),
  symbol text not null,
  volume numeric(18, 8) not null check (volume > 0),
  stop_loss numeric(18, 8),
  take_profit numeric(18, 8),
  magic integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'acked', 'failed')),
  ack_ticket bigint,
  ack_error text,
  ack_meta jsonb,
  created_at timestamptz default now() not null,
  acked_at timestamptz,
  unique (mt5_account_id, client_id)
);

create index if not exists idx_mt5_ea_commands_account_status on public.mt5_ea_commands(mt5_account_id, status, created_at asc);

-- Custodial Ethereum HD wallet (one address per user; path m/44'/60'/0'/0/{derivation_index})
create table if not exists public.crypto_ethereum_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  derivation_index integer not null unique,
  address text not null,
  cached_eth_balance text default '0' not null,
  cached_usdt_balance text default '0' not null,
  balances_updated_at timestamptz,
  balance_sync_status text default 'idle' not null,
  balance_sync_message text,
  created_at timestamptz default now() not null
);

create index if not exists idx_crypto_ethereum_wallets_address_lower on public.crypto_ethereum_wallets(lower(address));

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

-- Airfarming: server-tracked weekly yield events (product simulation; not on-chain)
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

-- Airfarming: cash moved from internal wallet; return to cash only via /airfarming/return-to-cash (not withdraw)
create table if not exists public.airfarming_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  balance numeric(18,2) not null default 0 check (balance >= 0),
  updated_at timestamptz default now() not null
);

create table if not exists public.airfarming_transfers (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('to_airfarming','to_cash')),
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz default now() not null
);

create index if not exists idx_airfarming_transfers_user_created on public.airfarming_transfers(user_id, created_at desc);

-- Contracts: internal contract balance (funded from cash wallet); daily accrual applied server-side
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
