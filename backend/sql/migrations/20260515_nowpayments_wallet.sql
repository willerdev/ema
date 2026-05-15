-- NOWPayments crypto ledger (separate from internal cash wallets)

create table if not exists public.nowpayments_payments (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  payment_id text unique,
  order_id text unique not null,
  price_amount numeric(24, 8) not null,
  price_currency text not null,
  pay_currency text not null,
  pay_amount text,
  pay_address text,
  payment_status text not null default 'waiting',
  actually_paid text,
  outcome_amount text,
  outcome_currency text,
  ledger_credited boolean not null default false,
  raw_last_ipn jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_nowpayments_payments_user_created
  on public.nowpayments_payments(user_id, created_at desc);
create index if not exists idx_nowpayments_payments_status
  on public.nowpayments_payments(payment_status);

create table if not exists public.nowpayments_payouts (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  payout_id text,
  unique_external_id text unique not null,
  currency text not null,
  address text not null,
  amount numeric(24, 8) not null check (amount > 0),
  status text not null default 'pending',
  reserve_released boolean not null default false,
  raw_last_ipn jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_nowpayments_payouts_user_created
  on public.nowpayments_payouts(user_id, created_at desc);
create index if not exists idx_nowpayments_payouts_status
  on public.nowpayments_payouts(status);

create table if not exists public.crypto_ledger_entries (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  asset text not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(24, 8) not null check (amount > 0),
  source text not null check (source in ('payment', 'payout', 'reserve', 'reserve_release')),
  source_id uuid not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_crypto_ledger_user_asset
  on public.crypto_ledger_entries(user_id, asset);
create index if not exists idx_crypto_ledger_source
  on public.crypto_ledger_entries(source, source_id);
