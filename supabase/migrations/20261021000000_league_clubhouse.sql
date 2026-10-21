-- The clubhouse: what a league's members do together week to week.
--
--   league_members   an account claims the manager it is in a league, so the
--                    site and the app know whose team is whose: one account
--                    per manager and one manager per account in a league.
--                    Everything below needs a claim.
--   pickem_picks     league pick'em: each member picks the winners of the
--                    week's games, all locked at the week's first NFL kickoff.
--   award_votes      the week's awards (Manager of the Week, Choke of the
--                    Week, Robbery of the Week), voted by the members between
--                    the week's kickoff and the next week's.
--   push_devices     where to send a member's notifications (a browser's Web
--                    Push subscription, or an iPhone's APNs token), and
--   push_sends       which notifications have gone, so none goes twice.
--   clubhouse_leagues  how the sender finds each league's current season.
--   nfl_weeks        each NFL week's first kickoff, the deadline everything
--                    above runs on.
--
-- A league is named by its `league_key`, which never changes over its
-- history: a Sleeper league's first season's league id (its oldest, at the
-- end of the previous_league_id chain: each renewal gets a new id but the
-- first one stays), or an ESPN league's `espn-<id>`. A season is its year,
-- and a week its regular-season or playoff week number. A game is the two
-- teams' ids for that season ("r1", "r4") sorted and joined with "|", so a
-- pick names its game without trusting the order it was sent in. Sorted
-- byte by byte (collate "C"), the way Clubhouse.gameKey() in clubhouse.js
-- sorts them, whatever the database's own collation.
--
-- How it holds:
--   - Nothing here is read or written directly: row-level security is on with
--     no policies for anon or authenticated, and every read and write goes
--     through the security-definer functions below, which check who is
--     asking (auth.uid()), that they've claimed a manager in the league, and
--     the clock (pick_deadline). The sender uses the service role.
--   - Picks are graded on the device, not here: a league's results are the
--     platform's public data and every member's page already has them, and
--     everyone grades the same picks the same way (clubhouse.js). What the
--     server guarantees is that nobody's picks change after the lock, and
--     that nobody sees anyone else's picks for a week before it locks (until
--     then, only who has picked).
--   - Award tallies stay hidden until voting closes (next week's kickoff);
--     until then only how many have voted.
--   - A claim is taken on trust: Sleeper and ESPN have no sign-in to check
--     it against. It is first come, first served, shown to the league, and
--     the claimer can let it go (release_manager). To fix a wrong claim by
--     hand, delete the row in the table editor.
--   - Nothing a member sends is trusted to reach anyone else. claim_manager()
--     keeps what the member's own page saw (the league's newest id, season
--     and name) on the member's own row only. The sender (service role) is
--     the only writer of clubhouse_leagues: it takes a Sleeper league's
--     current id only once it has followed that league's previous_league_id
--     chain on Sleeper back to the league_key, and its name from Sleeper;
--     it sends nothing for a claimed manager who isn't one of that league's
--     owners. An ESPN league's id is its key, and its notifications are
--     plain lines (the name in one is the member's own page's).
--   - Notifications are opt-in per league: a claim starts with them all
--     off, and only set_league_notifications() turns them on (the site's and
--     the app's "Turn on").
--   - A browser's push address must be one of the browsers' own push
--     services (clubhouse_push_endpoint_ok), so the sender never posts to
--     anywhere else.
--   - Every table references auth.users with `on delete cascade`, so
--     delete_my_account() (20261008000000_delete_account.sql) takes all of a
--     member's clubhouse rows with it.
--
-- Paste into Supabase ▸ SQL editor (or apply it as one named migration). Not
-- `supabase db push`: the live project's migration versions don't match these
-- file names. Safe to run again.

-- ------------------------------------------------------------ checks
-- The shapes every function checks its arguments against.
create or replace function public.clubhouse_key_ok(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and p ~ '^([0-9]{6,24}|espn-[0-9]{1,15})$';
$$;

create or replace function public.clubhouse_team_ok(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and p ~ '^[A-Za-z0-9_.:-]{1,40}$';
$$;

-- A name as a page sent it, made safe to show: control, zero-width and
-- direction-changing characters out, runs of space as one, at most 120.
create or replace function public.clubhouse_clean_text(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(
           regexp_replace(p, '[\u0001-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]', ' ', 'g'),
           '\s+', ' ', 'g')), 120), '');
$$;

/* A Web Push endpoint the sender may post to: https, no port or user, on
   one of the browsers' push services (Chrome and Edge's FCM, Firefox's
   Mozilla push, Safari's Apple push, Windows' WNS). Anything else could
   aim the sender at any address on the internet. push.ts checks the same. */
create or replace function public.clubhouse_push_endpoint_ok(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and char_length(p) between 16 and 1000 and p ~ ('^https://(fcm\.googleapis\.com'
    || '|([a-z0-9-]+\.)+push\.services\.mozilla\.com'
    || '|([a-z0-9-]+\.)+push\.apple\.com'
    || '|([a-z0-9-]+\.)+notify\.windows\.com)/\S*$');
$$;

-- ------------------------------------------------------------ the deadline
create table if not exists public.nfl_weeks (
  season  smallint not null check (season between 2000 and 2100),
  week    smallint not null check (week between 1 and 22),
  kickoff timestamptz not null,
  primary key (season, week)
);
alter table public.nfl_weeks enable row level security;
drop policy if exists "anyone reads nfl weeks" on public.nfl_weeks;
create policy "anyone reads nfl weeks" on public.nfl_weeks for select to anon, authenticated using (true);
revoke all on public.nfl_weeks from anon, authenticated;
grant select on public.nfl_weeks to anon, authenticated;

-- The NFL's first Monday in September (Labor Day): week 1 kicks off the
-- Thursday after.
create or replace function public.labor_day(p_season int)
returns date language sql immutable set search_path = '' as $$
  select make_date(p_season, 9, 1) + ((8 - extract(isodow from make_date(p_season, 9, 1))::int) % 7);
$$;

/* When a week's picks lock: its first kickoff, from nfl_weeks where the
   week is listed (tools/nfl-weeks.mjs fills it from the NFL's schedule),
   otherwise the Thursday night game, 8:15 PM Eastern, of that week (12:30 PM
   on Thanksgiving, when the first game is in the afternoon). Week w's
   Thursday is week 1's plus 7(w − 1) days. The formula is only a stand-in:
   2026 alone has a Wednesday opener, a Wednesday game on Thanksgiving eve
   and a Saturday week 18, so each season's weeks belong in nfl_weeks. */
create or replace function public.pick_deadline(p_season int, p_week int)
returns timestamptz language sql stable set search_path = '' as $$
  with d as (
    select public.labor_day(p_season) + 3 + 7 * (p_week - 1) as thursday,
           make_date(p_season, 11, 1) as nov1
  )
  select coalesce(
    (select w.kickoff from public.nfl_weeks w where w.season = p_season and w.week = p_week),
    (select ((d.thursday::timestamp + case
               when d.thursday = d.nov1 + ((4 - extract(isodow from d.nov1)::int + 7) % 7) + 21
               then time '12:30' else time '20:15' end)
             at time zone 'America/New_York')
       from d)
  );
$$;
grant execute on function public.pick_deadline(int, int) to anon, authenticated;

-- ------------------------------------------------------------ leagues
/* What the sender has checked about a league: its id this season, its
   season and its name, as Sleeper has them. Written by the sender only
   (service role), once it has followed current_league_id's
   previous_league_id chain on Sleeper back to league_key; never by a
   member's page (what a page saw stays on the member's own row,
   league_members.seen_*). ESPN leagues have no row: their id is their key. */
create table if not exists public.clubhouse_leagues (
  league_key        text primary key check (public.clubhouse_key_ok(league_key)),
  source            text not null check (source in ('sleeper', 'espn')),
  current_league_id text not null check (current_league_id ~ '^([0-9]{6,24}|espn-[0-9]{1,15})$'),
  current_season    smallint not null check (current_season between 2000 and 2100),
  name              text check (char_length(name) <= 120),
  verified_at       timestamptz,          -- when the sender checked it (null: not checked, not used)
  updated_at        timestamptz not null default now()
);
-- (An install from before the sender checked leagues: its rows were the
-- pages' word, so they start unchecked and the sender checks them again.)
alter table public.clubhouse_leagues add column if not exists verified_at timestamptz;
alter table public.clubhouse_leagues enable row level security;
revoke all on public.clubhouse_leagues from anon, authenticated;

-- ------------------------------------------------------------ members
create table if not exists public.league_members (
  league_key    text not null check (public.clubhouse_key_ok(league_key)),
  -- The manager: a Sleeper user id or an ESPN member id (SWID), as the
  -- site's league model has it (team.ownerId); the same every season.
  owner_id      text not null check (owner_id ~ '^[A-Za-z0-9{}_-]{1,80}$' and owner_id !~ '^open-'),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Opt-in, per league: off until the member turns them on
  -- (set_league_notifications).
  notify_recap  boolean not null default false,  -- Tuesday: the week is final
  notify_pickem boolean not null default false,  -- Thursday: picks lock tonight
  notify_awards boolean not null default false,  -- the week's awards are in
  -- What the member's page last saw of the league (claim_manager): its
  -- newest season's league id, that season and its name. The member's
  -- word only: the sender checks a Sleeper id before using it, and the name
  -- is shown to this member alone.
  seen_league_id text check (seen_league_id ~ '^([0-9]{6,24}|espn-[0-9]{1,15})$'),
  seen_season    smallint check (seen_season between 2000 and 2100),
  seen_name      text check (char_length(seen_name) <= 120),
  claimed_at    timestamptz not null default now(),
  primary key (league_key, owner_id),
  unique (league_key, user_id)
);
-- (An install from before notifications were opt-in, or before seen_*.)
alter table public.league_members alter column notify_recap set default false;
alter table public.league_members alter column notify_pickem set default false;
alter table public.league_members alter column notify_awards set default false;
alter table public.league_members add column if not exists seen_league_id text check (seen_league_id ~ '^([0-9]{6,24}|espn-[0-9]{1,15})$');
alter table public.league_members add column if not exists seen_season smallint check (seen_season between 2000 and 2100);
alter table public.league_members add column if not exists seen_name text check (char_length(seen_name) <= 120);
create index if not exists league_members_user on public.league_members (user_id);
alter table public.league_members enable row level security;
revoke all on public.league_members from anon, authenticated;

-- The member's own claim in a league, or null.
create or replace function public.clubhouse_owner(p_league_key text, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.owner_id from public.league_members m where m.league_key = p_league_key and m.user_id = p_user;
$$;
revoke all on function public.clubhouse_owner(text, uuid) from public, anon, authenticated;

/* Who has claimed which manager in a league: owner ids only, no accounts.
   Anyone signed in may ask (to see which managers are still free to claim);
   `mine` is the asker's own claim. */
create or replace function public.league_claims(p_league_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  return jsonb_build_object(
    'claimed', coalesce((select jsonb_agg(m.owner_id order by m.claimed_at) from public.league_members m where m.league_key = p_league_key), '[]'::jsonb),
    'mine', (select to_jsonb(m) - 'user_id' - 'league_key' - 'seen_league_id' - 'seen_season' - 'seen_name'
               from public.league_members m where m.league_key = p_league_key and m.user_id = me)
  );
end;
$$;

/* Claim a manager: "I'm Lamb Chops' manager". A member who already has
   another manager in the league moves to this one (their picks and votes
   stay theirs, and so do their notification choices).

   p_current_league_id, p_season and p_name are what the member's page
   sees of the league (its newest season's league id, that season, its
   name), kept on the member's own row only (seen_*), never as the
   league's: the sender checks a Sleeper id on Sleeper before it uses it
   (clubhouse_leagues), and the name is shown back to this member only. A
   season is a year from 2000 to next year, and never goes back; an ESPN
   league's id is its key. p_source is the key's ("espn-…" is ESPN), kept
   for the callers. Errors: not_signed_in, bad_league, bad_manager, taken. */
create or replace function public.claim_manager(
  p_league_key        text,
  p_owner_id          text,
  p_source            text,
  p_current_league_id text,
  p_season            int,
  p_name              text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     uuid := auth.uid();
  owner  uuid;
  espn   boolean;
  seen   text;
  season int;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  if p_owner_id is null or p_owner_id !~ '^[A-Za-z0-9{}_-]{1,80}$' or p_owner_id ~ '^open-' then
    raise exception 'bad_manager';
  end if;
  -- One claim at a time per league, so two members racing for a manager
  -- can't both get it.
  perform pg_advisory_xact_lock(hashtextextended('league_members:' || p_league_key, 0));
  select m.user_id into owner from public.league_members m where m.league_key = p_league_key and m.owner_id = p_owner_id;
  if owner is not null and owner <> me then raise exception 'taken'; end if;
  if owner is null then
    with gone as (
      delete from public.league_members where league_key = p_league_key and user_id = me
      returning notify_recap, notify_pickem, notify_awards, seen_league_id, seen_season, seen_name)
    insert into public.league_members (league_key, owner_id, user_id, notify_recap, notify_pickem, notify_awards,
                                       seen_league_id, seen_season, seen_name)
    select p_league_key, p_owner_id, me, coalesce(g.notify_recap, false), coalesce(g.notify_pickem, false),
           coalesce(g.notify_awards, false), g.seen_league_id, g.seen_season, g.seen_name
      from (select 1) one left join gone g on true;
  end if;

  espn := p_league_key like 'espn-%';
  seen := case when espn and p_current_league_id = p_league_key then p_current_league_id
               when not espn and p_current_league_id ~ '^[0-9]{6,24}$' then p_current_league_id end;
  season := case when p_season between 2000 and extract(year from now())::int + 1 then p_season end;
  update public.league_members m
     set seen_name = coalesce(public.clubhouse_clean_text(p_name), m.seen_name)
   where m.league_key = p_league_key and m.user_id = me;
  if seen is not null and season is not null then
    update public.league_members m
       set seen_league_id = seen, seen_season = season
     where m.league_key = p_league_key and m.user_id = me
       and (m.seen_season is null or m.seen_season <= season);
  end if;
  return public.league_claims(p_league_key);
end;
$$;

-- Let go of the member's manager in a league.
create or replace function public.release_manager(p_league_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  delete from public.league_members where league_key = p_league_key and user_id = me;
end;
$$;

-- Every league the member has claimed a manager in, for the account panel:
-- its name as Sleeper has it once the sender has checked the league,
-- otherwise as the member's own page last saw it.
create or replace function public.my_clubhouses()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'league_key', m.league_key, 'owner_id', m.owner_id,
           'notify_recap', m.notify_recap, 'notify_pickem', m.notify_pickem, 'notify_awards', m.notify_awards,
           'name', coalesce(l.name, m.seen_name), 'claimed_at', m.claimed_at) order by m.claimed_at), '[]'::jsonb)
    from public.league_members m
    left join public.clubhouse_leagues l on l.league_key = m.league_key
   where m.user_id = auth.uid();
$$;

-- Which of a league's notifications the member wants (null leaves one as
-- it is). The only way one is turned on: a claim starts with them all off.
create or replace function public.set_league_notifications(
  p_league_key text, p_recap boolean default null, p_pickem boolean default null, p_awards boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  update public.league_members
     set notify_recap = coalesce(p_recap, notify_recap),
         notify_pickem = coalesce(p_pickem, notify_pickem),
         notify_awards = coalesce(p_awards, notify_awards)
   where league_key = p_league_key and user_id = me;
  if not found then raise exception 'not_a_member'; end if;
end;
$$;

-- ------------------------------------------------------------ pick'em
create table if not exists public.pickem_picks (
  league_key text not null check (public.clubhouse_key_ok(league_key)),
  season     smallint not null check (season between 2000 and 2100),
  week       smallint not null check (week between 1 and 22),
  user_id    uuid not null references auth.users (id) on delete cascade,
  game       text not null check (char_length(game) <= 81
                                  and split_part(game, '|', 1) collate "C" < split_part(game, '|', 2) collate "C"
                                  and public.clubhouse_team_ok(split_part(game, '|', 1))
                                  and public.clubhouse_team_ok(split_part(game, '|', 2))
                                  and split_part(game, '|', 3) = ''),
  winner     text not null,
  is_lock    boolean not null default false,  -- the member's Lock of the Week: worth 2 when right
  picked_at  timestamptz not null default now(),
  primary key (league_key, season, week, user_id, game),
  check (winner = split_part(game, '|', 1) or winner = split_part(game, '|', 2))
);
-- One lock a week.
create unique index if not exists pickem_one_lock on public.pickem_picks (league_key, season, week, user_id) where is_lock;
create index if not exists pickem_user on public.pickem_picks (user_id);
alter table public.pickem_picks enable row level security;
revoke all on public.pickem_picks from anon, authenticated;

/* Save the member's picks for a week, replacing whatever they had: every
   game they've picked, as [{ "a": "r1", "b": "r4", "winner": "r4",
   "lock": false }], up to 20 (a week has a game per two teams). An empty
   list takes them all back. Only before the week locks.
   Errors: not_signed_in, bad_league, bad_week, not_a_member, locked,
   bad_picks, two_locks. */
create or replace function public.save_picks(p_league_key text, p_season int, p_week int, p_picks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me   uuid := auth.uid();
  pick jsonb;
  a    text;
  b    text;
  win  text;
  game_key text;
  as_lock boolean;
  locks int := 0;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  if p_season is null or p_season not between 2000 and 2100 or p_week is null or p_week not between 1 and 22 then
    raise exception 'bad_week';
  end if;
  if public.clubhouse_owner(p_league_key, me) is null then raise exception 'not_a_member'; end if;
  if now() >= public.pick_deadline(p_season, p_week) then raise exception 'locked'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 20 then
    raise exception 'bad_picks';
  end if;

  delete from public.pickem_picks
   where league_key = p_league_key and season = p_season and week = p_week and user_id = me;
  for pick in select * from jsonb_array_elements(p_picks) loop
    a := pick ->> 'a'; b := pick ->> 'b'; win := pick ->> 'winner';
    if not public.clubhouse_team_ok(a) or not public.clubhouse_team_ok(b) or a = b
       or win is null or win not in (a, b)
       or coalesce(jsonb_typeof(pick -> 'lock'), 'null') not in ('boolean', 'null') then
      raise exception 'bad_picks';
    end if;
    as_lock := coalesce((pick ->> 'lock')::boolean, false);
    game_key := least(a collate "C", b collate "C") || '|' || greatest(a collate "C", b collate "C");
    if as_lock then locks := locks + 1; end if;
    if locks > 1 then raise exception 'two_locks'; end if;
    -- The same game twice: the later pick stands.
    insert into public.pickem_picks (league_key, season, week, user_id, game, winner, is_lock)
    values (p_league_key, p_season, p_week, me, game_key, win, as_lock)
    on conflict (league_key, season, week, user_id, game) do update
      set winner = excluded.winner, is_lock = excluded.is_lock, picked_at = now();
  end loop;
  return jsonb_build_object(
    'saved', (select count(*) from public.pickem_picks
               where league_key = p_league_key and season = p_season and week = p_week and user_id = me),
    'locks_at', public.pick_deadline(p_season, p_week));
end;
$$;

/* A league's pick'em for a season, as the asker may see it:
     members    every member's manager (owner id), the asker's flagged `me`
     picks      [{ owner, week, game, winner, lock }]: the asker's own picks
                for every week, everyone's for the weeks that have locked
     picked     { week: [owner ids] } for the weeks still open: who has
                picked, not what
     deadlines  { week: when it locks } for weeks 1 to 18
   Members only. Errors: not_signed_in, bad_league, not_a_member. */
create or replace function public.pickem_board(p_league_key text, p_season int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me   uuid := auth.uid();
  mine text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  mine := public.clubhouse_owner(p_league_key, me);
  if mine is null then raise exception 'not_a_member'; end if;
  return jsonb_build_object(
    'me', mine,
    'members', coalesce((select jsonb_agg(m.owner_id order by m.claimed_at) from public.league_members m where m.league_key = p_league_key), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object('owner', m.owner_id, 'week', p.week, 'game', p.game, 'winner', p.winner, 'lock', p.is_lock)
                       order by p.week, m.owner_id, p.game)
        from public.pickem_picks p
        join public.league_members m on m.league_key = p.league_key and m.user_id = p.user_id
       where p.league_key = p_league_key and p.season = p_season
         and (p.user_id = me or now() >= public.pick_deadline(p_season, p.week))
    ), '[]'::jsonb),
    'picked', coalesce((
      select jsonb_object_agg(x.week, x.owners) from (
        select p.week, jsonb_agg(distinct m.owner_id) as owners
          from public.pickem_picks p
          join public.league_members m on m.league_key = p.league_key and m.user_id = p.user_id
         where p.league_key = p_league_key and p.season = p_season
           and now() < public.pick_deadline(p_season, p.week)
         group by p.week) x
    ), '{}'::jsonb),
    'deadlines', (select jsonb_object_agg(w, public.pick_deadline(p_season, w)) from generate_series(1, 18) w)
  );
end;
$$;

-- ------------------------------------------------------------ awards
create table if not exists public.award_votes (
  league_key text not null check (public.clubhouse_key_ok(league_key)),
  season     smallint not null check (season between 2000 and 2100),
  week       smallint not null check (week between 1 and 22),
  award      text not null check (award in ('mvp', 'choke', 'robbery')),
  user_id    uuid not null references auth.users (id) on delete cascade,
  nominee    text not null check (public.clubhouse_team_ok(nominee)),
  voted_at   timestamptz not null default now(),
  primary key (league_key, season, week, award, user_id)
);
create index if not exists award_votes_user on public.award_votes (user_id);
alter table public.award_votes enable row level security;
revoke all on public.award_votes from anon, authenticated;

/* Vote (or, with a null nominee, take a vote back) for one of a week's
   awards: from the week's first kickoff until the next week's. (The site
   and the app offer the vote once the week's results are in; the server
   can't tell when that is, and doesn't need to.) Errors: not_signed_in,
   bad_league, bad_week,
   bad_award, bad_nominee, not_a_member, not_open, closed. */
create or replace function public.cast_vote(p_league_key text, p_season int, p_week int, p_award text, p_nominee text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  if p_season is null or p_season not between 2000 and 2100 or p_week is null or p_week not between 1 and 21 then
    raise exception 'bad_week';
  end if;
  if p_award is null or p_award not in ('mvp', 'choke', 'robbery') then raise exception 'bad_award'; end if;
  if p_nominee is not null and not public.clubhouse_team_ok(p_nominee) then raise exception 'bad_nominee'; end if;
  if public.clubhouse_owner(p_league_key, me) is null then raise exception 'not_a_member'; end if;
  if now() < public.pick_deadline(p_season, p_week) then raise exception 'not_open'; end if;
  if now() >= public.pick_deadline(p_season, p_week + 1) then raise exception 'closed'; end if;
  if p_nominee is null then
    delete from public.award_votes
     where league_key = p_league_key and season = p_season and week = p_week and award = p_award and user_id = me;
  else
    insert into public.award_votes (league_key, season, week, award, user_id, nominee)
    values (p_league_key, p_season, p_week, p_award, me, p_nominee)
    on conflict (league_key, season, week, award, user_id) do update set nominee = excluded.nominee, voted_at = now();
  end if;
end;
$$;

/* A league's awards for a season, as the asker may see them:
     mine     [{ week, award, nominee }]: the asker's own votes
     voters   { "<week>": { award: how many have voted } } for weeks still open
     results  [{ week, award, nominee, votes }] for weeks whose voting has
              closed: every nominee's tally (the most votes wins; a tie
              shares it)
     closes   { week: when its voting closes } for weeks 1 to 18
   Members only. */
create or replace function public.award_board(p_league_key text, p_season int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if not public.clubhouse_key_ok(p_league_key) then raise exception 'bad_league'; end if;
  if public.clubhouse_owner(p_league_key, me) is null then raise exception 'not_a_member'; end if;
  return jsonb_build_object(
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('week', v.week, 'award', v.award, 'nominee', v.nominee) order by v.week, v.award)
        from public.award_votes v
       where v.league_key = p_league_key and v.season = p_season and v.user_id = me), '[]'::jsonb),
    'voters', coalesce((
      select jsonb_object_agg(x.week, x.counts) from (
        select y.week, jsonb_object_agg(y.award, y.n) as counts from (
          select v.week, v.award, count(*) as n
            from public.award_votes v
           where v.league_key = p_league_key and v.season = p_season
             and now() < public.pick_deadline(p_season, v.week + 1)
           group by v.week, v.award) y
         group by y.week) x), '{}'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object('week', v.week, 'award', v.award, 'nominee', v.nominee, 'votes', v.n)
                       order by v.week, v.award, v.n desc)
        from (select week, award, nominee, count(*) as n
                from public.award_votes
               where league_key = p_league_key and season = p_season
                 and now() >= public.pick_deadline(p_season, week + 1)
               group by week, award, nominee) v), '[]'::jsonb),
    'closes', (select jsonb_object_agg(w, public.pick_deadline(p_season, w + 1)) from generate_series(1, 18) w)
  );
end;
$$;

-- ------------------------------------------------------------ notifications
create table if not exists public.push_devices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('web', 'apns')),
  -- A Web Push subscription's endpoint, or an APNs device token (hex).
  token      text not null unique check (char_length(token) between 16 and 1000),
  p256dh     text check (char_length(p256dh) <= 200),   -- Web Push keys
  auth       text check (char_length(auth) <= 100),
  apns_env   text check (apns_env in ('sandbox', 'production')),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  -- Sends in a row that failed (not counting ones that said the device is
  -- gone, which forget it at once): the sender forgets it at 5, and puts
  -- it back to 0 when one gets through.
  failures   int not null default 0,
  check (kind <> 'web' or (token ~ '^https://' and p256dh is not null and auth is not null)),
  check (kind <> 'apns' or (token ~ '^[0-9a-fA-F]{16,200}$' and apns_env is not null))
);
alter table public.push_devices add column if not exists failures int not null default 0;
create index if not exists push_devices_user on public.push_devices (user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;

-- A device to send the member's notifications to: a Web Push subscription
-- (p_kind 'web', its endpoint as p_token, on one of the browsers' push
-- services (clubhouse_push_endpoint_ok), its p256dh and auth keys) or an
-- iPhone's APNs token (p_kind 'apns', the token in hex, p_env 'sandbox' for
-- a debug build or 'production'). A device that was someone else's (a
-- shared iPad, a browser signed into another account) becomes this
-- member's. At most 10 a member; the one seen longest ago goes.
-- Errors: not_signed_in, bad_device.
create or replace function public.register_push_device(
  p_kind text, p_token text, p_p256dh text default null, p_auth text default null, p_env text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if p_token is null or char_length(p_token) not between 16 and 1000
     or not coalesce(
       (p_kind = 'web' and public.clubhouse_push_endpoint_ok(p_token) and p_env is null
          and p_p256dh ~ '^[A-Za-z0-9_=-]{1,200}$' and p_auth ~ '^[A-Za-z0-9_=-]{1,100}$')
       or (p_kind = 'apns' and p_token ~ '^[0-9a-fA-F]{16,200}$' and p_env in ('sandbox', 'production')
          and p_p256dh is null and p_auth is null), false) then
    raise exception 'bad_device';
  end if;
  insert into public.push_devices (user_id, kind, token, p256dh, auth, apns_env)
  values (me, p_kind, p_token, p_p256dh, p_auth, p_env)
  on conflict (token) do update
    set user_id = me, kind = excluded.kind, p256dh = excluded.p256dh, auth = excluded.auth,
        apns_env = excluded.apns_env, last_seen = now(), failures = 0;
  delete from public.push_devices
   where user_id = me and id not in (
     select id from public.push_devices where user_id = me order by last_seen desc, id desc limit 10);
end;
$$;

create or replace function public.unregister_push_device(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.push_devices where token = p_token and user_id = auth.uid();
end;
$$;

-- What the sender has sent: one of each kind per member, league and week.
create table if not exists public.push_sends (
  user_id    uuid not null references auth.users (id) on delete cascade,
  league_key text not null,
  kind       text not null check (kind in ('recap', 'pickem', 'awards')),
  season     smallint not null,
  week       smallint not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, league_key, kind, season, week)
);
alter table public.push_sends enable row level security;
revoke all on public.push_sends from anon, authenticated;

-- ------------------------------------------------------------ grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.league_claims(text)',
    'public.claim_manager(text, text, text, text, int, text)',
    'public.release_manager(text)',
    'public.my_clubhouses()',
    'public.set_league_notifications(text, boolean, boolean, boolean)',
    'public.save_picks(text, int, int, jsonb)',
    'public.pickem_board(text, int)',
    'public.cast_vote(text, int, int, text, text)',
    'public.award_board(text, int)',
    'public.register_push_device(text, text, text, text, text)',
    'public.unregister_push_device(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
