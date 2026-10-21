// What the clubhouse's notifications say, to whom, and when (index.ts calls
// run() every hour). Plain TypeScript over fetch and Web Crypto, no Deno
// APIs, so supabase/tests/clubhouse-push.test.mjs can run it in Node.
//
// When: everything runs on the NFL's weeks, K(w) = pick_deadline(season, w),
// the week's first kickoff (supabase/migrations/20261021000000_league_clubhouse.sql).
// The current week c is the last one (of 18) that has kicked off.
//   recap   week c, from the Tuesday after its kickoff, 9 AM Eastern, until
//           the next week's kickoff: "Week 9 is final".
//   pickem  week c + 1, from 4½ hours before its kickoff until 15 minutes
//           before: "Picks lock at 8:15 PM ET", to members with no picks,
//           when the week has games to pick (below).
//   awards  week w, whose voting closed at K(w + 1), in the 12 hours after:
//           "Week 9's awards are in", when anyone voted. Week 18's closes
//           at K(19), the formula's Thursday after it (cast_vote's close).
// The season is Sleeper's (/v1/state/nfl); its week isn't used, because
// Sleeper moves on to the next week on Tuesday, before that week's games.
//
// Who: league_members who turned that notification on (notify_*, off
// until they do) and have a device (push_devices). Each notification is
// recorded in push_sends (one per member, league, kind and week) before it
// goes, and a member already recorded is skipped, so a run can be repeated
// and two runs can't both send: at most once, even if a send then fails.
//
// Trust: nothing a member's page sent reaches anyone else's notification.
//   - A Sleeper league's id this season is the one the sender has checked
//     (clubhouse_leagues, verified_at), or else one the members' pages saw
//     (league_members.seen_league_id), used only once Sleeper says it's
//     this season's and its previous_league_id chain leads back to the
//     league's key; then it's kept in clubhouse_leagues. The name is
//     Sleeper's, and a claim whose manager isn't one of the league's
//     owners gets nothing.
//   - An ESPN league's private data stays in the members' browsers: its
//     notifications are plain lines, under the name the member's own page
//     saw (seen_name), or "Your ESPN league".
//   - Every name in a notification loses its control and direction
//     characters and is cut to length (safeText).
//
// ESPN leagues and pick'em: the sender can't read an ESPN league's schedule,
// so it can't tell a week that starts a two-week matchup from one that
// continues it. Through week 14 it reminds as for a one-week matchup;
// after that, only when someone in the league has already picked that week
// (the pages offer no picks for a continuing week, so a pick shows there
// are games). A league with two-week matchups before week 15 can get a
// reminder for a week with nothing to pick.

export type Kind = "recap" | "pickem" | "awards";
export const KINDS: Kind[] = ["recap", "pickem", "awards"];

export type Env = {
  SUPABASE_URL: string;
  SERVICE_KEY: string;
  SITE_URL?: string;
  // Web Push and APNs are each optional: a device whose kind isn't set up
  // is skipped (and counted in the report).
  webPush?: (device: Device, payload: unknown, opts: { ttl: number; urgency: "normal" | "high"; topic: string }) => Promise<Sent>;
  apns?: (device: Device, payload: unknown, opts: { expires: Date; collapseId: string; priority: 5 | 10 }) => Promise<Sent>;
};
export type Sent = { ok: boolean; status: number; gone: boolean; reason?: string; env?: "sandbox" | "production" };
export type Device = {
  id: number; user_id: string; kind: "web" | "apns"; token: string; p256dh: string; auth: string;
  apns_env: string | null; failures?: number; removed?: boolean; failedThisRun?: boolean;
};
type Member = { league_key: string; owner_id: string; user_id: string; seen_name?: string | null };
type LeagueRow = {
  league_key: string; source: "sleeper" | "espn"; current_league_id: string; current_season: number;
  name: string | null; verified_at: string | null;
};
type Seen = { league_key: string; seen_league_id: string | null; seen_season: number | null };
// A league as this run sends for it: its id this season (checked, for
// Sleeper), Sleeper's name for it and its managers.
type League = {
  key: string; source: "sleeper" | "espn"; id: string;
  name: string | null; sleeper: Sleeper | null; owners: Set<string> | null;
};
type Message = { title: string; body: string };
export type Note = {
  kind: Kind; user_id: string; league_key: string; season: number; week: number;
  title: string; body: string; url: string;
  link: { league: string; season: number; week: number; view: "recap" | "results" };
};

const SLEEPER = "https://api.sleeper.app/v1";
const HOUR = 3600 * 1000;
const PAGE = 1000;            // rows a read asks for at a time (PostgREST's usual most)
const SENDING = 8;            // members sent to at once
const MAX_FAILURES = 5;       // failed sends in a row before a device is forgotten
const MAX_HOPS = 40;          // seasons followed back through previous_league_id
const MAX_CANDIDATES = 5;     // ids the members' pages saw, tried a league a run

// ------------------------------------------------------------ text, made safe
// Control, zero-width and direction-changing characters (a name could
// otherwise break a line or turn the rest of the notification around).
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
/* A name or line as a notification shows it: unsafe characters out, runs
   of space as one, at most `max` characters (an ellipsis when cut). */
export function safeText(text: unknown, max: number): string {
  const s = String(text ?? "").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
const TITLE = 60, BODY = 200, TEAM = 40;

// ------------------------------------------------------------ time, in Eastern
const TZ = "America/New_York";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", hourCycle: "h23",
});
function eastern(at: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), dow, h: Number(p.hour) % 24 };
}
// A wall-clock time in Eastern, as an instant (EDT or EST); days past the
// month's end roll over.
export function easternTime(y: number, m: number, d: number, h: number, min = 0): Date {
  for (const offset of [4, 5]) {
    const at = new Date(Date.UTC(y, m - 1, d, h + offset, min));
    if (eastern(at).h === h) return at;
  }
  return new Date(Date.UTC(y, m - 1, d, h + 5, min));
}
// The Tuesday after a week's kickoff, 9 AM Eastern: the week's games are
// over (Monday night) and the scores are in.
export function recapTime(kickoff: Date): Date {
  const k = eastern(kickoff);
  const days = ((2 - k.dow + 7) % 7) || 7;
  return easternTime(k.y, k.m, k.d + days, 9);
}
const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export const clock = (at: Date) => `${clean(clockFmt.format(at))} ET`;
// The NFL season a date is in: September to February.
const seasonOf = (at: Date) => { const e = eastern(at); return e.m >= 3 ? e.y : e.y - 1; };

// ------------------------------------------------------------ reading
async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${url.replace(/\?.*/, "")} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// The database as the service role, through PostgREST.
function database(env: Env) {
  const base = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
  const headers = { apikey: env.SERVICE_KEY, Authorization: `Bearer ${env.SERVICE_KEY}`, "Content-Type": "application/json" };
  return {
    /* Every row a read matches, a page at a time (PostgREST answers at most
       its max-rows, 1000 on Supabase, to one request), until a page comes
       back empty. The path has its own order=, so the pages don't overlap. */
    all: async (path: string): Promise<any[]> => {
      const out: any[] = [];
      for (;;) {
        const rows = await getJson(`${base}/${path}&limit=${PAGE}&offset=${out.length}`, { headers });
        if (!Array.isArray(rows) || !rows.length) return out;
        out.push(...rows);
      }
    },
    rpc: (fn: string, args: unknown) => getJson(`${base}/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) }),
    // A row, unless one with the same key is there already: answers whether
    // this call put it there.
    claim: async (table: string, onConflict: string, row: unknown) => {
      const rows = await getJson(`${base}/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(row),
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    // A row, replacing the one with the same key.
    upsert: (table: string, onConflict: string, row: unknown) => getJson(`${base}/${table}?on_conflict=${onConflict}`, {
      method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row),
    }),
    patch: (path: string, change: unknown) => getJson(`${base}/${path}`, {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(change),
    }),
    remove: (path: string) => getJson(`${base}/${path}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }),
  };
}
type Db = ReturnType<typeof database>;
const list = (values: (string | number)[]) => `(${values.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",")})`;
async function inChunks<T>(values: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 80) out.push(...await read(values.slice(i, i + 80)));
  return out;
}
// At most `size` at once.
async function inTurn<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

// A Sleeper league's season, read once a run.
function sleeperLeague(id: string, cache: Map<string, Promise<any>>) {
  const read = (path: string) => {
    const url = `${SLEEPER}/league/${id}${path}`;
    if (!cache.has(url)) cache.set(url, getJson(url));
    return cache.get(url)!;
  };
  return {
    id,
    league: () => read(""),
    rosters: () => read("/rosters").then((r: any) => (Array.isArray(r) ? r : [])) as Promise<any[]>,
    users: () => read("/users").then((u: any) => (Array.isArray(u) ? u : [])) as Promise<any[]>,
    matchups: (week: number) => read(`/matchups/${week}`).then((m: any) => (Array.isArray(m) ? m : [])) as Promise<any[]>,
  };
}
type Sleeper = ReturnType<typeof sleeperLeague>;

/* Whether a Sleeper league id is one of the seasons of the league named by
   `key`: following previous_league_id back from it on Sleeper reaches the
   key (each renewal points at the season before; a member's page can't
   change that). At most MAX_HOPS seasons back; once a run per id. */
function leadsBack(id: string, key: string, cache: Map<string, Promise<any>>, checked: Map<string, Promise<boolean>>) {
  const k = `${id}>${key}`;
  if (!checked.has(k)) {
    checked.set(k, (async () => {
      let at = id;
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (at === key) return true;
        const league = await sleeperLeague(at, cache).league().catch(() => null);
        const prev = String(league?.previous_league_id ?? "");
        if (!/^[0-9]{6,24}$/.test(prev) || prev === at) return false;
        at = prev;
      }
      return false;
    })());
  }
  return checked.get(k)!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// As sleeper.js and clubhouse.js: a commissioner's correction wins, two
// decimals, trailing zeros dropped.
const pointsOf = (m: any) => round2(Number(m.custom_points != null ? m.custom_points : m.points) || 0);
const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, "");

// Each roster's team name and manager, as the site names them.
async function teamsOf(s: Sleeper) {
  const [rosters, users] = await Promise.all([s.rosters(), s.users()]);
  const byUser = new Map(users.map((u: any) => [u.user_id, u]));
  return new Map(rosters.map((r: any) => {
    const u: any = r.owner_id ? byUser.get(r.owner_id) : null;
    const name = safeText(u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`, TEAM) || `Team ${r.roster_id}`;
    const owners = [r.owner_id, ...(r.co_owners || [])].filter(Boolean).map(String);
    return [Number(r.roster_id), { name, owners }];
  }));
}
const rosterOf = (teams: Map<number, { owners: string[] }>, owner: string) =>
  [...teams.entries()].find(([, t]) => t.owners.includes(owner))?.[0] ?? null;

/* A week's games: the rosters paired by matchup id, and, in a league that
   also plays the week's median (league_average_match), each roster's
   result against it the way Sleeper counts it (the top half of the week's
   scores win, the bottom half lose, and an even league's two middle scores
   tie when they're level). */
async function weekOf(s: Sleeper, week: number, median: boolean) {
  const entries = await s.matchups(week);
  const groups = new Map<number, any[]>();
  for (const m of entries) {
    if (m.matchup_id == null) continue;
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id)!.push(m);
  }
  const games = [...groups.values()].filter((g) => g.length === 2)
    .map(([a, b]) => ({ a: Number(a.roster_id), as: pointsOf(a), b: Number(b.roster_id), bs: pointsOf(b) }));
  const scored = entries.some((m) => pointsOf(m) > 0);
  const vsMedian = new Map<number, "W" | "L" | "T">();
  if (median && scored) {
    const all = entries.map((m) => ({ id: Number(m.roster_id), pts: pointsOf(m) })).sort((x, y) => y.pts - x.pts);
    const half = Math.floor(all.length / 2);
    const cut = all.length % 2 ? null : (all[half - 1].pts + all[half].pts) / 2;
    all.forEach((t, i) => vsMedian.set(t.id, cut != null && t.pts === cut ? "T" : i < half ? "W" : "L"));
  }
  return { games, scored, vsMedian };
}

// ------------------------------------------------------------ which league
type Lookup = {
  db: Db; season: number; dry: boolean; now: Date; cache: Map<string, Promise<any>>;
  checked: Map<string, Promise<boolean>>; found: Map<string, Promise<League | string>>;
};

/* The league a key names, as this run sends for it, or why not (a string
   for the report). Once a run per key. */
function leagueFor(key: string, row: LeagueRow | undefined, seen: Seen[], ctx: Lookup): Promise<League | string> {
  if (!ctx.found.has(key)) ctx.found.set(key, findLeague(key, row, seen, ctx).catch((err) => `couldn't read it: ${err instanceof Error ? err.message : err}`));
  return ctx.found.get(key)!;
}

async function findLeague(key: string, row: LeagueRow | undefined, seen: Seen[], ctx: Lookup): Promise<League | string> {
  const mine = seen.filter((x) => x.league_key === key);
  if (/^espn-/.test(key)) {
    // Its id is its key; it's playing this season if a member's page has
    // seen this season (or a later one) of it.
    if (!mine.some((x) => (x.seen_season ?? 0) >= ctx.season)) return "not opened this season";
    return { key, source: "espn", id: key, name: null, sleeper: null, owners: null };
  }
  // The id checked before (a season's id never changes), then the ids the
  // members' pages saw this season, the one most of them saw first.
  const checkedBefore = row?.verified_at && row.source === "sleeper" && row.current_season === ctx.season ? row.current_league_id : null;
  const votes = new Map<string, number>();
  for (const x of mine) {
    if (x.seen_season === ctx.season && x.seen_league_id && /^[0-9]{6,24}$/.test(x.seen_league_id)) {
      votes.set(x.seen_league_id, (votes.get(x.seen_league_id) ?? 0) + 1);
    }
  }
  const candidates = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id)
    .filter((id) => id !== checkedBefore).slice(0, MAX_CANDIDATES);
  if (checkedBefore) candidates.unshift(checkedBefore);
  if (!candidates.length) return "not opened this season";

  for (const id of candidates) {
    const sleeper = sleeperLeague(id, ctx.cache);
    const league = await sleeper.league().catch(() => null);
    if (!league || String(league.season) !== String(ctx.season)) continue;
    if (id !== checkedBefore && !await leadsBack(id, key, ctx.cache, ctx.checked)) continue;
    const teams = await teamsOf(sleeper);
    const users = await sleeper.users();
    const owners = new Set<string>([...[...teams.values()].flatMap((t) => t.owners), ...users.map((u: any) => String(u.user_id))]);
    const name = safeText(league.name, 120) || null;
    if (!ctx.dry && (id !== checkedBefore || name !== row?.name)) {
      await ctx.db.upsert("clubhouse_leagues", "league_key", {
        league_key: key, source: "sleeper", current_league_id: id, current_season: ctx.season, name,
        verified_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString(),
      });
    }
    return { key, source: "sleeper", id, name, sleeper, owners };
  }
  return `no ${ctx.season} league on Sleeper that leads back to it`;
}

// ------------------------------------------------------------ what each says
const AWARDS: Record<string, string> = { mvp: "Manager of the Week", choke: "Choke of the Week", robbery: "Robbery of the Week" };
const record = (w: number, l: number, t: number) => `${w}–${l}${t ? `–${t}` : ""}`;
const and = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/* The recap line for each member of a Sleeper league: their game and, in
   the regular season, their record (from every week's matchups since the
   league's start week, the median games counted as Sleeper counts them).
   Null when the week has no scored games (the league's season is over, or
   hasn't begun): no recap then. */
async function sleeperRecap(s: Sleeper, week: number, members: Member[], leagueName: string) {
  const league = await s.league();
  const settings = league?.settings || {};
  const playoffs = Number(settings.playoff_week_start) || 0;
  const start = Number(settings.start_week) || 1;
  const median = Number(settings.league_average_match) === 1;
  if (week < start) return null;
  const thisWeek = await weekOf(s, week, median && (!playoffs || week < playoffs));
  if (!thisWeek.scored || !thisWeek.games.length) return null;
  const teams = await teamsOf(s);
  const regular = !playoffs || week < playoffs;
  const tally = new Map<number, [number, number, number]>();
  if (regular) {
    for (let w = start; w <= week; w++) {
      const { games, vsMedian } = w === week ? thisWeek : await weekOf(s, w, median);
      const add = (id: number, r: 0 | 1 | 2) => { const t = tally.get(id) ?? [0, 0, 0]; t[r]++; tally.set(id, t); };
      for (const g of games) {
        if (!(g.as > 0 || g.bs > 0)) continue;
        add(g.a, g.as > g.bs ? 0 : g.as < g.bs ? 1 : 2);
        add(g.b, g.bs > g.as ? 0 : g.bs < g.as ? 1 : 2);
      }
      vsMedian.forEach((r, id) => add(id, r === "W" ? 0 : r === "L" ? 1 : 2));
    }
  }
  const generic = { title: leagueName, body: `Week ${week} is final. See the recap and vote on the week's awards.` };
  const out = new Map<string, Message>();
  for (const m of members) {
    const mine = rosterOf(teams, m.owner_id);
    const game = mine == null ? null : thisWeek.games.find((g) => g.a === mine || g.b === mine);
    if (mine == null || !game) { out.set(m.user_id, generic); continue; }
    const [me, them, theirs] = game.a === mine ? [game.as, game.bs, game.b] : [game.bs, game.as, game.a];
    const opp = teams.get(theirs)?.name ?? "your opponent";
    const t = tally.get(mine);
    const rec = regular && t ? record(...t) : null;
    let line: string;
    if (me > them) line = `You beat ${opp} ${fmt(me)}–${fmt(them)}${rec ? ` and you're ${rec}` : ""}.`;
    else if (me < them) line = `${opp} got you ${fmt(them)}–${fmt(me)}.${rec ? ` You're ${rec}.` : ""}`;
    else line = `You and ${opp} tied ${fmt(me)}–${fmt(them)}.${rec ? ` You're ${rec}.` : ""}`;
    out.set(m.user_id, { title: leagueName, body: `Week ${week} is final. ${line}` });
  }
  return out;
}

// The week's award winners (most votes; a tie shares it), in award order.
function winners(votes: { award: string; nominee: string }[]) {
  const out: { award: string; teams: string[] }[] = [];
  for (const award of Object.keys(AWARDS)) {
    const n = new Map<string, number>();
    votes.filter((v) => v.award === award).forEach((v) => n.set(v.nominee, (n.get(v.nominee) ?? 0) + 1));
    if (!n.size) continue;
    const top = Math.max(...n.values());
    out.push({ award, teams: [...n.entries()].filter(([, c]) => c === top).map(([t]) => t).sort() });
  }
  return out;
}

// ------------------------------------------------------------ the run
export type Options = { now?: Date; only?: Kind | null; dry?: boolean; league?: string | null };
export type Report = {
  now: string; season: number; week: number;
  due: { kind: Kind; week: number }[];
  notes: (Note & { devices: number })[];
  sent: number; failed: number; removed: number; already: number; unsupported: number;
  skipped: string[];
};

export async function run(opts: Options, env: Env): Promise<Report> {
  const now = opts.now ?? new Date();
  const db = database(env);
  const site = (env.SITE_URL || "https://pigskinpantheon.com").replace(/\/+$/, "");
  const sleeperCache = new Map<string, Promise<any>>();

  // The season: Sleeper's, unless the run is pretending it's another time.
  let season = seasonOf(now);
  if (!opts.now) {
    try {
      const state = await getJson(`${SLEEPER}/state/nfl`);
      if (/^\d{4}$/.test(String(state?.season))) season = Number(state.season);
    } catch { /* the calendar's season */ }
  }
  const K: Date[] = [];
  await Promise.all(Array.from({ length: 19 }, (_, i) => i + 1).map(async (w) => {
    K[w] = new Date(await db.rpc("pick_deadline", { p_season: season, p_week: w }));
  }));
  let c = 0;
  for (let w = 1; w <= 18; w++) if (K[w] <= now) c = w;

  const due: { kind: Kind; week: number }[] = [];
  if (c >= 1 && now >= recapTime(K[c]) && now < K[c + 1]) due.push({ kind: "recap", week: c });
  if (c + 1 <= 18 && now.getTime() >= K[c + 1].getTime() - 4.5 * HOUR && now.getTime() < K[c + 1].getTime() - HOUR / 4) {
    due.push({ kind: "pickem", week: c + 1 });
  }
  for (let w = 1; w <= 18; w++) {
    if (now >= K[w + 1] && now.getTime() < K[w + 1].getTime() + 12 * HOUR) due.push({ kind: "awards", week: w });
  }

  const report: Report = {
    now: now.toISOString(), season, week: c, due: due.filter((d) => !opts.only || d.kind === opts.only),
    notes: [], sent: 0, failed: 0, removed: 0, already: 0, unsupported: 0, skipped: [],
  };
  const lookup: Lookup = { db, season, dry: !!opts.dry, now, cache: sleeperCache, checked: new Map(), found: new Map() };
  const leagueRows = new Map<string, LeagueRow | undefined>();
  const seenRows = new Map<string, Seen[]>();
  const devicesById = new Map<number, Device>();

  for (const job of report.due) {
    const { kind, week } = job;
    // Who wants it and has somewhere to get it.
    let members: Member[] = await db.all(
      `league_members?select=league_key,owner_id,user_id,seen_name&notify_${kind}=eq.true` +
      `${opts.league ? `&league_key=eq.${encodeURIComponent(opts.league)}` : ""}&order=league_key,owner_id`);
    if (!members.length) continue;
    const devices: Device[] = (await inChunks([...new Set(members.map((m) => m.user_id))], (ids) =>
      db.all(`push_devices?select=id,user_id,kind,token,p256dh,auth,apns_env,failures&user_id=in.${list(ids)}&order=id`)))
      // One object a device for the whole run, so its failures add up.
      .map((d: Device) => { if (!devicesById.has(d.id)) devicesById.set(d.id, d); return devicesById.get(d.id)!; })
      .filter((d) => !d.removed);
    // Only devices this run can reach (a dry run counts them all), so a
    // member isn't recorded as sent to while their kind isn't set up yet.
    const reachable = (d: Device) => opts.dry || (d.kind === "web" ? !!env.webPush : !!env.apns);
    report.unsupported += devices.filter((d) => !reachable(d)).length;
    const byUser = new Map<string, Device[]>();
    devices.filter(reachable).forEach((d) => byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]));
    members = members.filter((m) => byUser.has(m.user_id));
    if (!members.length) continue;
    const sent: { user_id: string; league_key: string }[] = await db.all(
      `push_sends?select=user_id,league_key&kind=eq.${kind}&season=eq.${season}&week=eq.${week}&order=user_id,league_key`);
    const done = new Set(sent.map((x) => `${x.user_id}|${x.league_key}`));
    report.already += members.filter((m) => done.has(`${m.user_id}|${m.league_key}`)).length;
    members = members.filter((m) => !done.has(`${m.user_id}|${m.league_key}`));
    if (!members.length) continue;

    // What's known of each league: the sender's checked row, and what the
    // members' pages have seen of it this season or later.
    const keys = [...new Set(members.map((m) => m.league_key))];
    const unread = keys.filter((k) => !leagueRows.has(k));
    if (unread.length) {
      const rows: LeagueRow[] = await inChunks(unread, (k) =>
        db.all(`clubhouse_leagues?select=league_key,source,current_league_id,current_season,name,verified_at&league_key=in.${list(k)}&order=league_key`));
      unread.forEach((k) => leagueRows.set(k, rows.find((r) => r.league_key === k)));
      const seen: Seen[] = await inChunks(unread, (k) =>
        db.all(`league_members?select=league_key,seen_league_id,seen_season&league_key=in.${list(k)}&seen_season=gte.${season}&order=league_key,owner_id`));
      unread.forEach((k) => seenRows.set(k, seen.filter((x) => x.league_key === k)));
    }

    for (const key of keys) {
      let here = members.filter((m) => m.league_key === key);
      const league = await leagueFor(key, leagueRows.get(key), seenRows.get(key) ?? [], lookup);
      if (typeof league === "string") { report.skipped.push(`${kind} ${key}: ${league}`); continue; }
      if (league.owners) {
        // A claim on a manager who isn't one of the league's gets nothing.
        const strangers = here.filter((m) => !league.owners!.has(m.owner_id)).length;
        if (strangers) report.skipped.push(`${kind} ${key}: ${strangers} claim${strangers === 1 ? "" : "s"} on no manager of the league`);
        here = here.filter((m) => league.owners!.has(m.owner_id));
        if (!here.length) continue;
      }
      let messages: Map<string, Message> | null = null;
      try {
        messages = await compose(kind, week, league, here, { db, season, deadline: K[week] });
      } catch (err) {
        report.skipped.push(`${kind} ${key}: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      if (!messages) { report.skipped.push(`${kind} ${key}: nothing to say`); continue; }
      const view = kind === "pickem" ? "results" : "recap";
      const link = { league: league.id, season, week, view } as Note["link"];
      const url = `${site}/season.html?league=${encodeURIComponent(league.id)}&season=${season}#w${week}-panel-${view}`;
      const topic = `${kind}${week}-${await shortHash(key)}`;
      await inTurn(here, SENDING, async (m) => {
        const msg = messages!.get(m.user_id);
        if (!msg) return;
        const note: Note = {
          kind, user_id: m.user_id, league_key: key, season, week,
          title: safeText(msg.title, TITLE) || "Pigskin Pantheon", body: safeText(msg.body, BODY), url, link,
        };
        const targets = (byUser.get(m.user_id) ?? []).filter((d) => !d.removed);
        if (opts.dry) { report.notes.push({ ...note, devices: targets.length }); return; }
        if (!await db.claim("push_sends", "user_id,league_key,kind,season,week", { user_id: m.user_id, league_key: key, kind, season, week })) {
          report.already++;
          return;
        }
        report.notes.push({ ...note, devices: targets.length });
        await deliver(note, topic, targets, env, db, report, kind === "pickem" ? K[week] : new Date(now.getTime() + 24 * HOUR), now);
      });
    }
  }
  return report;
}

// A league key, as a few URL-safe characters (a Web Push Topic is at most
// 32 of them): "recap9-" plus this keeps one league's from replacing
// another's.
async function shortHash(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let s = "";
  for (const b of digest.slice(0, 6)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Context = { db: Db; season: number; deadline: Date };

// Each member's message for a league, or null when there's nothing to say.
async function compose(kind: Kind, week: number, league: League, members: Member[], ctx: Context): Promise<Map<string, Message> | null> {
  const sleeper = league.sleeper;
  // A Sleeper league's name is Sleeper's; an ESPN member's is what their
  // own page saw (no one else's word reaches them).
  const titleOf = (m: Member) => (sleeper ? league.name : safeText(m.seen_name, TITLE)) || (sleeper ? "Your league" : "Your ESPN league");
  const inName = sleeper && league.name ? ` in ${safeText(league.name, TITLE)}` : "";
  const everyone = (body: string, who = members) => new Map(who.map((m) => [m.user_id, { title: titleOf(m), body }]));

  if (kind === "recap") {
    // ESPN's private leagues need the member's keys, which stay in their
    // browser: a plain line, and only in weeks an ESPN season can have.
    if (!sleeper) return week <= 17 ? everyone(`Week ${week} is final. See the recap and vote on the week's awards.`) : null;
    return sleeperRecap(sleeper, week, members, titleOf(members[0]));
  }

  if (kind === "pickem") {
    // Pick'em is the regular season's games (the league's schedule).
    const picks: { user_id: string; week: number }[] = await ctx.db.all(
      `pickem_picks?select=user_id,week&league_key=eq.${encodeURIComponent(league.key)}&season=eq.${ctx.season}&week=eq.${week}&order=user_id,game`);
    if (sleeper) {
      const settings = (await sleeper.league())?.settings || {};
      const playoffs = Number(settings.playoff_week_start) || 0;
      if (week < (Number(settings.start_week) || 1) || (playoffs && week >= playoffs)) return null;
      // Nothing to pick in a week without matchups.
      if (!(await weekOf(sleeper, week, false)).games.length) return null;
    } else if (week > 17 || (week > 14 && !picks.length)) {
      // An ESPN league's schedule is unknown here (the header): past week
      // 14, only when someone has picked this week, which shows it has games.
      return null;
    }
    const picked = new Set(picks.map((p) => p.user_id));
    const left = members.filter((m) => !picked.has(m.user_id));
    if (!left.length) return null;
    return everyone(`Picks lock at ${clock(ctx.deadline)}. Make your Week ${week} picks${inName}.`, left);
  }

  // awards
  const votes: { award: string; nominee: string }[] = await ctx.db.all(
    `award_votes?select=award,nominee&league_key=eq.${encodeURIComponent(league.key)}&season=eq.${ctx.season}&week=eq.${week}&order=award,user_id`);
  const won = winners(votes);
  if (!won.length) return null;
  const head = won.find((w) => w.award === "mvp") ?? won[0];
  const plain = `Week ${week}'s awards are in. See who won${inName}.`;
  if (!sleeper) return everyone(plain);
  const teams = await teamsOf(sleeper);
  const names = head.teams.map((t) => teams.get(Number(String(t).replace(/^r/, "")))?.name);
  if (names.some((n) => !n)) return everyone(plain);
  const title = AWARDS[head.award];
  const line = names.length === 1 ? `${names[0]} is ${title}` : `${and(names as string[])} share ${title}`;
  return new Map(members.map((m) => {
    const mine = rosterOf(teams, m.owner_id);
    const yours = mine != null && head.teams.includes(`r${mine}`);
    const body = yours && names.length === 1 ? `Week ${week}'s awards are in: you're ${title}!` : `Week ${week}'s awards are in: ${line}.`;
    return [m.user_id, { title: titleOf(m), body }];
  }));
}

/* To each of the member's devices. A device that has gone is forgotten at
   once; one that fails MAX_FAILURES sends in a row is forgotten too (a
   send that gets through starts the count again). A failure counts once a
   run (an outage during a run that sends one device several notifications
   isn't several), and not when it's about the sender's own keys or rate
   (401, 403, 429: a key set up wrong mustn't forget everyone's devices).
   An APNs token that only the other environment took keeps that one. */
async function deliver(note: Note, topic: string, devices: Device[], env: Env, db: Db, report: Report, expires: Date, now: Date) {
  const tag = `${note.kind}-${note.league_key}-${note.season}-${note.week}`;
  for (const d of devices) {
    if (d.removed) continue;
    let result: Sent | null = null;
    try {
      if (d.kind === "web" && env.webPush) {
        result = await env.webPush(d, {
          title: note.title, body: note.body, url: note.url, tag, kind: note.kind, link: note.link,
        }, { ttl: Math.max(60, (expires.getTime() - now.getTime()) / 1000), urgency: note.kind === "pickem" ? "high" : "normal", topic });
      } else if (d.kind === "apns" && env.apns) {
        result = await env.apns(d, {
          aps: { alert: { title: note.title, body: note.body }, sound: "default", "thread-id": note.league_key },
          kind: note.kind, url: note.url, link: note.link,
        }, { expires, collapseId: tag, priority: 10 });
      } else {
        continue; // not reachable (filtered out above)
      }
    } catch (err) {
      result = { ok: false, status: 0, gone: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const change: Record<string, unknown> = {};
    if (result.ok) {
      report.sent++;
      if (d.failures) change.failures = d.failures = 0;
      if (d.kind === "apns" && result.env && result.env !== d.apns_env) change.apns_env = d.apns_env = result.env;
    } else {
      report.failed++;
      console.error(`clubhouse-push: ${d.kind} device ${d.id} answered ${result.status} ${result.reason ?? ""}`.trim());
      const ours = result.status === 401 || result.status === 403 || result.status === 429;
      if (!result.gone && !ours && !d.failedThisRun) {
        d.failedThisRun = true;
        change.failures = d.failures = (d.failures ?? 0) + 1;
      }
    }
    if (result.gone || (d.failures ?? 0) >= MAX_FAILURES) {
      d.removed = true;
      await db.remove(`push_devices?id=eq.${d.id}`).catch(() => {});
      report.removed++;
    } else if (Object.keys(change).length) {
      await db.patch(`push_devices?id=eq.${d.id}`, change).catch(() => {});
    }
  }
}
