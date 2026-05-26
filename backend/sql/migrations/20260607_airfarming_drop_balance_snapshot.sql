-- 24h-before-drop airfarming balance snapshot for eligibility (anti-gaming).

alter table public.airfarming_drops
  add column if not exists eligibility_snapshot_at timestamptz,
  add column if not exists eligibility_snapshot_balance numeric(18, 2);

comment on column public.airfarming_drops.eligibility_snapshot_balance is
  'Airfarming wallet balance captured ~24h before due_at; used for paid/missed eligibility.';
