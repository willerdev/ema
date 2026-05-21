-- Allow general support tickets (subject + message) from the app.

alter table public.support_tickets drop constraint if exists support_tickets_category_check;

alter table public.support_tickets
  add constraint support_tickets_category_check
  check (category in ('withdraw', 'deposit', 'daily_earning', 'transfer', 'general'));
