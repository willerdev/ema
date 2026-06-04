alter table public.mt5_accounts
  add column if not exists ea_positions_snapshot jsonb,
  add column if not exists ea_snapshot_at timestamptz;

alter table public.mt5_ea_commands
  add column if not exists command_type text not null default 'place_order'
    check (command_type in ('place_order', 'close_position')),
  add column if not exists position_ticket bigint,
  add column if not exists close_side text check (close_side is null or close_side in ('buy', 'sell'));
