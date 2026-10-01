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
    const pool = [...new Set(entry.players || [])]
      .filter((pid) => pid && pid !== "0" && !taxi.has(pid))
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
    // A regular-season loss the best lineup would have won.
    (season.results[week] || []).forEach(([a, as, b, bs]) => {
      [[a, as, bs], [b, bs, as]].forEach(([id, own, opp]) => {
        if (byTeam[id]) byTeam[id].costGame = own < opp && byTeam[id].optimal > opp;
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
    let failed = 0;
    txns.forEach((t) => {
      if (t.type !== "waiver" && t.type !== "free_agent") return;
      if (t.status !== "complete") { if (t.type === "waiver") failed++; return; }
      Object.entries(t.adds || {}).forEach(([pid, rid]) => {
        const team = season.teams[`r${rid}`];
        if (!team) return;
        const key = `${team.ownerId}|${pid}`;
        if (seen.has(key)) return; // the first time they got him covers the rest
        seen.add(key);
        const week = Math.max(1, Number(t.leg) || 1);
        const v = scoredFor(model, team.ownerId, pid, year, week, true);
        const bid = t.type === "waiver" && t.settings && t.settings.waiver_bid != null ? Number(t.settings.waiver_bid) : null;
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
      t.spent += p.bid || 0;
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
