-- Local mobile money deposits / crypto-to-mobile withdrawals (Rwanda, Uganda).
-- Run in Supabase SQL editor.

create table if not exists local_money_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('deposit', 'withdraw')),
  country_code text not null,
  fiat_currency text not null,
  fiat_amount numeric not null,
  crypto_asset text not null default 'usdt',
  crypto_amount numeric,
  phone text not null,
  status text not null default 'pending',
  provider text not null default 'flutterwave',
  provider_reference text,
  provider_charge_id text,
  provider_payload jsonb,
  ledger_posted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists local_money_orders_user_id_idx on local_money_orders (user_id, created_at desc);
create index if not exists local_money_orders_status_idx on local_money_orders (status);
