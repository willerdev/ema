-- Single active in-app announcement (admin-published, dismissible per user/device).

create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_announcements_active
  on public.app_announcements (active, created_at desc)
  where active = true;
