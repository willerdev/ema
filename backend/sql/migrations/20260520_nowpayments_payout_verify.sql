-- NOWPayments: store batch id separately; payout_id holds per-withdrawal id for /verify

alter table public.nowpayments_payouts
  add column if not exists batch_payout_id text;

create index if not exists idx_nowpayments_payouts_batch_payout_id
  on public.nowpayments_payouts(batch_payout_id)
  where batch_payout_id is not null;
