-- Premium deposit/withdrawal alerts ($2/week) via SMS and/or in-app email channel

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  premium_alerts_enabled boolean not null default false,
  notify_sms boolean not null default false,
  notify_email boolean not null default false,
  premium_terms_accepted_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
