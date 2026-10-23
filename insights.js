/* The front office: what a league's history says about the people running
   the teams, worked out from what sleeper.js loads.

     Insights.lineupWeek(model, year, week)   every team's lineup against the
                                              best one it could have set
     Insights.lineupSeason(model, year)       the same, for a season, with the
                                              games a lineup cost and the worst
                                              benchings
     Insights.lineupAllTime(model)            each manager's record across all
     Insights.trades(model)                   every trade, what each side got
                                              and what it has scored for them
     Insights.waivers(model, year)            every pickup and what it scored
     Insights.pickLedger(model)               who holds whose future picks

   Everything is hindsight: points actually scored, never projections
   (Sleeper's API terms rule those out). "Scored for them" always means
   points a player put up in a team's starting lineup, the only points that
   count toward a result.

   Plain script, loaded after sleeper.js. */
(function () {
  "use strict";

  const round2 = (n) => Math.round(n * 100) / 100;

  /* ------------------------------------------------------------ lineups */

  // The fantasy position a real one plays as, where Sleeper's players file
  // only gives the real one.
  const IMPLIED = {
    DE: "DL", DT: "DL", NT: "DL", CB: "DB", S: "DB", SS: "DB", FS: "DB",
    ILB: "LB", OLB: "LB", MLB: "LB", DST: "DEF", DEF: "DEF",
  };
  // Who may fill each of Sleeper's lineup slots.
  const SLOT = {
    QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
    DL: ["DL"], LB: ["LB"], DB: ["DB"],
    FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"], IDP_FLEX: ["DL", "LB", "DB"],
  };
  const NOT_STARTING = new Set(["BN", "IR", "TAXI"]);
  const slotTakes = (slot) => SLOT[slot] || [slot];

  function eligibleOf(db, pid) {
    const p = db[pid];
    if (!p) return /^[A-Z]{2,3}$/.test(pid) ? ["DEF"] : [];
    if (p[3]) return p[3];
    return [IMPLIED[p[1]] || p[1]];
  }

  /* The assignment problem, exactly (Hungarian method): n slots against m
     players, cheapest total cost, every slot filled. Lineups are a dozen
     slots against a few dozen players, so this is instant. */
  function assign(cost) {
    const n = cost.length, m = cost[0].length, INF = Infinity;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const out = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
    return out;
  }

  /* The best lineup a team could have set from the players it had: every
     slot filled by someone allowed in it, or left empty (a slot can be, and
     an empty one beats a kicker who went negative). */
  function bestLineup(slots, pool) {
    if (!slots.length) return { total: 0, picks: [] };
    const BIG = 1e7;
    const cols = pool.length + slots.length; // one "leave it empty" per slot
    const cost = slots.map((slot) => {
      const takes = slotTakes(slot);
      const row = new Array(cols).fill(0);
      pool.forEach((pl, j) => { row[j] = pl.elig.some((e) => takes.includes(e)) ? -pl.pts : BIG; });
      return row;
    });
    const pick = assign(cost);
    const picks = slots.map((slot, i) => {
      const j = pick[i];
      return j >= 0 && j < pool.length && cost[i][j] < BIG ? { slot, pid: pool[j].pid, pts: pool[j].pts } : { slot, pid: null, pts: 0 };
    });
    return { total: round2(picks.reduce((s, x) => s + x.pts, 0)), picks };
  }

  // Players a team started at any point in the season: a taxi player who
  // appears here was promoted, and was startable.
  const startedCache = new WeakMap();
  function startedBy(season) {
    if (!startedCache.has(season)) {
      const out = {};
      Object.values(season.matchups).forEach((entries) => (entries || []).forEach((e) => {
        const set = (out[`r${e.roster_id}`] = out[`r${e.roster_id}`] || new Set());
        (e.starters || []).forEach((pid) => { if (pid && pid !== "0") set.add(pid); });
      }));
      startedCache.set(season, out);
    }
    return startedCache.get(season);
  }

  const finalWeeks = (season) => Object.keys(season.matchups).map(Number).sort((a, b) => a - b)
    .filter((w) => w <= season.lastFinal && (season.matchups[w] || []).some((m) => (m.points || m.custom_points || 0) > 0));

  /* One team's week: what it scored, what it could have, and its costliest
     call (the benched player who would have added most, and the starter he
     should have replaced). */
  function teamWeek(season, entry, db) {
    const teamId = `r${entry.roster_id}`;
    const team = season.teams[teamId];
    if (!team) return null;
    const slots = season.settings.rosterPositions.filter((p) => !NOT_STARTING.has(p));
    const pts = entry.players_points || {};
    const starters = (entry.starters || []).slice(0, slots.length);
    const actual = round2(starters.reduce((s, pid) => s + (pid && pid !== "0" ? pts[pid] || 0 : 0), 0));
    const started = startedBy(season)[teamId] || new Set();
    const taxi = new Set((team.taxi || []).filter((pid) => !started.has(pid)));
    // Nor can a player on injured reserve that week.
    const ir = new Set(entry.reserve || []);
    const pool = [...new Set(entry.players || [])]
      .filter((pid) => pid && pid !== "0" && !taxi.has(pid) && !ir.has(pid))
      .map((pid) => ({ pid, pts: round2(pts[pid] || 0), elig: eligibleOf(db, pid) }));
    const best = bestLineup(slots, pool);
    const optimal = Math.max(best.total, actual);

    const chosen = new Set(starters);
    const bestSet = new Set(best.picks.map((x) => x.pid).filter(Boolean));
    const benched = best.picks.filter((x) => x.pid && !chosen.has(x.pid)).sort((a, b) => b.pts - a.pts);
    const wasted = starters.map((pid, i) => ({ pid, slot: slots[i], pts: pid && pid !== "0" ? round2(pts[pid] || 0) : 0 }))
      .filter((x) => !x.pid || x.pid === "0" || !bestSet.has(x.pid)).sort((a, b) => a.pts - b.pts);
    let blunder = null;
    if (benched.length && wasted.length) {
      const top = benched[0];
      const elig = eligibleOf(db, top.pid);
      const swap = wasted.find((x) => slotTakes(x.slot).some((e) => elig.includes(e))) || wasted[0];
      blunder = {
        benched: { pid: top.pid, pts: top.pts },
        started: swap.pid && swap.pid !== "0" ? { pid: swap.pid, pts: swap.pts } : null,
        cost: round2(top.pts - (swap.pts || 0)),
      };
    }
    return { teamId, ownerId: team.ownerId, actual, optimal, left: round2(optimal - actual), blunder };
  }

  async function lineupWeek(model, year, week) {
    const season = model.season(year);
    if (!season) return null;
    const db = await window.League.players();
    const entries = (season.matchups[week] || []).filter((e) => e.matchup_id != null);
    const rows = entries.map((e) => teamWeek(season, e, db)).filter(Boolean);
    const byTeam = Object.fromEntries(rows.map((r) => [r.teamId, r]));
    /* A regular-season loss the best lineup would have won. A game over
       several weeks (season.multiWeeks) is scored in its last, on all its
       weeks' points, so every one of its weeks' bench points count. */
    const span = (season.multiWeeks || {})[week] || [week];
    const leftOver = {};
    span.filter((w) => w !== week).forEach((w) => {
      (season.matchups[w] || []).filter((e) => e.matchup_id != null).forEach((e) => {
        const r = teamWeek(season, e, db);
        if (r) leftOver[r.teamId] = (leftOver[r.teamId] || 0) + r.left;
      });
    });
    (season.results[week] || []).forEach(([a, as, b, bs]) => {
      [[a, as, bs], [b, bs, as]].forEach(([id, own, opp]) => {
        const r = byTeam[id];
        if (!r) return;
        if (span.length > 1) r.gameBest = round2(own + r.left + (leftOver[id] || 0));
        r.costGame = own < opp && (span.length > 1 ? r.gameBest : r.optimal) > opp;
      });
    });
    return { year, week, rows: rows.sort((x, y) => y.left - x.left), byTeam };
  }

  const seasonCache = new Map();
  function lineupSeason(model, year) {
    const key = `${model.leagueId}:${year}`;
    if (!seasonCache.has(key)) {
      seasonCache.set(key, (async () => {
        const season = model.season(year);
        if (!season) return null;
        const weeks = await Promise.all(finalWeeks(season).map((w) => lineupWeek(model, year, w)));
        const teams = {};
        const blunders = [];
        const lostGames = [];
        weeks.forEach((wk) => wk.rows.forEach((r) => {
          const t = (teams[r.teamId] = teams[r.teamId] || { teamId: r.teamId, ownerId: r.ownerId, weeks: 0, actual: 0, optimal: 0, left: 0, perfect: 0, costGames: 0 });
          t.weeks++;
          t.actual += r.actual;
          t.optimal += r.optimal;
          t.left += r.left;
          if (r.left < 0.005) t.perfect++;
          if (r.costGame) { t.costGames++; lostGames.push({ week: wk.week, ...r }); }
          if (r.blunder && r.blunder.cost > 0) blunders.push({ week: wk.week, teamId: r.teamId, ownerId: r.ownerId, ...r.blunder });
        }));
        const rows = Object.values(teams).map((t) => ({
          ...t, actual: round2(t.actual), optimal: round2(t.optimal), left: round2(t.left),
          efficiency: t.optimal ? t.actual / t.optimal : 1,
        })).sort((a, b) => b.efficiency - a.efficiency);
        blunders.sort((a, b) => b.cost - a.cost);
        return { year, weeks: weeks.map((w) => w.week), rows, blunders, lostGames };
      })());
    }
    return seasonCache.get(key);
  }

  async function lineupAllTime(model) {
    const seasons = await Promise.all(model.seasons.filter((s) => s.playedWeeks.length).map((s) => lineupSeason(model, s.year)));
    const owners = {};
    seasons.filter(Boolean).forEach((s) => s.rows.forEach((r) => {
      const o = (owners[r.ownerId] = owners[r.ownerId] || { ownerId: r.ownerId, seasons: 0, weeks: 0, actual: 0, optimal: 0, left: 0, perfect: 0, costGames: 0 });
      o.seasons++;
      ["weeks", "actual", "optimal", "left", "perfect", "costGames"].forEach((k) => { o[k] += r[k]; });
    }));
    return Object.values(owners).map((o) => ({
      ...o, actual: round2(o.actual), optimal: round2(o.optimal), left: round2(o.left),
      efficiency: o.optimal ? o.actual / o.optimal : 1,
    })).sort((a, b) => b.efficiency - a.efficiency);
  }

  /* ------------------------------------------------------------ what a player scored for a manager */

  /* Every starting-lineup point in the league's history, by manager and
     player: the ledger trades and pickups are judged against. Managers, not
     rosters, because a roster id can change hands between seasons. */
  const ledgerCache = new WeakMap();
  function startLedger(model) {
    if (!ledgerCache.has(model)) {
      const ledger = new Map();
      model.seasons.forEach((season) => {
        finalWeeks(season).forEach((week) => {
          (season.matchups[week] || []).forEach((e) => {
            if (e.matchup_id == null) return;
            const team = season.teams[`r${e.roster_id}`];
            if (!team) return;
            const pts = e.players_points || {};
            (e.starters || []).forEach((pid) => {
              if (!pid || pid === "0") return;
              const key = `${team.ownerId}|${pid}`;
              if (!ledger.has(key)) ledger.set(key, []);
              ledger.get(key).push({ year: season.year, week, pts: pts[pid] || 0 });
            });
          });
        });
      });
      ledgerCache.set(model, ledger);
    }
    return ledgerCache.get(model);
  }
  // Points a player scored in a manager's lineup from a given week on.
  function scoredFor(model, ownerId, pid, year, week, sameSeason = false) {
    const rows = startLedger(model).get(`${ownerId}|${pid}`) || [];
    let total = 0, starts = 0;
    rows.forEach((r) => {
      const after = r.year > year ? !sameSeason : r.year === year && r.week >= week;
      if (after) { total += r.pts; starts++; }
    });
    return { pts: round2(total), starts };
  }

  /* ------------------------------------------------------------ trades */

  function draftLookup(drafts) {
    // season -> the draft that season's picks were made in
    const bySeason = {};
    drafts.filter((d) => d.done).forEach((d) => {
      if (!bySeason[d.year] || d.picks.length > bySeason[d.year].picks.length) bySeason[d.year] = d;
    });
    return (season, round, originalRid) => {
      const d = bySeason[Number(season)];
      if (!d) return null;
      const slot = Object.entries(d.slotToRoster).find(([, rid]) => Number(rid) === Number(originalRid));
      if (!slot) return null;
      const pick = d.picks.find((p) => p.round === round && Number(p.slot) === Number(slot[0]));
      return pick ? { ...pick, year: d.year, leagueYear: d.leagueYear } : null;
    };
  }

  async function trades(model) {
    const [txns, drafts] = await Promise.all([model.transactions(), model.drafts()]);
    const db = await window.League.players();
    const resolve = draftLookup(drafts);
    const nameOf = (pid) => (db[pid] ? db[pid][0] : `Player ${pid}`);
    const out = [];

    model.seasons.forEach((season) => {
      (txns[season.year] || []).filter((t) => t.type === "trade" && t.status === "complete").forEach((t) => {
        const week = Math.max(1, Number(t.leg) || 1);
        const sides = (t.roster_ids || []).map((rid) => {
          const team = season.teams[`r${rid}`];
          return team ? { rid, teamId: `r${rid}`, ownerId: team.ownerId, got: [], total: 0 } : null;
        }).filter(Boolean);
        const side = (rid) => sides.find((s) => s.rid === Number(rid));

        Object.entries(t.adds || {}).forEach(([pid, rid]) => {
          const s = side(rid);
          if (!s) return;
          const from = side((t.drops || {})[pid]);
          const v = scoredFor(model, s.ownerId, pid, season.year, week);
          s.got.push({ kind: "player", pid, name: nameOf(pid), pos: db[pid] ? db[pid][1] : "", from: from && from.teamId, pts: v.pts, starts: v.starts });
        });
        (t.draft_picks || []).forEach((pk) => {
          const s = side(pk.owner_id);
          if (!s) return;
          const from = side(pk.previous_owner_id);
          const made = resolve(pk.season, pk.round, pk.roster_id);
          const item = { kind: "pick", season: Number(pk.season), round: pk.round, origin: `r${pk.roster_id}`, from: from && from.teamId, pts: 0, starts: 0 };
          if (made && made.pid) {
            const picker = model.season(made.leagueYear) && model.season(made.leagueYear).teams[`r${made.rosterId}`];
            item.became = { pid: made.pid, name: nameOf(made.pid), no: made.no };
            if (picker && picker.ownerId === s.ownerId) {
              const v = scoredFor(model, s.ownerId, made.pid, made.year, 1);
              item.pts = v.pts;
              item.starts = v.starts;
            } else item.passedOn = true; // traded on before it was used
          } else item.pending = true;
          s.got.push(item);
        });
        (t.waiver_budget || []).forEach((b) => {
          const s = side(b.receiver);
          const from = side(b.sender);
          if (s) s.got.push({ kind: "faab", amount: b.amount, from: from && from.teamId, pts: 0, starts: 0 });
        });

        sides.forEach((s) => { s.total = round2(s.got.reduce((n, g) => n + g.pts, 0)); });
        const ranked = sides.slice().sort((a, b) => b.total - a.total);
        const pending = sides.some((s) => s.got.some((g) => g.pending));
        out.push({
          id: t.transaction_id, year: season.year, week, created: t.created,
          sides, winner: ranked.length > 1 && ranked[0].total > ranked[1].total ? ranked[0].teamId : null,
          margin: ranked.length > 1 ? round2(ranked[0].total - ranked[1].total) : 0,
          pending, live: season.live,
        });
      });
    });
    out.sort((a, b) => (b.created || 0) - (a.created || 0));
    return { trades: out, traders: tradersOf(out) };
  }

  /* Each manager across a set of trades (all of them, or one season's):
     what they got, and what what they gave away went on to score for
     whoever took it. */
  function tradersOf(list) {
    const owners = {};
    list.forEach((tr) => tr.sides.forEach((s) => {
      const o = (owners[s.ownerId] = owners[s.ownerId] || { ownerId: s.ownerId, teamId: s.teamId, trades: 0, won: 0, got: 0, gave: 0 });
      o.trades++;
      if (tr.winner === s.teamId) o.won++;
      o.got += s.total;
      tr.sides.filter((x) => x !== s).forEach((x) => x.got.filter((g) => g.from === s.teamId).forEach((g) => { o.gave += g.pts; }));
    }));
    return Object.values(owners).map((o) => ({ ...o, got: round2(o.got), gave: round2(o.gave), net: round2(o.got - o.gave) }))
      .sort((a, b) => b.net - a.net);
  }

  /* ------------------------------------------------------------ waivers */

  async function waivers(model, year) {
    const season = model.season(year);
    if (!season) return null;
    const txns = (await model.transactions())[year] || [];
    const db = await window.League.players();
    const faab = season.settings.waiverType === 2;
    const seen = new Set();
    const pickups = [];
    const spent = {};
    let failed = 0;
    txns.forEach((t) => {
      if (t.type !== "waiver" && t.type !== "free_agent") return;
      if (t.status !== "complete") { if (t.type === "waiver") failed++; return; }
      Object.entries(t.adds || {}).forEach(([pid, rid]) => {
        const team = season.teams[`r${rid}`];
        if (!team) return;
        // Every claim is paid for, a player claimed back included.
        const bid = t.type === "waiver" && t.settings && t.settings.waiver_bid != null ? Number(t.settings.waiver_bid) : null;
        spent[`r${rid}`] = (spent[`r${rid}`] || 0) + (bid || 0);
        const key = `${team.ownerId}|${pid}`;
        if (seen.has(key)) return; // the first time they got him covers his points
        seen.add(key);
        const week = Math.max(1, Number(t.leg) || 1);
        const v = scoredFor(model, team.ownerId, pid, year, week, true);
        pickups.push({
          teamId: `r${rid}`, ownerId: team.ownerId, pid, name: db[pid] ? db[pid][0] : `Player ${pid}`,
          pos: db[pid] ? db[pid][1] : "", week, kind: t.type, bid, pts: v.pts, starts: v.starts,
        });
      });
    });
    const teams = {};
    pickups.forEach((p) => {
      const t = (teams[p.teamId] = teams[p.teamId] || { teamId: p.teamId, ownerId: p.ownerId, adds: 0, spent: 0, pts: 0, hits: 0 });
      t.adds++;
      t.spent = spent[p.teamId];
      t.pts += p.pts;
      if (p.starts >= 3) t.hits++;
    });
    const rows = Object.values(teams).map((t) => ({ ...t, pts: round2(t.pts), perDollar: faab && t.spent ? t.pts / t.spent : null }))
      .sort((a, b) => b.pts - a.pts);
    return {
      year, faab, budget: season.settings.waiverBudget, failed,
      pickups: pickups.slice().sort((a, b) => b.pts - a.pts),
      rows,
    };
  }

  /* ------------------------------------------------------------ future picks */

  /* Who holds every future pick: each roster starts with its own, and
     Sleeper's traded-picks list says where the traded ones went. Shown for
     the seasons still to be drafted, three ahead as Sleeper allows. */
  async function pickLedger(model) {
    const newest = model.seasons[model.seasons.length - 1];
    if (!newest) return null;
    const [traded, drafts] = await Promise.all([model.tradedPicks(), model.drafts()]);
    const rounds = newest.settings.draftRounds || Math.max(0, ...traded.map((t) => t.round));
    if (!rounds) return null;
    const drafted = drafts.some((d) => d.leagueYear === newest.year && d.done);
    const start = drafted ? newest.year + 1 : newest.year;
    const years = new Set([start, start + 1, start + 2]);
    traded.forEach((t) => { if (Number(t.season) >= start) years.add(Number(t.season)); });
    const seasons = [...years].sort((a, b) => a - b);
    const teamIds = Object.keys(newest.teams).sort((a, b) => newest.teams[a].rosterId - newest.teams[b].rosterId);

    const holdings = Object.fromEntries(teamIds.map((id) => [id, []]));
    seasons.forEach((year) => {
      for (let round = 1; round <= rounds; round++) {
        teamIds.forEach((orig) => {
          const rid = newest.teams[orig].rosterId;
          const move = traded.find((t) => Number(t.season) === year && t.round === round && t.roster_id === rid);
          const holder = move ? `r${move.owner_id}` : orig;
          if (holdings[holder]) holdings[holder].push({ year, round, origin: orig, own: holder === orig });
        });
      }
    });
    // A pick's weight for a rough comparison of pick capital: a first is
    // worth the most, each later round a little over half the one before.
    const weight = (round) => Math.pow(0.55, round - 1);
    const rows = teamIds.map((id) => {
      const picks = holdings[id];
      const lost = [];
      seasons.forEach((year) => {
        for (let round = 1; round <= rounds; round++) {
          if (!picks.some((p) => p.year === year && p.round === round && p.origin === id)) lost.push({ year, round });
        }
      });
      const byYear = Object.fromEntries(seasons.map((year) => [year, picks.filter((p) => p.year === year).reduce((s, p) => s + weight(p.round), 0)]));
      return { teamId: id, ownerId: newest.teams[id].ownerId, picks, lost, byYear, capital: picks.reduce((s, p) => s + weight(p.round), 0) };
    });
    const parYear = [...Array(rounds)].reduce((s, _, i) => s + weight(i + 1), 0);
    const par = seasons.length * parYear;
    rows.forEach((r) => { r.vsPar = par ? r.capital / par : 1; });
    return { year: newest.year, seasons, rounds, parYear, rows: rows.sort((a, b) => b.capital - a.capital), anyTraded: traded.length > 0 };
  }

  window.Insights = { lineupWeek, lineupSeason, lineupAllTime, trades, tradersOf, waivers, pickLedger, bestLineup };
})();

/* The rivalry preview: one game between two managers, read against the
   league's whole history.

     Insights.rivalry(model, year, week, a, b, { records })
       a, b      the game's team ids that season ("r3"); each is followed
                 to its manager (team.ownerId), the way the record book
                 follows managers across seasons (model.leagueData())
       records   optional { teamId: "5–3" }, the records going in as the
                 page already shows them

   Answers plain data (the app's bridge hands it over as JSON): both
   managers this season and for their careers, the all-time series
   (regular season, playoffs and consolation games apart and together,
   the streak, the last meeting, the biggest win each way, every meeting),
   and the stakes: specific, reachable things this one game can settle,
   drawn from the league's history alone, never from projections (Sleeper's
   API terms rule those out). A game already played lists what was on the
   line going in, each marked with whether it happened.

   Counted as the record book counts them: records and points for are the
   regular season's (with the median game where the league plays one);
   the playoffs are the title path's games; streaks and the single-week
   record run through every game, consolation games included, and a game
   over two weeks is kept out of one-week marks. */
(function () {
  "use strict";

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (n) => Number(n).toFixed(1);
  const round2 = (n) => Math.round(n * 100) / 100;
  const rec = (w, l, t) => (t ? `${w}–${l}–${t}` : `${w}–${l}`);
  const pctOf = (w, l, t) => { const g = w + l + t; return g ? (w + t / 2) / g : 0; };
  const pctText = (p) => p.toFixed(3).replace(/^0/, "");
  const ordinal = (n) => {
    const m = n % 100;
    if (m >= 11 && m <= 13) return `${n}th`;
    return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
  };
  const poss = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
  const span = (from, to) => (from === to ? String(to) : `${from}–${String(to).slice(2)}`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

  /* ------------------------------------------------------------ history */

  /* Every game the league has played, oldest first, each side as its
     manager, and the median games beside them: built once per model. */
  const histories = new WeakMap();
  function historyOf(model) {
    if (histories.has(model)) return histories.get(model);
    const data = model.leagueData();
    const games = [], medians = [], seasons = {};
    [...data.seasons].sort((x, y) => x.year - y.year).forEach((s) => {
      const full = model.season(s.year);
      seasons[s.year] = s;
      const owner = (id) => (s.teams[id] ? s.teams[id].ownerId : null);
      const add = (g, kind) => {
        const oa = owner(g.a), ob = owner(g.b);
        if (!oa || !ob) return;
        games.push({
          year: s.year, week: g.week, kind, ta: g.a, tb: g.b, oa, ob, as: g.aScore, bs: g.bScore,
          multi: Boolean(g.multi), label: g.label || null, bracket: g.bracket || null, p: g.p || null, r: g.r || null,
        });
      };
      [...s.regularGames].sort((x, y) => x.week - y.week).forEach((g) => add(g, "regular"));
      // The season being played carries its bracket games too, once played.
      const post = s.live && full
        ? full.postseason.filter((g) => g.played && g.a && g.b).map((g) => ({
          week: g.week, a: g.a, aScore: g.aScore, b: g.b, bScore: g.bScore, label: g.label,
          bracket: g.bracket, titlePath: g.titlePath, p: g.p, r: g.r, multi: g.weeks.length > 1,
        }))
        : s.postseasonGames;
      [...post].sort((x, y) => x.week - y.week).forEach((g) => add(g, g.titlePath ? "playoffs" : "consolation"));
      if (full && full.medianResults) {
        Object.entries(full.medianResults).forEach(([w, byTeam]) => {
          Object.entries(byTeam).forEach(([id, r]) => { if (owner(id)) medians.push({ year: s.year, week: Number(w), o: owner(id), r }); });
        });
      }
    });
    const champions = {};
    data.seasons.forEach((s) => {
      if (s.live) return;
      const champ = Object.values(s.teams).find((t) => t.finalRank === 1);
      if (champ) champions[s.year] = champ.ownerId;
    });
    const h = { data, games, medians, seasons, champions };
    histories.set(model, h);
    return h;
  }

  const before = (x, year, week) => x.year < year || (x.year === year && x.week < week);

  /* Every manager as the record book tallies them, over the games that
     pass `keep`. */
  function tally(h, keep) {
    const M = {};
    const m = (o) => M[o] || (M[o] = {
      w: 0, l: 0, t: 0, games: 0, pf: 0, pw: 0, pl: 0, pt: 0, post: 0,
      run: 0, from: null, best: null, lossRun: 0, lossFrom: null, worst: null, high: null,
    });
    const league = { high: null, scores: [] };
    h.games.forEach((g) => {
      if (!keep(g)) return;
      [[g.oa, g.as, g.bs, g.ob, g.ta], [g.ob, g.bs, g.as, g.oa, g.tb]].forEach(([o, mine, theirs, opp, team]) => {
        const p = m(o);
        if (g.kind === "regular") {
          p.games += 1;
          p.pf += mine;
          if (mine > theirs) p.w += 1; else if (mine < theirs) p.l += 1; else p.t += 1;
        } else if (g.kind === "playoffs") {
          p.post += 1;
          if (mine > theirs) p.pw += 1; else if (mine < theirs) p.pl += 1; else p.pt += 1;
        }
        if (mine > theirs) {
          p.run += 1;
          if (p.run === 1) p.from = g.year;
          if (!p.best || p.run > p.best.n) p.best = { n: p.run, from: p.from, to: g.year };
        } else p.run = 0;
        if (mine < theirs) {
          p.lossRun += 1;
          if (p.lossRun === 1) p.lossFrom = g.year;
          if (!p.worst || p.lossRun > p.worst.n) p.worst = { n: p.lossRun, from: p.lossFrom, to: g.year };
        } else p.lossRun = 0;
        if (!g.multi) {
          if (!p.high || mine > p.high.pts) p.high = { pts: mine, year: g.year, week: g.week, team };
          if (!league.high || mine > league.high.pts) league.high = { pts: mine, year: g.year, week: g.week, o, team };
          league.scores.push(mine);
        }
      });
    });
    h.medians.forEach((x) => {
      if (!keep(x)) return;
      const p = m(x.o);
      if (x.r === "W") p.w += 1; else if (x.r === "L") p.l += 1; else p.t += 1;
    });
    league.scores.sort((x, y) => x - y);
    const best = (key) => Object.entries(M).reduce((top, [o, p]) => (p[key] && (!top || p[key].n > top.n) ? { ...p[key], o } : top), null);
    league.streak = best("best");
    league.skid = best("worst");
    return { M, m, league };
  }

  // The share of the league's single-week scores at or above `x`.
  function shareAtLeast(scores, x) {
    if (!scores.length) return 0;
    let lo = 0, hi = scores.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scores[mid] < x) lo = mid + 1; else hi = mid; }
    return (scores.length - lo) / scores.length;
  }

  /* ------------------------------------------------------------ series */

  function seriesOf(h, oa, ob, keep) {
    const games = h.games.filter((g) => keep(g) && ((g.oa === oa && g.ob === ob) || (g.oa === ob && g.ob === oa)))
      .map((g) => {
        const flip = g.oa !== oa;
        return { ...g, ta: flip ? g.tb : g.ta, tb: flip ? g.ta : g.tb, as: flip ? g.bs : g.as, bs: flip ? g.as : g.bs, oa, ob };
      });
    const zero = () => ({ a: 0, b: 0, t: 0, games: 0 });
    const out = { games: games.length, all: zero(), regular: zero(), playoffs: zero(), consolation: zero(), list: games };
    let run = { side: null, n: 0 }, longest = { side: null, n: 0 };
    const pf = { a: 0, b: 0, n: 0 };
    const big = { a: null, b: null };
    games.forEach((g) => {
      const side = g.as > g.bs ? "a" : g.bs > g.as ? "b" : null;
      [out.all, out[g.kind]].forEach((r) => { r.games += 1; if (side) r[side] += 1; else r.t += 1; });
      run = side && run.side === side ? { side, n: run.n + 1 } : { side, n: side ? 1 : 0 };
      if (run.side && run.n > longest.n) longest = { ...run, to: g.year };
      if (!g.multi) {
        pf.a += g.as; pf.b += g.bs; pf.n += 1;
        if (side && (!big[side] || Math.abs(g.as - g.bs) > big[side].margin)) big[side] = { margin: Math.abs(g.as - g.bs), game: g };
      }
    });
    out.streak = run;
    out.longest = longest;
    out.avg = pf.n ? { a: pf.a / pf.n, b: pf.b / pf.n } : null;
    out.biggest = big;
    // Seasons one side won every regular-season meeting of (two or more).
    out.sweeps = { a: [], b: [] };
    const byYear = {};
    games.filter((g) => g.kind === "regular").forEach((g) => { (byYear[g.year] = byYear[g.year] || []).push(g); });
    Object.entries(byYear).forEach(([y, list]) => {
      if (list.length < 2) return;
      if (list.every((g) => g.as > g.bs)) out.sweeps.a.push(Number(y));
      if (list.every((g) => g.bs > g.as)) out.sweeps.b.push(Number(y));
    });
    return out;
  }

  /* ------------------------------------------------------------ the game */

  function locate(season, week, a, b) {
    const pair = (x, y) => (x === a && y === b) || (x === b && y === a);
    const regular = week <= season.settings.regularWeeks;
    if (regular) {
      // A two-week matchup is scored in the week it ends.
      let end = week;
      Object.entries(season.multiWeeks || {}).forEach(([e, weeks]) => { if (weeks.includes(week)) end = Number(e); });
      const scheduled = (season.schedule[week] || []).some(([x, y]) => pair(x, y));
      const row = (season.results[end] || []).find(([x, , y]) => pair(x, y));
      const score = row ? (row[0] === a ? { a: row[1], b: row[3] } : { a: row[3], b: row[1] }) : null;
      return { kind: "regular", label: `Week ${week}`, end, start: Math.min(week, ...(season.multiWeeks && season.multiWeeks[end] || [week])), scheduled, score, game: null };
    }
    const g = season.postseason.find((x) => x.weeks.includes(week) && x.a && x.b && pair(x.a, x.b)) || null;
    const score = g && g.played ? (g.a === a ? { a: g.aScore, b: g.bScore } : { a: g.bScore, b: g.aScore }) : null;
    return {
      kind: g ? (g.titlePath ? "playoffs" : "consolation") : "playoffs",
      label: g ? g.label : `Week ${week}`, end: g ? g.week : week, start: g ? g.weeks[0] : week,
      scheduled: Boolean(g), score, game: g,
    };
  }

  // Both teams' records going into the week (regular season so far).
  function seasonRecord(season, id, upTo) {
    let w = 0, l = 0, t = 0, pf = 0;
    Object.keys(season.results).map(Number).filter((wk) => wk < upTo).forEach((wk) => {
      season.results[wk].forEach(([x, xs, y, ys]) => {
        if (x !== id && y !== id) return;
        const mine = x === id ? xs : ys, theirs = x === id ? ys : xs;
        pf += mine;
        if (mine > theirs) w++; else if (mine < theirs) l++; else t++;
      });
      const med = season.medianResults && season.medianResults[wk] && season.medianResults[wk][id];
      if (med === "W") w++; else if (med === "L") l++; else if (med === "T") t++;
    });
    return { w, l, t, pf };
  }

  /* ------------------------------------------------------------ stakes */

  function stakesFor(ctx) {
    const { h, loc, side, opp, name, oppName, owners, before: T, series, season, a, b, median } = ctx;
    const items = [];
    const add = (rank, kind, text, cond, extra = {}) => items.push({ side: side.key, rank, kind, text, cond, ...extra });
    const me = T.M[side.owner] || T.m(side.owner), them = T.M[opp.owner] || T.m(opp.owner);
    const L = T.league;
    const isRegular = loc.kind === "regular";
    // The series, always from this side's seat: "a" is this side.
    const s = series;
    const mine = "a", theirs = "b";
    const ownerName = (o) => (owners[o] ? owners[o].name : "a manager");

    /* --- the title game */
    if (loc.game && loc.game.bracket === "W" && loc.game.p === 1 && loc.game.titlePath) {
      const titles = Object.entries(h.champions).filter(([y, o]) => Number(y) < ctx.year && o === side.owner).map(([y]) => Number(y));
      const lastYear = h.champions[ctx.year - 1] === side.owner;
      add(100, "title", titles.length
        ? `A win gives ${name} a ${ordinal(titles.length + 1)} title${lastYear ? ", back to back" : ""}`
        : `A win gives ${name} a first title`, { when: "win" }, { tone: "gold" });
    }

    /* --- playoff firsts */
    if (loc.kind === "playoffs") {
      if (me.post === 0) add(62, "playoffs", `${poss(name)} first playoff game`, { when: "always" }, { tone: "gold" });
      else if (me.pw === 0) add(78, "playoffs", `A win would be ${poss(name)} first playoff win (0–${me.pl + me.pt} so far)`, { when: "win" }, { tone: "gold" });
      else if ([5, 10, 15, 20].includes(me.pw + 1)) add(44, "playoffs", `A win would be ${poss(name)} ${ordinal(me.pw + 1)} playoff win`, { when: "win" }, { tone: "gold" });
    }

    /* --- the series */
    const won = s.all[mine], lost = s.all[theirs], ties = s.all.t;
    // Said once, for both sides.
    if (side.key === "a") {
      const both = (rank, kind, text, cond, extra) => items.push({ side: null, rank, kind, text, cond, ...extra });
      if (!s.games) both(55, "first-meeting", `The first meeting between these two managers`, { when: "always" }, { tone: "navy" });
      else if (won === lost) both(s.games >= 4 ? 50 : 30, "series-lead", `The all-time series is tied ${rec(won, lost, ties)}: the winner takes the lead`, { when: "decided" }, { tone: "blue" });
      // A playoff meeting this season or last, met again.
      const rematch = s.list.filter((g) => g.kind === "playoffs").pop();
      if (rematch && (loc.kind === "playoffs" || rematch.year >= ctx.year - 1)) {
        const who = rematch.as > rematch.bs ? name : rematch.bs > rematch.as ? oppName : null;
        both(loc.kind === "playoffs" ? 46 : 36, "rematch", `A${loc.kind === "playoffs" ? " playoff" : ""} rematch of the ${rematch.year} ${rematch.label}${who ? `, won by ${who}` : ""}`, { when: "always" }, { tone: "gold" });
      }
    }
    if (s.games >= 2 && won === 0) {
      add(60 + Math.min(s.games, 8) * 3, "first-win", `A win would be ${poss(name)} first ever over ${oppName} (${rec(0, lost, ties)})`, { when: "win" }, { tone: "red" });
    } else if (s.streak.side === theirs && s.streak.n >= 2) {
      add(Math.min(80, 38 + 5 * s.streak.n), "series-streak", `A win would snap a ${s.streak.n}-game losing streak to ${oppName}`, { when: "win" }, { tone: "blue" });
    }
    if (s.streak.side === mine && s.streak.n >= 2) {
      const n = s.streak.n + 1;
      if (n > s.longest.n && s.games >= 5) add(45 + 4 * s.streak.n, "series-streak", `A win makes it ${n} straight over ${oppName}, the longest run in the series`, { when: "win" }, { tone: "blue" });
      else if (s.streak.n >= 3) add(25 + 3 * s.streak.n, "series-streak", `A win makes it ${n} straight over ${oppName}`, { when: "win" }, { tone: "blue" });
    }
    if (s.games > 0 && won + 1 === lost) {
      add(48, "series-lead", `A win evens the all-time series at ${rec(lost, lost, ties)}`, { when: "win" }, { tone: "blue" });
    }
    if (s.games >= 4 && won + 1 >= 10 && (won + 1) % 5 === 0) {
      add(30, "series-wins", `A win would be ${poss(name)} ${ordinal(won + 1)} over ${oppName}`, { when: "win" }, { tone: "blue" });
    }
    // The season series: this the last meeting, the others all won.
    if (isRegular) {
      const meetingWeeks = Object.keys(season.schedule).map(Number).filter((w) => {
        let end = w;
        Object.entries(season.multiWeeks || {}).forEach(([e, weeks]) => { if (weeks.includes(w)) end = Number(e); });
        return end === w && w <= season.settings.regularWeeks &&
          season.schedule[w].some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      });
      const prior = s.list.filter((g) => g.year === ctx.year && g.kind === "regular");
      const last = meetingWeeks.length && Math.max(...meetingWeeks) === loc.end;
      if (last && prior.length >= 1) {
        const iWon = prior.every((g) => g.as > g.bs);
        const theyWon = prior.every((g) => g.bs > g.as);
        if (iWon) {
          const first = !s.sweeps[mine].length;
          add(first ? 70 : 56, "sweep", `A win gives ${name} ${first ? "a first" : "a"} season sweep of ${oppName}${first ? "" : ` (${s.sweeps[mine].length === 1 ? "also" : "after"} ${s.sweeps[mine].join(", ")})`}`, { when: "win" }, { tone: "purple" });
        } else if (theyWon) {
          add(26, "sweep", `A win splits the season series and keeps ${oppName} from a sweep`, { when: "win" }, { tone: "purple" });
        }
      }
    }

    /* --- streaks across the league */
    const r = me.run;
    const top = L.streak;
    let streakItem = null;
    if (top && top.n >= 4 && r + 1 > top.n) {
      streakItem = top.o === side.owner && r === top.n
        ? [88, `A win extends ${poss(name)} league-record win streak to ${r + 1}`]
        : [90, `A win gives ${name} the league’s longest win streak ever (${r + 1})`];
    } else if (top && top.n >= 4 && r + 1 === top.n) {
      streakItem = [80, `Win and ${name} ties the league’s longest win streak (${top.n}, ${ownerName(top.o)}, ${span(top.from, top.to)})`];
    } else if (r >= 2 && me.best && me.best.n >= 3 && r + 1 > me.best.n) {
      streakItem = [60, `A win would be ${poss(name)} longest win streak ever (${r + 1})`];
    } else if (r >= 2 && me.best && r + 1 === me.best.n) {
      streakItem = [52, `A win matches ${poss(name)} longest win streak (${me.best.n}, ${span(me.best.from, me.best.to)})`];
    } else if (r >= 3) {
      streakItem = [22 + 3 * r, `${name} has won ${r} straight; a win makes it ${r + 1}`];
    }
    if (streakItem) add(streakItem[0], "win-streak", streakItem[1], { when: "win" }, { tone: "fire" });

    const l = me.lossRun;
    const skid = L.skid;
    let skidItem = null;
    if (skid && skid.n >= 4 && l + 1 > skid.n) {
      skidItem = [72, `Lose and ${name} sets the league’s longest losing streak (${l + 1})`, "lose"];
    } else if (skid && skid.n >= 4 && l + 1 === skid.n) {
      skidItem = [66, `Lose and ${name} ties the league’s longest losing streak (${skid.n}, ${ownerName(skid.o)}, ${span(skid.from, skid.to)})`, "lose"];
    } else if (l >= 2 && me.worst && me.worst.n >= 3 && l + 1 > me.worst.n) {
      skidItem = [50, `Lose and it’s ${poss(name)} longest losing streak ever (${l + 1})`, "lose"];
    } else if (l >= 2 && me.worst && l + 1 === me.worst.n) {
      skidItem = [45, `Lose and it matches ${poss(name)} longest losing streak (${me.worst.n}, ${span(me.worst.from, me.worst.to)})`, "lose"];
    } else if (l >= 3) {
      skidItem = [Math.min(70, 30 + 5 * l), `A win would snap ${poss(name)} ${l}-game losing streak`, "win"];
    }
    if (skidItem) add(skidItem[0], "loss-streak", skidItem[1], { when: skidItem[2] }, { tone: "red" });

    /* --- career marks (the regular season's, as the record book keeps) */
    if (isRegular) {
      const next = me.w + 1;
      if (next === 10 || next % 25 === 0) {
        add(next === 10 ? 34 : 45 + (next % 100 === 0 ? 20 : next % 50 === 0 ? 10 : 0), "wins",
          median ? `${name} is one win from ${next} regular-season wins` : `A win would be ${poss(name)} ${ordinal(next)} regular-season win`,
          { when: "win" }, { tone: "gold" });
      }
      const g = me.w + me.l + me.t;
      if (g >= 10 && !median) {
        const now = pctOf(me.w, me.l, me.t), up = pctOf(me.w + 1, me.l, me.t), down = pctOf(me.w, me.l + 1, me.t);
        if (now < 0.5 && up >= 0.5) add(42, "500", up === 0.5 ? `A win gets ${name} back to .500 all-time (${rec(me.w, me.l, me.t)} now)` : `A win lifts ${name} over .500 all-time (${rec(me.w, me.l, me.t)} now)`, { when: "win" }, { tone: "blue" });
        else if (now >= 0.5 && down < 0.5) add(40, "500", `A loss drops ${name} under .500 all-time (${rec(me.w, me.l, me.t)} now)`, { when: "lose" }, { tone: "red" });
      }
      if (me.games > 0 && (me.games + 1) % 50 === 0) {
        add(18, "games", `${poss(name)} ${ordinal(me.games + 1)} regular-season game`, { when: "always" }, { tone: "navy" });
      }
      // All-time points for, the next thousand.
      const mark = Math.ceil((me.pf + 0.005) / 1000) * 1000;
      const need = Math.round((mark - me.pf) * 100) / 100;
      if (me.games >= 4 && shareAtLeast(L.scores, need) >= 0.25) {
        add(28 + (mark % 10000 === 0 ? 18 : mark % 5000 === 0 ? 10 : 0), "points",
          `${fmt(need)} points takes ${name} past ${mark.toLocaleString("en-US")} all-time points`, { when: "score", score: need }, { tone: "navy" });
      }
    }

    /* --- one-week highs */
    if (me.high && (me.games + me.post) >= 8) {
      const need = Math.round((me.high.pts + 0.01) * 100) / 100;
      const share = shareAtLeast(L.scores, need);
      if (share >= 0.05) {
        let text = `${fmt(need)} points sets ${poss(name)} career high (${fmt(me.high.pts)}, ${me.high.year})`;
        if (L.high && L.high.o === side.owner && L.high.pts === me.high.pts) text = `${fmt(need)} points breaks the league single-week record, ${poss(name)} own ${fmt(L.high.pts)} (${L.high.year})`;
        else if (L.high) text += `; ${fmt(L.high.pts + 0.01)} breaks the league record`;
        add(Math.round(32 + 18 * share), "high", text, { when: "score", score: need }, { tone: "fire" });
      }
    }
    return items;
  }

  // Each kind of stake as the record book marks its highlights.
  const STAKE_ICONS = {
    title: "🏆", playoffs: "🏅", rematch: "🔁", "first-meeting": "🤝", "first-win": "🎯",
    "series-streak": "⚔️", "series-lead": "⚖️", "series-wins": "⚔️", sweep: "🧹",
    "win-streak": "📈", "loss-streak": "🧊", wins: "⭐", 500: "⚖️", games: "📅", points: "💯", high: "🔥",
  };

  // The most interesting first, at most `cap`, with each side heard.
  function pick(items, cap) {
    const sorted = [...items].sort((x, y) => y.rank - x.rank);
    const out = sorted.slice(0, cap);
    ["a", "b"].forEach((side) => {
      if (out.some((x) => x.side === side)) return;
      const best = sorted.find((x) => x.side === side);
      if (!best) return;
      if (out.length < cap) { out.push(best); return; }
      // In place of the lowest item of the side that has the most.
      const other = side === "a" ? "b" : "a";
      const idx = out.map((x) => x.side).lastIndexOf(other);
      if (idx >= 0) out[idx] = best;
    });
    return out.sort((x, y) => y.rank - x.rank);
  }

  /* ------------------------------------------------------------ answer */

  function rivalry(model, year, week, a, b, opts = {}) {
    year = Number(year); week = Number(week);
    const season = model.season(year);
    if (!season) throw new Error(`There is no ${year} season.`);
    if (!season.teams[a] || !season.teams[b]) throw new Error("Those teams aren't in this season.");
    const h = historyOf(model);
    const loc = locate(season, week, a, b);
    const median = Boolean(season.settings.median);
    const owners = model.owners;
    const oa = season.teams[a].ownerId, ob = season.teams[b].ownerId;
    const keepBefore = (x) => before(x, year, loc.start);
    const keepAll = () => true;
    const T0 = tally(h, keepBefore);
    const Tnow = tally(h, keepAll);
    const was = seriesOf(h, oa, ob, keepBefore);
    const now = seriesOf(h, oa, ob, keepAll);
    const played = Boolean(loc.score);

    const teamName = (y, id) => (h.seasons[y] && h.seasons[y].teams[id] ? h.seasons[y].teams[id].name : (season.teams[id] || {}).name || id);
    const side = (key, id, owner) => {
      const t = season.teams[id];
      const sr = seasonRecord(season, id, loc.kind === "regular" ? loc.start : season.settings.regularWeeks + 1);
      const p = Tnow.M[owner] || Tnow.m(owner);
      const titles = Object.entries(h.champions).filter(([, o]) => o === owner).map(([y]) => Number(y));
      const seasonsPlayed = Object.values(h.seasons).filter((s) => Object.values(s.teams).some((x) => x.ownerId === owner)).length;
      return {
        key, teamId: id, ownerId: owner, team: t.name, owner: (owners[owner] || {}).name || t.owner,
        icon: t.icon || "", color: t.color || null,
        season: {
          record: (opts.records && opts.records[id]) || rec(sr.w, sr.l, sr.t),
          wins: sr.w, losses: sr.l, ties: sr.t, pf: round2(sr.pf), pfText: fmt(sr.pf),
          games: sr.w + sr.l + sr.t,
        },
        career: {
          seasons: seasonsPlayed,
          record: rec(p.w, p.l, p.t), pct: pctText(pctOf(p.w, p.l, p.t)),
          playoffs: rec(p.pw, p.pl, p.pt), titles: titles.length, titleYears: titles,
          pfg: p.games ? fmt1(p.pf / p.games) : "—",
          high: p.high ? { pts: p.high.pts, text: fmt(p.high.pts), year: p.high.year, week: p.high.week } : null,
          streak: p.best ? { n: p.best.n, text: `${p.best.n} straight`, years: span(p.best.from, p.best.to) } : null,
        },
      };
    };
    const A = side("a", a, oa), B = side("b", b, ob);

    // The series as it stands now (with this game, once it's played).
    const S = now;
    const meeting = (g) => ({
      year: g.year, week: g.week, kind: g.kind,
      label: g.kind === "regular" ? `Week ${g.week}` : g.label,
      teamA: teamName(g.year, g.ta), teamB: teamName(g.year, g.tb),
      // that season's team ids, for the game's box score and badges
      teamIdA: g.ta, teamIdB: g.tb,
      aScore: g.as, bScore: g.bs, aText: fmt(g.as), bText: fmt(g.bs),
      winner: g.as > g.bs ? "a" : g.bs > g.as ? "b" : null,
      multi: g.multi,
      current: g.year === year && g.week === loc.end && (g.ta === a || g.tb === a),
    });
    const leadText = !S.games ? `First meeting`
      : S.all.a === S.all.b ? `Series tied ${rec(S.all.a, S.all.b, S.all.t)}`
      : S.all.a > S.all.b ? `${A.team} leads ${rec(S.all.a, S.all.b, S.all.t)}`
      : `${B.team} leads ${rec(S.all.b, S.all.a, S.all.t)}`;
    const streakText = S.streak.side
      ? `${S.streak.side === "a" ? A.team : B.team} ${S.streak.n === 1 ? "won the last meeting" : `has won ${S.streak.n} straight`}`
      : S.games ? "The last meeting was a tie" : "";
    const big = (k) => {
      const x = S.biggest[k];
      return x ? { margin: round2(x.margin), marginText: fmt(x.margin), ...meeting(x.game) } : null;
    };
    const split = (r) => ({ a: r.a, b: r.b, t: r.t, games: r.games, record: rec(r.a, r.b, r.t) });
    const series = {
      games: S.games,
      lead: leadText,
      all: split(S.all), regular: split(S.regular), playoffs: split(S.playoffs), consolation: split(S.consolation),
      streak: { side: S.streak.side, n: S.streak.n, text: streakText },
      last: S.list.length ? meeting(S.list[S.list.length - 1]) : null,
      biggest: { a: big("a"), b: big("b") },
      avg: S.avg ? { a: round2(S.avg.a), b: round2(S.avg.b), aText: fmt(S.avg.a), bText: fmt(S.avg.b) } : null,
      sweeps: { a: S.sweeps.a, b: S.sweeps.b },
      playoffMeetings: S.list.filter((g) => g.kind === "playoffs").map(meeting).reverse(),
      meetings: S.list.map(meeting).reverse(),
    };

    // The stakes, as they stood going in.
    const ctx = { h, loc, year, season, a, b, owners, before: T0, series: was, median };
    const items = [
      ...stakesFor({ ...ctx, side: { key: "a", owner: oa }, opp: { owner: ob }, name: A.team, oppName: B.team }),
      ...stakesFor({ ...ctx, side: { key: "b", owner: ob }, opp: { owner: oa }, name: B.team, oppName: A.team, series: flipSeries(was) }),
    ];
    // Two first titles on the line are one line.
    const firsts = items.filter((x) => x.kind === "title" && / a first title$/.test(x.text));
    if (firsts.length === 2) {
      items.splice(items.indexOf(firsts[1]), 1);
      Object.assign(firsts[0], { side: null, text: "The winner takes a first title", cond: { when: "decided" } });
    }
    const stakes = pick(items, 6).map((x) => {
      const out = { side: x.side, kind: x.kind, tone: x.tone || "navy", icon: STAKE_ICONS[x.kind] || "•", text: x.text, when: x.cond.when, score: x.cond.score == null ? null : x.cond.score, rank: x.rank, hit: null };
      if (played) {
        const mine = x.side === "b" ? loc.score.b : loc.score.a, theirs = x.side === "b" ? loc.score.a : loc.score.b;
        out.hit = x.cond.when === "win" ? mine > theirs
          : x.cond.when === "lose" ? mine < theirs
          : x.cond.when === "decided" ? mine !== theirs
          : x.cond.when === "score" ? mine >= x.cond.score
          : true;
      }
      return out;
    });

    return {
      year, week, end: loc.end, kind: loc.kind, label: loc.label, scheduled: loc.scheduled,
      played, score: loc.score ? { a: loc.score.a, b: loc.score.b, aText: fmt(loc.score.a), bText: fmt(loc.score.b) } : null,
      a: A, b: B,
      met: S.games > 0,
      metBefore: was.games > 0,
      series,
      stakesTitle: played ? "What was on the line" : "Records within reach",
      stakes,
      noStakes: played ? "Nothing in the record book was on the line in this one." : "Nothing in the record book is within reach in this one.",
    };
  }

  // The series seen from b's side.
  function flipSeries(s) {
    const f = (r) => ({ a: r.b, b: r.a, t: r.t, games: r.games });
    return {
      ...s,
      all: f(s.all), regular: f(s.regular), playoffs: f(s.playoffs), consolation: f(s.consolation),
      streak: { ...s.streak, side: s.streak.side === "a" ? "b" : s.streak.side === "b" ? "a" : null },
      longest: { ...s.longest, side: s.longest.side === "a" ? "b" : s.longest.side === "b" ? "a" : null },
      sweeps: { a: s.sweeps.b, b: s.sweeps.a },
      list: s.list.map((g) => ({ ...g, as: g.bs, bs: g.as, ta: g.tb, tb: g.ta, oa: g.ob, ob: g.oa })),
    };
  }

  window.Insights = Object.assign(window.Insights || {}, { rivalry });
})();
