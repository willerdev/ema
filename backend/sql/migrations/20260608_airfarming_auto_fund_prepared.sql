-- Auto-fund balance adjustment runs in the 5-minute window before due_at.

alter table public.airfarming_drops
  add column if not exists auto_fund_prepared_at timestamptz;

comment on column public.airfarming_drops.auto_fund_prepared_at is
  'When auto-fund last adjusted balance for this drop (typically ~5 min before due_at).';
