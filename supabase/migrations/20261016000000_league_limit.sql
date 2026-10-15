-- The free plan's one league, made to hold. Two ways past it in
-- sync_league() (20261005000000_free_for_everyone.sql), neither reachable
-- while app_settings.free_for_everyone is on (everyone counts as Pro), both
-- reachable the day it goes off:
--
--   1. The "already on the account" path added whatever ids it was sent to
--      the matching row. A league is matched by any one of its ids, so a
--      free member with league A could call
--        sync_league('<B>', array['<an id of A>', '<B>', '<C>', …])
--      and A's row would hold up to 40 unrelated leagues, every one of which
--      the site's gate (account.js judge(), which matches a row by any id)
--      and the app (AccountStore.syncedLeague(covering:)) then open as the
--      member's one league. One request, no race needed.
--   2. The count and the insert weren't atomic: two sync_league() calls at
--      once (two tabs, or two requests from a script) both counted 0 and
--      both inserted, for two (or more) rows.
--
-- Now:
--   - sync_league() and unsync_league() take a per-member lock first, so a
--     member's calls run one at a time and the count is always current.
--   - For a member without Pro, the "already on the account" path never
--     adds ids to the row (it still refreshes the name and picture). The
--     server can't tell a renewal (Sleeper's new league id for a new
--     season) from an unrelated league without asking Sleeper, and it
--     doesn't need to: a renewal's history still holds the ids already on
--     the row, so the league keeps matching and opening without them. Pro
--     members' rows grow as before.
--   - A trigger on synced_leagues holds both rules for every writer, not
--     only these functions: a member without Pro can't get a second row,
--     can't have a row moved to them, and can't have new ids put on a row.
--     Rows already past the limit (added while everything was free, or on
--     Pro that has lapsed) stay; the site and the app list them locked.
--     To give someone more leagues by hand, make them a comp
--     (profiles.plan_status = 'comp', then refresh_plan()), don't insert.
--
-- Nothing changes while free_for_everyone is on: has_pro() is true for
-- everyone and every check is skipped. The errors are the codes the site
-- and the app already turn into sentences (free_limit).
--
-- Needs 20261005000000_free_for_everyone.sql (has_pro). Safe to run again.
-- Paste into Supabase ▸ SQL editor (or apply it as one named migration). Not
-- `supabase db push`: the live project's migration versions don't match these
-- file names, so a push would try to run every migration again.

-- ------------------------------------------------------------ the lock
-- Held until the end of the transaction. Every writer of a member's
-- synced_leagues rows takes it before reading them, so a second call waits
-- for the first to commit and then sees its row.
create or replace function public.lock_synced_leagues(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('synced_leagues:' || p_user_id::text, 0));
end;
$$;

-- ------------------------------------------------------------ the trigger
create or replace function public.synced_leagues_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active int;
begin
  perform public.lock_synced_leagues(new.user_id);
  if public.has_pro(new.user_id) then
    return new;
  end if;

  if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
    -- A new row for this member (or one moved to them): only if they have
    -- none. Counted after the lock, so a row committed by a call that ran
    -- at the same moment is counted too.
    select count(*) into active from public.synced_leagues
     where user_id = new.user_id and (tg_op = 'INSERT' or id <> new.id);
    if active >= 1 then
      raise exception 'free_limit';
    end if;
  elsif not (new.league_ids <@ old.league_ids)
        or not (new.league_id = any (old.league_ids) or new.league_id = old.league_id) then
    -- The same row given ids it didn't have: another league in disguise.
    raise exception 'free_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists synced_leagues_limit on public.synced_leagues;
create trigger synced_leagues_limit
  before insert or update on public.synced_leagues
  for each row execute function public.synced_leagues_limit();

-- ------------------------------------------------------------ sync / unsync
-- As in 20261005000000_free_for_everyone.sql, with the lock, and the
-- "already on the account" path adding ids only for Pro.
create or replace function public.sync_league(
  p_league_id  text,
  p_league_ids text[],
  p_name       text default null,
  p_avatar     text default null
)
returns public.synced_leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  pro       boolean;
  existing  public.synced_leagues;
  active    int;
  ids       text[];
  row_out   public.synced_leagues;
  id_shape  constant text := '^([0-9]{6,24}|espn-[0-9]{1,12})$';
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if p_league_id !~ id_shape then
    raise exception 'bad_league';
  end if;
  ids := array(select distinct x from unnest(array_append(coalesce(p_league_ids, '{}'), p_league_id)) as x
               where x ~ id_shape);
  if cardinality(ids) > 40 then
    raise exception 'bad_league';
  end if;

  -- One call at a time per member, so the count below can't be raced.
  perform public.lock_synced_leagues(uid);
  pro := public.has_pro(uid);

  -- Already on the account (this season or any season of its history):
  -- refresh it, which never counts against the limit. Only Pro adds the
  -- ids it was sent: without Pro, they could be any league at all, and the
  -- ones already on the row are enough to keep matching this league.
  -- (An assignment rather than SELECT INTO: the Supabase SQL editor's
  -- automatic RLS step mistakes SELECT INTO for creating a table.)
  existing := (select s from public.synced_leagues s
                where s.user_id = uid and s.league_ids && ids
                order by s.synced_at limit 1);
  if existing.id is not null then
    update public.synced_leagues
       set league_ids = case when pro
                             then array(select distinct x from unnest(existing.league_ids || ids) as x)
                             else league_ids end,
           name = coalesce(left(p_name, 120), name),
           avatar = coalesce(left(p_avatar, 300), avatar)
     where id = existing.id
    returning * into row_out;
    return row_out;
  end if;

  if not pro then
    active := (select count(*) from public.synced_leagues where user_id = uid);
    if active >= 1 then
      raise exception 'free_limit';
    end if;
  end if;

  insert into public.synced_leagues (user_id, league_id, league_ids, name, avatar)
  values (uid, p_league_id, ids, left(p_name, 120), left(p_avatar, 300))
  returning * into row_out;
  insert into public.league_changes (user_id, league_id, action) values (uid, p_league_id, 'sync');
  return row_out;
end;
$$;

create or replace function public.unsync_league(p_league_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  target    public.synced_leagues;
  unlocks   timestamptz;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  perform public.lock_synced_leagues(uid);
  target := (select s from public.synced_leagues s
              where s.user_id = uid and (s.league_id = p_league_id or p_league_id = any (s.league_ids))
              limit 1);
  if target.id is null then
    return;
  end if;

  -- A free account's league is locked in for 30 days from when it was
  -- synced: one swap a month.
  if not public.has_pro(uid) then
    unlocks := target.synced_at + interval '30 days';
    if unlocks > now() then
      raise exception 'swap_locked:%', to_char(unlocks at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  delete from public.synced_leagues where id = target.id;
  insert into public.league_changes (user_id, league_id, action) values (uid, target.league_id, 'unsync');
end;
$$;

-- ------------------------------------------------------------ grants
revoke all on function public.lock_synced_leagues(uuid) from public, anon, authenticated;
revoke all on function public.synced_leagues_limit() from public, anon, authenticated;
revoke all on function public.sync_league(text, text[], text, text) from public, anon;
revoke all on function public.unsync_league(text) from public, anon;
grant execute on function public.sync_league(text, text[], text, text) to authenticated;
grant execute on function public.unsync_league(text) to authenticated;
