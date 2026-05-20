-- Configurable drop % per balance tier (edit rows in Supabase to tune upcoming drops).
-- band_index matches the four seeded balance windows used when scheduling drops.

create table if not exists public.airfarming_drop_bands (
  band_index integer primary key check (band_index >= 0 and band_index <= 3),
  label text not null,
  balance_hint text not null,
  percent numeric(10, 2) not null check (percent >= 0.01 and percent <= 57.9),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.airfarming_drop_bands (band_index, label, balance_hint, percent)
values
  (0, 'Starter A', 'Airfarming balance ~$100 – $145', 12.00),
  (1, 'Starter B', 'Airfarming balance ~$100 – $112', 10.00),
  (2, 'Growth', 'Airfarming balance ~$1,000 – $2,400', 22.00),
  (3, 'Premium', 'Airfarming balance ~$10,000 – $21,000', 30.00)
on conflict (band_index) do nothing;

alter table if exists public.airfarming_drops
  add column if not exists band_index integer check (band_index is null or (band_index >= 0 and band_index <= 3)),
  add column if not exists percent_locked boolean not null default false;

comment on table public.airfarming_drop_bands is
  'Admin-editable drop percentages by balance tier. Upcoming scheduled drops sync percent from here unless percent_locked on the drop row.';
comment on column public.airfarming_drops.percent_locked is
  'When true, percent is not overwritten from airfarming_drop_bands (use for one-off per-user overrides).';
