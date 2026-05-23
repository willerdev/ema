-- VIP Farmers: 30-day locked investment with daily principal-based accrual.

create table if not exists public.vip_investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  principal_usd numeric(18, 2) not null check (principal_usd > 0),
  started_at timestamptz not null default now(),
  matures_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'matured', 'early_withdrawn', 'closed')),
  total_accrued_usd numeric(18, 2) not null default 0 check (total_accrued_usd >= 0),
  days_accrued integer not null default 0 check (days_accrued >= 0 and days_accrued <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vip_investments_user on public.vip_investments (user_id);
create index if not exists idx_vip_investments_status on public.vip_investments (status);

create table if not exists public.vip_accruals (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.vip_investments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  accrual_date date not null,
  rate numeric(10, 4) not null default 0.09,
  amount numeric(18, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (investment_id, accrual_date)
);

create index if not exists idx_vip_accruals_user_date on public.vip_accruals (user_id, accrual_date desc);
create index if not exists idx_vip_accruals_date on public.vip_accruals (accrual_date);

comment on table public.vip_investments is
  'VIP Farmers locked principal (30 UTC days); daily 9% of principal paid to cash wallet.';
comment on table public.vip_accruals is
  'Daily VIP Farmers payout log (9% of original principal per UTC day).';
