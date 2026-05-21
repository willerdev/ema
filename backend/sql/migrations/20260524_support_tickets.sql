create table if not exists public.support_tickets (
  id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  category text not null check (category in ('withdraw', 'deposit', 'daily_earning', 'transfer', 'general')),
  status text not null default 'under_review'
    check (status in ('under_review', 'in_progress', 'resolved', 'closed')),
  payload jsonb not null default '{}',
  related_activity_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_support_tickets_user_created
  on public.support_tickets (user_id, created_at desc);

create index if not exists idx_support_tickets_status
  on public.support_tickets (status);
