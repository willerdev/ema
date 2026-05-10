-- Manual crypto activity row: outbound USDT on Ethereum mainnet.
-- On-chain: tx 0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92
--   from 0x56eddb7aa87536c09ccc2793473599fd21a8b17f
--   to   0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9 (transfer() arg on USDT contract)
--   amount: 100 USDT (6 decimals, value 0x5f5e100)
--
-- Resolves user_id from crypto_ethereum_wallets using the sender address (must match onboarded HD wallet).
-- If this inserts 0 rows, run the diagnostic SELECTs at the bottom, then use the manual block with a real users.id.

insert into public.tatum_onchain_txs (
  id,
  user_id,
  direction,
  asset,
  amount_display,
  tx_hash,
  log_index,
  from_address,
  to_address,
  status,
  dedupe_key
)
select
  gen_random_uuid(),
  w.user_id,
  'out',
  'USDT',
  '100',
  '0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92',
  null,
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
  '0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9',
  'confirmed',
  'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT'
from public.crypto_ethereum_wallets w
inner join public.users u on u.id = w.user_id
where lower(trim(w.address)) = lower('0x56eddb7aa87536c09ccc2793473599fd21a8b17f')
on conflict (dedupe_key) do nothing;

-- Diagnostics (run separately if insert affected 0 rows):
-- select id, email from public.users order by created_at desc limit 20;
-- select user_id, address from public.crypto_ethereum_wallets where lower(address) like '%56eddb7a%';

-- Manual override when you know the correct users.id (must exist in public.users):
-- insert into public.tatum_onchain_txs (id, user_id, direction, asset, amount_display, tx_hash, log_index, from_address, to_address, status, dedupe_key)
-- values (
--   gen_random_uuid(),
--   '<paste-valid-user-uuid-here>'::uuid,
--   'out', 'USDT', '100',
--   '0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92',
--   null,
--   '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
--   '0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9',
--   'confirmed',
--   'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT'
-- )
-- on conflict (dedupe_key) do nothing;
