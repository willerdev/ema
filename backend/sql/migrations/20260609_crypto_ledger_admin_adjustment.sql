-- Allow admin wallet adjustments and other ledger sources used by the app.

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
      'local_withdraw_refund',
      'cash_wallet',
      'cash_wallet_refund',
      'admin_adjustment',
      'airfarming_auto_fund'
    )
  );
