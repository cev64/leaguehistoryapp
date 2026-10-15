-- The SLUH 22 league chat counts every request, not only questions, as
-- league-chat does since 20261015000000_hardening.sql. A question is one
-- request to Claude plus one per round of look-ups; counting only the
-- questions left the look-up rounds free, and a script could dress up any
-- request as one. Now each request is counted per visitor (for
-- SLUH22_DAILY_REQUESTS) and for the whole league (the day's cap on the
-- billed Claude key, SLUH22_CLAUDE_DAILY_REQUESTS).
--
-- Run it before deploying the sluh22-chat function that calls
-- count_sluh22_request(): until then the function counts in memory, which
-- is looser. Paste into Supabase ▸ SQL editor (or apply it as one named
-- migration). Safe to run again.

alter table public.sluh22_chat_usage add column if not exists requests int not null default 0;

-- One more request from a visitor today. Returns today's date (UTC), the
-- visitor's counts so far (this request included) and every visitor's
-- requests together:
--   { "day": "2026-10-16", "questions": 3, "requests": 11, "league": 140 }
create or replace function public.count_sluh22_request(p_visitor text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  u     public.sluh22_chat_usage;
  total int;
begin
  insert into public.sluh22_chat_usage as c (visitor, day, requests)
  values (left(p_visitor, 64), today, 1)
  on conflict (visitor, day) do update set requests = c.requests + 1
  returning * into u;
  select coalesce(sum(requests), 0) into total from public.sluh22_chat_usage where day = today;
  return json_build_object('day', u.day, 'questions', u.questions, 'requests', u.requests, 'league', total);
end;
$$;

revoke all on function public.count_sluh22_request(text) from public, anon, authenticated;
grant execute on function public.count_sluh22_request(text) to service_role;
