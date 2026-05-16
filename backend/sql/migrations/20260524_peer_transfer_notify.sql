-- Return recipient user id from wallet_peer_transfer for SMS notifications.

create or replace function public.wallet_peer_transfer(
  p_from_user_id uuid,
  p_to_code text,
  p_amount numeric,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
as $$
declare
  v_to_code text := nullif(trim(coalesce(p_to_code, '')), '');
  v_to_user_id uuid;
  v_tid uuid := gen_random_uuid();
  v_amount numeric(18, 2) := round(coalesce(p_amount, 0), 2);
  v_sender_bal numeric(18, 2);
  v_recipient_bal numeric(18, 2);
  v_sender_new numeric(18, 2);
  v_recipient_new numeric(18, 2);
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_existing public.wallet_peer_transfers%rowtype;
begin
  if v_idem is not null then
    select * into v_existing
    from public.wallet_peer_transfers w
    where w.from_user_id = p_from_user_id and w.idempotency_key = v_idem;
    if found then
      if v_existing.amount <> v_amount then
        raise exception 'idempotency_mismatch';
      end if;
      select balance into v_sender_bal from public.wallets where user_id = p_from_user_id;
      return jsonb_build_object(
        'transfer_id', v_existing.id::text,
        'to_user_id', v_existing.to_user_id::text,
        'from_balance', v_sender_bal::text,
        'idempotent', true
      );
    end if;
  end if;

  if v_to_code is null then
    raise exception 'invalid_recipient_code';
  end if;

  if v_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select u.id
  into v_to_user_id
  from public.users u
  where u.transfer_code = v_to_code
  limit 1;

  if v_to_user_id is null then
    raise exception 'recipient_not_found';
  end if;

  if v_to_user_id = p_from_user_id then
    raise exception 'cannot_send_to_self';
  end if;

  insert into public.wallets (id, user_id, balance)
  select gen_random_uuid(), x.uid, 0
  from (select unnest(array[p_from_user_id, v_to_user_id]::uuid[]) as uid) x
  on conflict (user_id) do nothing;

  perform 1
  from public.wallets w
  where w.user_id = least(p_from_user_id, v_to_user_id)
  for update;

  perform 1
  from public.wallets w
  where w.user_id = greatest(p_from_user_id, v_to_user_id)
  for update;

  select balance into v_sender_bal from public.wallets where user_id = p_from_user_id;
  select balance into v_recipient_bal from public.wallets where user_id = v_to_user_id;

  if v_sender_bal is null or v_recipient_bal is null then
    raise exception 'wallet_missing';
  end if;

  if v_sender_bal < v_amount then
    raise exception 'insufficient_funds';
  end if;

  v_sender_new := round(v_sender_bal - v_amount, 2);
  v_recipient_new := round(v_recipient_bal + v_amount, 2);

  update public.wallets set balance = v_sender_new where user_id = p_from_user_id;
  update public.wallets set balance = v_recipient_new where user_id = v_to_user_id;

  insert into public.wallet_peer_transfers (id, from_user_id, to_user_id, amount, idempotency_key, created_at)
  values (v_tid, p_from_user_id, v_to_user_id, v_amount, v_idem, now());

  insert into public.transactions (id, user_id, type, amount, status, created_at)
  values
    (gen_random_uuid(), p_from_user_id, 'peer_send', v_amount, 'completed:' || v_tid::text, now()),
    (gen_random_uuid(), v_to_user_id, 'peer_receive', v_amount, 'completed:' || v_tid::text, now());

  return jsonb_build_object(
    'transfer_id', v_tid::text,
    'to_user_id', v_to_user_id::text,
    'from_balance', v_sender_new::text,
    'idempotent', false
  );
end;
$$;
