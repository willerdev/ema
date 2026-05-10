-- Manual crypto activity row: outbound USDT on Ethereum mainnet.
-- On-chain: tx 0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92
--   from 0x56eddb7aa87536c09ccc2793473599fd21a8b17f
--   to   0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9 (transfer() arg on USDT contract)
--   amount: 100 USDT (6 decimals, value 0x5f5e100)
--
-- User id was given as "8ce8dde-1b43-4dc5-b64d-b9b2fa9dbe39" (invalid UUID — first group must be 8 hex).
-- Defaulting to 8ce8dde8-1b43-4dc5-b64d-b9b2fa9dbe39. Edit the UUID below if yours differs.

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
) values (
  gen_random_uuid(),
  '8ce8dde8-1b43-4dc5-b64d-b9b2fa9dbe39'::uuid,
  'out',
  'USDT',
  '100',
  '0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92',
  null,
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
  '0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9',
  'confirmed',
  'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT'
)
on conflict (dedupe_key) do nothing;
