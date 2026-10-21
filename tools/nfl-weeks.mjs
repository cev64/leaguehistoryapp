/* Each NFL regular-season week's first kickoff, from the NFL's public
   schedule (ESPN's public scoreboard), as SQL for public.nfl_weeks: the
   deadline pick'em locks at and the week's award voting runs on
   (supabase/migrations/20261021000000_league_clubhouse.sql). Without a row
   for a week, pick_deadline() falls back to a Thursday 8:15 PM Eastern
   formula, which misses a Wednesday opener, a game abroad and week 18's
   Saturday, so run this once a season when the schedule comes out (May):

     node tools/nfl-weeks.mjs 2027 > supabase/migrations/2027MMDD000000_nfl_weeks_2027.sql

   then paste the file into Supabase ▸ SQL editor. Safe to run again (an
   upsert); run it again if the NFL moves a week's first game (flexed games
   are Sundays and Mondays, so they rarely do).

   Week 18's times are set only near the end of the season (its games are
   all listed as a TBD Sunday until then, and two or three of them move to
   the Saturday). A week with a game whose time isn't set yet gets a safe
   stand-in, the Saturday before at 1:00 PM Eastern, marked in the SQL:
   run this again once the NFL sets the times (after week 17's games are
   scheduled, around the start of January) to get the real kickoff.

   Notes on stderr: any week whose first game isn't the formula's Thursday
   8:15 PM, so a surprise can be checked by eye. Exits non-zero if a week
   has no games or the scoreboard doesn't answer. Reads only; needs Node 18+. */

const season = Number(process.argv[2]);
if (!Number.isInteger(season) || season < 2000 || season > 2100) {
  console.error('usage: node tools/nfl-weeks.mjs <season>   (e.g. 2027)');
  process.exit(2);
}

const WEEKS = 18;
const url = (week) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;

async function firstKickoff(week) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url(week), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`the scoreboard answered ${res.status}`);
      const data = await res.json();
      if (data?.season?.year !== season || data?.season?.type !== 2 || data?.week?.number !== week) {
        throw new Error(`the scoreboard sent another week (${data?.season?.year} type ${data?.season?.type} week ${data?.week?.number})`);
      }
      const games = (data.events || [])
        .map((e) => ({
          at: new Date(e.date),
          name: e.shortName,
          where: e.competitions?.[0]?.venue?.address?.country,
          tbd: e.competitions?.[0]?.timeValid === false,
        }))
        .filter((g) => !Number.isNaN(g.at.getTime()))
        .sort((a, b) => a.at - b.at);
      if (!games.length) throw new Error(`week ${week} has no games`);
      const set = games.filter((g) => !g.tbd);
      const tbd = games.filter((g) => g.tbd);
      if (!tbd.length) return set[0];
      // The day before the first TBD game's date, 1:00 PM Eastern.
      const [y, m, d] = ymd.format(tbd[0].at).split('-').map(Number);
      const standIn = { at: easternTime(y, m, d - 1, 13, 0), name: `${tbd.length} games not yet scheduled`, tbd: true };
      return set.length && set[0].at < standIn.at ? set[0] : standIn;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// The same fallback as pick_deadline(): the Thursday after Labor Day plus
// a week a week, 8:15 PM Eastern (12:30 PM on Thanksgiving).
const clean = (s) => s.replace(/\s+/g, ' ');
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourIn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
// A wall-clock time in the Eastern time zone, as an instant (EDT or EST).
function easternTime(y, m, d, h, min) {
  for (const offset of [4, 5]) {
    const at = new Date(Date.UTC(y, m - 1, d, h + offset, min));
    if (Number(hourIn.format(at)) === h) return at;
  }
  throw new Error(`no such Eastern time: ${y}-${m}-${d} ${h}:${min}`);
}
const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
function formula(week) {
  const sep1 = new Date(Date.UTC(season, 8, 1));
  const laborDay = 1 + ((8 - (sep1.getUTCDay() || 7)) % 7);
  const thursday = new Date(Date.UTC(season, 8, laborDay + 3 + 7 * (week - 1), 12));
  const nov1 = new Date(Date.UTC(season, 10, 1));
  const thanksgiving = 1 + ((4 - (nov1.getUTCDay() || 7) + 7) % 7) + 21;
  const isThanksgiving = thursday.getUTCMonth() === 10 && thursday.getUTCDate() === thanksgiving;
  return clean(`${day.format(thursday)}, ${isThanksgiving ? '12:30 PM' : '8:15 PM'}`);
}

const rows = [];
let failed = false;
for (let week = 1; week <= WEEKS; week++) {
  try {
    const g = await firstKickoff(week);
    rows.push({ week, kickoff: g.at.toISOString(), tbd: g.tbd });
    const actual = clean(eastern.format(g.at));
    const expected = formula(week);
    if (g.tbd) {
      console.error(`week ${String(week).padStart(2)}: times not set yet; standing in ${actual} ET until they are (run this again then)`);
    } else if (actual !== expected) {
      console.error(`week ${String(week).padStart(2)}: ${actual} ET (${g.name}${g.where && g.where !== 'USA' ? `, ${g.where}` : ''}); the formula says ${expected}`);
    }
  } catch (err) {
    failed = true;
    console.error(`week ${week}: ${err.message}`);
  }
}
if (failed) process.exit(1);

const today = new Date().toISOString().slice(0, 10);
console.log(`-- The ${season} NFL regular season's first kickoff each week, from the NFL's
-- schedule (ESPN's public scoreboard) as of ${today}: what pick'em locks at
-- and award voting runs on (pick_deadline(), 20261021000000_league_clubhouse.sql).
-- Made by \`node tools/nfl-weeks.mjs ${season}\`; run it again if the NFL moves a
-- week's first game.
--
-- Paste into Supabase ▸ SQL editor after the clubhouse migration. Safe to
-- run again.

insert into public.nfl_weeks (season, week, kickoff) values
${rows.map((r, i) => `  (${season}, ${String(r.week).padStart(2)}, '${r.kickoff}')${i < rows.length - 1 ? ',' : ''}${r.tbd ? '  -- times not set yet: the Saturday before, 1 PM ET, until they are' : ''}`).join('\n')}
on conflict (season, week) do update set kickoff = excluded.kickoff;`);
