-- ESPN leagues alongside Sleeper's.
--
-- A Sleeper league is known by its numeric league ids (one a season); an
-- ESPN league keeps one id for life and is written "espn-<id>" (espn.js).
-- Both are accepted now, by the table and by sync_league(); everything
-- else (the free plan's one league, the 30-day swap) is unchanged.

alter table public.synced_leagues drop constraint if exists synced_leagues_league_id_check;
alter table public.synced_leagues
  add constraint synced_leagues_league_id_check
  check (league_id ~ '^([0-9]{6,24}|espn-[0-9]{1,12})$');

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
  user_plan text;
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

  -- Already on the account (this season or any season of its history):
  -- refresh it, which never counts against the limit.
  select * into existing from public.synced_leagues
   where user_id = uid and league_ids && ids
   order by synced_at limit 1;
  if found then
    update public.synced_leagues
       set league_ids = array(select distinct x from unnest(existing.league_ids || ids) as x),
           name = coalesce(p_name, name),
           avatar = coalesce(p_avatar, avatar)
     where id = existing.id
    returning * into row_out;
    return row_out;
  end if;

  select plan into user_plan from public.profiles where id = uid;
  if coalesce(user_plan, 'free') <> 'pro' then
    select count(*) into active from public.synced_leagues where user_id = uid;
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

revoke all on function public.sync_league(text, text[], text, text) from public, anon;
grant execute on function public.sync_league(text, text[], text, text) to authenticated;
