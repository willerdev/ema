-- Admin-recorded trades shown to users in trade history.

create table if not exists public.user_recorded_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  volume numeric(18, 4) not null default 1 check (volume > 0),
  open_price numeric(18, 6),
  close_price numeric(18, 6),
  profit_usd numeric(18, 2) not null,
  traded_at timestamptz not null default now(),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_recorded_trades_user_traded
  on public.user_recorded_trades (user_id, traded_at desc);

comment on table public.user_recorded_trades is
  'Platform-recorded closed trades for a user (entered by admin).';
