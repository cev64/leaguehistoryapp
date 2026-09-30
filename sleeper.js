/* League data, read live from Sleeper's public API.

   Every page asks for one league by id (?league=<id> in the address) and gets
   back its whole history: the league it names and every season before it,
   followed through `previous_league_id`. Nothing about any particular league
   is written into the site; what a page shows is whatever Sleeper holds.

   The model a page receives has the same shape the pages were first built
   around, so their renderers read it unchanged:

     League.load(id) -> model
       model.name, model.avatar, model.leagueId
       model.owners            { ownerId: { name, currentTeam, icon, color, logo } }
       model.seasons           oldest first; each season:
         year, leagueId, status, finished, live, preseason
         settings              regularWeeks, playoffWeekStart, playoffTeams, byes, ...
         teams                 { teamId: { name, owner, ownerId, division, icon, color,
                                           wins, losses, ties, pf, pa, finalRank?, seed? } }
         schedule / results    { week: [[a, b]] } / { week: [[a, aScore, b, bScore]] }
         postseason            every bracket game, labelled
       model.leagueData()      the record-book shape (owners + seasons with
                               regularGames / postseasonGames) that the all-time
                               page and the trophy room read

   Sleeper is asked as little as possible. A finished season never changes, so
   everything about it is kept in IndexedDB for a month; a season in progress
   is kept for a few minutes. Box scores and the player index are built only
   when a page first needs them. Only Sleeper's documented public API is
   used (api.sleeper.app/v1), plus its image server for avatars and photos.

   Plain script, not a module, so every page can load it before its own. */
(function () {
  "use strict";

  const API = "https://api.sleeper.app/v1";
  const CDN = "https://sleepercdn.com";

  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const TTL = { finished: 30 * DAY, live: 3 * MINUTE, state: 10 * MINUTE, players: DAY, user: 10 * MINUTE };

  /* ------------------------------------------------------------ storage */

  /* A small key-value store in IndexedDB. Any failure (a private window, a
     blocked store) quietly falls back to memory for the visit. */
  const memory = new Map();
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open("league-history", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("kv");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (err) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }
  async function storeGet(key) {
    if (memory.has(key)) return memory.get(key);
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const req = d.transaction("kv").objectStore("kv").get(key);
        req.onsuccess = () => { if (req.result) memory.set(key, req.result); resolve(req.result || null); };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }
  async function storeSet(key, value) {
    memory.set(key, value);
    const d = await db();
    if (!d) return;
    try { d.transaction("kv", "readwrite").objectStore("kv").put(value, key); } catch (err) { /* memory only */ }
  }

  /* ------------------------------------------------------------ network */

  // A handful of requests at a time: a long history is a few hundred calls,
  // and Sleeper asks callers to stay well under a thousand a minute.
  const MAX_ACTIVE = 8;
  let active = 0;
  const queue = [];
  function slot() {
    if (active < MAX_ACTIVE) { active++; return Promise.resolve(); }
    return new Promise((resolve) => queue.push(resolve));
  }
  function release() {
    const next = queue.shift();
    if (next) next(); else active--;
  }

  async function fetchJSON(url, tries = 3) {
    await slot();
    try {
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          res = await fetch(url);
        } catch (err) {
          if (attempt + 1 >= tries) throw err;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        if (res.status === 404) return null;
        if (res.ok) {
          const text = await res.text();
          return text && text !== "null" ? JSON.parse(text) : null;
        }
        if (attempt + 1 >= tries) throw new Error(`Sleeper answered ${res.status}`);
        await new Promise((r) => setTimeout(r, (res.status === 429 ? 1500 : 400) * (attempt + 1)));
      }
    } finally {
      release();
    }
  }

  /* Read through the store: a copy younger than `ttl` is used as it is.
     An older copy is still returned if the network fails, so a flaky
     connection shows the league as it was rather than nothing. */
  async function cached(key, ttl, url) {
    const hit = await storeGet(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    try {
      const value = await fetchJSON(url);
      await storeSet(key, { t: Date.now(), v: value });
      return value;
    } catch (err) {
      if (hit) return hit.v;
      throw err;
    }
  }

  /* ------------------------------------------------------------ helpers */

  const round2 = (n) => Math.round(n * 100) / 100;
  const pointsOf = (m) => round2(m.custom_points != null ? m.custom_points : (m.points || 0));
  const fpts = (settings, key) => round2((settings[key] || 0) + (settings[`${key}_decimal`] || 0) / 100);
  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Sleeper's club codes, spelled the way the site's logos are named.
  const CLUB = { WAS: "WSH", JAC: "JAX", OAK: "LV", SD: "LAC", STL: "LAR", LA: "LAR" };
  const club = (code) => (code ? CLUB[code] || code : "FA");

  /* An NFL club is shown as its abbreviation on the club's colour (no logos:
     those belong to the NFL). The ink is worked out from the colour, so
     Pittsburgh's yellow gets black text and Philadelphia's green white. */
  const CLUB_COLOR = {
    ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D", CAR: "#0085CA", CHI: "#0B162A",
    CIN: "#FB4F14", CLE: "#311D00", DAL: "#041E42", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
    HOU: "#03202F", IND: "#002C5F", JAX: "#101820", KC: "#E31837", LAC: "#0080C6", LAR: "#003594",
    LV: "#111111", MIA: "#008E97", MIN: "#4F2683", NE: "#002244", NO: "#A08A5B", NYG: "#0B2265",
    NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SEA: "#002244", SF: "#AA0000", TB: "#D50A0A",
    TEN: "#0C2340", WSH: "#5A1414",
  };
  function clubStyle(abbr) {
    const hex = CLUB_COLOR[abbr];
    if (!hex) return "";
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return `background:${hex};color:${lum > 0.62 ? "#0b1726" : "#ffffff"}`;
  }

  /* Team colours. Each manager gets one for good, handed out in the order
     they joined, so no two in a league of up to twenty share one; larger
     leagues continue round the colour wheel. Muted, so white type and a
     logo both sit on them. */
  const PALETTE = [
    "#304f91", "#c05b2a", "#166a83", "#7c3945", "#719b70", "#b78d0a", "#4d3f93", "#9d542e",
    "#3a3c9d", "#6a78a7", "#2f7d5b", "#a23b72", "#5b6b2f", "#8a4f9e", "#1f5f8b", "#b0493b",
    "#3d7f8c", "#86632b", "#5a4a8a", "#7a6a55"
  ];
  function colorAt(i) {
    if (i < PALETTE.length) return PALETTE[i];
    const hue = (i * 137.5) % 360;
    return `hsl(${hue.toFixed(0)} 42% 38%)`;
  }

  /* A badge's fallback when there is no avatar: the team name's first
     character, which is its emoji when the name starts with one. */
  function iconFor(name) {
    const text = String(name || "").trim();
    if (!text) return "🏈";
    let first = text;
    try {
      if (window.Intl && Intl.Segmenter) first = [...new Intl.Segmenter().segment(text)][0].segment;
      else first = [...text][0];
    } catch (err) {
      first = [...text][0];
    }
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
  }

  const avatarUrl = (id) => (id ? `${CDN}/avatars/thumbs/${id}` : null);

  const SLOT_LABEL = {
    DEF: "D/ST", SUPER_FLEX: "SF", WRRB_FLEX: "W/R", REC_FLEX: "W/T", IDP_FLEX: "IDP",
    FLEX: "FLEX", BN: "BE", IR: "IR", TAXI: "TX"
  };
  const slotLabel = (s) => SLOT_LABEL[s] || s;

  /* ------------------------------------------------------------ standings */

  /* Sleeper's order: games won (a tie is half), then points for. The same
     comparison sets division tables, the playoff seeds and anyone left
     unplaced at the end of a season. */
  function compareTeams(a, b) {
    const wa = a.wins + (a.ties || 0) / 2, wb = b.wins + (b.ties || 0) / 2;
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  }

  /* Playoff seeds from a table of records: with divisions, every division's
     leader is seeded first, then everyone else in order. */
  function seedOrder(ids, stats, divisionOf, divisionCount) {
    const cmp = (a, b) => compareTeams(stats[a], stats[b]);
    const ordered = ids.slice().sort(cmp);
    if (!divisionCount || divisionCount < 2) return ordered;
    const leaders = [];
    const seen = new Set();
    ordered.forEach((id) => {
      const d = divisionOf(id);
      if (d != null && !seen.has(d)) { seen.add(d); leaders.push(id); }
    });
    return [...leaders, ...ordered.filter((id) => !leaders.includes(id))];
  }

  /* ------------------------------------------------------------ brackets */

  /* The weeks a bracket round is played over. Sleeper's round types: one
     week per round, a two-week championship, or two weeks per round. */
  function roundWeeks(settings, round, rounds) {
    const start = settings.playoffWeekStart;
    const type = settings.playoffRoundType || 0;
    if (type === 2) return [start + (round - 1) * 2, start + (round - 1) * 2 + 1];
    if (type === 1 && round === rounds) return [start + round - 1, start + round];
    return [start + round - 1];
  }

  function roundName(r, rounds) {
    const fromEnd = rounds - r;
    if (fromEnd === 0) return "Championship";
    if (fromEnd === 1) return "Semifinals";
    if (fromEnd === 2) return rounds === 3 ? "Round 1" : "Quarterfinals";
    return r === 1 ? "Round 1" : `Round ${r}`;
  }
  // What a single game of that round is called in a schedule or a box score.
  function gameName(r, rounds) {
    const fromEnd = rounds - r;
    if (fromEnd === 0) return "Championship";
    if (fromEnd === 1) return "Semifinal";
    if (fromEnd === 2) return "Quarterfinal";
    return `Playoffs · Round ${r}`;
  }
  const PLACE_NAME = { 3: "Third Place", 5: "Fifth Place", 7: "Seventh Place", 9: "Ninth Place", 11: "Eleventh Place" };
  const placeName = (p) => PLACE_NAME[p] || `${ordinal(p)} Place`;

  /* ------------------------------------------------------------ one season */

  function lastFinalWeek(league, state) {
    if (league.status === "complete") return 18;
    const s = league.settings || {};
    const scored = Number(s.last_scored_leg) || 0;
    if (!state || String(state.season) !== String(league.season)) {
      return Number(league.season) < Number(state && state.season) ? 18 : scored;
    }
    if (state.season_type === "pre") return 0;
    if (state.season_type === "post" || state.season_type === "off") return 18;
    return scored || Math.max(0, (Number(state.week) || 1) - 1);
  }

  async function loadSeasonRaw(leagueId, state) {
    const league = await cached(`league:${leagueId}`, TTL.live, `${API}/league/${leagueId}`);
    if (!league) return null;
    const finished = league.status === "complete";
    const ttl = finished ? TTL.finished : TTL.live;
    const [users, rosters, winners, losers] = await Promise.all([
      cached(`users:${leagueId}`, ttl, `${API}/league/${leagueId}/users`),
      cached(`rosters:${leagueId}`, ttl, `${API}/league/${leagueId}/rosters`),
      cached(`winners:${leagueId}`, ttl, `${API}/league/${leagueId}/winners_bracket`),
      cached(`losers:${leagueId}`, ttl, `${API}/league/${leagueId}/losers_bracket`),
    ]);
    // Keep the finished league itself for a month too.
    if (finished) await storeSet(`league:${leagueId}`, { t: Date.now() + TTL.finished - TTL.live, v: league });

    const s = league.settings || {};
    const pws = Number(s.playoff_week_start) || 0;
    const rounds = Math.max(0, ...(winners || []).map((m) => m.r));
    const lbRounds = Math.max(0, ...(losers || []).map((m) => m.r));
    const type = Number(s.playoff_round_type) || 0;
    let lastWeek = 17;
    if (pws) {
      const settings = { playoffWeekStart: pws, playoffRoundType: type };
      const r = Math.max(rounds, lbRounds);
      lastWeek = r ? Math.max(...roundWeeks(settings, r, rounds || r)) : pws - 1;
    }
    lastWeek = Math.min(18, Math.max(lastWeek, 1));
    const final = lastFinalWeek(league, state);
    const startWeek = Math.max(1, Number(s.start_week) || 1);

    const weeks = [];
    for (let w = startWeek; w <= lastWeek; w++) weeks.push(w);
    const matchups = {};
    await Promise.all(weeks.map(async (w) => {
      // A week already final keeps for a day even in a live season (stat
      // corrections land within one); later weeks are only a schedule.
      const weekTtl = finished ? TTL.finished : w <= final ? DAY : TTL.live;
      matchups[w] = (await cached(`matchups:${leagueId}:${w}`, weekTtl, `${API}/league/${leagueId}/matchups/${w}`)) || [];
    }));
    return { league, users: users || [], rosters: rosters || [], winners: winners || [], losers: losers || [], matchups, final, startWeek, lastWeek };
  }

  function buildSeason(raw) {
    const { league, users, rosters, winners, losers, matchups } = raw;
    const s = league.settings || {};
    const year = Number(league.season);
    const meta = league.metadata || {};
    const divisionCount = Number(s.divisions) || 0;
    const pws = Number(s.playoff_week_start) || 0;
    const rounds = Math.max(0, ...winners.map((m) => m.r));
    const settings = {
      numTeams: rosters.length || Number(league.total_rosters) || 0,
      startWeek: raw.startWeek,
      regularWeeks: pws ? pws - 1 : raw.lastWeek,
      playoffWeekStart: pws,
      playoffTeams: pws ? Number(s.playoff_teams) || 0 : 0,
      playoffRoundType: Number(s.playoff_round_type) || 0,
      playoffType: Number(s.playoff_type) || 0,
      rounds,
      lastWeek: raw.lastWeek,
      median: Number(s.league_average_match) === 1,
      divisions: [],
      rosterPositions: league.roster_positions || [],
      scoring: league.scoring_settings || {},
    };
    for (let d = 1; d <= divisionCount; d++) settings.divisions.push((meta[`division_${d}`] || `Division ${d}`).trim());
    // Byes: the seeds left over once round 1's games are filled.
    const openers = winners.filter((m) => m.r === 1).length;
    settings.byes = rounds > 1 ? Math.max(0, settings.playoffTeams - openers * 2) : 0;
    settings.weeksPerRound = (r) => roundWeeks(settings, r, rounds);

    const userById = new Map(users.map((u) => [u.user_id, u]));
    const teams = {};
    const idOf = (rid) => `r${rid}`;
    rosters.slice().sort((a, b) => a.roster_id - b.roster_id).forEach((r) => {
      const user = r.owner_id ? userById.get(r.owner_id) : null;
      const um = (user && user.metadata) || {};
      const name = String(um.team_name || (user ? user.display_name : `Team ${r.roster_id}`)).replace(/\s+/g, " ").trim();
      const division = divisionCount > 1 && r.settings && r.settings.division
        ? settings.divisions[r.settings.division - 1] || null : null;
      teams[idOf(r.roster_id)] = {
        rosterId: r.roster_id,
        name,
        ownerId: r.owner_id || `open-${league.league_id}-${r.roster_id}`,
        owner: user ? user.display_name : "Open roster",
        division,
        logo: um.avatar || avatarUrl(user && user.avatar),
        icon: iconFor(name),
        wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
        sleeper: { wins: (r.settings || {}).wins || 0, losses: (r.settings || {}).losses || 0, pf: fpts(r.settings || {}, "fpts") },
      };
    });
    const known = (rid) => teams[idOf(rid)] ? idOf(rid) : null;

    /* Every week's pairings, from the matchup ids. Weeks not yet final
       are only a schedule; a week that is final also has scores. */
    const schedule = {}, results = {}, medianResults = {};
    const byWeek = {};
    Object.keys(matchups).map(Number).sort((a, b) => a - b).forEach((w) => {
      const entries = matchups[w] || [];
      byWeek[w] = new Map(entries.map((m) => [m.roster_id, m]));
      if (w > settings.regularWeeks) return;
      const groups = new Map();
      entries.forEach((m) => {
        if (m.matchup_id == null || !known(m.roster_id)) return;
        if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
        groups.get(m.matchup_id).push(m);
      });
      const pairs = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g).filter((g) => g.length === 2);
      if (!pairs.length) return;
      schedule[w] = pairs.map(([a, b]) => [idOf(a.roster_id), idOf(b.roster_id)]);
      const scored = w <= raw.final && entries.some((m) => pointsOf(m) > 0);
      if (scored) {
        results[w] = pairs.map(([a, b]) => [idOf(a.roster_id), pointsOf(a), idOf(b.roster_id), pointsOf(b)]);
        if (settings.median) {
          // Against the league median: the top half of the week's scores
          // take an extra win, the bottom half an extra loss.
          const all = entries.filter((m) => known(m.roster_id)).map((m) => ({ id: idOf(m.roster_id), pts: pointsOf(m) }))
            .sort((x, y) => y.pts - x.pts);
          const half = Math.floor(all.length / 2);
          const cut = all.length % 2 ? null : (all[half - 1].pts + all[half].pts) / 2;
          medianResults[w] = {};
          all.forEach((t, i) => {
            medianResults[w][t.id] = cut != null && t.pts === cut ? "T" : i < half ? "W" : "L";
          });
        }
      }
    });
    const playedWeeks = Object.keys(results).map(Number).sort((a, b) => a - b);

    // Regular-season records, the median games counted as Sleeper counts them.
    playedWeeks.forEach((w) => {
      results[w].forEach(([a, as, b, bs]) => {
        [[a, as, bs], [b, bs, as]].forEach(([id, own, opp]) => {
          const t = teams[id];
          t.pf = round2(t.pf + own);
          t.pa = round2(t.pa + opp);
          if (own > opp) t.wins++; else if (own < opp) t.losses++; else t.ties++;
        });
      });
      Object.entries(medianResults[w] || {}).forEach(([id, r]) => {
        const t = teams[id];
        if (r === "W") t.wins++; else if (r === "L") t.losses++; else t.ties++;
      });
    });

    /* The brackets as played, each game numbered (m) within its bracket.
       Sleeper records the team that goes on as `w`. In the winner's bracket
       that is the team that won; a game with `p` settles places p and p + 1.

       The losers bracket is one of two things (settings.playoff_type):
         0, a toilet bowl (Sleeper's default): the team that LOSES goes on,
            so `w` is the lower score, and whoever goes on out of the p = 1
            game has lost their way to last place
         1, a consolation bracket: winners go on, as in the winner's bracket,
            and places count on from the last playoff seed
       Below, `winner` and `loser` are always who won and lost on the
       field; `advanced` is who Sleeper sent on. */
    const toilet = settings.playoffType === 0;
    settings.toiletBowl = toilet;
    const postseason = [];
    const scoreFor = (rid, weeks) => round2(weeks.reduce((sum, w) => {
      const m = byWeek[w] && byWeek[w].get(rid);
      return sum + (m ? pointsOf(m) : 0);
    }, 0));
    const lbRounds = Math.max(0, ...losers.map((m) => m.r));
    [["W", winners, rounds], ["L", losers, lbRounds]].forEach(([bracket, games, count]) => {
      games.forEach((g) => {
        const weeks = roundWeeks(settings, g.r, count);
        const played = g.w != null && g.l != null && weeks.every((w) => w <= raw.final);
        const a = g.t1 != null ? known(g.t1) : null;
        const b = g.t2 != null ? known(g.t2) : null;
        const titlePath = bracket === "W" && (!g.p || g.p === 1);
        const label = bracket === "W"
          ? (titlePath ? gameName(g.r, count) : placeName(g.p))
          : `Losers Bracket · Game ${g.m}`;
        const flip = bracket === "L" && toilet;
        postseason.push({
          bracket, m: g.m, r: g.r, p: g.p || null, titlePath, label,
          weeks, week: weeks[weeks.length - 1],
          a, b,
          aScore: a && played ? scoreFor(g.t1, weeks) : null,
          bScore: b && played ? scoreFor(g.t2, weeks) : null,
          winner: played ? known(flip ? g.l : g.w) : null,
          loser: played ? known(flip ? g.w : g.l) : null,
          advanced: played ? known(g.w) : null,
          played,
          from: { a: g.t1_from || null, b: g.t2_from || null },
        });
      });
    });

    // Final places, where the season has settled them.
    const ids = Object.keys(teams);
    const place = {};
    postseason.forEach((g) => {
      if (!g.played || !g.p) return;
      if (g.bracket === "L" && toilet) {
        // Counted up from the bottom: the p = 1 game's loser is last.
        place[g.loser] = ids.length - g.p + 1;
        place[g.winner] = ids.length - g.p;
        return;
      }
      const base = g.bracket === "W" ? 0 : settings.playoffTeams;
      place[g.winner] = base + g.p;
      place[g.loser] = base + g.p + 1;
    });
    const standing = seedOrder(ids, teams, (id) => teams[id].division, divisionCount);
    standing.forEach((id, i) => { teams[id].regularRank = i + 1; });
    // A league Sleeper calls complete that never scored a game was abandoned
    // before it started: nothing was settled, so nothing is ranked.
    const finished = league.status === "complete" && (playedWeeks.length > 0 || postseason.some((g) => g.played));
    if (finished) {
      const taken = new Set(Object.values(place));
      let next = 1;
      standing.filter((id) => !place[id]).forEach((id) => {
        while (taken.has(next)) next++;
        place[id] = next;
        taken.add(next);
      });
      ids.forEach((id) => { teams[id].finalRank = place[id]; });
    }

    // Owners of this season's teams, in a stable order for colours.
    const titleGame = postseason.find((g) => g.bracket === "W" && g.p === 1);
    const champion = titleGame && titleGame.played ? titleGame.winner : null;
    const byPlace = (n) => ids.find((id) => place[id] === n) || null;
    const lastPlace = finished ? byPlace(ids.length) : null;
    const lastGame = lastPlace
      ? postseason.filter((g) => g.played && (g.winner === lastPlace || g.loser === lastPlace) && g.loser === lastPlace && g.p)
        .sort((x, y) => y.week - x.week)[0] || null
      : null;

    return {
      year,
      leagueId: league.league_id,
      name: league.name,
      avatar: league.avatar ? avatarUrl(league.avatar) : null,
      status: league.status,
      finished,
      live: !finished,
      preseason: !finished && playedWeeks.length === 0,
      settings,
      teams,
      schedule,
      results,
      medianResults,
      playedWeeks,
      lastFinal: raw.final,
      postseason,
      winnersBracket: winners,
      losersBracket: losers,
      champion,
      runnerUp: finished ? byPlace(2) : null,
      lastPlace,
      titleGame: titleGame && titleGame.played ? titleGame : null,
      lastPlaceGame: lastGame,
      standing,
      matchups,
    };
  }

  const hasGames = (season) => season.playedWeeks.length > 0 || season.postseason.some((g) => g.played);

  /* ------------------------------------------------------------ the league */

  let nflState = null;
  async function state() {
    if (!nflState) nflState = cached("state:nfl", TTL.state, `${API}/state/nfl`).catch(() => null);
    return nflState;
  }

  const models = new Map();

  /* The league and every season before it. `onProgress(done, total)` hears
     as seasons arrive, for a loading line. */
  function load(leagueId, { onProgress } = {}) {
    const id = String(leagueId || "").trim();
    if (!/^\d{6,}$/.test(id)) return Promise.reject(new Error("That isn't a Sleeper league id."));
    if (!models.has(id)) {
      const job = (async () => {
        const st = await state();
        const chain = [];
        let next = id;
        const seen = new Set();
        while (next && next !== "0" && !seen.has(next) && chain.length < 30) {
          seen.add(next);
          const league = await cached(`league:${next}`, TTL.live, `${API}/league/${next}`);
          if (!league) break;
          chain.push(next);
          next = league.previous_league_id;
        }
        if (!chain.length) throw new Error("Sleeper has no league with that id.");
        let done = 0;
        if (onProgress) onProgress(0, chain.length);
        const raws = await Promise.all(chain.map(async (lid) => {
          const raw = await loadSeasonRaw(lid, st);
          done++;
          if (onProgress) onProgress(done, chain.length);
          return raw;
        }));
        const seasons = raws.filter(Boolean).map(buildSeason).sort((a, b) => a.year - b.year);
        // An abandoned season (no game ever scored) is left out, unless it
        // is the newest, which may simply not have started.
        const newest = seasons[seasons.length - 1];
        const kept = seasons.filter((season) => season === newest || hasGames(season));
        // Two leagues can claim the same year (a league restarted mid-summer);
        // keep the one that was played.
        const byYear = new Map();
        kept.forEach((season) => {
          const had = byYear.get(season.year);
          if (!had || (!hasGames(had) && hasGames(season))) byYear.set(season.year, season);
        });
        return buildModel(id, [...byYear.values()].sort((a, b) => a.year - b.year), st);
      })();
      models.set(id, job);
      job.catch(() => models.delete(id));
    }
    return models.get(id);
  }

  function buildModel(id, seasons, st) {
    // Managers in the order they first appear, each with a colour for good.
    const owners = {};
    const order = [];
    seasons.forEach((season) => {
      Object.values(season.teams).sort((a, b) => a.rosterId - b.rosterId).forEach((team) => {
        if (!owners[team.ownerId]) {
          owners[team.ownerId] = { name: team.owner, currentTeam: team.name, icon: team.icon, color: null, logo: team.logo };
          order.push(team.ownerId);
        }
        const o = owners[team.ownerId];
        // Their latest season names them: team, avatar and display name.
        o.name = team.owner;
        o.currentTeam = team.name;
        o.icon = team.icon;
        if (team.logo) o.logo = team.logo;
        o.lastYear = season.year;
      });
    });
    order.forEach((ownerId, i) => { owners[ownerId].color = colorAt(i); });
    seasons.forEach((season) => {
      Object.values(season.teams).forEach((team) => { team.color = owners[team.ownerId].color; });
    });

    const newest = seasons[seasons.length - 1];
    const logos = {};
    Object.entries(owners).forEach(([oid, o]) => { if (o.logo) logos[oid] = o.logo; });

    const model = {
      leagueId: id,
      name: newest ? newest.name : "League",
      avatar: [...seasons].reverse().map((s) => s.avatar).find(Boolean) || null,
      state: st,
      seasons,
      owners,
      logos,
      current: newest,
      // The season a visit opens on: the newest one, unless it has not even
      // been scheduled yet (a league rolled over for next year), in which
      // case the last one played.
      opening: [...seasons].reverse().find((s) => s.playedWeeks.length || Object.keys(s.schedule).length) || newest,
      season: (year) => seasons.find((s) => s.year === Number(year)) || null,
      leagueData: () => toLeagueData(model),
      boxWeek: (year, week) => boxWeek(model, year, week),
      boxWeeks: (year) => boxWeeksOf(model, year),
      roster: (year) => rosterOf(model, year),
      starters: () => startersOf(model),
      playerIndex: () => playerIndexOf(model),
    };
    return model;
  }

  /* The record-book shape: finished seasons carry their final places;
     the season being played carries its regular season so far. */
  function toLeagueData(model) {
    const seasons = model.seasons.filter(hasGames).map((season) => {
      const regularGames = [];
      season.playedWeeks.forEach((w) => season.results[w].forEach(([a, aScore, b, bScore]) =>
        regularGames.push({ week: w, a, aScore, b, bScore })));
      const postseasonGames = season.postseason.filter((g) => g.played && g.a && g.b).map((g) => ({
        week: g.week, a: g.a, aScore: g.aScore, b: g.b, bScore: g.bScore, label: g.label,
        bracket: g.bracket, titlePath: g.titlePath, p: g.p, r: g.r,
      }));
      const teams = {};
      Object.entries(season.teams).forEach(([id, t]) => {
        teams[id] = {
          ownerId: t.ownerId, name: t.name, owner: t.owner, division: t.division,
          wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa,
          finalRank: t.finalRank, icon: t.icon, color: t.color,
          divisionChamp: false,
        };
      });
      // Division winners: the regular-season leader of each division.
      if (season.settings.divisions.length > 1 && season.playedWeeks.length) {
        season.settings.divisions.forEach((d) => {
          const lead = season.standing.find((id) => season.teams[id].division === d);
          if (lead && season.finished) teams[lead].divisionChamp = true;
        });
      }
      return {
        year: season.year,
        live: !season.finished,
        throughWeek: season.playedWeeks.length ? season.playedWeeks[season.playedWeeks.length - 1] : 0,
        regularWeeks: season.settings.regularWeeks,
        teams, regularGames, postseasonGames,
      };
    });
    return { owners: model.owners, seasons, name: model.name };
  }

  /* ------------------------------------------------------------ players */

  /* Every NFL player's name, position and club. Sleeper asks that its
     players file be fetched at most once a day and kept on our side, so a
     scheduled job (tools/update-players.py) copies it into this site each
     morning as data/players.json, [name, position, Sleeper's club code] per
     player, and pages read that copy, never Sleeper's. Kept for a day; only
     fetched once something needs a name: a box score, starters, a search. */
  let playersPromise = null;
  function players() {
    if (!playersPromise) {
      playersPromise = (async () => {
        const hit = await storeGet("players:site");
        if (hit && Date.now() - hit.t < TTL.players) return hit.v;
        try {
          const all = await fetchJSON("data/players.json");
          const slim = {};
          Object.entries(all || {}).forEach(([pid, p]) => { slim[pid] = [p[0], p[1], club(p[2])]; });
          if (!Object.keys(slim).length) throw new Error("no players");
          await storeSet("players:site", { t: Date.now(), v: slim });
          return slim;
        } catch (err) {
          return hit ? hit.v : {};
        }
      })();
    }
    return playersPromise;
  }
  function playerInfo(db, pid) {
    const p = db[pid];
    if (p) return { name: p[0], pos: p[1], nfl: p[2] };
    // A defence Sleeper's file has lost track of is still its club.
    if (/^[A-Z]{2,3}$/.test(pid)) return { name: `${pid} D/ST`, pos: "DST", nfl: club(pid) };
    return { name: `Player ${pid}`, pos: "?", nfl: "FA" };
  }

  /* One team's lineup for a week, in the order Sleeper lists its slots:
     the starters, then the bench by points. */
  function lineup(season, entry, db) {
    const slots = season.settings.rosterPositions.filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI");
    const starters = (entry.starters || []);
    const pts = entry.players_points || {};
    const out = [];
    const started = new Set();
    starters.forEach((pid, i) => {
      const slot = slotLabel(slots[i] || "FLEX");
      if (!pid || pid === "0") return;
      started.add(pid);
      const info = playerInfo(db, pid);
      out.push({ id: pid, ...info, slot, pts: round2(pts[pid] || 0), proj: null, starter: true, injury: null });
    });
    const reserve = new Set(entry.reserve || []);
    (entry.players || []).filter((pid) => !started.has(pid)).map((pid) => {
      const info = playerInfo(db, pid);
      return { id: pid, ...info, slot: reserve.has(pid) ? "IR" : "BE", pts: round2(pts[pid] || 0),
        proj: null, starter: false, injury: null };
    }).sort((a, b) => b.pts - a.pts).forEach((p) => out.push(p));
    return out;
  }

  /* A week's games with both lineups, in the shape the box score reads. */
  function weekGames(season, week) {
    const entries = season.matchups[week] || [];
    const groups = new Map();
    entries.forEach((m) => {
      if (m.matchup_id == null || !season.teams[`r${m.roster_id}`]) return;
      if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
      groups.get(m.matchup_id).push(m);
    });
    return [...groups.values()].filter((g) => g.length === 2);
  }

  const weekIsFinal = (season, week) => week <= season.lastFinal &&
    (season.matchups[week] || []).some((m) => pointsOf(m) > 0);

  function boxWeeksOf(model, year) {
    const season = model.season(year);
    if (!season) return Promise.resolve(new Set());
    return Promise.resolve(new Set(Object.keys(season.matchups).map(Number).filter((w) => weekIsFinal(season, w))));
  }

  async function boxWeek(model, year, week) {
    const season = model.season(year);
    if (!season || !weekIsFinal(season, week)) return null;
    const db = await players();
    const games = weekGames(season, week).map(([a, b]) => ({
      home: `r${a.roster_id}`, away: `r${b.roster_id}`,
      homeScore: pointsOf(a), awayScore: pointsOf(b),
      lineups: { [`r${a.roster_id}`]: lineup(season, a, db), [`r${b.roster_id}`]: lineup(season, b, db) },
    }));
    return { season: season.year, week, games, projected: false };
  }

  /* Every player a team used, week by week, for the team drawer's
     starters strip. Built from the matchups; a week is
     [points, started (1/0), club]. */
  const rosterJobs = new Map();
  function rosterOf(model, year) {
    const season = model.season(year);
    if (!season) return Promise.resolve(null);
    if (!rosterJobs.has(year)) {
      rosterJobs.set(year, players().then((db) => {
        const out = {};
        Object.keys(season.matchups).map(Number).sort((a, b) => a - b).forEach((week) => {
          if (!weekIsFinal(season, week)) return;
          weekGames(season, week).flat().forEach((entry) => {
            const teamId = `r${entry.roster_id}`;
            const team = (out[teamId] = out[teamId] || { weeks: [], players: {} });
            team.weeks.push(week);
            lineup(season, entry, db).forEach((p) => {
              const r = (team.players[p.id] = team.players[p.id] || { id: p.id, name: p.name, pos: p.pos, starts: 0, pts: 0, clubs: {}, weeks: {} });
              r.weeks[week] = [p.pts, p.starter ? 1 : 0, p.nfl];
              if (p.starter) {
                r.starts++;
                r.pts += p.pts;
                r.clubs[p.nfl] = (r.clubs[p.nfl] || 0) + 1;
              }
            });
          });
        });
        Object.values(out).forEach((team) => {
          team.players = Object.values(team.players)
            .filter((p) => p.starts)
            .sort((a, b) => b.starts - a.starts || b.pts - a.pts)
            .map((p) => ({ ...p, pts: round2(p.pts), clubs: Object.entries(p.clubs).sort((a, b) => b[1] - a[1]).map(([c]) => c) }));
        });
        return out;
      }));
    }
    return rosterJobs.get(year);
  }

  /* Each manager's ten most-started players across every season, for the
     all-time page's profile panel. */
  let startersJob = null;
  function startersOf(model) {
    if (!startersJob) {
      startersJob = players().then((db) => {
        const tally = {};
        const ownerSeasons = {};
        model.seasons.forEach((season) => {
          Object.keys(season.matchups).map(Number).sort((a, b) => a - b).forEach((week) => {
            if (!weekIsFinal(season, week)) return;
            weekGames(season, week).flat().forEach((entry) => {
              const team = season.teams[`r${entry.roster_id}`];
              const owner = team.ownerId;
              (ownerSeasons[owner] = ownerSeasons[owner] || new Set()).add(season.year);
              const list = (tally[owner] = tally[owner] || {});
              lineup(season, entry, db).forEach((p) => {
                if (!p.starter) return;
                const t = (list[p.id] = list[p.id] || { id: p.id, name: p.name, pos: p.pos, nfl: p.nfl, starts: 0, years: {} });
                t.starts++;
                const y = (t.years[season.year] = t.years[season.year] || { n: 0, clubs: {} });
                y.n++;
                y.clubs[p.nfl] = (y.clubs[p.nfl] || 0) + 1;
                t.nfl = p.nfl;
                t.pos = p.pos;
              });
            });
          });
        });
        const owners = {};
        Object.entries(tally).forEach(([owner, list]) => {
          const lastYear = (p) => Math.max(...Object.keys(p.years).map(Number));
          owners[owner] = {
            seasons: [...ownerSeasons[owner]].sort((a, b) => a - b),
            players: Object.values(list)
              .sort((a, b) => b.starts - a.starts || lastYear(b) - lastYear(a) || a.name.localeCompare(b.name))
              .slice(0, 10)
              .map((p) => ({ ...p, years: Object.fromEntries(Object.entries(p.years).map(([yr, y]) =>
                [yr, [y.n, ...Object.entries(y.clubs).sort((a, b) => b[1] - a[1]).map(([c]) => c)]])) })),
          };
        });
        return { seasons: model.seasons.map((s) => s.year), owners };
      });
    }
    return startersJob;
  }

  /* Every player's whole history in the league, for the player card and
     the search:
       seasons, regularWeeks { season: n }
       teams   { season: { teamId: [name, ownerId, owner, color] } }
       games   { season: { week: { teamId: [oppId, score, oppScore, label] } } }
       players [{ id, n, p, h, r: [[season, week, teamId, slot, pts, proj, club], ...] }] */
  let indexJob = null;
  function playerIndexOf(model) {
    if (!indexJob) {
      indexJob = players().then((db) => {
        const out = { seasons: [], regularWeeks: {}, teams: {}, games: {}, players: [] };
        const byId = new Map();
        model.seasons.forEach((season) => {
          const weeks = Object.keys(season.matchups).map(Number).filter((w) => weekIsFinal(season, w)).sort((a, b) => a - b);
          if (!weeks.length) return;
          out.seasons.push(season.year);
          out.regularWeeks[season.year] = season.settings.regularWeeks;
          out.teams[season.year] = Object.fromEntries(Object.entries(season.teams)
            .map(([id, t]) => [id, [t.name, t.ownerId, t.owner, t.color]]));
          const games = (out.games[season.year] = {});
          weeks.forEach((week) => {
            const wk = (games[week] = {});
            const label = (a, b) => {
              if (week <= season.settings.regularWeeks) return null;
              const g = season.postseason.find((x) => x.weeks.includes(week) &&
                ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
              return g ? g.label : "Consolation";
            };
            weekGames(season, week).forEach(([ea, eb]) => {
              const a = `r${ea.roster_id}`, b = `r${eb.roster_id}`;
              wk[a] = [b, pointsOf(ea), pointsOf(eb), label(a, b)];
              wk[b] = [a, pointsOf(eb), pointsOf(ea), label(b, a)];
              [[a, ea], [b, eb]].forEach(([teamId, entry]) => {
                lineup(season, entry, db).forEach((p) => {
                  if (!byId.has(p.id)) byId.set(p.id, { id: p.id, n: p.name, p: p.pos, h: p.pos === "DST" ? null : p.id, r: [] });
                  byId.get(p.id).r.push([season.year, week, teamId, p.slot, p.pts, null, p.nfl]);
                });
              });
            });
          });
        });
        out.players = [...byId.values()].sort((a, b) => a.n.localeCompare(b.n));
        return out;
      });
    }
    return indexJob;
  }

  /* ------------------------------------------------------------ accounts */

  async function user(username) {
    const name = String(username || "").trim();
    if (!name) throw new Error("Enter a Sleeper username.");
    const u = await cached(`user:${name.toLowerCase()}`, TTL.user, `${API}/user/${encodeURIComponent(name)}`);
    if (!u || !u.user_id) throw new Error(`Sleeper has no user called “${name}”.`);
    return { id: u.user_id, username: u.username, name: u.display_name || u.username, avatar: avatarUrl(u.avatar) };
  }

  /* A user's leagues, newest season first, one entry per league history:
     a league that continued into a later season is shown once, as its
     newest season, with how far back it goes. */
  async function leaguesFor(userId) {
    const st = await state();
    const newest = Number((st && (st.league_season || st.season)) || new Date().getFullYear());
    const years = [];
    for (let y = newest; y >= newest - 9; y--) years.push(y);
    const lists = await Promise.all(years.map((y) =>
      cached(`userleagues:${userId}:${y}`, y === newest ? TTL.user : DAY, `${API}/user/${userId}/leagues/nfl/${y}`).catch(() => [])));
    const all = [];
    lists.forEach((list) => (list || []).forEach((l) => all.push(l)));
    const byId = new Map(all.map((l) => [l.league_id, l]));
    const continued = new Set(all.map((l) => l.previous_league_id).filter((p) => p && byId.has(p)));
    const heads = all.filter((l) => !continued.has(l.league_id));
    const seasonsBack = (l) => {
      let n = 1, first = Number(l.season), cur = l;
      while (cur.previous_league_id && byId.has(cur.previous_league_id)) {
        cur = byId.get(cur.previous_league_id);
        n++;
        first = Number(cur.season);
      }
      return { n, first, more: Boolean(cur.previous_league_id && cur.previous_league_id !== "0") };
    };
    return heads
      .map((l) => ({
        id: l.league_id,
        name: l.name,
        season: Number(l.season),
        status: l.status,
        teams: l.total_rosters,
        avatar: avatarUrl(l.avatar),
        history: seasonsBack(l),
      }))
      .sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
  }

  /* ------------------------------------------------------------ navigation */

  // The league a page is showing, from ?league= in its address.
  const params = new URLSearchParams(location.search);
  const pageLeague = params.get("league");

  /* A link to another page of the same league. `page` is alltime, season or
     trophy; `extra` adds search parameters, `hash` a fragment. */
  function url(page, extra = {}, hash = "") {
    const q = new URLSearchParams();
    if (pageLeague) q.set("league", pageLeague);
    Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== "") q.set(k, v); });
    const file = page === "home" ? "index.html" : `${page}.html`;
    const qs = q.toString();
    return `${file}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
  }

  // Recently opened leagues, remembered on this device for the sign-in page.
  const RECENT_KEY = "lh-recent-leagues";
  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (err) { return []; }
  }
  function remember(entry) {
    try {
      const list = recent().filter((x) => x.id !== entry.id);
      list.unshift({ ...entry, at: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
    } catch (err) { /* private mode: nothing to remember */ }
  }
  function forget(id) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent().filter((x) => x.id !== id))); } catch (err) { /* ignore */ }
  }
  const USER_KEY = "lh-sleeper-user";
  function savedUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (err) { return null; } }
  function saveUser(u) { try { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); } catch (err) { /* ignore */ } }

  /* The season menu in every page's header: All-Time, then each season,
     newest first. `selected` is "home" or a year. */
  function fillSeasonMenu(select, model, selected) {
    if (!select) return;
    const years = model.seasons.map((s) => s.year).sort((a, b) => b - a);
    select.innerHTML = `<option value="home">All-Time</option>${years.map((y) => `<option value="${y}">${y}</option>`).join("")}` +
      `<option value="switch">Switch league…</option>`;
    select.value = String(selected);
    select.addEventListener("change", () => {
      const v = select.value;
      location.href = v === "home" ? url("alltime") : v === "switch" ? "index.html" : url("season", { season: v });
    });
  }

  /* Brand, links and menu shared by the header of every page: the league's
     own name and avatar in place of the site's, and every link carrying the
     league along. */
  function dressHeader(model, selected) {
    const brand = document.querySelector(".brand");
    if (brand) {
      brand.href = url("alltime");
      const kicker = brand.querySelector(".brand-kicker");
      if (kicker) kicker.textContent = model.name;
      const img = brand.querySelector(".brand-mark img");
      if (img && model.avatar) {
        img.src = model.avatar;
        img.crossOrigin = "anonymous";
        img.closest(".brand-mark").classList.add("league-avatar");
        img.addEventListener("error", () => { img.src = "icons/crest.png"; img.closest(".brand-mark").classList.remove("league-avatar"); }, { once: true });
      }
    }
    const trophy = document.querySelector(".topbar-trophy");
    if (trophy) trophy.href = url("trophy");
    fillSeasonMenu(document.querySelector("#yearSelect, #pageSelect"), model, selected);
  }

  /* Sends anyone who arrives without a league to the sign-in page. */
  function requireLeague() {
    if (pageLeague) return pageLeague;
    location.replace("index.html");
    return null;
  }

  /* A page's loading line and failure note, drawn in the page's own card. */
  function showStatus(target, { title, copy, error = false }) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    el.innerHTML = `<div class="empty-state lh-status${error ? " lh-error" : ""}">
      ${error ? "" : '<span class="lh-spinner" aria-hidden="true"></span>'}
      <strong>${esc(title)}</strong><p>${copy}</p>
      ${error ? `<p><a class="lh-status-link" href="index.html">Choose a league</a></p>` : ""}
    </div>`;
  }

  window.League = {
    load, user, leaguesFor, players, state,
    url, recent, remember, forget, savedUser, saveUser,
    dressHeader, fillSeasonMenu, requireLeague, showStatus,
    compareTeams, seedOrder, roundName, gameName, placeName, roundWeeks,
    ordinal, esc, club, clubStyle, param: (k) => params.get(k), leagueId: pageLeague,
  };
})();
