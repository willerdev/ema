-- VIP Farmers v2: 38-day calendar lock, 22 working accrual days, exit/reinvest/loans.

alter table public.vip_investments
  add column if not exists revenue_withdrawn_usd numeric(18, 2) not null default 0
    check (revenue_withdrawn_usd >= 0);

alter table public.vip_investments drop constraint if exists vip_investments_days_accrued_check;
alter table public.vip_investments
  add constraint vip_investments_days_accrued_check
    check (days_accrued >= 0 and days_accrued <= 22);

comment on column public.vip_investments.revenue_withdrawn_usd is
  'Cumulative NET revenue taken via exit/reinvest; available = total_accrued_usd - revenue_withdrawn_usd.';

create table if not exists public.vip_exit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  investment_id uuid not null references public.vip_investments(id) on delete cascade,
  mode text not null check (mode in ('full_stop', 'partial_continue')),
  revenue_percent integer not null check (revenue_percent in (50, 60, 70, 80, 90, 100)),
  destination text not null check (destination in ('platform', 'direct_wallet')),
  wallet_address text,
  principal_usd numeric(18, 2) not null,
  revenue_base_usd numeric(18, 2) not null default 0,
  revenue_selected_usd numeric(18, 2) not null default 0,
  penalty_usd numeric(18, 2) not null default 0,
  gas_fees_usd numeric(18, 2) not null default 0,
  commission_usd numeric(18, 2) not null default 0,
  gas_reward_usd numeric(18, 2) not null default 0,
  net_revenue_usd numeric(18, 2) not null default 0,
  principal_return_usd numeric(18, 2) not null default 0,
  net_total_usd numeric(18, 2) not null default 0,
  investment_extra_credit_usd numeric(18, 2) not null default 0,
  working_days integer not null default 0,
  calendar_days integer not null default 0,
  penalty_free boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed')),
  admin_note text,
  reviewed_at timestamptz,
  applied_penalty_usd numeric(18, 2),
  applied_gas_fees_usd numeric(18, 2),
  applied_commission_usd numeric(18, 2),
  applied_gas_reward_usd numeric(18, 2),
  applied_investment_extra_credit_usd numeric(18, 2),
  applied_net_revenue_usd numeric(18, 2),
  applied_net_total_usd numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vip_exit_requests_user on public.vip_exit_requests (user_id, created_at desc);
create index if not exists idx_vip_exit_requests_status on public.vip_exit_requests (status);

create table if not exists public.vip_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  investment_id uuid references public.vip_investments(id) on delete set null,
  amount_usd numeric(18, 2) not null check (amount_usd > 0),
  commission_rate numeric(10, 4) not null default 0.30,
  commission_usd numeric(18, 2) not null default 0,
  disbursed_usd numeric(18, 2) not null default 0,
  last_month_earnings_usd numeric(18, 2) not null default 0,
  max_loan_usd numeric(18, 2) not null default 0,
  outstanding_usd numeric(18, 2) not null default 0,
  repaid_usd numeric(18, 2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'repaid', 'rejected')),
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  disbursed_at timestamptz,
  repaid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vip_loans_user on public.vip_loans (user_id, created_at desc);
create index if not exists idx_vip_loans_status on public.vip_loans (status);

create table if not exists public.vip_loan_fund_transfers (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.vip_loans(id) on delete cascade,
  transfer_id uuid,
  from_user_id uuid not null references public.users(id) on delete cascade,
  to_user_id uuid not null references public.users(id) on delete cascade,
  amount_usd numeric(18, 2) not null check (amount_usd > 0),
  recipient_exempt boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_vip_loan_fund_transfers_loan on public.vip_loan_fund_transfers (loan_id);

create table if not exists public.vip_reinvest_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  investment_id uuid not null references public.vip_investments(id) on delete cascade,
  amount_usd numeric(18, 2) not null,
  previous_principal_usd numeric(18, 2) not null,
  new_principal_usd numeric(18, 2) not null,
  lock_reset boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_vip_reinvest_events_user on public.vip_reinvest_events (user_id, created_at desc);

create table if not exists public.platform_revenue_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  investment_id uuid references public.vip_investments(id) on delete set null,
  loan_id uuid references public.vip_loans(id) on delete set null,
  event_type text not null
    check (event_type in ('vip_accrual', 'vip_loan_commission', 'vip_reinvest_commission', 'vip_exit_commission')),
  amount_usd numeric(18, 2) not null default 0,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_revenue_events_type on public.platform_revenue_events (event_type, created_at desc);
