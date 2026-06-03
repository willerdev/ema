-- VIP daily interest: store gross, 30% platform commission, and net paid to user.

alter table public.vip_accruals
  add column if not exists gross_amount numeric(18, 2),
  add column if not exists commission_rate numeric(10, 4) not null default 0,
  add column if not exists commission_amount numeric(18, 2) not null default 0;

-- Legacy rows: treat full amount as gross with no commission.
update public.vip_accruals
set
  gross_amount = coalesce(gross_amount, amount),
  commission_rate = coalesce(nullif(commission_rate, 0), 0),
  commission_amount = coalesce(commission_amount, 0)
where gross_amount is null;

comment on column public.vip_accruals.amount is
  'Net USD credited to user cash wallet after commission.';
comment on column public.vip_accruals.gross_amount is
  'Gross daily interest before platform commission.';
comment on column public.vip_accruals.commission_rate is
  'Platform commission rate applied (e.g. 0.30 = 30%).';
