-- Optional one-time migration: move from legacy Tatum Virtual Account rows to crypto_ethereum_wallets.
-- Safe to run even if `crypto_ethereum_wallets` has not been created yet.
-- Verify app behavior before dropping legacy tables.

create table if not exists public.crypto_ethereum_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  derivation_index integer not null unique,
  address text not null,
  created_at timestamptz default now() not null
);

create index if not exists idx_crypto_ethereum_wallets_address_lower on public.crypto_ethereum_wallets(lower(address));

-- One row per user from the ETH VA row (same deposit address used for USDT on-chain).
insert into public.crypto_ethereum_wallets (user_id, derivation_index, address)
select distinct on (t.user_id)
  t.user_id,
  t.derivation_index,
  lower(t.deposit_address)
from public.tatum_virtual_accounts t
where t.currency = 'ETH'
  and t.chain = 'ETHEREUM'
on conflict (user_id) do nothing;

-- After production verification, you may drop legacy VA tables:
-- drop table if exists public.tatum_virtual_accounts;
-- drop table if exists public.tatum_crypto_profiles;
