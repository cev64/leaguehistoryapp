-- The league chat (supabase/functions/league-chat): how many questions each
-- Pro member has asked the AI today, so one account can't run up the bill.
-- The function counts a question with count_chat_question() before asking
-- the AI and turns the member away past its AI_DAILY_QUESTIONS allowance.
--
-- Only the function (the service role) reads or writes this table: members
-- can't see or reset their own count.
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor.

create table if not exists public.chat_usage (
  user_id   uuid not null references auth.users (id) on delete cascade,
  day       date not null default (now() at time zone 'utc')::date,
  questions int  not null default 0,
  primary key (user_id, day)
);

alter table public.chat_usage enable row level security;
revoke all on public.chat_usage from anon, authenticated;

-- One more question for a member today; returns today's count, this one
-- included. A row per member per day they ask anything: small enough to
-- keep, and a record of how much the chat is used.
create or replace function public.count_chat_question(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n     int;
begin
  insert into public.chat_usage as u (user_id, day, questions)
  values (p_user_id, today, 1)
  on conflict (user_id, day) do update set questions = u.questions + 1
  returning questions into n;
  return n;
end;
$$;

revoke all on function public.count_chat_question(uuid) from public, anon, authenticated;
grant execute on function public.count_chat_question(uuid) to service_role;
