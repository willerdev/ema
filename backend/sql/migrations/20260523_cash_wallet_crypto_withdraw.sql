-- Allow internal cash wallet (USD) to fund NOWPayments crypto withdrawals (1:1 on USDT networks).

alter table public.nowpayments_payouts
  add column if not exists cash_funded_amount numeric(24, 8) not null default 0;

alter table public.crypto_ledger_entries
  drop constraint if exists crypto_ledger_entries_source_check;

alter table public.crypto_ledger_entries
  add constraint crypto_ledger_entries_source_check
  check (
    source in (
      'payment',
      'payout',
      'reserve',
      'reserve_release',
      'local_withdraw',
      'local_deposit',
      'cash_wallet',
      'cash_wallet_refund'
    )
  );
