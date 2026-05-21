-- Run in Supabase SQL editor if you see:
-- "Could not find the 'drops_pause_band_indexes' column of 'airfarming_state'"

alter table if exists public.airfarming_state
  add column if not exists drops_pause_from timestamptz,
  add column if not exists drops_pause_until timestamptz,
  add column if not exists drops_pause_band_indexes smallint[];

-- Optional: reload PostgREST schema cache (Supabase usually picks this up within a minute)
-- notify pgrst, 'reload schema';
