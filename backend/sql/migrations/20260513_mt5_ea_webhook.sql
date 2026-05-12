-- MT5 EA webhook: per-account bearer token + telemetry + command queue for EA polling

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
