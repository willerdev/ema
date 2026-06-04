alter table public.market_prices
  add column if not exists day_open numeric(18, 8),
  add column if not exists day_high numeric(18, 8),
  add column if not exists day_low numeric(18, 8),
  add column if not exists day_stats_date date;
