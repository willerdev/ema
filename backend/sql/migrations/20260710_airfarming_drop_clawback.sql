-- Admin clawback: deduct from paid drop profit without losing original profit_amount audit.

alter table public.airfarming_drops
  add column if not exists profit_clawback_usd numeric(18, 2) not null default 0
    check (profit_clawback_usd >= 0);

alter table public.airfarming_drops
  add column if not exists clawback_reason text;

alter table public.airfarming_drops
  add column if not exists clawback_at timestamptz;

comment on column public.airfarming_drops.profit_clawback_usd is
  'Cumulative USD clawed back from this paid drop; journal net = profit_amount - profit_clawback_usd.';
