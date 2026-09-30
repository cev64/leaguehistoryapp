-- Accounts for League History: a profile per user with their plan, and the
-- Sleeper leagues synced to the account.
--
--   free  one league, ads, and the league can be swapped once every 30 days
--   pro   ($5/month) unlimited leagues, no ads, no swap limit
--
-- The plan is only ever written by the stripe-webhook function (service
-- role); a signed-in user can read it but not change it. Leagues are synced
-- and unsynced only through sync_league() / unsync_league(), which is where
-- the limits live, so they hold no matter what the browser sends.
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor.

-- ------------------------------------------------------------ profiles
create table if not exists public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  text,
  display_name           text check (char_length(display_name) <= 60),
  sleeper_username       text check (char_length(sleeper_username) <= 40),
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  plan_status            text,              -- Stripe's subscription status
  current_period_end     timestamptz,       -- when the paid period renews or ends
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Only the harmless columns are writable by the user; plan and billing are not.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, sleeper_username) on public.profiles to authenticated;

-- A profile for every new account.
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
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ leagues
-- A league is a whole history: `league_ids` holds every season's Sleeper
-- league id, so next year's renewal (a new id) is still recognised as the
-- same league and costs nothing to re-sync.
create table if not exists public.synced_leagues (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  league_id  text not null check (league_id ~ '^[0-9]{6,24}$'),
  league_ids text[] not null check (cardinality(league_ids) between 1 and 40),
  name       text check (char_length(name) <= 120),
  avatar     text check (char_length(avatar) <= 300),
  synced_at  timestamptz not null default now(),
  unique (user_id, league_id)
);
create index if not exists synced_leagues_user on public.synced_leagues (user_id);

alter table public.synced_leagues enable row level security;

drop policy if exists "read own leagues" on public.synced_leagues;
create policy "read own leagues" on public.synced_leagues
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.synced_leagues from anon, authenticated;
grant select on public.synced_leagues to authenticated;

-- Every sync and unsync, for support questions and for the swap limit.
create table if not exists public.league_changes (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  league_id text not null,
  action    text not null check (action in ('sync', 'unsync')),
  at        timestamptz not null default now()
);
create index if not exists league_changes_user on public.league_changes (user_id, at desc);
alter table public.league_changes enable row level security;
drop policy if exists "read own changes" on public.league_changes;
create policy "read own changes" on public.league_changes
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.league_changes from anon, authenticated;
grant select on public.league_changes to authenticated;

-- ------------------------------------------------------------ sync / unsync
-- Errors carry a stable code in their message (free_limit, swap_locked,
-- not_signed_in, bad_league) that the site turns into a sentence.

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
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if p_league_id !~ '^[0-9]{6,24}$' then
    raise exception 'bad_league';
  end if;
  ids := array(select distinct x from unnest(array_append(coalesce(p_league_ids, '{}'), p_league_id)) as x
               where x ~ '^[0-9]{6,24}$');
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

create or replace function public.unsync_league(p_league_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  user_plan text;
  target    public.synced_leagues;
  unlocks   timestamptz;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into target from public.synced_leagues
   where user_id = uid and (league_id = p_league_id or p_league_id = any (league_ids))
   limit 1;
  if not found then
    return;
  end if;

  -- A free account's league is locked in for 30 days from when it was
  -- synced: one swap a month.
  select plan into user_plan from public.profiles where id = uid;
  if coalesce(user_plan, 'free') <> 'pro' then
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
revoke all on function public.handle_new_user() from public, anon, authenticated;
