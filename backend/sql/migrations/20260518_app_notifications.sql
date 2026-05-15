-- In-app notifications: user_id NULL = broadcast to all users; valid UUID = single user only.

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_notifications_user_created
  on public.app_notifications (user_id, created_at desc);

create index if not exists idx_app_notifications_broadcast_created
  on public.app_notifications (created_at desc)
  where user_id is null;
