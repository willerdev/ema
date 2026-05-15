-- Compliance / withdrawal profile (required before external withdrawals)

create table if not exists public.user_compliance_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  legal_first_name text not null default '',
  legal_last_name text not null default '',
  country text not null default '',
  profession text not null default '',
  source_of_funds text not null default '',
  source_of_funds_detail text,
  planned_investment_amount numeric(18, 2),
  planned_investment_currency text not null default 'usd',
  planned_investment_duration text not null default '',
  date_of_birth date,
  phone text,
  address_line text,
  city text,
  accepted_terms_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_user_compliance_profiles_completed
  on public.user_compliance_profiles(completed_at)
  where completed_at is not null;
