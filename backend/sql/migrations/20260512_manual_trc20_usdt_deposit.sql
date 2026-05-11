-- Supabase "Success" only means no SQL error — you may still insert 0 rows (no wallet match)
-- or skip silently (ON CONFLICT DO NOTHING). Read the result row from the SELECT below.
--
-- Manual crypto activity: USDT (TRC20) deposit on Tron to shared custodial receive address.
-- Tx: e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a
-- From: TJqwA7SoZnERE4zW5uDEiPkbz4B66h9TFj
-- To:   TTYycDgKxpdjWnhJxyACTDsbqaN6BPVFTV
-- Amount: 700 USDT (6 decimals, on-chain value 700000000)
-- user_id: same as 20260511 migration (join via ETH wallet 0x56eddb7aa87536c09ccc2793473599fd21a8b17f).

with inserted as (
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
  'in',
  'USDT',
  '700',
  'e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a',
  0,
  'TJqwA7SoZnERE4zW5uDEiPkbz4B66h9TFj',
  'TTYycDgKxpdjWnhJxyACTDsbqaN6BPVFTV',
  'confirmed',
  'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in'
from public.crypto_ethereum_wallets w
inner join public.users u on u.id = w.user_id
where lower(trim(w.address)) = lower('0x56eddb7aa87536c09ccc2793473599fd21a8b17f')
on conflict (dedupe_key) do nothing
returning id
)
select
  (select count(*)::int from inserted) as rows_inserted_this_run,
  (select count(*)::int
   from public.crypto_ethereum_wallets w
   inner join public.users u on u.id = w.user_id
   where lower(trim(w.address)) = lower('0x56eddb7aa87536c09ccc2793473599fd21a8b17f')) as wallet_join_rows_for_insert,
  (select count(*)::int from public.tatum_onchain_txs
   where dedupe_key = 'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in') as rows_with_this_dedupe_key_total;

-- If rows_inserted_this_run = 0 and rows_with_this_dedupe_key_total >= 1: already inserted (conflict).

-- If 0 rows: ETH wallet row missing — use manual block with the same users.id you used for the ETH tx.
-- insert into public.tatum_onchain_txs (id, user_id, direction, asset, amount_display, tx_hash, log_index, from_address, to_address, status, dedupe_key)
-- values (
--   gen_random_uuid(),
--   '<users.id uuid>'::uuid,
--   'in', 'USDT', '700',
--   'e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a',
--   0,
--   'TJqwA7SoZnERE4zW5uDEiPkbz4B66h9TFj',
--   'TTYycDgKxpdjWnhJxyACTDsbqaN6BPVFTV',
--   'confirmed',
--   'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in'
-- )
-- on conflict (dedupe_key) do nothing;
