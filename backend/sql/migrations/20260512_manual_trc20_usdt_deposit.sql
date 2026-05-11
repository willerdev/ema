-- USDT (TRC20) deposit on Tron → custodial address.
-- Tx: e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a
-- From: TJqwA7SoZnERE4zW5uDEiPkbz4B66h9TFj  To: TTYycDgKxpdjWnhJxyACTDsbqaN6BPVFTV  Amount: 700 USDT
--
-- If wallet_join_rows = 0 in the result, this DB has NO crypto_ethereum_wallets row for the ETH
-- address below — the INSERT used to insert nothing. Set explicit_user_id to your public.users.id
-- (run: select id, email from public.users order by created_at desc;).

with cfg as (
  select
    -- Replace NULL with your user uuid, e.g. 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid
    null::uuid as explicit_user_id
),
resolved as (
  select coalesce(
    (select c.explicit_user_id from cfg c where c.explicit_user_id is not null limit 1),
    (
      select w.user_id
      from public.crypto_ethereum_wallets w
      inner join public.users u on u.id = w.user_id
      where lower(trim(w.address)) = lower('0x56eddb7aa87536c09ccc2793473599fd21a8b17f')
      limit 1
    )
  ) as user_id
),
inserted as (
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
    r.user_id,
    'in',
    'USDT',
    '700',
    'e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a',
    0,
    'TJqwA7SoZnERE4zW5uDEiPkbz4B66h9TFj',
    'TTYycDgKxpdjWnhJxyACTDsbqaN6BPVFTV',
    'confirmed',
    'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in'
  from resolved r
  inner join public.users u on u.id = r.user_id
  where r.user_id is not null
  on conflict (dedupe_key) do nothing
  returning id
)
select
  (select count(*)::int from inserted) as rows_inserted_this_run,
  (select user_id from resolved) as resolved_user_id,
  (select explicit_user_id is not null from cfg) as used_explicit_user_id,
  (
    select count(*)::int
    from public.crypto_ethereum_wallets w
    inner join public.users u on u.id = w.user_id
    where lower(trim(w.address)) = lower('0x56eddb7aa87536c09ccc2793473599fd21a8b17f')
  ) as wallet_join_rows_for_eth_address,
  (
    select count(*)::int
    from public.tatum_onchain_txs
    where dedupe_key = 'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in'
  ) as rows_with_this_dedupe_key_total,
  case
    when (select user_id from resolved) is null then 'Set cfg.explicit_user_id OR add crypto_ethereum_wallets row for 0x56eddb7a...'
    when (select count(*) from inserted) = 0
      and (select count(*)::int from public.tatum_onchain_txs where dedupe_key = 'trc20:e04d04183e786b986207b3080359582d4fd2b36eec7ccb37317b7b79f1ffd20a:0:USDT:in') >= 1
      then 'Row already exists (dedupe_key conflict).'
    when (select count(*) from inserted) = 0 then 'Unexpected: resolved user but no insert.'
    else 'Inserted.'
  end as note;
