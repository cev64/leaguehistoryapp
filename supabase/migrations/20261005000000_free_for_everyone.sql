-- Free for everyone, for now: every signed-in member gets what Pro gives
-- (unlimited leagues, no 30-day swap lock, the league AI), while the plans,
-- Stripe and League Pass stay in place for later.
--
-- One switch, public.app_settings.free_for_everyone:
--   true   every member counts as Pro (the default this migration sets)
--   false  back to plans: only members whose profiles.plan is 'pro' do
-- Flip it in Supabase ▸ Table editor ▸ app_settings, together with PRICING in
-- account-config.js, which brings the plans back on the site.
--
-- public.has_pro() is the one place that answers "does this member get Pro?";
-- sync_league(), unsync_league() and the league-chat function all ask it.
-- profiles.plan is untouched, so a member who pays keeps their plan through
-- the switch either way.
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor. If the
-- editor offers to enable Row Level Security on new tables, run it without:
-- it misreads SELECT INTO inside sync_league() as a new table and breaks the
-- function (app_settings turns RLS on itself).

create table if not exists public.app_settings (
  id                boolean primary key default true check (id),  -- one row only
  free_for_everyone boolean not null default true,
  updated_at        timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.has_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select free_for_everyone from public.app_settings where id), false)
      or coalesce((select plan = 'pro' from public.profiles where id = p_user_id), false);
$$;

revoke all on function public.has_pro(uuid) from public, anon, authenticated;
grant execute on function public.has_pro(uuid) to service_role;

-- The league limits, now asking has_pro() rather than reading the plan.
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

  if not public.has_pro(uid) then
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
  -- An assignment rather than SELECT INTO: the Supabase SQL editor's
  -- automatic RLS step mistakes SELECT INTO for creating a table.
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

revoke all on function public.sync_league(text, text[], text, text) from public, anon;
revoke all on function public.unsync_league(text) from public, anon;
grant execute on function public.sync_league(text, text[], text, text) to authenticated;
grant execute on function public.unsync_league(text) to authenticated;
