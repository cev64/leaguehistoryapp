/* Bridge.season: what the app's Season screen asks for, read through the
   season page's own engine (season-engine.js). Plain data only. */
(function () {
  "use strict";

  const B = window.Bridge;

  /* The season's shape and the week rail, as renderWeekRail draws it: a
     played week's ring closed, a week to come open, the next week to be
     played dotted, the playoff weeks gold, week 0 the season overview. */
  function info(year) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const FINISHED = season.finished;
    const playedWeek = (w) => (FINISHED ? true
      : w === 0 ? E.lastPlayedWeek > 0
      : w > E.REGULAR_WEEKS ? E.playoffWeekPlayed(w) : E.isPlayed(w));
    let next = null;
    if (!FINISHED) for (let w = 1; w <= E.LAST_WEEK && next === null; w++) if (!playedWeek(w)) next = w;
    const weeks = [];
    for (let w = 0; w <= E.LAST_WEEK; w++) {
      const playoff = w > E.REGULAR_WEEKS, played = playedWeek(w);
      weeks.push({
        w, played, playoff, now: w === next,
        num: w === 0 ? (FINISHED ? "SZN" : "PRE") : String(w),
        label: w === 0 ? (FINISHED ? `${year} season overview` : "Preseason")
          : `Week ${w}${playoff ? " · playoffs" : ""}${w === next ? " · up next" : played ? "" : " · not played yet"}`,
      });
    }
    return {
      year: Number(year),
      finished: FINISHED,
      regularWeeks: E.REGULAR_WEEKS,
      playoffTeams: E.PLAYOFF_TEAMS,
      byes: E.BYES,
      median: E.MEDIAN,
      hasPlayoffs: E.HAS_PLAYOFFS,
      hasDivisions: E.HAS_DIVISIONS,
      hasBracket: E.HAS_BRACKET,
      divisionNames: E.DIVISION_NAMES,
      lastWeek: E.LAST_WEEK,
      latestWeek: E.latestWeek,
      lastPlayedWeek: E.lastPlayedWeek,
      priorYear: E.PRIOR ? E.PRIOR.year : null,
      tieRule: E.TIE_RULE,
      seasonViews: E.SEASON_VIEWS,
      homeView: E.HOME_VIEW,
      start: { week: E.state.week, view: E.state.view },
      weeks,
      source: League.sourceName(),
    };
  }

  function weekTitle(E, season, week) {
    if (week === 0) {
      return season.finished ? `${season.year} Season` : season.unplayed ? `${season.year} · Not played` : `Preseason · ${season.year}`;
    }
    return `Week ${week} · ${season.year}`;
  }

  /* The playoff picture after a week, as plain data: every team's line,
     the tables, the seeds and their labels, the clinch flags and the
     tiebreak notes. */
  function picture(E, week) {
    const p = E.buildPicture(week);
    const stats = {};
    Object.entries(p.stats).forEach(([id, t]) => {
      stats[id] = {
        wins: t.wins, losses: t.losses, ties: t.ties, gp: t.gp, pf: t.pf, pa: t.pa,
        pct: t.pct, score: t.score, record: t.record, divRecord: t.divRecord,
        pfg: t.pfg, pag: t.pag, diff: t.diff, form: t.form,
        gamesLeft: E.gamesLeft(id, week),
      };
    });
    return {
      week: p.week,
      stats,
      divisions: p.divisions,
      seeds: p.seeds,
      leaders: p.leaders,
      seedLabels: p.seedLabels,
      flags: p.flags,
      reasons: p.reasons,
      playoffField: p.playoffField,
      firstOut: p.firstOut,
    };
  }

  /* Everything one week shows: its views, its games (scores once played,
     pairings with records before), the standings and playoff picture as
     they stood, and next week's scenarios where they apply. */
  function week(year, wk) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const w = Number(wk);
    const asOf = w === 0 ? E.lastPlayedWeek : Math.min(E.asOfWeek(w), E.REGULAR_WEEKS);
    const played = w > 0 && w <= E.REGULAR_WEEKS && E.isPlayed(w);
    const out = {
      year: Number(year),
      week: w,
      title: weekTitle(E, season, w),
      views: E.viewsFor(w),
      played,
      playoff: w > E.REGULAR_WEEKS,
      asOf,
      games: [],
      matchups: [],
      picture: picture(E, asOf),
      scenarios: null,
      superlatives: null,
    };
    if (played) {
      out.games = (season.results[w] || []).map(([a, as, b, bs]) => ({ a, as, b, bs, label: "" }));
      out.superlatives = superlatives(season.results[w] || []);
    } else if (w > E.REGULAR_WEEKS) {
      out.games = E.gamesOfWeek(w).map((g) => ({ a: g.a, as: g.as, b: g.b, bs: g.bs, label: g.label || "" }));
    } else if (w > 0) {
      const stats = E.buildPicture(asOf).stats;
      out.matchups = (season.schedule[w] || []).map(([a, b]) => ({ a, b, ar: stats[a].record, br: stats[b].record }));
      if (!season.finished && w === E.lastPlayedWeek + 1) out.scenarios = E.playoffScenarios(E.lastPlayedWeek);
    }
    return out;
  }

  /* The week's notes (weekSuperlatives): high, low, blowout, closest,
     average. The bench blunder is asked for on its own (blunder()). */
  function superlatives(games) {
    if (!games.length) return null;
    const scores = [];
    games.forEach(([a, as, b, bs]) => { scores.push({ id: a, score: as }); scores.push({ id: b, score: bs }); });
    const byScore = scores.slice().sort((x, y) => y.score - x.score);
    const byMargin = games.slice().sort((x, y) => Math.abs(y[1] - y[3]) - Math.abs(x[1] - x[3]));
    const winnerOf = (g) => (g[1] >= g[3] ? g[0] : g[2]);
    const loserOf = (g) => (g[1] >= g[3] ? g[2] : g[0]);
    const total = scores.reduce((sum, s) => sum + s.score, 0);
    const blowout = byMargin[0], close = byMargin[byMargin.length - 1];
    return {
      high: byScore[0],
      low: byScore[byScore.length - 1],
      blowout: { winner: winnerOf(blowout), loser: loserOf(blowout), margin: Math.abs(blowout[1] - blowout[3]) },
      closest: { winner: winnerOf(close), loser: loserOf(close), margin: Math.abs(close[1] - close[3]) },
      average: total / scores.length,
      total,
    };
  }

  /* The week's costliest benching (fillBlunder), or null when every lineup
     was perfect. */
  async function blunder(year, wk) {
    if (!window.Insights) return null;
    const [lw, db] = await Promise.all([Insights.lineupWeek(B.model(), Number(year), Number(wk)), League.players()]);
    const worst = lw && lw.rows.filter((r) => r.blunder && r.blunder.cost > 0).sort((a, b) => b.blunder.cost - a.blunder.cost)[0];
    if (!worst) return { perfect: true };
    const b = worst.blunder;
    const name = (pid) => (db[pid] ? db[pid][0] : `Player ${pid}`);
    return {
      perfect: false,
      teamId: worst.teamId,
      benched: { pid: b.benched.pid, name: name(b.benched.pid), pts: b.benched.pts },
      started: b.started ? { pid: b.started.pid, name: name(b.started.pid), pts: b.started.pts } : null,
      costGame: Boolean(worst.costGame),
    };
  }

  /* The whole season's schedule (week 0 of a season still being played). */
  function schedule(year) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const weeks = Object.keys(season.schedule).map(Number).filter((w) => w <= E.REGULAR_WEEKS).sort((a, b) => a - b);
    return weeks.map((w) => ({ week: w, played: E.isPlayed(w), games: season.schedule[w].map(([a, b]) => ({ a, b })) }));
  }

  /* ==================================================================
     STANDINGS, FINAL STANDINGS, BRACKETS, STRENGTH OF SCHEDULE

     Lifted from season.html's own renderers (standingsCards,
     standingsLegend, renderFinalStandings, the BRACKETS block,
     playoffFormatText, formatCard, renderSosPanel), with the HTML
     replaced by plain data the app draws natively. The words and the
     numbers are the page's.
     ================================================================== */

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctText = (v) => v.toFixed(3).replace(/^0/, "");
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const numberWord = (n) => NUMBER_WORDS[n] || String(n);
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* The standings tables of a week (renderStandingsPanel), a playoff week
     (the regular season's last), or a finished season's "regular" view
     (renderDivisions). `live` is false before a week has been played,
     when every record is 0–0 and nobody is ranked. */
  function standings(year, wk, view) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const teams = season.teams;
    const TEAM_IDS = Object.keys(teams);
    const LB = season.losersBracket || [];
    const w = Number(wk);
    const asOf = E.asOfWeek(view === "regular" || w > E.REGULAR_WEEKS ? E.REGULAR_WEEKS : w);
    const live = asOf > 0;
    const picture = E.buildPicture(asOf);
    const stats = picture.stats;
    const HAS_DIVISIONS = E.HAS_DIVISIONS;
    const nameOf = (id) => teams[id].name;

    const gbText = (leader, t) => {
      const back = E.gamesBack(leader, t);
      return back <= 0 ? "—" : (back % 1 ? back.toFixed(1) : String(back));
    };
    const rowClass = (id) => {
      if (!live) return "";
      const label = picture.seedLabels[id];
      if (!label) return "";
      if (label.kind === "div") return "seed-div";
      if (label.kind === "wc") return "seed-wc";
      return "seed-toilet";
    };
    const why = (id) => {
      const entries = picture.reasons[id];
      if (!entries || !entries.length) return null;
      return {
        title: `${nameOf(id)} · ${entries.length} tiebreak${entries.length === 1 ? "" : "s"}`,
        entries: entries.map((r) => ({
          head: `${r.race} · ${r.criterion}`,
          detail: r.detail,
          foot: r.note ? r.note
            : r.over ? `Placed ahead of ${nameOf(r.over)}.`
            : r.under ? `Placed behind ${nameOf(r.under)}.` : null,
        })),
      };
    };
    const flagOf = (id) => {
      const f = picture.flags[id];
      return f ? { label: E.CLINCH_KEY[f].label, kind: f, title: E.CLINCH_KEY[f].title } : null;
    };

    const cards = E.DIVISION_NAMES.map((division) => {
      const ids = live ? picture.divisions[division] : E.divisionOrder[division];
      return {
        title: HAS_DIVISIONS ? division : "Standings",
        chip: HAS_DIVISIONS ? "shield" : "standings",
        rows: ids.map((id, i) => {
          const t = stats[id];
          return {
            id,
            rank: live ? String(i + 1) : "–",
            record: t.record,
            gb: live ? gbText(stats[ids[0]], t) : "—",
            pct: pctText(t.pct),
            pf: fmt(t.pf),
            pa: fmt(t.pa),
            div: HAS_DIVISIONS ? t.divRecord : null,
            rowClass: rowClass(id),
            seed: live ? (picture.seedLabels[id] || null) : null,
            flag: live ? flagOf(id) : null,
            why: live ? why(id) : null,
          };
        }),
      };
    });

    // standingsLegend
    const legend = [];
    if (live) {
      const { HAS_PLAYOFFS, BYES, PLAYOFF_TEAMS } = E;
      const anyFlag = TEAM_IDS.some((id) => picture.flags[id]);
      const anyWhy = TEAM_IDS.some((id) => (picture.reasons[id] || []).length);
      if (HAS_PLAYOFFS || anyWhy) {
        const firstOther = BYES + (HAS_DIVISIONS ? Math.max(0, picture.leaders.length - BYES) : 0) + 1;
        if (HAS_PLAYOFFS && BYES) legend.push({ kind: "seed", cls: "lead", tag: "#1", text: "First-round bye" });
        if (HAS_PLAYOFFS && HAS_DIVISIONS && picture.leaders.length > BYES) legend.push({ kind: "seed", cls: "div", tag: `#${BYES + 1}`, text: "Division leader" });
        if (HAS_PLAYOFFS && PLAYOFF_TEAMS >= firstOther) legend.push({ kind: "seed", cls: HAS_DIVISIONS ? "wc" : "div", tag: `#${firstOther}`, text: HAS_DIVISIONS ? "Wild card" : "Playoff seed" });
        if (HAS_PLAYOFFS && PLAYOFF_TEAMS < TEAM_IDS.length) legend.push({ kind: "seed", cls: "out", tag: `#${PLAYOFF_TEAMS + 1}`, text: LB.length ? "Losers bracket" : "Missed the playoffs" });
        if (anyFlag) {
          if (E.CLINCH_KEY.z && TEAM_IDS.some((id) => picture.flags[id] === "z")) legend.push({ kind: "clinch", cls: "z", tag: "z", text: BYES ? "Clinched a bye" : "Clinched division" });
          legend.push({ kind: "clinch", cls: "x", tag: "x", text: "Clinched a berth" });
          legend.push({ kind: "clinch", cls: "e", tag: "e", text: "Eliminated" });
        }
        if (anyWhy) legend.push({ kind: "why", cls: "", tag: "i", text: "Tap for the tiebreaker" });
      }
    }
    return { asOf, live, hasDivisions: HAS_DIVISIONS, cards, legend };
  }

  /* A finished season's final table (renderFinalStandings). The app sorts
     it; these are the values the page sorts on and the text it shows. */
  function finalStandings(year) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const teams = season.teams;
    const gamesOf = (t) => Math.max(1, t.wins + t.losses + t.ties - (E.MEDIAN ? season.playedWeeks.length : 0));
    const ids = Object.keys(teams).sort((a, b) => (teams[a].finalRank || 99) - (teams[b].finalRank || 99));
    return ids.map((id) => {
      const t = teams[id];
      const g = gamesOf(t);
      const d = (t.pf - t.pa) / g;
      return {
        id,
        rank: t.finalRank || null,
        name: t.name,
        wins: t.wins, losses: t.losses, ties: t.ties,
        record: t.ties ? `${t.wins}–${t.losses}–${t.ties}` : `${t.wins}–${t.losses}`,
        pf: t.pf, pa: t.pa, pfg: t.pf / g, pag: t.pa / g, diff: d,
        pfText: fmt(t.pf), paText: fmt(t.pa),
        pfgText: (t.pf / g).toFixed(1), pagText: (t.pa / g).toFixed(1),
        diffText: `${d >= 0 ? "+" : ""}${d.toFixed(1)}`,
      };
    });
  }

  /* Strength of schedule (renderSosPanel). */
  function sos(year) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    if (!E.PRIOR || !Object.keys(season.schedule).length) {
      return { empty: { title: "No schedule to rate yet", detail: "Strength of schedule needs this season's slate and a season before it to read records from." } };
    }
    const rows = E.strengthOfSchedule();
    const hardest = rows[0], easiest = rows[rows.length - 1];
    const out = rows.map((r, i) => {
      const side = r.deviation > 0 ? "tough" : r.deviation < 0 ? "easy" : "even";
      return {
        id: r.id, rank: i + 1, wins: r.wins, losses: r.losses, games: r.games,
        sos: r.sos, sosText: pctText(r.sos), deviation: r.deviation, magnitude: r.magnitude, side,
        record: `${r.wins}–${r.losses}`,
        aria: `${pctText(r.sos)} opponent win percentage, ${side === "even" ? "exactly average" : side === "tough" ? "above average" : "below average"}`,
      };
    });
    return {
      empty: null,
      priorYear: E.PRIOR.year,
      meta: `Opponents' ${E.PRIOR.year} records`,
      rows: out,
      notes: [
        { label: "Toughest slate", title: season.teams[hardest.id].name, detail: `${pctText(hardest.sos)} · opponents went ${hardest.wins}–${hardest.losses}` },
        { label: "Easiest slate", title: season.teams[easiest.id].name, detail: `${pctText(easiest.sos)} · opponents went ${easiest.wins}–${easiest.losses}` },
        { label: "Spread", title: `${pctText(hardest.sos - easiest.sos)} of win percentage`, detail: "between the hardest and easiest schedules" },
      ],
    };
  }

  /* ------------------------------------------------------------ brackets

     The page's BRACKETS block, as data. Three readings of one bracket:
       "picture"   a regular-season week's playoff picture, projected
       "playoffs"  a playoff week, as it stood when that week went final
                   (projected until the regular season is over)
       "season"    a finished season's bracket, as it finished
     A game is { kicker, path, week (its box score's week, or 0), kind,
     stage, rows }; a row is { seed, id | label, score | record, winner,
     lastPlace }. The winner's bracket comes as the page's tree grid,
     column by round; the app lays it out as a tree on a wide screen and
     as the page's two lanes on a phone. */
  function bracketMaker(year) {
    const E = B.seasonEngine(year);
    const model = B.model();
    const season = model.season(year);
    const S = season.settings;
    const teams = season.teams;
    const TEAM_IDS = Object.keys(teams);
    const WB = season.winnersBracket || [];
    const LB = season.losersBracket || [];
    const { REGULAR_WEEKS, PLAYOFF_TEAMS, WB_ROUNDS, LB_ROUNDS } = E;
    const buildPicture = E.buildPicture, asOfWeek = E.asOfWeek, postOf = E.postOf, weeksText = E.weeksText;

    const bkRow = (seed, id, stats) => ({ seed, id, label: null, score: null, record: stats[id].record, winner: false, lastPlace: false, projected: true });
    const bkTbd = (label) => ({ seed: "—", id: null, label, score: null, record: null, winner: false, lastPlace: false, projected: false });
    const bkGame = (rows, { kind = "", kicker = "", path = "", week = 0, stage = "" } = {}) => ({ rows, kind, kicker, path, week, stage });

    const drawnFrom = () => buildPicture(asOfWeek(REGULAR_WEEKS)).seeds;
    function entrantsOf(raw) {
      const set = new Set();
      raw.forEach((g) => [g.t1, g.t2].forEach((rid) => { if (rid != null && teams[`r${rid}`]) set.add(`r${rid}`); }));
      const order = drawnFrom();
      return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    const WB_ENTRANTS = entrantsOf(WB);
    const LB_BASE = WB_ENTRANTS.length || PLAYOFF_TEAMS;

    function winnersTree() {
      if (!WB.length) return null;
      const byM = new Map(WB.map((g) => [g.m, g]));
      const final = WB.find((g) => g.p === 1) || WB.filter((g) => g.r === WB_ROUNDS && !g.p)[0];
      if (!final) return null;
      const used = new Set();
      const nodes = new Map();
      const build = (g) => {
        used.add(g.m);
        const node = { g, sides: [] };
        nodes.set(g.m, node);
        node.sides = [1, 2].map((n) => {
          const from = g[`t${n}_from`];
          const rid = g[`t${n}`];
          if (from && from.w != null && byM.has(from.w) && !used.has(from.w)) return { child: build(byM.get(from.w)) };
          if (rid != null) {
            const feeder = WB.find((x) => x.r < g.r && !x.p && !used.has(x.m) && x.w === rid);
            if (feeder) return { child: build(feeder) };
            return { team: `r${rid}` };
          }
          return { open: true };
        });
        return node;
      };
      const root = build(final);
      const orphans = WB.filter((g) => !used.has(g.m) && !g.p).sort((a, b) => b.r - a.r || a.m - b.m);
      const queue = [root];
      while (queue.length) {
        const node = queue.shift();
        node.sides.forEach((side, i) => {
          if (side.open) {
            const k = orphans.findIndex((o) => o.r === node.g.r - 1 && !used.has(o.m));
            if (k >= 0) node.sides[i] = { child: build(orphans.splice(k, 1)[0]) };
          }
          if (node.sides[i].child) queue.push(node.sides[i].child);
        });
      }
      return { root, nodes, third: WB.find((g) => g.p === 3) || null };
    }
    const TREE = winnersTree();

    function bracketContext(mode, week) {
      if (mode === "projected") {
        const picture = buildPicture(week);
        const drawn = drawnFrom();
        const slotSeed = (id) => {
          const inWB = WB_ENTRANTS.indexOf(id);
          return inWB >= 0 ? inWB : drawn.indexOf(id);
        };
        return {
          projected: true, asOf: 0, stats: picture.stats,
          map: (id) => picture.seeds[slotSeed(id)] || id,
          seed: (id) => `#${picture.seeds.indexOf(id) + 1}`,
        };
      }
      const stats = buildPicture(asOfWeek(REGULAR_WEEKS)).stats;
      return {
        projected: false, asOf: week, stats,
        map: (id) => id,
        seed: (id) => {
          const w = WB_ENTRANTS.indexOf(id);
          if (w >= 0) return `#${w + 1}`;
          const place = drawnFrom().indexOf(id);
          return place >= 0 ? `#${place + 1}` : "";
        },
      };
    }

    function resultOf(bracket, m, ctx) {
      if (ctx.projected) return null;
      const game = postOf(bracket, m);
      if (!game || !game.played || game.week > ctx.asOf || !game.a || !game.b) return null;
      return game;
    }

    function wbSide(side, ctx) {
      if (side.team) return { id: ctx.map(side.team) };
      if (side.child) {
        const res = resultOf("W", side.child.g.m, ctx);
        if (res) return { id: res.winner };
        return { label: `Winner of ${describeWB(side.child, ctx)}` };
      }
      return { label: "To be decided" };
    }
    function describeWB(node, ctx) {
      const sides = node.sides.map((s) => wbSide(s, ctx));
      if (sides.every((s) => s.id)) return `${ctx.seed(sides[0].id)} vs ${ctx.seed(sides[1].id)}`;
      const name = League.gameName(node.g.r, WB_ROUNDS).toLowerCase();
      const top = topSeedIn(node, ctx);
      return top ? `${top}'s ${name}` : `the ${name}`;
    }
    function topSeedIn(node, ctx) {
      const seeds = [];
      const walk = (n) => n.sides.forEach((s) => {
        if (s.team) seeds.push(parseInt(ctx.seed(ctx.map(s.team)).slice(1), 10));
        if (s.child) walk(s.child);
      });
      walk(node);
      const known = seeds.filter(Number.isFinite);
      return known.length ? `#${Math.min(...known)}` : "";
    }

    function bkSideRow(slot, game, ctx, { lastPlace = false } = {}) {
      if (!slot.id) return bkTbd(slot.label);
      const seed = ctx.seed(slot.id);
      if (!game) return bkRow(seed, slot.id, ctx.stats);
      const score = game.a === slot.id ? game.aScore : game.bScore;
      return {
        seed, id: slot.id, label: null, score, record: null,
        winner: game.winner === slot.id,
        lastPlace: Boolean(lastPlace && game.loser === slot.id),
        projected: false,
      };
    }

    function wbGame(node, ctx, opts = {}) {
      const res = resultOf("W", node.g.m, ctx);
      const sides = node.sides.map((s) => wbSide(s, ctx));
      const rows = sides.map((slot) => bkSideRow(slot, res, ctx));
      return bkGame(rows, { ...opts, week: res ? res.week : 0 });
    }

    // A bye: the team waits out the round, a berth rather than a win.
    function bye(id, ctx) {
      const seed = ctx.seed(id);
      const row = ctx.projected
        ? bkRow(seed, id, ctx.stats)
        : { seed, id, label: null, score: null, record: null, winner: false, lastPlace: false, projected: false };
      return { seed, row };
    }

    function treeGrid() {
      const R = WB_ROUNDS;
      const grid = [];
      for (let c = 1; c <= R; c++) grid[c] = new Array(2 ** (R - c)).fill(null);
      const place = (node, col, slot) => {
        if (col < 1) return;
        grid[col][slot] = { node };
        node.sides.forEach((side, i) => {
          const childSlot = slot * 2 + i;
          if (side.child) place(side.child, col - 1, childSlot);
          else if (side.team && col - 1 >= 1) grid[col - 1][childSlot] = { bye: side.team };
        });
      };
      place(TREE.root, R, 0);
      return grid;
    }

    function winners(ctx) {
      if (!TREE) return null;
      const R = WB_ROUNDS;
      const grid = treeGrid();
      const weeksOf = (c) => weeksText(S.weeksPerRound(c));
      const cell = (entry, opts = {}) => {
        if (!entry) return null;
        if (entry.bye) return { bye: bye(ctx.map(entry.bye), ctx), game: null };
        return { bye: null, game: wbGame(entry.node, ctx, opts) };
      };
      let third = null;
      if (TREE.third) {
        const g = TREE.third;
        const res = resultOf("W", g.m, ctx);
        const loserOf = (from) => {
          if (!from || from.l == null) return { label: "Semifinal loser" };
          const semi = resultOf("W", from.l, ctx);
          if (semi) return { id: semi.loser };
          const node = TREE.nodes.get(from.l);
          return { label: node ? `Loser of ${describeWB(node, ctx)}` : "Semifinal loser" };
        };
        const slots = ctx.projected || !res
          ? [loserOf(g.t1_from), loserOf(g.t2_from)]
          : [{ id: res.a }, { id: res.b }];
        third = bkGame(slots.map((s) => bkSideRow(s, res, ctx)), { kind: "third", kicker: "Third Place", week: res ? res.week : 0 });
      }

      const columns = [];
      for (let c = 1; c <= R; c++) {
        const stage = c === R - 1 ? `${League.gameName(c, R)} · ${weeksOf(c)}` : "";
        columns.push({
          round: c,
          title: League.roundName(c, R),
          weeks: weeksOf(c),
          stage,
          cells: grid[c].map((entry) => cell(entry, c === R ? { kind: "championship" } : { stage })),
        });
      }

      const half = (c, lane) => {
        const slots = grid[c];
        const n = slots.length / 2;
        return slots.slice(lane * n, lane * n + n);
      };
      const laneLabel = (lane) => {
        const ids = [];
        for (let c = 1; c < R; c++) half(c, lane).forEach((e) => {
          if (!e) return;
          if (e.bye) ids.push(ctx.map(e.bye));
          else e.node.sides.forEach((s) => { if (s.team) ids.push(ctx.map(s.team)); });
        });
        const seeds = ids.map((id) => parseInt(ctx.seed(id).slice(1), 10)).filter(Number.isFinite);
        return seeds.length ? `#${Math.min(...seeds)} Seed Side` : lane ? "Bottom Half" : "Top Half";
      };
      const champion = (() => {
        const res = resultOf("W", TREE.root.g.m, ctx);
        return res ? res.winner : null;
      })();
      return { rounds: R, columns, third, laneLabels: R > 1 ? [laneLabel(0), laneLabel(1)] : [], champion };
    }

    const TOILET = Boolean(S.toiletBowl);
    function losers(ctx) {
      if (!LB.length) return null;
      const N = TEAM_IDS.length;
      const placesOf = (g) => (TOILET ? [N - g.p, N - g.p + 1] : [LB_BASE + g.p, LB_BASE + g.p + 1]);
      const lastPlaceGame = LB.filter((g) => g.p && placesOf(g)[1] === N)[0] || null;
      const goesOn = TOILET ? "Loser" : "Winner", staysBack = TOILET ? "Winner" : "Loser";
      const routes = (g) => {
        if (g.p) {
          const [hi, lo] = placesOf(g);
          return lo === N ? "Loser = last place in the league" : `Winner ${League.ordinal(hi)} · Loser ${League.ordinal(lo)}`;
        }
        const to = (key) => LB.filter((x) => [x.t1_from, x.t2_from].some((f) => f && f[key] === g.m)).map((x) => x.m);
        const on = to("w"), back = to("l");
        return [on.length ? `${goesOn} → Game ${on[0]}` : "", back.length ? `${staysBack} → Game ${back[0]}` : ""].filter(Boolean).join(" · ");
      };
      const lbSide = (g, n) => {
        const from = g[`t${n}_from`], rid = g[`t${n}`];
        if (from && (from.w != null || from.l != null)) {
          const m = from.w != null ? from.w : from.l;
          const wentOn = from.w != null;
          const res = resultOf("L", m, ctx);
          if (res) return { id: wentOn ? res.advanced : (res.advanced === res.winner ? res.loser : res.winner) };
          return { label: `${wentOn ? goesOn : staysBack} of Game ${m}` };
        }
        if (rid != null && teams[`r${rid}`]) return { id: ctx.map(`r${rid}`) };
        return { label: "To be decided" };
      };
      const rounds = [];
      for (let r = 1; r <= LB_ROUNDS; r++) {
        const games = LB.filter((g) => g.r === r).sort((a, b) => a.m - b.m).map((g) => {
          const res = resultOf("L", g.m, ctx);
          const slots = [lbSide(g, 1), lbSide(g, 2)];
          const last = g === lastPlaceGame;
          return bkGame(slots.map((s) => bkSideRow(s, res, ctx, { lastPlace: last })), {
            kind: last ? "lastPlace" : "", kicker: `Game ${g.m}`, path: routes(g), week: res ? res.week : 0,
          });
        });
        const title = r === 1 ? "Opening Round" : r === LB_ROUNDS ? "Final Round" : `Round ${r}`;
        rounds.push({ round: r, title, weeks: weeksText(S.weeksPerRound(r)), games });
      }
      return { toilet: TOILET, rounds };
    }

    function formatLines() {
      const lines = [];
      if (E.HAS_PLAYOFFS) {
        for (let r = 1; r <= WB_ROUNDS; r++) {
          const games = WB.filter((g) => g.r === r && (!g.p || g.p === 1)).length;
          let text;
          if (r === WB_ROUNDS) text = `The championship${LB.length ? ", with the third-place game alongside it" : ""}.`;
          else if (r === 1 && E.BYES) text = `The top ${numberWord(E.BYES)} seed${E.BYES === 1 ? "" : "s"} rest${E.BYES === 1 ? "s" : ""}. The other ${numberWord(games * 2)} play ${numberWord(games)} game${games === 1 ? "" : "s"}.`;
          else text = `${capital(numberWord(games))} game${games === 1 ? "" : "s"}; the winners move on.`;
          lines.push({ head: weeksText(S.weeksPerRound(r)).replace(/^NFL /, ""), text });
        }
      }
      return { title: "How the field is set", meta: `From the league's ${League.sourceName()} settings`, lines };
    }

    function playoffFormatText() {
      const n = TEAM_IDS.length;
      const P = PLAYOFF_TEAMS;
      const parts = [`${capital(numberWord(P))} of the ${numberWord(n)} teams make the playoffs`];
      if (E.HAS_DIVISIONS) parts[0] += `, every division leader among them`;
      let text = `${parts[0]}, seeded on record with points for as the tiebreaker.`;
      if (E.BYES) text += ` The top ${numberWord(E.BYES)} seed${E.BYES === 1 ? " gets" : "s get"} a first-round bye.`;
      if (LB.length) text += TOILET
        ? ` The other ${numberWord(n - P)} play a toilet bowl, where the team that loses moves on and the last one left finishes last.`
        : ` The other ${numberWord(n - P)} play a consolation bracket for the places after them.`;
      text += ` Once results are posted, this tab shows where every team would land if the season ended that day.`;
      return text;
    }

    return { E, season, teams, S, winners, losers, bracketContext, formatLines, playoffFormatText };
  }

  async function boxWeekSet(year) {
    try { return await B.model().boxWeeks(Number(year)); } catch (err) { return new Set(); }
  }

  /* A game's box score only where the week has one (markBracketBoxScores). */
  function markBoxScores(out, weeks) {
    const mark = (g) => {
      if (!g) return;
      const both = g.rows.filter((r) => r.id).length === 2;
      if (!(g.week && both && weeks.has(g.week))) g.week = 0;
    };
    if (out.winners) {
      out.winners.columns.forEach((c) => c.cells.forEach((cell) => cell && mark(cell.game)));
      mark(out.winners.third);
    }
    if (out.losers) out.losers.rounds.forEach((r) => r.games.forEach(mark));
  }

  async function bracket(year, wk, view) {
    const K = bracketMaker(year);
    const { E, season } = K;
    const w = Number(wk);
    const blank = { empty: null, format: null, scenarios: null, note: "", label: "", flips: [], winners: null, losers: null, projected: false };
    const source = League.sourceName();

    if (view === "panel-picture") {
      // renderPicturePanel
      const asOf = E.asOfWeek(w);
      if (asOf === 0 || !E.HAS_PLAYOFFS) {
        return {
          ...blank,
          empty: {
            title: E.HAS_PLAYOFFS ? "The bracket opens after Week 1" : "No playoffs set up",
            detail: E.HAS_PLAYOFFS ? K.playoffFormatText() : `This league has no playoff bracket on ${source}.`,
          },
          format: E.HAS_PLAYOFFS ? K.formatLines() : null,
        };
      }
      const picture = E.buildPicture(asOf);
      const ctx = K.bracketContext("projected", asOf);
      const note = asOf >= E.REGULAR_WEEKS ? "Final seeding" : `Projected · through Week ${asOf}`;
      const sc = !season.finished && asOf === E.lastPlayedWeek ? E.playoffScenarios(asOf) : null;
      return {
        ...blank,
        projected: true,
        scenarios: sc && sc.rows.length ? sc : null,
        note, label: "Projected winner's bracket",
        flips: picture.flips.map(([a, b]) => `Level on record and points · ${K.teams[a].name} / ${K.teams[b].name}`),
        winners: K.winners(ctx),
        losers: K.losers(ctx),
      };
    }

    if (view === "bracket") {
      // renderSeasonBracket
      const ctx = K.bracketContext("asOf", E.LAST_WEEK);
      const out = { ...blank, label: `${season.year} winner's bracket`, winners: K.winners(ctx), losers: K.losers(ctx) };
      markBoxScores(out, await boxWeekSet(year));
      return out;
    }

    // renderPlayoffPanel
    if (!E.HAS_PLAYOFFS) return { ...blank, empty: { title: "No playoffs", detail: `This league has no playoff bracket on ${source}.` } };
    if (E.lastPlayedWeek < E.REGULAR_WEEKS && !season.finished) {
      const asOf = E.asOfWeek(E.REGULAR_WEEKS);
      if (asOf === 0) {
        return {
          ...blank,
          empty: {
            title: "The bracket fills in once games are played",
            detail: `The playoffs run from Week ${season.settings.playoffWeekStart} to Week ${E.LAST_WEEK}. Until the regular season ends, the field is projected from the latest standings.`,
          },
        };
      }
      const ctx = K.bracketContext("projected", asOf);
      return { ...blank, projected: true, note: `Projected · through Week ${asOf}`, label: `Week ${w} winner's bracket`, winners: K.winners(ctx), losers: K.losers(ctx) };
    }
    const ctx = K.bracketContext("asOf", w);
    const status = w > E.lastPlayoffWeek()
      ? "Upcoming"
      : w >= E.LAST_WEEK && season.finished ? "Final" : `Through Week ${w}`;
    const out = { ...blank, note: status, label: `Week ${w} winner's bracket`, winners: K.winners(ctx), losers: K.losers(ctx) };
    markBoxScores(out, await boxWeekSet(year));
    return out;
  }

  B.season = { info, week, blunder, schedule, standings, finalStandings, sos, bracket };
})();
