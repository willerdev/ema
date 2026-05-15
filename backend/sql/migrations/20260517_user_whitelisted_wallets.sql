-- Up to 3 whitelisted crypto withdrawal addresses per user (NOWPayments)

create table if not exists public.user_whitelisted_wallets (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  label text,
  currency text not null,
  address text not null,
  created_at timestamptz default now() not null
);

create unique index if not exists idx_user_whitelisted_wallets_user_currency_address
  on public.user_whitelisted_wallets(user_id, lower(currency), lower(address));

create index if not exists idx_user_whitelisted_wallets_user_id
  on public.user_whitelisted_wallets(user_id);
