-- Deleting an account from inside the app (App Store guideline 5.1.1(v)):
-- a signed-in member calls delete_my_account() and their auth.users row
-- goes, taking everything of theirs with it.
--
-- Every table that holds a member's rows references auth.users with
-- `on delete cascade`, so nothing else needs deleting here:
--   profiles, synced_leagues, league_changes   (20260930000000_accounts)
--   espn_keys                                   (20261002000000_espn_keys)
--   chat_usage                                  (20261003000000_league_chat)
--   league_passes (as owner), league_pass_members (20261004000000_league_pass)
-- A League Pass the member owns goes too, and with it every seat on it.
-- Its Stripe subscription, and a Pro subscription of their own, are left
-- in Stripe: cancel those there (none exist while plans are off).
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
