-- Airfarming segregated balance (from internal cash wallet)
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
