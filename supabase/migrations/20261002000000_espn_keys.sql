-- ESPN keys saved to an account, so a private ESPN league opens on every
-- device the member signs in on (their phone included), not only in the
-- browser where they typed the keys.
--
-- espn_s2 and SWID work like an ESPN password, so they are never kept in
-- the clear: the ESPN relay (supabase/functions/espn-proxy) encrypts them
-- with a secret only it holds (ESPN_KEYS_SECRET), bound to the member's
-- user id, and is the only thing that reads or writes this table. No
-- browser can select from it, not even the member's own: the relay tells
-- them whether keys are saved, and uses the keys itself.

create table if not exists public.espn_keys (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  sealed   text not null check (char_length(sealed) <= 8000),
  saved_at timestamptz not null default now()
);

alter table public.espn_keys enable row level security;
-- No policies: with row-level security on, anon and authenticated see no
-- rows; only the relay (service role) can.
revoke all on public.espn_keys from anon, authenticated;
