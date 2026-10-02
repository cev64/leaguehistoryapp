/* ESPN leagues, read from ESPN's fantasy API and handed to sleeper.js in
   the raw shape Sleeper's own API gives, so every page (seasons, brackets,
   box scores, the record book, the front office, the trophy room) draws an
   ESPN league exactly as it draws a Sleeper one.

     League id on this site    espn-<ESPN league id>   (?league=espn-12345678)

   ESPN keeps one league id for a league's whole life; its seasons are that
   id plus a year, and `status.previousSeasons` lists the years before.

   What is read, per season (lm-api-reads.fantasy.espn.com/apis/v3/games/ffl):
     the league     settings, teams, members, the whole schedule with every
                    week's score, the draft and the league's status (one call)
     each week      both lineups of every game, with each player's points
                    (mMatchupScore + scoringPeriodId), once the week is final
     the front      waivers and pickups (mTransactions2, a call a week) and
     office         trades (the league's activity feed), only when the front
                    office is opened

   Public and private leagues. ESPN answers a public league ("viewable to
   the public" in its settings) to anyone, from any site. A private league
   wants a member's ESPN keys, the espn_s2 and SWID cookies, which a page
   on another site can't send for them. So a league is tried in turn, and
   the first that answers is kept for the visit:
     public   a plain request
     proxy    espn_s2 and SWID, typed once on the front page and kept in
              this browser, sent to the site's ESPN relay
              (supabase/functions/espn-proxy), which adds them to the request
              and passes ESPN's answer straight back
     account  a signed-in member's keys saved to their account (encrypted,
              held by the relay), so their phone, or any device they sign
              in on, opens the league without typing them again

   With keys (either kind), ESPN.myLeagues() lists the member's own football
   leagues from their ESPN profile, for the front page to offer.

   Everything ESPN answers is reshaped to what the pages need before it is
   kept (IndexedDB, through sleeper.js), so a finished season costs nothing
   to open again for a month.

   Plain script, loaded after sleeper.js on every page. */
(function () {
  "use strict";

  const L = window.League;
  if (!L || !L._core) return;
  const { addSource, addPlayers, fetchJSON, cachedFn, storeSet, round2, TTL, MINUTE } = L._core;

  const GAME = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
  const PREFIX = "espn-";
  const isEspnId = (id) => /^espn-\d{1,12}$/.test(String(id || ""));

  const CFG = window.ACCOUNT_CONFIG || {};
  const PROXY = CFG.ESPN_PROXY_URL ||
    (CFG.SUPABASE_URL ? `${String(CFG.SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/espn-proxy` : "");

  /* ------------------------------------------------------------ ESPN's codes */

  // NFL clubs by ESPN's proTeamId, spelled as the rest of the site spells them.
  const CLUB = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
    11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
    21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX",
    33: "BAL", 34: "HOU",
  };
  const clubOf = (proTeamId) => CLUB[proTeamId] || "FA";

  /* ESPN's lineup slots, as the Sleeper slot each one plays like. ESPN's
     DT, DE and DL slots all read as DL, CB, S and DB as DB. */
  const SLOT_NAME = {
    0: "QB", 1: "TQB", 2: "RB", 3: "WRRB_FLEX", 4: "WR", 5: "REC_FLEX", 6: "TE", 7: "SUPER_FLEX",
    8: "DL", 9: "DL", 10: "LB", 11: "DL", 12: "DB", 13: "DB", 14: "DB", 15: "IDP_FLEX", 16: "DEF",
    17: "K", 18: "P", 19: "HC", 20: "BN", 21: "IR", 23: "FLEX", 24: "ER",
  };
  // The order ESPN draws a lineup in: offence, flexes, defence, kickers, bench.
  const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 23, 7, 8, 9, 11, 24, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const BENCH = 20, IR = 21;
  // The positions a player may fill, from the slots ESPN lets him into.
  const ELIGIBLE = {
    0: "QB", 2: "RB", 4: "WR", 6: "TE", 8: "DL", 9: "DL", 11: "DL", 10: "LB", 12: "DB", 13: "DB", 14: "DB",
    16: "DEF", 17: "K", 18: "P", 19: "HC",
  };
  const POSITION = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 7: "P", 9: "DT", 10: "DE", 11: "LB", 12: "CB", 13: "S", 14: "HC", 16: "DST" };

  /* A player's id on this site: "e<ESPN id>", and a team defence (ESPN's
     -16000 - club) its club's code, as Sleeper names defences. */
  const pidOf = (espnId) => {
    const n = Number(espnId);
    if (n < 0) return CLUB[-16000 - n] || `e${n}`;
    return `e${n}`;
  };

  // Every player seen, for the site's player table: [name, pos, club, eligible].
  const known = new Set();
  function playerEntry(p) {
    if (!p || p.id == null) return null;
    const pid = pidOf(p.id);
    const club = clubOf(p.proTeamId);
    if (Number(p.id) < 0) return [pid, [`${String(p.fullName || `${pid} D/ST`).trim()}`, "DST", pid]];
    const elig = [...new Set((p.eligibleSlots || []).map((s) => ELIGIBLE[s]).filter(Boolean))];
    const pos = POSITION[p.defaultPositionId] || elig[0] || "?";
    const name = String(p.fullName || `${p.firstName || ""} ${p.lastName || ""}`).trim() || `Player ${p.id}`;
    return [pid, elig.length ? [name, pos, club, elig] : [name, pos, club]];
  }
  function register(map) {
    Object.keys(map).forEach((pid) => known.add(pid));
    addPlayers(map);
  }

  /* ------------------------------------------------------------ sign-in */

  /* A private league's keys: the visitor's espn_s2 and SWID cookies, typed
     on the front page and kept in this browser only. Pasted values are
     tidied (a pasted "espn_s2=" or quotes come off; SWID wears its
     braces). */
  const AUTH_KEY = "lh-espn-auth";
  function tidyAuth(s2, swid) {
    const clean = (v, name) => String(v || "").trim().replace(new RegExp(`^${name}\\s*=\\s*`, "i"), "").replace(/^["']|["';]+$/g, "").trim();
    const a = clean(s2, "espn_s2");
    let b = clean(swid, "swid").replace(/[{}]/g, "");
    if (!a || !b) return null;
    b = `{${b.toUpperCase()}}`;
    if (!/^\{[0-9A-F-]{30,40}\}$/.test(b) || a.length < 40 || /\s/.test(a)) return null;
    return { s2: a, swid: b };
  }
  function savedAuth() {
    try {
      const a = JSON.parse(localStorage.getItem(AUTH_KEY));
      return a && a.s2 && a.swid ? a : null;
    } catch (err) {
      return null;
    }
  }
  function saveAuth(s2, swid) {
    const a = tidyAuth(s2, swid);
    if (!a) return null;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (err) { /* private mode: for this visit only */ }
    access.clear();
    return a;
  }
  function clearAuth() {
    try { localStorage.removeItem(AUTH_KEY); } catch (err) { /* ignore */ }
    access.clear();
  }

  /* ------------------------------------------------------------ requests */

  const access = new Map(); // ESPN league number -> "public" | "proxy" | "account"
  const HINT_KEY = "lh-espn-access";
  function hintOf(n) { try { return (JSON.parse(localStorage.getItem(HINT_KEY)) || {})[n] || null; } catch (err) { return null; } }
  function hint(n, mode) {
    try {
      const all = JSON.parse(localStorage.getItem(HINT_KEY)) || {};
      all[n] = mode;
      localStorage.setItem(HINT_KEY, JSON.stringify(all));
    } catch (err) { /* ignore */ }
  }

  function request(url, filter, mode, token) {
    const headers = {};
    if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
    if (mode === "proxy" || mode === "account") {
      if (mode === "proxy") {
        const auth = savedAuth();
        headers["x-espn-s2"] = auth.s2;
        headers["x-espn-swid"] = auth.swid;
      } else {
        // The relay finds this member's saved keys from their session.
        headers["x-lh-account"] = "1";
      }
      if (CFG.SUPABASE_ANON_KEY) headers.apikey = CFG.SUPABASE_ANON_KEY;
      const bearer = mode === "account" ? token : CFG.SUPABASE_ANON_KEY;
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      return fetchJSON(`${PROXY}?url=${encodeURIComponent(url)}`, 3, { headers, credentials: "omit" }, "ESPN");
    }
    return fetchJSON(url, 3, { headers, credentials: "omit" }, "ESPN");
  }

  function privateError(n) {
    const tried = PROXY && (savedAuth() || accountSaved === true);
    const err = new Error(tried
      ? "ESPN didn't accept the keys saved in this browser for this league. ESPN changes them when you sign out or after a while: copy espn_s2 and SWID again and enter them on the front page."
      : PROXY
        ? "This ESPN league is private. Enter your ESPN keys (espn_s2 and SWID) on the front page to open it."
        : "This ESPN league is private, and this site isn't set up to open private ESPN leagues yet.");
    err.privateLeague = true;
    err.link = `index.html?espn=${encodeURIComponent(n)}`;
    err.linkText = PROXY ? "Enter your ESPN keys" : "Back to the front page";
    return err;
  }

  /* Keys saved to the member's account (see supabase/functions/espn-proxy).
     Only on a live site with accounts (Supabase) and the relay; in preview
     mode accounts live in this browser, so keys simply stay here too. */
  const accountsOn = () => Boolean(PROXY && window.Account && window.Account.mode === "supabase");
  async function memberToken() {
    if (!accountsOn() || !window.Account.user) return null;
    try { return await window.Account.accessToken(); } catch (err) { return null; }
  }
  let accountSaved = null; // what the relay last said: true, false, or not asked
  async function accountCall(action, body) {
    const token = await memberToken();
    if (!token) return { saved: false, signedOut: true };
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (CFG.SUPABASE_ANON_KEY) headers.apikey = CFG.SUPABASE_ANON_KEY;
    const res = await fetch(`${PROXY}?action=${action}`, {
      method: action === "status" ? "GET" : "POST", headers, credentials: "omit",
      body: action === "status" ? undefined : JSON.stringify(body || {}),
    });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(answer.error || `The relay answered ${res.status}`);
    accountSaved = Boolean(answer.saved);
    return answer;
  }
  /* The member's own ESPN football leagues, newest season first, from the
     teams on their ESPN profile (the relay's ?action=leagues): with the
     keys in this browser, or else the ones saved to their account. Null
     when there are no keys to ask with. */
  async function myLeagues() {
    if (!PROXY) return null;
    const auth = savedAuth();
    const token = auth ? null : await memberToken();
    if (!auth && !token) return null;
    const headers = {};
    if (CFG.SUPABASE_ANON_KEY) headers.apikey = CFG.SUPABASE_ANON_KEY;
    if (auth) {
      headers["x-espn-s2"] = auth.s2;
      headers["x-espn-swid"] = auth.swid;
      if (CFG.SUPABASE_ANON_KEY) headers.Authorization = `Bearer ${CFG.SUPABASE_ANON_KEY}`;
    } else {
      headers["x-lh-account"] = "1";
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${PROXY}?action=leagues`, { headers, credentials: "omit" });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) {
      // No keys on the account is no list, not a failure.
      if (!auth && res.status === 401 && /no ESPN keys/.test(answer.error || "")) return null;
      throw new Error(answer.error || `The relay answered ${res.status}`);
    }
    return Array.isArray(answer.leagues) ? answer.leagues : [];
  }

  const accountKeys = {
    available: accountsOn,
    signedIn: () => Boolean(accountsOn() && window.Account.user),
    status: () => accountCall("status"),
    // Saves this browser's keys to the account.
    save: () => {
      const auth = savedAuth();
      return auth ? accountCall("save", { s2: auth.s2, swid: auth.swid }) : Promise.reject(new Error("No keys in this browser."));
    },
    forget: () => accountCall("forget").finally(() => access.clear()),
  };

  /* A request about league `n`, in whichever way that league answers. The
     first request finds the way (public first; then the relay with keys
     typed in this browser, then with the member's saved keys, only if ESPN
     says no), and the rest of the visit follows it. */
  async function call(n, url, filter) {
    const settled = access.get(n);
    const token = await memberToken();
    if (settled) {
      try {
        return await request(url, filter, settled, token);
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw privateError(n);
        throw err;
      }
    }
    const modes = ["public"];
    if (PROXY && savedAuth()) modes.push("proxy");
    if (token) modes.push("account");
    const prefer = hintOf(n);
    if (prefer && modes.includes(prefer)) modes.sort((a, b) => (b === prefer) - (a === prefer));
    for (const mode of modes) {
      try {
        const value = await request(url, filter, mode, token);
        access.set(n, mode);
        if (mode !== prefer) hint(n, mode);
        return value;
      } catch (err) {
        // A refusal means try the next way.
        if (err.status !== 401 && err.status !== 403) throw err;
      }
    }
    throw privateError(n);
  }

  /* One season of league `n`. Seasons before 2018 live at ESPN's
     leagueHistory address, later ones under the season; each is tried at
     the other address when the first has nothing, as ESPN has moved
     seasons between them. */
  const leagueUrl = (n, year, history) => (history
    ? `${GAME}/leagueHistory/${n}?seasonId=${year}`
    : `${GAME}/seasons/${year}/segments/0/leagues/${n}`);
  const withQuery = (base, query) => (query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base);
  const views = (...list) => list.map((v) => `view=${v}`).join("&");
  const where = new Map(); // "n:year" -> which address answered
  async function leagueGet(n, year, query, filter) {
    const key = `${n}:${year}`;
    const order = where.has(key) ? [where.get(key), !where.get(key)] : year < 2018 ? [true, false] : [false, true];
    let denied = null;
    for (const history of order) {
      try {
        let value = await call(n, withQuery(leagueUrl(n, year, history), query), filter);
        if (Array.isArray(value)) value = value.find((x) => x && Number(x.seasonId) === year) || value[0] || null;
        if (value) { where.set(key, history); return value; }
      } catch (err) {
        if (!err.privateLeague) throw err;
        denied = err;
      }
    }
    if (denied) throw denied;
    return null;
  }

  // ESPN's season and week right now: { season, week }.
  async function gameState() {
    const g = await cachedFn("espn:game", 10 * MINUTE, () => fetchJSON(GAME, 3, { credentials: "omit" }, "ESPN"));
    const season = Number((g && (g.currentSeasonId || (g.currentSeason && g.currentSeason.id))) || new Date().getFullYear());
    const week = Number((g && g.currentSeason && g.currentSeason.currentScoringPeriod && g.currentSeason.currentScoringPeriod.id) || 1);
    return { season, week };
  }

  /* ------------------------------------------------------------ a season */

  const fullName = (m) => {
    const real = `${m.firstName || ""} ${m.lastName || ""}`.replace(/\s+/g, " ").trim();
    return real || String(m.displayName || "").trim() || "Manager";
  };
  /* A team logo is whatever address its manager gave ESPN, and the pages
     write it straight into an <img>: only a plain http(s) address with
     nothing in it that could end the attribute is kept. */
  function safeLogo(raw) {
    if (!raw) return null;
    try {
      const url = new URL(String(raw).trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const href = url.href.replace(/^http:/, "https:");
      return /["'<>\s`\\]/.test(href) || href.length > 500 ? null : href;
    } catch (err) {
      return null;
    }
  }
  const teamName = (t) => String(t.name || [t.location, t.nickname].filter(Boolean).join(" ") || t.abbrev || `Team ${t.id}`)
    .replace(/\s+/g, " ").trim();

  /* The season's league call, kept as only what the pages use. */
  function compactSeason(d, year) {
    const s = d.settings || {};
    const sched = s.scheduleSettings || {};
    const status = d.status || {};
    const draft = d.draftDetail || {};
    const ds = s.draftSettings || {};
    const acq = s.acquisitionSettings || {};
    const side = (x) => (x && x.teamId != null ? {
      id: x.teamId,
      pts: x.pointsByScoringPeriod || {},
      total: Number(x.totalPoints) || 0,
    } : null);
    return {
      year,
      name: String(s.name || "").trim(),
      status: {
        first: Number(status.firstScoringPeriod) || 1,
        final: Number(status.finalScoringPeriod) || 0,
        latest: Number(status.latestScoringPeriod) || 0,
        previous: (status.previousSeasons || []).map(Number).filter(Boolean),
      },
      mpc: Number(sched.matchupPeriodCount) || 0,
      periods: sched.matchupPeriods || {},
      playoffTeams: Number(sched.playoffTeamCount) || 0,
      divisions: (sched.divisions || []).map((x) => ({ id: x.id, name: String(x.name || "").trim() })),
      slots: (s.rosterSettings || {}).lineupSlotCounts || {},
      faab: Boolean(acq.isUsingAcquisitionBudget),
      budget: Number(acq.acquisitionBudget) || 0,
      pickOrder: ds.pickOrder || [],
      draftType: ds.type || null,
      drafted: Boolean(draft.drafted),
      picks: (draft.picks || []).map((p) => [p.roundId, p.roundPickNumber, p.overallPickNumber, p.teamId, p.playerId]),
      members: (d.members || []).map((m) => ({ id: m.id, name: fullName(m) })),
      teams: (d.teams || []).map((t) => ({
        id: t.id,
        name: teamName(t),
        logo: safeLogo(t.logo),
        owner: t.primaryOwner || (t.owners || [])[0] || null,
        division: t.divisionId,
        seed: Number(t.playoffSeed) || 0,
        rank: Number(t.rankCalculatedFinal) || Number(t.rankFinal) || 0,
        record: (t.record && t.record.overall) || {},
      })),
      games: (d.schedule || []).map((g) => ({
        id: g.id,
        mp: Number(g.matchupPeriodId),
        tier: g.playoffTierType || null,
        winner: g.winner || "UNDECIDED",
        home: side(g.home),
        away: side(g.away),
      })).filter((g) => g.home || g.away),
    };
  }

  // The league call for one season, or null where ESPN has no such season.
  const cores = new Map();
  async function seasonCore(n, year, gs) {
    const key = `espn:season:${n}:${year}`;
    const past = year < gs.season;
    const core = await cachedFn(key, past ? TTL.finished : TTL.live, async () => {
      const d = await leagueGet(n, year, views("mSettings", "mTeam", "mMatchup", "mStandings", "mDraftDetail", "mStatus"));
      return d ? compactSeason(d, year) : null;
    });
    // A season that finished this year keeps for a month from now on.
    if (core && !past && isComplete(core, gs)) await storeSet(key, { t: Date.now() + TTL.finished - TTL.live, v: core });
    if (core) cores.set(`${n}:${year}`, core);
    return core;
  }

  /* Over once ESPN has moved on to a later season, or has given every team
     its final place and played its last week. */
  const isComplete = (core, gs) => core.year < gs.season ||
    (core.teams.length > 0 && core.teams.every((t) => t.rank > 0) && core.status.latest >= core.status.final);

  /* One week's lineups: { teamId: { e: [[pid, slot], ...], p: { pid: pts } } },
     the players met registered as a side effect. */
  function compactBox(d, sp, mp) {
    const out = {};
    const seen = {};
    (d.schedule || []).forEach((g) => {
      if (mp != null && Number(g.matchupPeriodId) !== mp) return;
      ["home", "away"].forEach((k) => {
        const side = g[k];
        // Older seasons only have the matchup's roster, which is the week's
        // own when a matchup is one week long.
        const roster = side && (side.rosterForCurrentScoringPeriod || (mp === sp ? side.rosterForMatchupPeriod : null));
        if (!roster || !roster.entries) return;
        const team = { e: [], p: {} };
        roster.entries.forEach((entry) => {
          const pool = entry.playerPoolEntry || {};
          const player = pool.player || entry.player || {};
          const espnId = entry.playerId != null ? entry.playerId : player.id;
          if (espnId == null) return;
          const pid = pidOf(espnId);
          const stat = (player.stats || []).find((x) => x.scoringPeriodId === sp && x.statSourceId === 0 && (x.statSplitTypeId === 1 || x.statSplitTypeId == null));
          const pts = stat && stat.appliedTotal != null ? stat.appliedTotal : pool.appliedStatTotal || 0;
          team.e.push([pid, Number(entry.lineupSlotId)]);
          team.p[pid] = round2(Number(pts) || 0);
          const info = playerEntry({ ...player, id: espnId, proTeamId: player.proTeamId != null ? player.proTeamId : stat && stat.proTeamId });
          if (info) seen[info[0]] = info[1];
        });
        out[side.teamId] = team;
      });
    });
    return { teams: out, players: seen };
  }

  async function boxWeek(n, year, sp, mp, ttl) {
    const box = await cachedFn(`espn:box:${n}:${year}:${sp}`, ttl, async () => {
      const d = await leagueGet(n, year, `${views("mMatchupScore", "mScoreboard")}&scoringPeriodId=${sp}`,
        { schedule: { filterMatchupPeriodIds: { value: [mp] } } });
      return d ? compactBox(d, sp, mp) : { teams: {}, players: {} };
    });
    register(box.players || {});
    return box;
  }

  /* ------------------------------------------------------------ brackets */

  /* ESPN has no bracket list: its playoff games are entries in the schedule,
     tagged (in recent seasons) WINNERS_BRACKET, WINNERS_CONSOLATION_LADDER or
     LOSERS_CONSOLATION_LADDER. Sleeper's winners and losers brackets are
     rebuilt from them:
       - the winner's bracket is drawn the standard way for the field
         (byes to the top seeds, 1 meets the 4/5 winner, 2 the 3/6 winner),
         so it can be shown before it is played, and each game ESPN has
         played is laid onto it. A bracket that doesn't fit (a commissioner
         who moved the games) is drawn from the games alone.
       - a placement game in the last round (third, fifth...) and every
         consolation game join as Sleeper has them, their places from
         ESPN's final standings.
     Seasons before ESPN tagged its games are sorted by who is still alive:
     playoff teams that haven't lost are the winner's bracket. */
  function brackets(core, ctx) {
    const { R, playoffTeams, seeds, final, spOf, complete } = ctx;
    const rankOf = Object.fromEntries(core.teams.map((t) => [t.id, t.rank]));
    const N = Math.min(playoffTeams, seeds.length);
    if (!R || N < 2) return { winners: [], losers: [] };

    // The playoff games, each with its round and, once played, its result.
    const played = (g) => (g.winner === "HOME" || g.winner === "AWAY") && spOf(g.mp).every((w) => w <= final);
    const games = core.games
      .filter((g) => g.mp > core.mpc && g.mp <= core.mpc + R && g.home && g.away)
      .map((g) => {
        const done = played(g);
        return {
          r: g.mp - core.mpc, a: g.home.id, b: g.away.id, tier: g.tier,
          w: done ? (g.winner === "HOME" ? g.home.id : g.away.id) : null,
          l: done ? (g.winner === "HOME" ? g.away.id : g.home.id) : null,
        };
      })
      .sort((x, y) => x.r - y.r);

    const field = new Set(seeds.slice(0, N));
    const tagged = games.some((g) => g.tier && g.tier !== "NONE");
    const alive = new Set(field);
    for (let r = 1; r <= R; r++) {
      games.filter((g) => g.r === r).forEach((g) => {
        if (tagged) {
          g.kind = g.tier === "WINNERS_BRACKET" ? "W" : g.tier === "WINNERS_CONSOLATION_LADDER" ? "WC" : g.tier === "LOSERS_CONSOLATION_LADDER" ? "L" : null;
        } else {
          const inA = field.has(g.a), inB = field.has(g.b);
          g.kind = alive.has(g.a) && alive.has(g.b) ? "W" : inA || inB ? "WC" : "L";
        }
      });
      games.filter((g) => g.r === r && g.kind === "W" && g.l != null).forEach((g) => alive.delete(g.l));
    }
    const same = (g, x, y) => (g.a === x && g.b === y) || (g.a === y && g.b === x);

    // The standard draw: seeds in bracket order, byes for the top seeds.
    function drawn() {
      const size = 2 ** R;
      let order = [1];
      while (order.length < size) {
        const k = order.length * 2;
        order = order.flatMap((s) => [s, k + 1 - s]);
      }
      const out = [];
      let m = 0;
      let nodes = [];
      for (let i = 0; i < size; i += 2) {
        const [x, y] = [order[i], order[i + 1]];
        if (x <= N && y <= N) {
          const g = { r: 1, m: ++m, t1: seeds[x - 1], t2: seeds[y - 1], w: null, l: null, t1_from: null, t2_from: null, p: null };
          out.push(g);
          nodes.push({ game: g });
        } else {
          nodes.push({ team: seeds[Math.min(x, y) - 1] });
        }
      }
      for (let r = 2; r <= R; r++) {
        const next = [];
        for (let i = 0; i < nodes.length; i += 2) {
          const [left, right] = [nodes[i], nodes[i + 1]];
          const g = {
            r, m: ++m,
            t1: left.team != null ? left.team : null, t2: right.team != null ? right.team : null,
            t1_from: left.game ? { w: left.game.m } : null, t2_from: right.game ? { w: right.game.m } : null,
            w: null, l: null, p: r === R ? 1 : null,
          };
          out.push(g);
          next.push({ game: g });
        }
        nodes = next;
      }
      // Lay ESPN's games onto it, round by round.
      const actual = games.filter((g) => g.kind === "W");
      const used = new Set();
      const byM = new Map(out.map((g) => [g.m, g]));
      for (let r = 1; r <= R; r++) {
        out.filter((g) => g.r === r).forEach((g) => {
          ["t1", "t2"].forEach((k) => {
            const from = g[`${k}_from`];
            if (g[k] == null && from && byM.get(from.w) && byM.get(from.w).w != null) g[k] = byM.get(from.w).w;
          });
          if (g.t1 == null || g.t2 == null) return;
          const hit = actual.find((x) => x.r === r && !used.has(x) && same(x, g.t1, g.t2));
          if (hit) { used.add(hit); g.w = hit.w; g.l = hit.l; }
        });
      }
      return used.size === actual.length ? out : null;
    }

    // A bracket ESPN played some other way: the games as they were.
    function asPlayed() {
      const out = [];
      let m = 0;
      const actual = games.filter((g) => g.kind === "W");
      const last = Math.max(0, ...actual.map((g) => g.r));
      actual.forEach((g) => out.push({ r: g.r, m: ++m, t1: g.a, t2: g.b, w: g.w, l: g.l, p: null, t1_from: null, t2_from: null }));
      const finals = out.filter((g) => g.r === last);
      if (finals.length === 1 && last === R) finals[0].p = 1;
      linkFrom(out);
      return out;
    }

    // Where each team in a game came from: the winner or loser of its game
    // the round before in the same bracket.
    function linkFrom(list) {
      list.forEach((g) => {
        ["t1", "t2"].forEach((k) => {
          if (g[`${k}_from`] || g[k] == null) return;
          const before = list.find((x) => x.r === g.r - 1 && (x.t1 === g[k] || x.t2 === g[k]) && x.w != null);
          if (before) g[`${k}_from`] = before.w === g[k] ? { w: before.m } : { l: before.m };
        });
      });
    }

    // Places a final-round game settles, from ESPN's final standings.
    const placeOf = (x, y) => {
      const rx = rankOf[x], ry = rankOf[y];
      return complete && rx && ry && Math.abs(rx - ry) === 1 ? Math.min(rx, ry) : null;
    };

    const winners = drawn() || asPlayed();
    // Placement games among the playoff teams: the last round's only.
    let m = Math.max(0, ...winners.map((g) => g.m));
    games.filter((g) => g.kind === "WC" && g.r === R).forEach((g) => {
      let p = placeOf(g.a, g.b);
      if (!p) {
        const semis = winners.filter((x) => x.r === R - 1);
        if (semis.some((x) => x.l === g.a) && semis.some((x) => x.l === g.b)) p = 3;
      }
      if (!p || p === 1) return;
      winners.push({ r: g.r, m: ++m, t1: g.a, t2: g.b, w: g.w, l: g.l, p, t1_from: null, t2_from: null });
    });
    linkFrom(winners);

    // The consolation bracket, as ESPN played it.
    const losers = [];
    let lm = 0;
    const lgames = games.filter((g) => g.kind === "L");
    const lastL = Math.max(0, ...lgames.map((g) => g.r));
    lgames.forEach((g) => {
      const place = g.r === lastL ? placeOf(g.a, g.b) : null;
      losers.push({ r: g.r, m: ++lm, t1: g.a, t2: g.b, w: g.w, l: g.l, p: place && place > N ? place - N : null, t1_from: null, t2_from: null });
    });
    linkFrom(losers);
    return { winners, losers };
  }

  /* ------------------------------------------------------------ the raw season */

  function seasonShape(core, gs) {
    const spOf = (mp) => (core.periods[mp] || core.periods[String(mp)] || [Number(mp)]).map(Number);
    const complete = isComplete(core, gs);
    const playoffTeams = Math.min(core.playoffTeams, core.teams.length);
    const R = playoffTeams > 1 ? Math.ceil(Math.log2(playoffTeams)) : 0;
    const pws = R ? spOf(core.mpc + 1)[0] : 0;
    const lengths = [];
    for (let r = 1; r <= R; r++) lengths.push(spOf(core.mpc + r).length);
    let roundType = 0;
    if (lengths.length && lengths.every((x) => x === 2)) roundType = 2;
    else if (lengths.length > 1 && lengths[lengths.length - 1] === 2 && lengths.slice(0, -1).every((x) => x === 1)) roundType = 1;
    else if (lengths.length === 1 && lengths[0] === 2) roundType = 1;
    const lastPeriod = R ? core.mpc + R : core.mpc || Math.max(1, ...core.games.map((g) => g.mp));
    const lastWeek = Math.min(18, Math.max(1, ...spOf(lastPeriod), ...core.games.filter((g) => g.mp <= lastPeriod).flatMap((g) => spOf(g.mp))));
    let final;
    if (complete) final = lastWeek;
    else if (core.year === gs.season) final = Math.max(0, Math.min(lastWeek, (core.status.latest || gs.week) - 1));
    else final = 0;
    if (!core.drafted && !complete) final = 0;
    return { spOf, complete, playoffTeams, R, pws, roundType, lastWeek, final };
  }

  async function seasonRaw(n, core, gs) {
    const shape = seasonShape(core, gs);
    const { spOf, complete, playoffTeams, R, pws, roundType, lastWeek, final } = shape;
    const year = core.year;

    // Lineup slots, in ESPN's order, under Sleeper's names.
    const slotIds = [];
    SLOT_ORDER.forEach((s) => {
      const count = Number(core.slots[s]) || 0;
      for (let i = 0; i < count && i < 30; i++) slotIds.push(s);
    });
    const startSlots = slotIds.filter((s) => s !== BENCH && s !== IR);

    // Every week that is final: its lineups.
    const mpOf = {};
    Object.keys(core.periods).forEach((mp) => spOf(mp).forEach((sp) => { mpOf[sp] = Number(mp); }));
    const ttl = complete ? TTL.finished : L._core.DAY;
    const weeks = [];
    for (let w = core.status.first || 1; w <= final; w++) weeks.push(w);
    const boxes = {};
    if (weeks.length) {
      // The first week says whether ESPN kept lineups this far back.
      const first = await boxWeek(n, year, weeks[0], mpOf[weeks[0]] || weeks[0], ttl).catch(() => null);
      boxes[weeks[0]] = first;
      if (first && Object.keys(first.teams).length) {
        await Promise.all(weeks.slice(1).map(async (w) => {
          boxes[w] = await boxWeek(n, year, w, mpOf[w] || w, ttl).catch(() => null);
        }));
      }
    }

    // Divisions, in ESPN's order; one division is none.
    const divisions = core.divisions.slice().sort((a, b) => a.id - b.id);
    const divisionIndex = new Map(divisions.map((d, i) => [d.id, i + 1]));
    const metadata = {};
    if (divisions.length > 1) divisions.forEach((d, i) => { metadata[`division_${i + 1}`] = d.name || `Division ${i + 1}`; });

    const memberName = new Map(core.members.map((m) => [m.id, m.name]));
    const rounds = Math.max(0, ...core.picks.map((p) => Number(p[0]) || 0));
    const league = {
      league_id: `${PREFIX}${n}`,
      season: String(year),
      name: core.name || "ESPN League",
      avatar: null,
      status: complete ? "complete" : core.drafted ? "in_season" : "pre_draft",
      total_rosters: core.teams.length,
      roster_positions: slotIds.map((s) => SLOT_NAME[s] || "BN"),
      scoring_settings: {},
      metadata,
      settings: {
        playoff_week_start: pws,
        playoff_teams: playoffTeams,
        playoff_round_type: roundType,
        playoff_type: 1, // ESPN's consolation ladder: winners move on
        divisions: divisions.length > 1 ? divisions.length : 0,
        league_average_match: 0,
        start_week: core.status.first || 1,
        type: 0, // ESPN draft picks can't be traded, so no pick ledger
        waiver_type: core.faab ? 2 : 0,
        waiver_budget: core.budget,
        draft_rounds: rounds,
      },
    };
    const users = core.members.map((m) => ({ user_id: m.id, display_name: m.name, metadata: {} }));
    const rosters = core.teams.map((t) => {
      const rec = t.record || {};
      const pf = Number(rec.pointsFor) || 0;
      return {
        roster_id: t.id,
        // A team with no member on file (a public league's view, an
        // orphaned team) is followed across seasons by its ESPN team number.
        owner_id: t.owner || `${PREFIX}team-${t.id}`,
        lh_name: t.name,
        lh_owner: (t.owner && memberName.get(t.owner)) || t.name,
        lh_logo: t.logo,
        settings: {
          wins: Number(rec.wins) || 0, losses: Number(rec.losses) || 0, ties: Number(rec.ties) || 0,
          fpts: Math.floor(pf), fpts_decimal: Math.round((pf - Math.floor(pf)) * 100),
          division: divisionIndex.get(t.division) || 0,
        },
        taxi: [],
      };
    });

    // Every week's games in Sleeper's matchup shape, lineups where known.
    const matchups = {};
    for (let w = 1; w <= lastWeek; w++) matchups[w] = [];
    const entryFor = (side, w, sps, matchupId) => {
      const scored = w <= final;
      const pts = side.pts[w] != null ? Number(side.pts[w]) : sps.length === 1 ? side.total : 0;
      const box = boxes[w] && boxes[w].teams[side.id];
      const entry = { roster_id: side.id, matchup_id: matchupId, points: scored ? round2(pts) : 0, starters: [], players: [], players_points: {}, reserve: [] };
      if (box && scored) {
        const left = box.e.slice();
        entry.starters = startSlots.map((slot) => {
          const i = left.findIndex(([, s]) => s === slot);
          return i >= 0 ? left.splice(i, 1)[0][0] : "0";
        });
        entry.players = box.e.map(([pid]) => pid);
        entry.reserve = box.e.filter(([, s]) => s === IR).map(([pid]) => pid);
        entry.players_points = { ...box.p };
      }
      return entry;
    };
    core.games.forEach((g) => {
      const sps = spOf(g.mp);
      sps.forEach((w) => {
        if (!matchups[w]) return;
        const pair = g.home && g.away;
        const id = pair ? g.id + 1 : null;
        [g.home, g.away].filter(Boolean).forEach((side) => matchups[w].push(entryFor(side, w, sps, id)));
      });
    });

    /* Seeds. Before a playoff game is played the bracket is only a shape
       the season page projects onto, re-ranking its teams by the standings
       as they stand, so it is seeded in that same order (record, then points
       for, division leaders first). Once the playoffs begin, ESPN's own
       seeds are the truth. */
    // The regular season as scored so far, counted the way the pages count it.
    const table = Object.fromEntries(core.teams.map((t) => [t.id, { wins: 0, losses: 0, ties: 0, pf: 0 }]));
    core.games.forEach((g) => {
      if (g.mp > core.mpc || !g.home || !g.away || !table[g.home.id] || !table[g.away.id]) return;
      spOf(g.mp).filter((w) => w <= final).forEach((w) => {
        const a = Number(g.home.pts[w]) || 0, b = Number(g.away.pts[w]) || 0;
        if (!a && !b) return;
        [[g.home.id, a, b], [g.away.id, b, a]].forEach(([id, own, opp]) => {
          const t = table[id];
          t.pf += own;
          if (own > opp) t.wins++; else if (own < opp) t.losses++; else t.ties++;
        });
      });
    });
    const started = core.games.some((g) => g.mp > core.mpc && (g.winner === "HOME" || g.winner === "AWAY"));
    const bySeed = core.teams.filter((t) => t.seed > 0).sort((a, b) => a.seed - b.seed);
    const espnSeeds = bySeed.length === core.teams.length && new Set(bySeed.map((t) => t.seed)).size === bySeed.length;
    const divisionOf = Object.fromEntries(core.teams.map((t) => [t.id, divisionIndex.get(t.division) || null]));
    const seeds = (complete || started) && espnSeeds
      ? bySeed.map((t) => t.id)
      : L.seedOrder(core.teams.map((t) => t.id), table, (id) => divisionOf[id], divisions.length > 1 ? divisions.length : 0);
    const { winners, losers } = brackets(core, { R, playoffTeams, seeds, final, spOf, complete });

    return {
      league, users, rosters, winners, losers, matchups, final,
      startWeek: core.status.first || 1, lastWeek,
      finalRanks: complete ? Object.fromEntries(core.teams.map((t) => [t.id, t.rank])) : null,
    };
  }

  /* ------------------------------------------------------------ the league */

  async function seasons(id, { onProgress } = {}) {
    const n = String(id).slice(PREFIX.length);
    // Whether the visitor is signed in (and so may have saved keys) is known
    // once the account's session is restored.
    if (accountsOn() && window.Account.ready) await window.Account.ready.catch(() => null);
    const gs = await gameState();
    // The newest season: this year's, or last year's for a league that
    // hasn't been renewed yet.
    let newest = null, denied = null;
    for (const year of [gs.season, gs.season - 1]) {
      try {
        newest = await seasonCore(n, year, gs);
      } catch (err) {
        if (!err.privateLeague) throw err;
        denied = denied || err;
      }
      if (newest) break;
    }
    if (!newest) {
      if (denied) throw denied;
      throw new Error("ESPN has no football league with that id.");
    }
    const years = [...new Set([...newest.status.previous, newest.year])].filter((y) => y >= 2000 && y <= newest.year).sort((a, b) => a - b);
    let done = 0;
    if (onProgress) onProgress(0, years.length);
    const raws = await Promise.all(years.map(async (year) => {
      let raw = null;
      try {
        const core = year === newest.year ? newest : await seasonCore(n, year, gs);
        raw = core ? await seasonRaw(n, core, gs) : null;
      } catch (err) {
        // An old season ESPN won't give up is left out; the newest can't be.
        if (year === newest.year) throw err;
      }
      done++;
      if (onProgress) onProgress(done, years.length);
      return raw;
    }));
    return { raws, state: { season: String(gs.season), week: gs.week, season_type: "regular" } };
  }

  /* ------------------------------------------------------------ the front office */

  const TXN_TYPES = ["FREEAGENT", "WAIVER", "WAIVER_ERROR", "TRADE_ACCEPT"];

  // One week's transactions, kept as the fields the front office reads.
  async function txnWeek(n, year, w, ttl) {
    return cachedFn(`espn:txns:${n}:${year}:${w}`, ttl, async () => {
      const d = await leagueGet(n, year, `view=mTransactions2&scoringPeriodId=${w}`, { transactions: { filterType: { value: TXN_TYPES } } });
      return ((d && d.transactions) || []).map((t) => ({
        id: t.id, type: t.type, status: t.status, team: t.teamId, sp: Number(t.scoringPeriodId) || w,
        at: t.processDate || t.acceptedDate || t.proposedDate || 0, bid: t.bidAmount,
        items: (t.items || []).map((x) => [x.type, x.playerId, x.fromTeamId, x.toTeamId]),
      }));
    }).catch(() => []);
  }

  /* Trades from the league's activity feed: ESPN's transactions leave the
     players out of other teams' trades, but the feed has every player who
     changed hands (message 244: target, from, to). Seasons from 2019. */
  async function feedTrades(n, year, ttl) {
    if (year < 2019) return null;
    return cachedFn(`espn:trades:${n}:${year}`, ttl, async () => {
      const out = [];
      for (let page = 0; page < 20; page++) {
        const filter = { topics: {
          filterType: { value: ["ACTIVITY_TRANSACTIONS"] },
          limit: 50, limitPerMessageSet: { value: 25 }, offset: page * 50,
          sortMessageDate: { sortPriority: 1, sortAsc: false },
          filterIncludeMessageTypeIds: { value: [244] },
        } };
        const d = await call(n, `${GAME}/seasons/${year}/segments/0/leagues/${n}/communication/?view=kona_league_communication`, filter);
        const topics = (d && d.topics) || [];
        topics.forEach((topic) => {
          const moves = (topic.messages || []).filter((m) => m.messageTypeId === 244 && m.targetId != null)
            .map((m) => [m.targetId, m.from, m.to]);
          if (moves.length) out.push({ id: topic.id, at: topic.date || 0, moves });
        });
        if (topics.length < 50) break;
      }
      return out;
    }).catch(() => null);
  }

  // Names for players met only in a transaction, from ESPN's player list.
  async function nameUnknown(pids, year) {
    const ids = [...new Set(pids)].filter((pid) => !known.has(pid) && /^e\d+$/.test(pid)).map((pid) => Number(pid.slice(1)));
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const list = await cachedFn(`espn:players:${year}:${batch.join(",")}`, L._core.DAY * 7, () =>
        fetchJSON(`${GAME}/seasons/${year}/players?view=players_wl`, 3,
          { credentials: "omit", headers: { "X-Fantasy-Filter": JSON.stringify({ filterIds: { value: batch } }) } }, "ESPN")).catch(() => []);
      const map = {};
      (list || []).forEach((p) => { const e = playerEntry(p); if (e) map[e[0]] = e[1]; });
      register(map);
    }
  }

  /* Every season's transactions in Sleeper's shape: waiver claims and
     free-agent pickups with their bids, and trades with who sent what. */
  function transactionsOf(model) {
    const n = String(model.leagueId).slice(PREFIX.length);
    return Promise.all(model.seasons.map(async (season) => {
      const ttl = season.finished ? TTL.finished : TTL.live;
      const last = season.finished ? season.settings.lastWeek : Math.max(1, Math.min(season.settings.lastWeek, (season.lastFinal || 0) + 1));
      const weeks = [];
      for (let w = 1; w <= Math.max(1, last); w++) weeks.push(w);
      const [lists, feed] = await Promise.all([
        Promise.all(weeks.map((w) => txnWeek(n, season.year, w, ttl))),
        feedTrades(n, season.year, ttl),
      ]);
      const rows = lists.flat();
      const seen = new Set();
      const out = [];
      const faab = season.settings.waiverType === 2;
      rows.forEach((t) => {
        if (seen.has(t.id)) return;
        seen.add(t.id);
        if (t.type === "FREEAGENT" || t.type === "WAIVER" || t.type === "WAIVER_ERROR") {
          const ok = t.status === "EXECUTED";
          const failed = t.type === "WAIVER_ERROR" || /^FAILED/.test(String(t.status));
          if (!ok && !failed) return;
          const adds = {}, drops = {};
          t.items.forEach(([kind, pid, from, to]) => {
            if (kind === "ADD") adds[pidOf(pid)] = to;
            if (kind === "DROP") drops[pidOf(pid)] = from;
          });
          out.push({
            transaction_id: t.id, type: t.type === "FREEAGENT" ? "free_agent" : "waiver",
            status: ok ? "complete" : "failed", leg: t.sp, created: t.at, roster_ids: [t.team],
            adds, drops, draft_picks: [], waiver_budget: [],
            settings: faab && t.type !== "FREEAGENT" && t.bid != null ? { waiver_bid: t.bid } : {},
          });
        }
      });
      // Trades: from the feed where it answers, else ESPN's transactions
      // (whose own trades always list their players).
      const weekAt = (at) => {
        let w = 1;
        rows.filter((t) => t.at && t.at <= at).forEach((t) => { if (t.sp > w) w = t.sp; });
        return w;
      };
      const trades = [];
      if (feed && feed.length) {
        feed.forEach((tr) => trades.push({ id: tr.id, at: tr.at, leg: weekAt(tr.at), moves: tr.moves }));
      } else {
        const sigs = new Set();
        rows.filter((t) => t.type === "TRADE_ACCEPT" && t.status === "EXECUTED").forEach((t) => {
          const moves = t.items.filter(([kind]) => kind === "TRADE").map(([, pid, from, to]) => [pid, from, to]);
          if (!moves.length) return;
          const sig = `${t.sp}|${moves.map((m) => m.join(":")).sort().join(",")}`;
          if (sigs.has(sig)) return;
          sigs.add(sig);
          trades.push({ id: t.id, at: t.at, leg: t.sp, moves });
        });
      }
      trades.forEach((tr) => {
        const adds = {}, drops = {};
        tr.moves.forEach(([pid, from, to]) => { adds[pidOf(pid)] = to; drops[pidOf(pid)] = from; });
        const teams = [...new Set(tr.moves.flatMap(([, from, to]) => [from, to]).filter((x) => x != null))];
        if (teams.length < 2) return;
        out.push({
          transaction_id: tr.id, type: "trade", status: "complete", leg: tr.leg, created: tr.at,
          roster_ids: teams, adds, drops, draft_picks: [], waiver_budget: [], settings: {},
        });
      });
      out.sort((a, b) => (a.created || 0) - (b.created || 0));
      await nameUnknown(out.flatMap((t) => [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})]), season.year);
      return [season.year, out];
    })).then((pairs) => Object.fromEntries(pairs));
  }

  // Every season's draft, in the shape the front office reads.
  function draftsOf(model) {
    const n = String(model.leagueId).slice(PREFIX.length);
    return model.seasons.map((season) => {
      const core = cores.get(`${n}:${season.year}`);
      if (!core || !core.picks.length) return null;
      const order = core.pickOrder.length ? core.pickOrder
        : core.picks.filter((p) => p[0] === 1).sort((a, b) => a[1] - b[1]).map((p) => p[3]);
      const slotToRoster = Object.fromEntries(order.map((teamId, i) => [i + 1, teamId]));
      const slotOf = new Map(order.map((teamId, i) => [teamId, i + 1]));
      const picks = core.picks.map(([round, , no, teamId, playerId]) => ({
        round, slot: slotOf.get(teamId) || null, no, rosterId: teamId, pid: playerId != null ? pidOf(playerId) : null,
      }));
      nameUnknown(picks.map((p) => p.pid).filter(Boolean), season.year);
      return {
        id: `${PREFIX}${n}-${season.year}`, year: season.year, leagueYear: season.year,
        status: core.drafted ? "complete" : "pre_draft", done: core.drafted, type: core.draftType,
        rounds: Math.max(0, ...picks.map((p) => p.round)), slotToRoster, picks,
      };
    }).filter(Boolean);
  }

  function decorate(model) {
    let txns = null;
    model.transactions = () => {
      if (!txns) {
        txns = transactionsOf(model);
        txns.catch(() => { txns = null; });
      }
      return txns;
    };
    model.drafts = () => Promise.resolve(draftsOf(model));
    model.tradedPicks = () => Promise.resolve([]);
  }

  /* ------------------------------------------------------------ registration */

  addSource({
    name: "espn",
    label: "ESPN",
    ownPlayers: true,
    credit: "Not affiliated with or endorsed by ESPN. League data from ESPN Fantasy.",
    handles: isEspnId,
    seasons,
    decorate,
    ownsPlayer: (pid) => /^e\d+$/.test(pid),
    headshot: (pid) => `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${pid.slice(1)}.png&w=192&h=140&scale=crop&cb=1`,
  });

  /* For the front page: reading a league id (or a league's address on
     fantasy.espn.com), and the private-league key. */
  function parseLeague(input) {
    const text = String(input || "").trim();
    if (!text) return null;
    const fromUrl = text.match(/[?&#]leagueId=(\d{1,12})/i);
    if (fromUrl) return fromUrl[1];
    const bare = text.replace(/^espn-/i, "");
    return /^\d{1,12}$/.test(bare) ? bare : null;
  }
  window.ESPN = {
    parseLeague, isEspnId, leagueId: (n) => `${PREFIX}${n}`,
    savedAuth, saveAuth, clearAuth, tidyAuth,
    proxyAvailable: Boolean(PROXY), accountKeys, myLeagues,
  };
})();
