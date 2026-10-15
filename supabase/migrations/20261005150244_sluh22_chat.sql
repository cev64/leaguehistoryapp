-- The SLUH 22 league chat (supabase/functions/sluh22-chat): how many
-- questions have been asked of the AI today, per visitor and for the whole
-- league, so nobody can use up Gemini's free allowance on their own.
--
-- A visitor is a hash of their address, made by the function; no address is
-- stored. Only the function (the service role) reads or writes this table.

create table if not exists public.sluh22_chat_usage (
  visitor   text not null,
  day       date not null default (now() at time zone 'utc')::date,
  questions int  not null default 0,
  primary key (visitor, day)
);

alter table public.sluh22_chat_usage enable row level security;
revoke all on public.sluh22_chat_usage from anon, authenticated;

-- One more question from a visitor today. Returns today's count for that
-- visitor and for everyone together, this one included.
create or replace function public.count_sluh22_question(p_visitor text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  mine  int;
  total int;
begin
  insert into public.sluh22_chat_usage as u (visitor, day, questions)
  values (left(p_visitor, 64), today, 1)
  on conflict (visitor, day) do update set questions = u.questions + 1
  returning questions into mine;
  select coalesce(sum(questions), 0) into total from public.sluh22_chat_usage where day = today;
  return json_build_object('visitor', mine, 'league', total);
end;
$$;

revoke all on function public.count_sluh22_question(text) from public, anon, authenticated;
grant execute on function public.count_sluh22_question(text) to service_role;
