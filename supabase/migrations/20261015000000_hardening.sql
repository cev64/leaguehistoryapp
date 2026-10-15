-- Hardening, from a security review:
--   1. the league chat counts every request (questions and tool rounds), and
--      a hard cap on the day's billed Claude backup, site-wide
--   2. the ESPN key store fits the ten sets of keys the relay allows
--   3. a sign-up with a long name no longer fails
--   4. tidier table grants on profiles, synced_leagues and league_changes
--
-- Run it before deploying the league-chat function that calls
-- count_chat_request() and count_chat_claude(): until then that function
-- answers "the account store didn't answer". Safe to run again.
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor.

-- ------------------------------------------------------------ 1. the chat
-- Questions stay counted by count_chat_question() (AI_DAILY_QUESTIONS);
-- now every request the chat makes to the AI is counted too
-- (AI_DAILY_REQUESTS): a question is one request plus one per round of
-- look-ups, so a member can't get more out of the AI by dressing questions
-- up as look-up results.
alter table public.chat_usage add column if not exists requests int not null default 0;
-- Requests the billed Claude backup answered (or was asked to).
alter table public.chat_usage add column if not exists claude_requests int not null default 0;

-- The whole site's Claude requests a day: the hard cap on the bill
-- (CLAUDE_DAILY_REQUESTS), whoever is asking.
create table if not exists public.chat_usage_site (
  day             date primary key,
  claude_requests int  not null default 0
);
alter table public.chat_usage_site enable row level security;
revoke all on public.chat_usage_site from anon, authenticated;

-- One more request for a member today. Returns today's date (UTC) and the
-- member's counts so far, this request included:
--   { "day": "2026-10-15", "questions": 3, "requests": 11 }
-- The function signs the look-ups it asks for with the day and the question
-- count, so a look-up round is only free when it follows a real question.
create or replace function public.count_chat_request(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  u     public.chat_usage;
begin
  insert into public.chat_usage as c (user_id, day, requests)
  values (p_user_id, today, 1)
  on conflict (user_id, day) do update set requests = c.requests + 1
  returning * into u;
  return json_build_object('day', u.day, 'questions', u.questions, 'requests', u.requests);
end;
$$;

-- One more request for the Claude backup: counted on the member's row and
-- the site's. Returns the site's count today, this one included.
create or replace function public.count_chat_claude(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n     int;
begin
  insert into public.chat_usage as c (user_id, day, claude_requests)
  values (p_user_id, today, 1)
  on conflict (user_id, day) do update set claude_requests = c.claude_requests + 1;
  insert into public.chat_usage_site as s (day, claude_requests)
  values (today, 1)
  on conflict (day) do update set claude_requests = s.claude_requests + 1
  returning claude_requests into n;
  return n;
end;
$$;

revoke all on function public.count_chat_request(uuid) from public, anon, authenticated;
revoke all on function public.count_chat_claude(uuid) from public, anon, authenticated;
grant execute on function public.count_chat_request(uuid) to service_role;
grant execute on function public.count_chat_claude(uuid) to service_role;

-- ------------------------------------------------------------ 2. ESPN keys
-- The relay keeps up to ten sets of keys in one sealed row, each espn_s2 up
-- to 2,000 characters: about 29,000 characters sealed, past the 8,000 the
-- table allowed (three long sets were enough to fail with a generic error).
alter table public.espn_keys drop constraint if exists espn_keys_sealed_check;
alter table public.espn_keys
  add constraint espn_keys_sealed_check check (char_length(sealed) <= 40000);

-- ------------------------------------------------------------ 3. sign-up
-- A profile for every new account, as in 20260930000000_accounts.sql, with
-- the name cut to the 60 characters profiles.display_name holds: a longer
-- name from the sign-up form (or Google's full name) failed the whole
-- sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'), 60)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ------------------------------------------------------------ 4. grants
-- Supabase grants every privilege on a new public table to anon and
-- authenticated; 20260930000000_accounts.sql took back insert, update and
-- delete, which left TRUNCATE, TRIGGER and REFERENCES (and anon's SELECT,
-- which row-level security already turned into no rows: every policy is
-- for authenticated). Start from nothing and grant only what the site and
-- the app use: a member reads their own rows (row-level security picks
-- them) and changes their own name and Sleeper username. Everything else
-- goes through the security-definer functions or the service role.
revoke all on public.profiles from anon, authenticated;
revoke all on public.synced_leagues from anon, authenticated;
revoke all on public.league_changes from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, sleeper_username) on public.profiles to authenticated;
grant select on public.synced_leagues to authenticated;
grant select on public.league_changes to authenticated;
