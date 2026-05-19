-- Expert platform trading balance (funded from internal cash wallet).

create table if not exists public.expert_trading_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  market_group text not null check (market_group in ('derived', 'metals')),
  balance numeric(18, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.expert_trading_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('to_expert', 'to_cash')),
  amount numeric(18, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_expert_trading_transfers_user_created
  on public.expert_trading_transfers (user_id, created_at desc);
