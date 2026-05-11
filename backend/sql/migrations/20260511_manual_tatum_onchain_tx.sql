-- Outbound USDT on Ethereum: tx 0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92
-- from 0x56eddb7aa87536c09ccc2793473599fd21a8b17f → 0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9  Amount: 100 USDT
--
-- If wallet_join_rows = 0, there is no crypto_ethereum_wallets row for that sender in THIS database.
-- Set explicit_user_id to your public.users.id (see select id, email from public.users).

with cfg as (
  select
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
    'out',
    'USDT',
    '100',
    '0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92',
    null,
    '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
    '0x4bf4d27dad979d5960c17753dbc8dd52bc47d6f9',
    'confirmed',
    'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT'
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
    where dedupe_key = 'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT'
  ) as rows_with_this_dedupe_key_total,
  case
    when (select user_id from resolved) is null then 'Set cfg.explicit_user_id OR add crypto_ethereum_wallets row for sender ETH address.'
    when (select count(*) from inserted) = 0
      and (select count(*)::int from public.tatum_onchain_txs where dedupe_key = 'out:0x3b925bee7c099d437393f3d1d444f67aea24039d700f945d124ae99f9b554f92:USDT') >= 1
      then 'Row already exists (dedupe_key conflict).'
    when (select count(*) from inserted) = 0 then 'Unexpected: resolved user but no insert.'
    else 'Inserted.'
  end as note;
