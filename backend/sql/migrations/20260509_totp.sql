-- TOTP (Google Authenticator) columns on users
alter table public.users add column if not exists totp_enabled boolean default false not null;
alter table public.users add column if not exists totp_secret_enc text;
