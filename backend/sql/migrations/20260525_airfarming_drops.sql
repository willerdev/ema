-- Airfarming random drops: scheduled eligibility windows + paid/missed outcomes.

create table if not exists public.airfarming_drops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  drop_index integer not null check (drop_index >= 0),
  due_at timestamptz not null,
  percent numeric(10, 2) not null check (percent >= 0.01 and percent <= 57.9),
  min_balance numeric(18, 2) not null check (min_balance >= 0),
  max_balance numeric(18, 2) not null check (max_balance >= min_balance),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'paid', 'missed')),
  eligible_balance numeric(18, 2),
  profit_amount numeric(18, 2) not null default 0,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, week_start, drop_index)
);

create index if not exists idx_airfarming_drops_user_week
  on public.airfarming_drops (user_id, week_start, due_at desc);

create index if not exists idx_airfarming_drops_user_scheduled
  on public.airfarming_drops (user_id, week_start, status)
  where status = 'scheduled';
