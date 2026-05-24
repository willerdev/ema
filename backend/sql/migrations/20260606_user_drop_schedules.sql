-- Per-user custom airfarming drop schedules (admin + AI-assisted percents and spacing).

create table if not exists public.user_drop_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  drop_count integer not null check (drop_count >= 1 and drop_count <= 12),
  target_total_usd numeric(18, 2) not null check (target_total_usd >= 0),
  reference_balance numeric(18, 2) not null check (reference_balance >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'applied', 'cancelled')),
  plan_summary text,
  planner_mode text,
  items jsonb not null default '[]'::jsonb,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists idx_user_drop_schedules_user_week
  on public.user_drop_schedules (user_id, week_start desc);

comment on table public.user_drop_schedules is
  'Admin-defined upcoming drop queue for a user: count, target profit, AI-suggested percents and intervals.';
