/* The clubhouse migration (supabase/migrations/20261021000000_league_clubhouse.sql),
   tested for real in an in-process Postgres (PGlite), with just enough of
   Supabase stubbed around it: the anon, authenticated and service_role
   roles with Supabase's default grants, auth.users, and auth.uid() reading
   the signed-in member from the request's JWT as PostgREST passes it.

   PGlite isn't a dependency of the site, so install it somewhere outside
   the repository and point the test at it:

     mkdir -p /tmp/pgtest && (cd /tmp/pgtest && npm init -y && npm i @electric-sql/pglite)
     PGLITE_DIR=/tmp/pgtest node supabase/tests/clubhouse.test.mjs

   Every member below acts as Supabase's `authenticated` role, so the table
   and function grants are tested as well as the functions. The clock is the
   real one: deadlines are put in nfl_weeks relative to now (seasons 2031 to
   2033, which nothing else uses). Exits non-zero if anything fails. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const dir = process.env.PGLITE_DIR;
if (!dir) {
  console.error('Set PGLITE_DIR to a folder where `npm i @electric-sql/pglite` was run (see the top of this file).');
  process.exit(2);
}
const entry = createRequire(path.join(path.resolve(dir), 'package.json')).resolve('@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(entry).href);

const db = new PGlite();
let passed = 0, failed = 0;
const ok = (cond, what) => {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL ${what}`); }
};
// Compared as JSON with object keys sorted (jsonb keeps its own key order).
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
const eq = (got, want, what) => {
  const g = canon(got), w = canon(want);
  ok(g === w, `${what}\n       got  ${g}\n       want ${w}`);
};
const section = (name) => console.log(`- ${name}`);

// ------------------------------------------------------------ Supabase, stubbed
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- What Supabase grants on everything new in public (the migration revokes).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
`);

const sql = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
await db.exec(sql('20261021000000_league_clubhouse.sql'));
section('the migration runs, and runs again');
await db.exec(sql('20261021000000_league_clubhouse.sql'));
ok(true, 'ran twice');

const U = {
  ann: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  cat: '00000000-0000-4000-8000-000000000003',
  dan: '00000000-0000-4000-8000-000000000004',
};
await db.exec(`insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(',')}`);

/* Run a statement as a member (Supabase's authenticated role with their id
   in the JWT), as anon (`who` null), or as the service role ('service').
   Answers the first column of the first row. */
async function as(who, text, params = []) {
  return db.transaction(async (tx) => {
    const role = who === 'service' ? 'service_role' : who ? 'authenticated' : 'anon';
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who && who !== 'service' ? who : '']);
    const res = await tx.query(text, params);
    const row = res.rows[0];
    return row ? Object.values(row)[0] : undefined;
  });
}
async function fails(promise, code, what) {
  try {
    await promise;
    ok(false, `${what}: expected ${code}, it worked`);
  } catch (err) {
    ok(String(err.message).includes(code), `${what}: expected ${code}, got "${err.message}"`);
  }
}
const owner = async (text, params = []) => (await db.query(text, params)).rows;
const iso = (d) => new Date(d).toISOString();

const LEAGUE = '1180000000000000001';
const claim = (who, ownerId, season = 2026, leagueId = '1180000000000000099', name = 'Lamb Chops League') =>
  as(who, 'select public.claim_manager($1, $2, $3, $4, $5, $6)', [LEAGUE, ownerId, 'sleeper', leagueId, season, name]);

// ------------------------------------------------------------ claims
section('claim, taken, move, release');
await fails(as(null, 'select public.league_claims($1)', [LEAGUE]), 'permission denied', 'anon may not ask who has claimed');
await fails(as(U.ann, 'select public.league_claims($1)', ['abc']), 'bad_league', 'a league key must be a league id');
await fails(db.transaction(async (tx) => { await tx.exec('set local role authenticated'); await tx.query('select public.league_claims($1)', [LEAGUE]); }),
  'not_signed_in', 'signed out');

let r = await claim(U.ann, 'ownerA');
eq(r.claimed, ['ownerA'], 'ann claims ownerA');
eq([r.mine.owner_id, r.mine.notify_recap, r.mine.notify_pickem, r.mine.notify_awards], ['ownerA', false, false, false], "ann's claim, notifications off until she turns them on");
ok(!('user_id' in r.mine), 'no account ids in a claim');
ok(!Object.keys(r.mine).some((k) => k.startsWith('seen_')), 'nor what her page saw');
await fails(claim(U.bob, 'ownerA'), 'taken', 'bob can\'t take ownerA');
await fails(claim(U.bob, 'open-1180000000000000099-4'), 'bad_manager', 'an open roster can\'t be claimed');
await fails(claim(U.bob, 'bad id!'), 'bad_manager', 'a manager id is checked');
r = await claim(U.bob, 'ownerB');
eq(r.claimed, ['ownerA', 'ownerB'], 'bob claims ownerB');
r = await claim(U.ann, 'ownerC');
eq([r.claimed, r.mine.owner_id], [['ownerB', 'ownerC'], 'ownerC'], 'ann moves to ownerC, ownerA is free again');
r = await claim(U.cat, 'ownerA');
eq(r.mine.owner_id, 'ownerA', 'cat claims ownerA');
eq((await as(U.dan, 'select public.league_claims($1)', [LEAGUE])).mine, null, 'dan, not a member, sees the claims and no mine');

await as(U.cat, 'select public.release_manager($1)', [LEAGUE]);
eq((await as(U.dan, 'select public.league_claims($1)', [LEAGUE])).claimed, ['ownerB', 'ownerC'], 'cat lets ownerA go');
await claim(U.cat, 'ownerA');

section('what a page saw stays on the member\'s own row');
const seen = async (who, key = LEAGUE) => (await owner(
  'select seen_league_id as id, seen_season as season, seen_name as name from public.league_members where league_key = $1 and user_id = $2', [key, who]))[0];
eq(await seen(U.cat), { id: '1180000000000000099', season: 2026, name: 'Lamb Chops League' }, "cat's page saw the league's newest id, season and name");
eq(await owner('select count(*)::int as n from public.clubhouse_leagues'), [{ n: 0 }], 'a claim writes nothing the sender trusts (clubhouse_leagues is the sender\'s)');
await claim(U.cat, 'ownerA', 2025, '1180000000000000050');
eq(await seen(U.cat), { id: '1180000000000000099', season: 2026, name: 'Lamb Chops League' }, 'an older season doesn\'t replace a newer one');
await claim(U.cat, 'ownerA', 2027, '1180000000000000100');
eq(await seen(U.cat), { id: '1180000000000000100', season: 2027, name: 'Lamb Chops League' }, 'next year\'s does');
await claim(U.cat, 'ownerA', 2100, '1180000000000000666');
await claim(U.cat, 'ownerA', 1999, '1180000000000000667');
eq((await seen(U.cat)).season, 2027, 'a season past next year (or before 2000) is ignored, so nobody can pin a league to 2100');
await claim(U.cat, 'ownerA', 2027, 'espn-12345');
eq((await seen(U.cat)).id, '1180000000000000100', 'a Sleeper league\'s id must be a Sleeper id');
await claim(U.cat, 'ownerA', 2027, '1180000000000000100', 'Bad\u202ename\n\u0007 here\u200b');
eq((await seen(U.cat)).name, 'Bad name here', 'a name loses its control, zero-width and direction characters');
await claim(U.cat, 'ownerA', 2027, '1180000000000000100', 'x'.repeat(300));
eq((await seen(U.cat)).name.length, 120, 'and stops at 120');
await claim(U.cat, 'ownerA', 2027, '1180000000000000100', 'Lamb Chops League');
const ESPN = 'espn-777';
const claimEspn = (leagueId, season = 2026) =>
  as(U.dan, 'select public.claim_manager($1, $2, $3, $4, $5, $6)', [ESPN, '{SWID-DAN}', 'espn', leagueId, season, 'Office League']);
await claimEspn('espn-778');
eq(await seen(U.dan, ESPN), { id: null, season: null, name: 'Office League' }, 'an ESPN league\'s id must be its key');
await claimEspn(ESPN);
eq(await seen(U.dan, ESPN), { id: ESPN, season: 2026, name: 'Office League' }, 'and then it\'s kept');
await as(U.dan, 'select public.release_manager($1)', [ESPN]);

section('notifications are opt-in');
await as(U.ann, 'select public.set_league_notifications($1, true, true, true)', [LEAGUE]);
r = await as(U.ann, 'select public.league_claims($1)', [LEAGUE]);
eq([r.mine.notify_recap, r.mine.notify_pickem, r.mine.notify_awards], [true, true, true], 'set_league_notifications turns them on');
await as(U.ann, 'select public.set_league_notifications($1, $2, null, null)', [LEAGUE, false]);
r = await as(U.ann, 'select public.league_claims($1)', [LEAGUE]);
eq([r.mine.notify_recap, r.mine.notify_pickem, r.mine.notify_awards], [false, true, true], 'ann turns off the recap only');
await claim(U.ann, 'ownerC');
r = await as(U.ann, 'select public.league_claims($1)', [LEAGUE]);
eq(r.mine.notify_recap, false, 'claiming her own manager again keeps her settings');
r = await claim(U.ann, 'ownerD');
eq([r.mine.owner_id, r.mine.notify_recap, r.mine.notify_pickem, r.mine.notify_awards], ['ownerD', false, true, true], 'moving to another manager keeps them too');
eq((await seen(U.ann)).id, '1180000000000000099', 'and what her page saw');
await claim(U.ann, 'ownerC');
await fails(as(U.dan, 'select public.set_league_notifications($1, true, true, true)', [LEAGUE]), 'not_a_member', 'dan has no notifications to set');
r = await as(U.ann, 'select public.my_clubhouses()');
eq(r.map((x) => [x.league_key, x.owner_id, x.name, x.notify_recap]), [[LEAGUE, 'ownerC', 'Lamb Chops League', false]], "ann's clubhouses (the name her page saw)");
await db.query(`insert into public.clubhouse_leagues (league_key, source, current_league_id, current_season, name, verified_at)
  values ($1, 'sleeper', '1180000000000000099', 2026, 'Lamb Chops (Sleeper)', now())`, [LEAGUE]);
eq((await as(U.ann, 'select public.my_clubhouses()'))[0].name, 'Lamb Chops (Sleeper)', 'once the sender has checked the league, Sleeper\'s name');
eq(await as(U.dan, 'select public.my_clubhouses()'), [], 'dan has none');

// ------------------------------------------------------------ the deadline
section('pick_deadline: the formula (no nfl_weeks rows yet)');
const deadline = async (season, week, who = null) => iso(await as(who, 'select public.pick_deadline($1, $2)', [season, week]));
eq(await deadline(2026, 1), '2026-09-11T00:15:00.000Z', '2026 week 1: Thu Sep 10, 8:15 PM EDT');
eq(await deadline(2026, 8), '2026-10-30T00:15:00.000Z', '2026 week 8: Thu Oct 29, 8:15 PM EDT (the last week before DST ends)');
eq(await deadline(2026, 9), '2026-11-06T01:15:00.000Z', '2026 week 9: Thu Nov 5, 8:15 PM EST (after DST ends Nov 1)');
eq(await deadline(2026, 12), '2026-11-26T17:30:00.000Z', '2026 week 12: Thanksgiving, Nov 26, 12:30 PM EST');
eq(await deadline(2027, 12), '2027-11-25T17:30:00.000Z', '2027 week 12: Thanksgiving, Nov 25, 12:30 PM EST');
eq(await deadline(2025, 1), '2025-09-05T00:15:00.000Z', '2025 week 1: Thu Sep 4 (Labor Day on Sep 1)');
eq(await deadline(2028, 1), '2028-09-08T00:15:00.000Z', '2028 week 1: Thu Sep 7 (Labor Day Sep 4)');

section('pick_deadline: the 2026 schedule (20261021000100_nfl_weeks_2026.sql)');
const formula2026 = {};
for (let w = 1; w <= 18; w++) formula2026[w] = await deadline(2026, w);
await db.exec(sql('20261021000100_nfl_weeks_2026.sql'));
await db.exec(sql('20261021000100_nfl_weeks_2026.sql'));
const seeded = await owner('select week, kickoff from public.nfl_weeks where season = 2026 order by week');
eq(seeded.length, 18, 'all 18 weeks');
eq(await deadline(2026, 1), '2026-09-10T00:20:00.000Z', '2026 week 1: the Wednesday opener, Sep 9, 8:20 PM EDT');
eq(await deadline(2026, 12), '2026-11-26T01:00:00.000Z', '2026 week 12: Thanksgiving eve, Nov 25, 8:00 PM EST');
const differ = seeded.filter((x) => iso(x.kickoff) !== formula2026[x.week]).map((x) => x.week);
eq(differ, [1, 12, 18], 'the schedule differs from the formula in weeks 1, 12 and 18 only');
for (const x of seeded) {
  const hours = (new Date(formula2026[x.week]) - new Date(x.kickoff)) / 36e5;
  if (x.week !== 18) ok(hours >= 0 && hours < 48, `week ${x.week}: the schedule is never after the formula's Thursday (${hours}h)`);
}
eq(await deadline(2026, 9, U.ann), '2026-11-06T01:15:00.000Z', 'a member can ask too');
await fails(as(null, `insert into public.nfl_weeks values (2040, 1, now())`), 'permission denied', 'anon can\'t write nfl_weeks');
await fails(as(U.ann, `delete from public.nfl_weeks`), 'permission denied', 'a member can\'t delete nfl_weeks');
await fails(as(U.ann, `truncate public.nfl_weeks`), 'permission denied', 'or truncate it');
eq(await as(null, 'select count(*)::int from public.nfl_weeks where season = 2026'), 18, 'anyone reads nfl_weeks');

// ------------------------------------------------------------ pick'em
// 2031: week 1 locked ten days ago, week 2 locks in three days, week 3 in ten.
await db.exec(`insert into public.nfl_weeks values
  (2031, 1, now() - interval '10 days'), (2031, 2, now() + interval '3 days'), (2031, 3, now() + interval '10 days'),
  (2032, 1, now() - interval '20 days'), (2032, 2, now() + interval '3 days'), (2032, 3, now() + interval '10 days'),
  (2033, 1, now() - interval '20 days'), (2033, 2, now() - interval '10 days'), (2033, 3, now() + interval '3 days')`);
const save = (who, week, picks, season = 2031) =>
  as(who, 'select public.save_picks($1, $2, $3, $4::jsonb)', [LEAGUE, season, week, JSON.stringify(picks)]);
const myPicks = async (who, season, week) =>
  (await owner('select game, winner, is_lock from public.pickem_picks where user_id = $1 and season = $2 and week = $3 order by game', [who, season, week]));

section('save_picks');
r = await save(U.ann, 2, [{ a: 'r1', b: 'r4', winner: 'r4', lock: true }, { a: 'r3', b: 'r2', winner: 'r3' }]);
eq(r.saved, 2, 'ann saves two picks');
eq(iso(r.locks_at), iso((await owner('select kickoff from public.nfl_weeks where season = 2031 and week = 2'))[0].kickoff), 'locks at week 2\'s kickoff');
eq(await myPicks(U.ann, 2031, 2), [{ game: 'r1|r4', winner: 'r4', is_lock: true }, { game: 'r2|r3', winner: 'r3', is_lock: false }], 'games named by their sorted teams');
await fails(save(U.ann, 2, [{ a: 'r1', b: 'r4', winner: 'r4', lock: true }, { a: 'r3', b: 'r2', winner: 'r3', lock: true }]), 'two_locks', 'two locks');
await fails(save(U.ann, 2, [{ a: 'r1', b: 'r4', winner: 'r9' }]), 'bad_picks', 'a winner not in the game');
await fails(save(U.ann, 2, [{ a: 'r1|r5', b: 'r4', winner: 'r4' }]), 'bad_picks', 'a team id with a "|"');
await fails(save(U.ann, 2, [{ a: 'r1', b: 'r4' }]), 'bad_picks', 'no winner');
await fails(save(U.ann, 2, [{ a: 'r1', b: 'r1', winner: 'r1' }]), 'bad_picks', 'a team playing itself');
await fails(save(U.ann, 2, [{ a: 'r1', b: 'r4', winner: 'r4', lock: 'yes' }]), 'bad_picks', 'a lock that isn\'t true or false');
await fails(save(U.ann, 2, [5]), 'bad_picks', 'a pick that isn\'t an object');
await fails(save(U.ann, 2, { a: 'r1' }), 'bad_picks', 'picks that aren\'t a list');
await fails(save(U.ann, 2, Array.from({ length: 21 }, (_, i) => ({ a: `t${i}`, b: `u${i}`, winner: `t${i}` }))), 'bad_picks', 'more than 20');
eq((await myPicks(U.ann, 2031, 2)).length, 2, 'a refused save leaves the saved picks as they were');
await fails(save(U.dan, 2, [{ a: 'r1', b: 'r4', winner: 'r4' }]), 'not_a_member', 'dan hasn\'t claimed a manager');
await fails(save(U.ann, 1, [{ a: 'r1', b: 'r4', winner: 'r4' }]), 'locked', 'week 1 has locked');
await fails(save(U.ann, 0, []), 'bad_week', 'week 0');
await fails(save(U.ann, 23, []), 'bad_week', 'week 23');
await fails(as(U.ann, 'select public.save_picks($1, 2031, 2, $2::jsonb)', ['nope', '[]']), 'bad_league', 'a bad league');
await fails(as(null, 'select public.save_picks($1, 2031, 2, $2::jsonb)', [LEAGUE, '[]']), 'permission denied', 'anon can\'t save');
r = await save(U.ann, 2, [{ a: 'r5', b: 'r6', winner: 'r5', lock: false }]);
eq([r.saved, await myPicks(U.ann, 2031, 2)], [1, [{ game: 'r5|r6', winner: 'r5', is_lock: false }]], 'saving again replaces the week\'s picks');
r = await save(U.ann, 2, [{ a: 'r5', b: 'r6', winner: 'r5', lock: true }, { a: 'r6', b: 'r5', winner: 'r6' }]);
eq([r.saved, await myPicks(U.ann, 2031, 2)], [1, [{ game: 'r5|r6', winner: 'r6', is_lock: false }]], 'the same game twice: the later pick stands');
r = await save(U.ann, 2, []);
eq([r.saved, (await myPicks(U.ann, 2031, 2)).length], [0, 0], 'an empty list takes them all back');
// Sorted as clubhouse.js sorts (JavaScript's <), whatever the collation.
const tricky = [['R2', 'r1'], ['r-1', 'r1'], ['a_b', 'a.b'], ['10', '9'], ['Zz', 'aa'], ['r10', 'r2']];
await save(U.ann, 3, tricky.map(([a, b]) => ({ a, b, winner: a })));
const gameKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
eq((await myPicks(U.ann, 2031, 3)).map((p) => p.game).sort(), tricky.map(([a, b]) => gameKey(a, b)).sort(), 'game keys match Clubhouse.gameKey()');
await save(U.ann, 3, []);

section('pickem_board: who sees what');
await save(U.ann, 2, [{ a: 'r1', b: 'r4', winner: 'r4', lock: true }, { a: 'r2', b: 'r3', winner: 'r3' }]);
await save(U.bob, 2, [{ a: 'r1', b: 'r4', winner: 'r1' }]);
await save(U.bob, 3, [{ a: 'r1', b: 'r2', winner: 'r1' }]);
let board = await as(U.ann, 'select public.pickem_board($1, 2031)', [LEAGUE]);
eq(board.me, 'ownerC', 'ann is ownerC');
eq(board.members.slice().sort(), ['ownerA', 'ownerB', 'ownerC'], 'the members');
eq(board.picks.map((p) => [p.owner, p.week, p.game, p.winner, p.lock]), [['ownerC', 2, 'r1|r4', 'r4', true], ['ownerC', 2, 'r2|r3', 'r3', false]],
  'before week 2 locks, ann sees only her own picks');
eq(board.picked, { 2: ['ownerB', 'ownerC'], 3: ['ownerB'] }, 'and who has picked the open weeks');
eq(Object.keys(board.deadlines).length, 18, 'deadlines for weeks 1 to 18');
eq(iso(board.deadlines['1']), iso((await owner('select kickoff from public.nfl_weeks where season = 2031 and week = 1'))[0].kickoff), 'week 1\'s deadline');
await db.exec(`update public.nfl_weeks set kickoff = now() - interval '1 hour' where season = 2031 and week = 2`);
board = await as(U.ann, 'select public.pickem_board($1, 2031)', [LEAGUE]);
eq(board.picks.map((p) => [p.owner, p.week, p.game, p.winner]),
  [['ownerB', 2, 'r1|r4', 'r1'], ['ownerC', 2, 'r1|r4', 'r4'], ['ownerC', 2, 'r2|r3', 'r3']], 'once week 2 locks, everyone\'s week 2 picks (not bob\'s week 3)');
eq(board.picked, { 3: ['ownerB'] }, 'week 2 is no longer listed as open');
await fails(save(U.bob, 2, []), 'locked', 'bob can\'t change week 2 now');
await fails(as(U.dan, 'select public.pickem_board($1, 2031)', [LEAGUE]), 'not_a_member', 'dan isn\'t a member');
await as(U.bob, 'select public.release_manager($1)', [LEAGUE]);
board = await as(U.ann, 'select public.pickem_board($1, 2031)', [LEAGUE]);
eq([board.picks.filter((p) => p.owner === 'ownerB').length, board.picked], [0, {}], 'a released member\'s picks leave the board');
await claim(U.bob, 'ownerB');
eq((await as(U.ann, 'select public.pickem_board($1, 2031)', [LEAGUE])).picks.length, 3, 'and come back when they claim again');

// ------------------------------------------------------------ awards
section('cast_vote and award_board');
const vote = (who, week, award, nominee, season = 2032) =>
  as(who, 'select public.cast_vote($1, $2, $3, $4, $5)', [LEAGUE, season, week, award, nominee]);
await vote(U.ann, 1, 'mvp', 'r3');
await vote(U.bob, 1, 'mvp', 'r3');
await vote(U.cat, 1, 'mvp', 'r5');
await vote(U.ann, 1, 'choke', 'r2');
await vote(U.ann, 1, 'robbery', 'r7');
await vote(U.ann, 1, 'robbery', 'r8');
let awards = await as(U.ann, 'select public.award_board($1, 2032)', [LEAGUE]);
eq(awards.mine, [{ week: 1, award: 'choke', nominee: 'r2' }, { week: 1, award: 'mvp', nominee: 'r3' }, { week: 1, award: 'robbery', nominee: 'r8' }],
  'ann\'s votes (a second vote replaces the first)');
eq(awards.voters, { 1: { mvp: 3, choke: 1, robbery: 1 } }, 'how many have voted, while voting is open');
eq(awards.results, [], 'no tallies until voting closes');
eq(Object.keys(awards.closes).length, 18, 'closes for weeks 1 to 18');
eq(iso(awards.closes['1']), iso((await owner('select kickoff from public.nfl_weeks where season = 2032 and week = 2'))[0].kickoff), 'week 1 closes at week 2\'s kickoff');
await vote(U.ann, 1, 'choke', null);
awards = await as(U.ann, 'select public.award_board($1, 2032)', [LEAGUE]);
eq([awards.mine.map((v) => v.award), awards.voters], [['mvp', 'robbery'], { 1: { mvp: 3, robbery: 1 } }], 'a null nominee takes the vote back');
await fails(vote(U.ann, 2, 'mvp', 'r3'), 'not_open', 'week 2 hasn\'t kicked off');
await fails(vote(U.ann, 1, 'mvp', 'r3', 2033), 'closed', '2033 week 1 closed at week 2\'s kickoff');
await fails(vote(U.ann, 1, 'mvp2', 'r3'), 'bad_award', 'no such award');
await fails(vote(U.ann, 1, 'mvp', 'r|3'), 'bad_nominee', 'a nominee is a team id');
await fails(vote(U.ann, 22, 'mvp', 'r3'), 'bad_week', 'week 22 has no next week');
await fails(vote(U.dan, 1, 'mvp', 'r3'), 'not_a_member', 'dan can\'t vote');
await fails(as(U.dan, 'select public.award_board($1, 2032)', [LEAGUE]), 'not_a_member', 'or see the board');
await fails(as(null, 'select public.cast_vote($1, 2032, 1, $2, $3)', [LEAGUE, 'mvp', 'r3']), 'permission denied', 'anon can\'t vote');
await db.exec(`update public.nfl_weeks set kickoff = now() - interval '1 minute' where season = 2032 and week = 2`);
awards = await as(U.bob, 'select public.award_board($1, 2032)', [LEAGUE]);
eq(awards.results, [{ week: 1, award: 'mvp', nominee: 'r3', votes: 2 }, { week: 1, award: 'mvp', nominee: 'r5', votes: 1 }, { week: 1, award: 'robbery', nominee: 'r8', votes: 1 }],
  'once week 2 kicks off: every nominee\'s tally');
eq(awards.voters, {}, 'and no running counts');
await fails(vote(U.bob, 1, 'mvp', 'r5'), 'closed', 'no more votes for week 1');
await fails(vote(U.bob, 1, 'mvp', null), 'closed', 'or taking one back');

// ------------------------------------------------------------ devices
section('register_push_device');
const WEB = 'https://fcm.googleapis.com/fcm/send/abcdefghijklmnop';
const register = (who, kind, token, p256dh = null, auth = null, env = null) =>
  as(who, 'select public.register_push_device($1, $2, $3, $4, $5)', [kind, token, p256dh, auth, env]);
await register(U.ann, 'web', WEB, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');
eq(await owner('select user_id, kind from public.push_devices where token = $1', [WEB]), [{ user_id: U.ann, kind: 'web' }], 'ann\'s browser');
await register(U.bob, 'web', WEB, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');
eq(await owner('select user_id from public.push_devices where token = $1', [WEB]), [{ user_id: U.bob }], 'the same browser signed in as bob becomes bob\'s');
const hex = (i) => i.toString(16).padStart(64, '0');
for (let i = 1; i <= 11; i++) await register(U.ann, 'apns', hex(i), null, null, i % 2 ? 'production' : 'sandbox');
const annDevices = (await owner('select token from public.push_devices where user_id = $1 order by token', [U.ann])).map((d) => d.token);
eq([annDevices.length, annDevices.includes(hex(1)), annDevices.includes(hex(11))], [10, false, true], 'at most 10 devices: the oldest goes');
await register(U.ann, 'apns', hex(2), null, null, 'production');
await register(U.ann, 'apns', hex(12), null, null, 'production');
const after = (await owner('select token from public.push_devices where user_id = $1', [U.ann])).map((d) => d.token);
eq([after.length, after.includes(hex(2)), after.includes(hex(3))], [10, true, false], 'seeing a device again keeps it: the one seen longest ago goes');
await fails(register(U.ann, 'sms', hex(20)), 'bad_device', 'an unknown kind');
await fails(register(U.ann, 'web', 'http://insecure.example/abcdefghijkl', 'k', 'a'), 'bad_device', 'a web endpoint that isn\'t https');
await fails(register(U.ann, 'web', WEB + 'x'), 'bad_device', 'a web subscription without its keys');
const P256 = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', AUTH = 'tBHItJI5svbpez7KI4CCXg';
for (const bad of [
  'https://evil.example/fcm/send/abcdefghijklmnop',
  'https://fcm.googleapis.com.evil.example/fcm/send/abcdefghijklmnop',
  'https://fcm.googleapis.com@evil.example/fcm/send/abcdefghijklmnop',
  'https://fcm.googleapis.com:8443/fcm/send/abcdefghijklmnop',
  'https://169.254.169.254/latest/meta-data/abcdef',
  'https://push.apple.com.evil.example/abcdefghijklmnop',
  'https://evilpush.apple.com/abcdefghijklmnop',
  'https://fcm.googleapis.com/fcm/send/abc def ghijklmnop',
]) await fails(register(U.ann, 'web', bad, P256, AUTH), 'bad_device', `not a browser's push service: ${bad}`);
for (const good of [
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABabcdefgh',
  'https://web.push.apple.com/QGuQyavXutnMH6Yo8EmBNO',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
]) {
  await register(U.cat, 'web', good, P256, AUTH);
  eq((await owner('select count(*)::int as n from public.push_devices where token = $1', [good]))[0].n, 1, `a browser's push service: ${new URL(good).host}`);
}
await db.query('update public.push_devices set failures = 3 where user_id = $1', [U.cat]);
await register(U.cat, 'web', 'https://web.push.apple.com/QGuQyavXutnMH6Yo8EmBNO', P256, AUTH);
eq((await owner('select failures from public.push_devices where token = $1', ['https://web.push.apple.com/QGuQyavXutnMH6Yo8EmBNO']))[0].failures, 0,
  'registering a device again clears its failures');
await db.query('delete from public.push_devices where user_id = $1', [U.cat]);
await fails(register(U.ann, 'apns', 'not-hex-not-hex-not-hex'), 'bad_device', 'an APNs token that isn\'t hex');
await fails(register(U.ann, 'apns', hex(21)), 'bad_device', 'an APNs token without its environment');
await fails(register(U.ann, 'apns', 'abc'), 'bad_device', 'a short token');
await fails(register(null, 'apns', hex(22), null, null, 'production'), 'permission denied', 'anon can\'t register');
await as(U.ann, 'select public.unregister_push_device($1)', [WEB]);
eq((await owner('select count(*)::int as n from public.push_devices where token = $1', [WEB]))[0].n, 1, 'ann can\'t unregister bob\'s browser');
await as(U.bob, 'select public.unregister_push_device($1)', [WEB]);
eq((await owner('select count(*)::int as n from public.push_devices where token = $1', [WEB]))[0].n, 0, 'bob can');

// ------------------------------------------------------------ grants
section('nothing is read or written directly');
for (const t of ['league_members', 'pickem_picks', 'award_votes', 'push_devices', 'push_sends', 'clubhouse_leagues']) {
  await fails(as(U.ann, `select * from public.${t}`), 'permission denied', `a member can't read ${t}`);
  await fails(as(null, `select * from public.${t}`), 'permission denied', `anon can't read ${t}`);
}
await fails(as(U.ann, `insert into public.pickem_picks (league_key, season, week, user_id, game, winner) values ($1, 2031, 3, $2, 'r1|r2', 'r1')`, [LEAGUE, U.ann]),
  'permission denied', 'a member can\'t write a pick directly');
await fails(as(U.ann, 'select public.clubhouse_owner($1, $2)', [LEAGUE, U.bob]), 'permission denied', 'clubhouse_owner() is internal');
await fails(as(null, 'select public.claim_manager($1, $2, $3, $4, $5, $6)', [LEAGUE, 'ownerD', 'sleeper', LEAGUE, 2031, null]), 'permission denied', 'anon can\'t claim');
eq(await as('service', 'select count(*)::int from public.league_members'), 3, 'the sender (service role) reads members');
await as('service', `insert into public.push_sends (user_id, league_key, kind, season, week) values ($1, $2, 'recap', 2031, 1)`, [U.ann, LEAGUE]);
await fails(as('service', `insert into public.push_sends (user_id, league_key, kind, season, week) values ($1, $2, 'recap', 2031, 1)`, [U.ann, LEAGUE]),
  'duplicate key', 'a notification is recorded once');
eq(await as('service', `select count(*)::int from public.pickem_picks where user_id = $1`, [U.ann]), 2, 'and reads picks');

// ------------------------------------------------------------ deleting an account
section('deleting an account takes its clubhouse rows');
const count = async (who) => {
  const out = {};
  for (const t of ['league_members', 'pickem_picks', 'award_votes', 'push_devices', 'push_sends']) {
    out[t] = (await owner(`select count(*)::int as n from public.${t} where user_id = $1`, [who]))[0].n;
  }
  return out;
};
const before = await count(U.ann);
ok(Object.values(before).every((n) => n > 0), `ann has rows everywhere before: ${JSON.stringify(before)}`);
await db.query('delete from auth.users where id = $1', [U.ann]);
eq(await count(U.ann), { league_members: 0, pickem_picks: 0, award_votes: 0, push_devices: 0, push_sends: 0 }, 'none after');
eq((await count(U.bob)).league_members, 1, 'bob\'s are left alone');
eq((await as(U.bob, 'select public.league_claims($1)', [LEAGUE])).claimed.includes('ownerC'), false, 'ann\'s manager is free to claim');

section('running the migration again keeps everything');
const snapshot = async () => (await owner(`select
  (select count(*) from public.league_members)::int as m, (select count(*) from public.pickem_picks)::int as p,
  (select count(*) from public.award_votes)::int as v, (select count(*) from public.nfl_weeks)::int as w`))[0];
const was = await snapshot();
await db.exec(sql('20261021000000_league_clubhouse.sql'));
eq(await snapshot(), was, 'the same rows');
await fails(as(U.bob, 'select * from public.league_members'), 'permission denied', 'and the same grants');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
