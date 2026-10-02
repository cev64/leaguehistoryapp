-- League Pass: one member buys Pro for their whole league, $20 per member
-- a year (supabase/functions/league-pass starts the checkout; the
-- stripe-webhook function keeps the pass in step with Stripe). The buyer
-- (the pass's owner) shares an invite link; whoever joins through it is on
-- Pro for as long as the pass is paid. The owner sees who has joined, can
-- remove (and restore) people, and can make a new link.
--
-- A member's plan stays in one place, profiles.plan, so everything that
-- already reads it (the league limits, the league chat, the site) needs no
-- change. refresh_plan() works it out from what the member has:
--   - their own Pro subscription (profiles.plan_status from Stripe), or
--   - a comp: plan_status 'comp', set by hand in the table editor, or
--   - a seat on a League Pass that's paid up.
-- Existing hand-set Pro accounts become comps here, so they keep Pro.
--
-- Members never touch these tables directly: row-level security is on with
-- no policies, and everything goes through the functions below.
--
-- Apply with `supabase db push`, or paste into Supabase ▸ SQL editor.

-- ------------------------------------------------------------ tables
create table if not exists public.league_passes (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references auth.users (id) on delete cascade,
  league_id              text not null check (league_id ~ '^([0-9]{6,24}|espn-[0-9]{1,12})$'),
  league_ids             text[] not null default '{}' check (cardinality(league_ids) <= 40),
  league_name            text check (char_length(league_name) <= 120),
  league_avatar          text check (char_length(league_avatar) <= 300),
  seats                  int not null check (seats between 1 and 60),
  -- Stripe's subscription status, or 'pending' until the checkout is paid
  status                 text not null default 'pending',
  invite_code            text not null unique default replace(gen_random_uuid()::text, '-', ''),
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists league_passes_owner on public.league_passes (owner_id);

create table if not exists public.league_pass_members (
  pass_id    uuid not null references public.league_passes (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  -- set when the owner takes the seat back; the row stays, so a removed
  -- member can't simply follow the link again
  removed_at timestamptz,
  primary key (pass_id, user_id)
);
create index if not exists league_pass_members_user on public.league_pass_members (user_id);

alter table public.league_passes enable row level security;
alter table public.league_pass_members enable row level security;
revoke all on public.league_passes from anon, authenticated;
revoke all on public.league_pass_members from anon, authenticated;

-- Hand-set Pro accounts so far had no Stripe status: they're comps.
update public.profiles set plan_status = 'comp' where plan = 'pro' and plan_status is null;

-- ------------------------------------------------------------ plans
-- A pass that's paid up (Stripe's grace period after a failed renewal
-- included).
create or replace function public.league_pass_live(p public.league_passes)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.status in ('active', 'trialing', 'past_due')
     and (p.current_period_end is null or p.current_period_end > now() - interval '3 days');
$$;

create or replace function public.refresh_plan(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_plan text;
begin
  select case
           when coalesce(pr.plan_status, '') in ('active', 'trialing', 'past_due', 'comp') then 'pro'
           when exists (
             select 1 from public.league_pass_members m
               join public.league_passes p on p.id = m.pass_id
              where m.user_id = p_user_id and m.removed_at is null and public.league_pass_live(p)
           ) then 'pro'
           else 'free'
         end
    into new_plan
    from public.profiles pr where pr.id = p_user_id;
  if new_plan is not null then
    update public.profiles set plan = new_plan where id = p_user_id and plan is distinct from new_plan;
  end if;
  return new_plan;
end;
$$;

-- Every member of a pass (removed ones too, so they lose Pro), after the
-- pass changes.
create or replace function public.refresh_pass_plans(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in select user_id from public.league_pass_members where pass_id = p_pass_id loop
    perform public.refresh_plan(m.user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------ for members
-- What an invite link shows before anyone signs in: whose league it is and
-- whether there's room. Errors: invite_unknown.
create or replace function public.league_pass_invite(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.league_passes;
  used   int;
  owner  text;
  mine   public.league_pass_members;
begin
  select * into p from public.league_passes where invite_code = p_code;
  if not found then
    raise exception 'invite_unknown';
  end if;
  select count(*) into used from public.league_pass_members where pass_id = p.id and removed_at is null;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1), 'A league-mate') into owner
    from public.profiles where id = p.owner_id;
  select * into mine from public.league_pass_members where pass_id = p.id and user_id = auth.uid();
  return json_build_object(
    'league_id', p.league_id,
    'league_name', p.league_name,
    'league_avatar', p.league_avatar,
    'owner_name', coalesce(owner, 'A league-mate'),
    'is_owner', p.owner_id = auth.uid(),
    'seats', p.seats,
    'used', used,
    'live', public.league_pass_live(p),
    'joined', found and mine.removed_at is null,
    'removed', found and mine.removed_at is not null
  );
end;
$$;

-- Taking a seat. Errors: not_signed_in, invite_unknown, pass_inactive,
-- invite_removed, pass_full. Adds the league to the member's account too.
create or replace function public.join_league_pass(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  p    public.league_passes;
  mine public.league_pass_members;
  used int;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into p from public.league_passes where invite_code = p_code for update;
  if not found then
    raise exception 'invite_unknown';
  end if;
  if not public.league_pass_live(p) then
    raise exception 'pass_inactive';
  end if;
  select * into mine from public.league_pass_members where pass_id = p.id and user_id = uid;
  if found and mine.removed_at is not null then
    raise exception 'invite_removed';
  end if;
  if not found then
    select count(*) into used from public.league_pass_members where pass_id = p.id and removed_at is null;
    if used >= p.seats then
      raise exception 'pass_full';
    end if;
    insert into public.league_pass_members (pass_id, user_id) values (p.id, uid);
  end if;
  perform public.refresh_plan(uid);
  perform public.sync_league(p.league_id, p.league_ids, p.league_name, p.league_avatar);
  return json_build_object('pass_id', p.id, 'league_id', p.league_id, 'league_name', p.league_name);
end;
$$;

-- The member's passes: the ones they own, with everyone on them, and the
-- ones they have a seat on.
create or replace function public.my_league_passes()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'owned', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'league_id', p.league_id, 'league_name', p.league_name, 'league_avatar', p.league_avatar,
        'seats', p.seats, 'status', p.status, 'live', public.league_pass_live(p),
        'current_period_end', p.current_period_end, 'invite_code', p.invite_code, 'created_at', p.created_at,
        'members', coalesce((
          select json_agg(json_build_object(
            'user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at, 'removed_at', m.removed_at,
            'name', coalesce(nullif(pr.display_name, ''), split_part(pr.email, '@', 1)), 'email', pr.email
          ) order by m.role = 'owner' desc, m.joined_at)
            from public.league_pass_members m left join public.profiles pr on pr.id = m.user_id
           where m.pass_id = p.id), '[]'::json)
      ) order by p.created_at desc)
        from public.league_passes p
       where p.owner_id = auth.uid() and p.status <> 'pending'), '[]'::json),
    'member_of', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'league_id', p.league_id, 'league_name', p.league_name, 'live', public.league_pass_live(p),
        'current_period_end', p.current_period_end,
        'owner_name', coalesce(nullif(o.display_name, ''), split_part(o.email, '@', 1))
      ))
        from public.league_pass_members m
        join public.league_passes p on p.id = m.pass_id
        left join public.profiles o on o.id = p.owner_id
       where m.user_id = auth.uid() and m.removed_at is null and p.owner_id <> auth.uid()), '[]'::json)
  );
$$;

-- ------------------------------------------------------------ for owners
-- Taking a seat back (p_active false) or giving it back (true). The owner's
-- own seat stays. Errors: not_signed_in, not_owner, pass_full.
create or replace function public.set_league_pass_member(p_pass_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p    public.league_passes;
  used int;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  select * into p from public.league_passes where id = p_pass_id for update;
  if not found or p.owner_id <> auth.uid() then
    raise exception 'not_owner';
  end if;
  if p_user_id = p.owner_id then
    return;
  end if;
  if p_active then
    select count(*) into used from public.league_pass_members where pass_id = p.id and removed_at is null;
    if used >= p.seats then
      raise exception 'pass_full';
    end if;
    update public.league_pass_members set removed_at = null where pass_id = p.id and user_id = p_user_id;
  else
    update public.league_pass_members set removed_at = now()
     where pass_id = p.id and user_id = p_user_id and removed_at is null;
  end if;
  perform public.refresh_plan(p_user_id);
end;
$$;

-- A new invite link; the old one stops working. Errors: not_owner.
create or replace function public.reset_league_pass_link(p_pass_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := replace(gen_random_uuid()::text, '-', '');
begin
  update public.league_passes set invite_code = code
   where id = p_pass_id and owner_id = auth.uid();
  if not found then
    raise exception 'not_owner';
  end if;
  return code;
end;
$$;

-- ------------------------------------------------------------ grants
revoke all on function public.league_pass_live(public.league_passes) from public, anon, authenticated;
revoke all on function public.refresh_plan(uuid) from public, anon, authenticated;
revoke all on function public.refresh_pass_plans(uuid) from public, anon, authenticated;
revoke all on function public.league_pass_invite(text) from public;
revoke all on function public.join_league_pass(text) from public, anon;
revoke all on function public.my_league_passes() from public, anon;
revoke all on function public.set_league_pass_member(uuid, uuid, boolean) from public, anon;
revoke all on function public.reset_league_pass_link(uuid) from public, anon;

grant execute on function public.refresh_plan(uuid) to service_role;
grant execute on function public.refresh_pass_plans(uuid) to service_role;
grant execute on function public.league_pass_invite(text) to anon, authenticated;
grant execute on function public.join_league_pass(text) to authenticated;
grant execute on function public.my_league_passes() to authenticated;
grant execute on function public.set_league_pass_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.reset_league_pass_link(uuid) to authenticated;
