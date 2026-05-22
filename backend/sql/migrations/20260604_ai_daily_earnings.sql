-- AI daily airfarming earnings planner: budget, market snapshot, per-user allocations.

create table if not exists public.ai_daily_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null unique,
  budget_usd numeric(18, 2) not null default 0 check (budget_usd >= 0),
  budget_spent_usd numeric(18, 2) not null default 0 check (budget_spent_usd >= 0),
  projected_payout_usd numeric(18, 2) not null default 0 check (projected_payout_usd >= 0),
  market_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'planning', 'pending_approval', 'active', 'closed')),
  plan_summary text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_daily_plans_date on public.ai_daily_plans (plan_date desc);
create index if not exists idx_ai_daily_plans_status on public.ai_daily_plans (status);

create table if not exists public.ai_user_drop_allocations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ai_daily_plans(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  band_index integer check (band_index is null or (band_index >= 0 and band_index <= 3)),
  percent numeric(10, 2),
  min_balance numeric(18, 2),
  max_balance numeric(18, 2),
  projected_profit numeric(18, 2) not null default 0 check (projected_profit >= 0),
  eligible boolean not null default true,
  drop_id uuid references public.airfarming_drops(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, user_id)
);

create index if not exists idx_ai_allocations_plan on public.ai_user_drop_allocations (plan_id);
create index if not exists idx_ai_allocations_user on public.ai_user_drop_allocations (user_id);

comment on table public.ai_daily_plans is
  'Daily platform budget and AI planner status for airfarming drop payouts (UTC date).';
comment on table public.ai_user_drop_allocations is
  'Per-user drop parameters proposed by the daily AI planner before apply to airfarming_drops.';
