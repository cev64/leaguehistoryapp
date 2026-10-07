/* Bridge.recap: the week's recap (THE WEEK IN REVIEW), its share text and
   pictures, a game's box score and a team's season (the team drawer), read
   through the season page's own engine (season-engine.js) and lifted from
   season.html's recapHtml, recapImages, openBox and openTeam, so the
   numbers and the words are the site's. Plain data only: weekRecap's
   functions (lineup.eff, moves.pname) are applied here. */
(function () {
  "use strict";

  const B = window.Bridge;

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (n) => Number(n).toFixed(1);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const recordText = (w, l, t) => (t ? `${w}–${l}–${t}` : `${w}–${l}`);

  function player(p, teamId) {
    if (!p) return null;
    return {
      id: String(p.id),
      name: p.name,
      pos: p.pos || "",
      nfl: p.nfl || "FA",
      pts: Number(p.pts) || 0,
      teamId: teamId || p.teamId || null,
    };
  }

  /* ------------------------------------------------------------ the recap */

  async function week(year, wk) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const teams = season.teams;
    const w = Number(wk);
    const r = await E.weekRecap(w);
    const plain = (id) => (teams[id] ? teams[id].name : id);
    const nameOf = plain;
    const PLAYOFF_TEAMS = E.PLAYOFF_TEAMS;
    const n = r.numbers;
    const eff = r.lineup ? r.lineup.eff : null;
    const pname = r.moves.pname;

    /* the lead */
    const lead = {
      kicker: `${r.playoff ? "Playoffs · " : ""}Week ${r.week} recap · ${r.season}`,
      title: r.headline ? r.headline.title : null,
      dek: r.headline ? r.headline.dek : null,
      also: r.also.slice(),
    };

    /* every game */
    const games = r.games.map((g) => ({
      a: g.a, as: g.as, b: g.b, bs: g.bs, w: g.w, l: g.l, ws: g.ws, ls: g.ls, tie: g.tie,
      label: g.label || "",
      aWon: g.tie || g.w === g.a,
      bWon: g.tie || g.w === g.b,
      line: g.line,
      notes: g.notes.slice(),
      stars: [player(g.stars[0], g.a), player(g.stars[1], g.b)].filter(Boolean),
    }));

    /* power rankings */
    let power = null;
    if (r.power) {
      const top = r.power[0];
      const riser = r.power.slice().sort((a, b) => b.move - a.move)[0];
      const faller = r.power.slice().sort((a, b) => a.move - b.move)[0];
      const best = Math.max(...r.power.map((x) => x.score), 1);
      power = {
        meta: `After week ${r.week}`,
        rows: r.power.map((p) => ({
          id: p.id, rank: p.rank, move: p.move || 0, record: p.record, apRecord: p.apRecord,
          pfg: fmt1(p.pfg), bar: p.score / best,
        })),
        foot: `${plain(top.id)} ${top.move > 0 ? `climb to the top` : "hold the top spot"}${riser && riser.move >= 2 ? `; ${plain(riser.id)} jump ${riser.move}` : ""}${faller && faller.move <= -2 ? `; ${plain(faller.id)} slide ${-faller.move}` : ""}. Ranked on all-play record (every team against every other team's score, every week), the actual record, the last three weeks and points per game.`,
      };
    }

    /* by the numbers */
    const tiles = [];
    const tile = (label, title, detail, teamId = null) => tiles.push({ label, title, detail, teamId });
    if (n.high) tile("High score", nameOf(n.high.id), `${fmt(n.high.pts)} · ${n.high.pts > n.high.oppPts ? "won" : "lost"}`, n.high.id);
    tile("League average", `${fmt1(n.avg)} per team`, `median ${fmt1(n.median)}`);
    if (n.luckyWin && n.luckyWin.apOf) tile("Luckiest win", nameOf(n.luckyWin.id), `${fmt(n.luckyWin.pts)} would have beaten ${n.luckyWin.ap} of ${n.luckyWin.apOf}`, n.luckyWin.id);
    if (n.unluckyLoss && n.unluckyLoss.apOf) tile("Unluckiest loss", nameOf(n.unluckyLoss.id), `${fmt(n.unluckyLoss.pts)} would have beaten ${n.unluckyLoss.ap} of ${n.unluckyLoss.apOf}`, n.unluckyLoss.id);
    if (n.toughest) tile("Toughest draw", nameOf(n.toughest.id), `faced ${fmt(n.toughest.oppPts)}`, n.toughest.id);
    if (n.luckiest && n.luckiest.luck > 0.5) tile("Luckiest season", nameOf(n.luckiest.id), `${n.luckiest.luck.toFixed(1)} wins above all-play`, n.luckiest.id);
    if (n.unluckiest && n.unluckiest.luck < -0.5) tile("Unluckiest season", nameOf(n.unluckiest.id), `${(-n.unluckiest.luck).toFixed(1)} wins below all-play`, n.unluckiest.id);
    if (r.lineup) {
      const L = r.lineup;
      tile("Best-set lineup", nameOf(L.best.teamId), `${(100 * eff(L.best)).toFixed(1)}% of the best possible`, L.best.teamId);
      if (L.worst.left > 0) tile("Most left on the bench", nameOf(L.worst.teamId), `${fmt(L.worst.left)} points`, L.worst.teamId);
      tile("Left on benches", `${fmt1(L.left)} points`, L.perfect.length ? `${plural(L.perfect.length, "perfect lineup")}` : "no perfect lineups");
    }

    /* players of the week */
    const P = r.players;
    let players = null;
    if (P.mvp) {
      const items = [];
      P.byPos.filter((p) => p !== P.mvp).forEach((p) => items.push({ tag: `Top ${p.pos}`, tone: "", player: player(p), note: nameOf(p.teamId), pts: p.pts }));
      if (P.bench && !(r.lineup && r.lineup.blunder && r.lineup.blunder.blunder.benched.pid === P.bench.id)) items.push({ tag: "Best on a bench", tone: "soft", player: player(P.bench), note: nameOf(P.bench.teamId), pts: P.bench.pts });
      if (P.wireHero) items.push({ tag: "Waiver-wire hero", tone: "soft", player: player(P.wireHero), note: nameOf(P.wireHero.teamId), pts: P.wireHero.pts });
      if (P.dud) items.push({ tag: "Dud of the week", tone: "bad", player: player(P.dud), note: `started by ${nameOf(P.dud.teamId)}`, pts: P.dud.pts });
      players = { mvp: player(P.mvp), mvpFor: `for ${nameOf(P.mvp.teamId)}`, items };
    }

    /* the front office: a line is a team in bold, then the rest */
    const M = r.moves;
    const office = [];
    M.trades.forEach((t) => office.push({ tag: "Trade", tone: "", lines: t.sides.map((s) => ({ teamId: s.id, text: `get ${s.got.length ? s.got.join(", ") : "nothing"}` })) }));
    if (r.lineup && r.lineup.blunder) {
      const b = r.lineup.blunder.blunder;
      office.push({ tag: "Bench blunder", tone: "bad", lines: [{ teamId: r.lineup.blunder.teamId, text: `benched ${pname(b.benched.pid)} (${fmt(b.benched.pts)})${b.started ? ` and started ${pname(b.started.pid)} (${fmt(b.started.pts)})` : ""}${r.lineup.blunder.costGame ? ". It cost them the game" : ""}.` }] });
    }
    if (M.adds) office.push({ tag: "Waiver wire", tone: "soft", lines: [{ teamId: null, text: `${plural(M.adds, "pickup")} this week${M.busiest ? `; ${nameOf(M.busiest[0])} made ${M.busiest[1]}` : ""}.${M.bids.length ? ` Biggest bid: ${nameOf(M.bids[0].id)}, $${M.bids[0].bid} on ${pname(M.bids[0].pid)}.` : ""}` }] });

    /* the playoff race */
    let race = null;
    if (r.race) {
      const R = r.race;
      race = {
        meta: R.weeksLeft ? `${plural(R.weeksLeft, "week")} left` : "Regular season over",
        seeds: R.seeds.map((s) => ({ id: s.id, seed: s.seed, record: s.record, flag: s.flag || "", in: s.in, cut: s.seed === PLAYOFF_TEAMS })),
        foot: R.bubble ? `${R.bubble.gap > 0 ? `${plain(R.bubble.lastIn)} hold the last spot by ${R.bubble.gap % 1 ? R.bubble.gap.toFixed(1) : R.bubble.gap} ${R.bubble.gap === 1 ? "game" : "games"} over ${plain(R.bubble.firstOut)}.` : `${plain(R.bubble.lastIn)} and ${plain(R.bubble.firstOut)} are level for the last spot; points for decides it for now.`}${R.changes.length ? ` This week: ${R.changes.map((c) => `${plain(c.id)} ${c.what}`).join("; ")}.` : ""}` : null,
        stakes: R.stakes ? R.stakes.rows.slice(0, 6).map((x) => ({ id: x.id, lines: x.lines.map((l) => `${l}.`) })) : [],
      };
    }

    /* next up */
    let next = null;
    if (r.next && r.next.games.length) {
      const X = r.next, g = X.gotw;
      const rk = (v) => (v < 99 ? `#${v}` : "");
      next = {
        week: X.week,
        title: `Next up · Week ${X.week}`,
        gotw: g ? {
          a: g.a, b: g.b,
          aNote: `${rk(g.ra)} · ${g.sa}`,
          bNote: `${rk(g.rb)} · ${g.sb}`,
          series: X.series && X.series.n
            ? (X.series.a === X.series.b
              ? `All square at ${recordText(X.series.a, X.series.b, X.series.t)} all-time.`
              : `${plain(X.series.a > X.series.b ? g.a : g.b)} lead the all-time series ${recordText(Math.max(X.series.a, X.series.b), Math.min(X.series.a, X.series.b), X.series.t)}.`)
            : "Their first ever meeting.",
        } : null,
        games: X.games.filter((x) => x !== g).map((x) => ({ a: x.a, b: x.b, sa: x.sa, sb: x.sb })),
      };
    }

    return {
      year: Number(year), week: r.week, league: r.league, playoff: r.playoff, hasBox: r.hasBox,
      lead, games, power, tiles, players, office, race, next,
      text: E.recapText(r),
      share: shareData(r, E, teams),
    };
  }

  /* What recapImages draws on its two 1080 × 1350 sheets, as data: the app
     draws them natively. */
  function shareData(r, E, teams) {
    const plain = (id) => (teams[id] ? teams[id].name : id);
    const pname = r.moves.pname;
    const P = r.players;
    const tiles = [];
    if (P.mvp) tiles.push(["PLAYER OF THE WEEK", P.mvp.name, `${fmt(P.mvp.pts)} · ${plain(P.mvp.teamId)}`]);
    const blunder = r.lineup && r.lineup.blunder;
    if (blunder) { const b = blunder.blunder; tiles.push(["BENCH BLUNDER", `Benched ${pname(b.benched.pid)}`, `${fmt(b.benched.pts)} pts · ${blunder.costGame ? "cost the game · " : ""}${plain(blunder.teamId)}`]); }
    if (P.wireHero) tiles.push(["WAIVER-WIRE HERO", P.wireHero.name, `${fmt(P.wireHero.pts)} · ${plain(P.wireHero.teamId)}`]);
    if (r.moves.trades[0]) { const t = r.moves.trades[0]; tiles.push(["TRADE OF THE WEEK", t.teams.map(plain).join(" & "), t.sides.map((x) => `${plain(x.id)} get ${x.got.slice(0, 2).join(", ") || "nothing"}`).join(" · ")]); }
    if (r.numbers.high) tiles.push(["HIGH SCORE", plain(r.numbers.high.id), `${fmt(r.numbers.high.pts)}${r.numbers.high.pts < r.numbers.high.oppPts ? " · and still lost" : ""}`]);
    if (P.bench && !(blunder && blunder.blunder.benched.pid === P.bench.id)) tiles.push(["BEST ON A BENCH", P.bench.name, `${fmt(P.bench.pts)} · ${plain(P.bench.teamId)}`]);
    if (r.lineup && r.lineup.left) tiles.push(["LEFT ON BENCHES", `${fmt1(r.lineup.left)} points`, r.lineup.perfect.length ? plural(r.lineup.perfect.length, "perfect lineup") : "not one perfect lineup"]);

    const week = {
      kicker: `${r.season} season${r.playoff ? " · playoffs" : ""}`,
      title: `WEEK ${r.week} RECAP`,
      headline: r.headline ? { title: r.headline.title, dek: r.headline.dek } : null,
      also: r.headline ? r.also.slice(0, 3) : [],
      games: r.games.slice(0, 8).map((g) => ({ w: g.w, ws: g.ws, l: g.l, ls: g.ls, tie: g.tie, note: g.notes[0] || "" })),
      tiles: tiles.map(([label, title, detail]) => ({ label, title, detail })),
    };

    let table = null;
    if (r.power) {
      const rows = r.power.slice(0, 14);
      const best = Math.max(...rows.map((x) => x.score), 1);
      const n = r.numbers;
      const t2 = [];
      if (n.luckyWin && n.luckyWin.apOf) t2.push(["LUCKIEST WIN", plain(n.luckyWin.id), `${fmt(n.luckyWin.pts)} beats ${n.luckyWin.ap} of ${n.luckyWin.apOf}`]);
      if (n.unluckyLoss && n.unluckyLoss.apOf) t2.push(["UNLUCKIEST LOSS", plain(n.unluckyLoss.id), `${fmt(n.unluckyLoss.pts)} beats ${n.unluckyLoss.ap} of ${n.unluckyLoss.apOf}`]);
      if (r.lineup) t2.push(["BEST-SET LINEUP", plain(r.lineup.best.teamId), `${(100 * r.lineup.eff(r.lineup.best)).toFixed(1)}% of the best possible`]);
      if (r.race && r.race.bubble) t2.push(["THE BUBBLE", `${plain(r.race.bubble.lastIn)} in, ${plain(r.race.bubble.firstOut)} out`, r.race.bubble.gap > 0 ? `by ${r.race.bubble.gap} ${r.race.bubble.gap === 1 ? "game" : "games"}` : "level on record"]);
      else if (n.luckiest && n.luckiest.luck > 0.5) t2.push(["LUCKIEST SEASON", plain(n.luckiest.id), `${n.luckiest.luck.toFixed(1)} wins above all-play`]);
      if (r.next && r.next.gotw) t2.push([`WEEK ${r.next.week}'S BIG GAME`, `${plain(r.next.gotw.a)} vs ${plain(r.next.gotw.b)}`, `${r.next.gotw.sa} vs ${r.next.gotw.sb}`]);
      table = {
        kicker: `After week ${r.week} · ${r.season}`,
        title: "POWER RANKINGS",
        rows: rows.map((p) => ({ id: p.id, rank: p.rank, move: p.move || 0, record: p.record, apRecord: p.apRecord, bar: p.score / best })),
        tiles: t2.map(([label, title, detail]) => ({ label, title, detail })),
        foot: "All-play: each team's record against every other team's score, every week.",
      };
    }
    return {
      league: r.league,
      host: location.host,
      title: `${r.league} · Week ${r.week} recap`,
      fileBase: `week-${r.week}-recap`,
      week,
      table,
    };
  }

  /* ------------------------------------------------------------ box scores */

  /* The first name abbreviated (bxShortName); defences carry no first name. */
  function shortName(name) {
    const parts = String(name).split(" ");
    if (parts.length < 2 || /D\/ST$/.test(name)) return name;
    return `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`;
  }

  function boxPlayer(p) {
    if (!p) return null;
    return {
      id: String(p.id), name: p.name, short: shortName(p.name), pos: p.pos || "", nfl: p.nfl || "FA",
      pts: Number(p.pts) || 0, proj: p.proj == null ? null : Number(p.proj), injury: p.injury || null,
    };
  }

  /* One game's box score (openBox): both lineups, slot by slot, in the
     order asked for. Null when the week has no lineups. */
  async function box(year, wk, idA, idB) {
    const E = B.seasonEngine(year);
    const season = B.model().season(year);
    const w = Number(wk);
    const data = await E.boxWeek(w);
    if (!data) return null;
    const game = data.games.find((g) => (g.home === idA && g.away === idB) || (g.home === idB && g.away === idA));
    if (!game) return null;
    const scoreOf = (id) => (game.home === id ? game.homeScore : game.awayScore);
    const round = season.postseason.find((g) => g.weeks.includes(w) &&
      ((g.a === idA && g.b === idB) || (g.a === idB && g.b === idA)));
    const lu = (id, test) => (game.lineups[id] || []).filter(test);
    const starters = (p) => p.starter;
    const benched = (p) => !p.starter && p.slot === "BE";
    const reserve = (p) => p.slot === "IR";
    const group = (label, left, right) => {
      const rows = [];
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i] || null, r = right[i] || null;
        rows.push({ slot: (l || r).slot, l: boxPlayer(l), r: boxPlayer(r) });
      }
      return { label, rows };
    };
    return {
      year: Number(year),
      week: w,
      title: `${season.year} · Week ${w}`,
      sub: round ? round.label : "",
      a: { id: idA, score: scoreOf(idA) },
      b: { id: idB, score: scoreOf(idB) },
      groups: [
        group("Starters", lu(idA, starters), lu(idB, starters)),
        group("Bench", lu(idA, benched), lu(idB, benched)),
        group("Injured reserve", lu(idA, reserve), lu(idB, reserve)),
      ].filter((g) => g.rows.length),
      foot: "The chip beside each player is his NFL club today.",
    };
  }

  /* The weeks of a season that have box scores. */
  async function boxWeeks(year) {
    const weeks = await B.model().boxWeeks(Number(year));
    return [...weeks].sort((a, b) => a - b);
  }

  /* ------------------------------------------------------------ a team's season */

  /* The team drawer (openTeam): the hero's line and stats, the regular
     season schedule, the bracket games, and the starters strip. */
  async function team(year, teamId) {
    const E = B.seasonEngine(year);
    const m = B.model();
    const season = m.season(year);
    const teams = season.teams;
    const t = teams[teamId];
    if (!t) throw new Error(`There is no team ${teamId} in ${year}.`);
    const FINISHED = season.finished;
    const REG = E.REGULAR_WEEKS;
    const stateWeek = E.state.week;
    const asOf = E.asOfWeek(FINISHED ? REG : stateWeek > REG ? REG : stateWeek);
    const picture = E.buildPicture(asOf);
    const line = FINISHED ? t : picture.stats[teamId];
    const seed = asOf > 0 ? picture.seedLabels[teamId] : null;
    const divisionLabel = (d) => (/division/i.test(d) ? d : `${d} Division`);
    const recordOf = (x) => (x.ties ? `${x.wins}–${x.losses}–${x.ties}` : `${x.wins}–${x.losses}`);

    const stats = [
      { label: "Record", value: FINISHED ? recordOf(t) : line.record },
      { label: "Points For", value: fmt(line.pf) },
      { label: "Points Against", value: fmt(line.pa) },
      FINISHED
        ? { label: "Final Place", value: t.finalRank ? `#${t.finalRank}` : "—" }
        : { label: "Current Seed", value: seed ? seed.chip : "—" },
    ];

    // seasonScheduleFor
    const schedule = [];
    for (let w = 1; w <= REG; w++) {
      const game = (season.schedule[w] || []).find(([a, b]) => a === teamId || b === teamId);
      if (!game) continue;
      const opponent = game[0] === teamId ? game[1] : game[0];
      const scored = (season.results[w] || []).find(([a, , b]) => a === teamId || b === teamId);
      if (scored) {
        const isFirst = scored[0] === teamId;
        const teamScore = isFirst ? scored[1] : scored[3];
        const oppScore = isFirst ? scored[3] : scored[1];
        schedule.push({ week: w, label: `Week ${w}`, opponent, teamScore, oppScore, result: teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T", played: true });
      } else {
        schedule.push({ week: w, label: `Week ${w}`, opponent, teamScore: null, oppScore: null, result: null, played: false });
      }
    }

    // postseasonFor
    const post = season.postseason
      .filter((g) => g.played && g.a && g.b && (g.a === teamId || g.b === teamId))
      .sort((x, y) => x.week - y.week)
      .map((g) => {
        const mine = g.a === teamId;
        const teamScore = mine ? g.aScore : g.bScore, oppScore = mine ? g.bScore : g.aScore;
        return { week: g.week, label: g.label, opponent: mine ? g.b : g.a, teamScore, oppScore, result: g.winner === teamId ? "W" : "L", played: true, bracket: g.bracket };
      });
    const postTitle = post.some((g) => g.bracket === "W") ? "Winner's Bracket" : "Losers Bracket";

    const [weeks, roster] = await Promise.all([boxWeeks(year).catch(() => []), starters(m, year, teamId, E).catch(() => null)]);

    return {
      year: Number(year),
      teamId,
      ownerId: t.ownerId,
      yearLine: `${season.year} season`,
      name: t.name,
      ownerLine: `${t.owner}${E.HAS_DIVISIONS && t.division ? ` · ${divisionLabel(t.division)}` : ""}`,
      stats,
      schedule,
      post: post.map(({ bracket, ...rest }) => rest),
      postTitle,
      boxWeeks: weeks,
      roster,
    };
  }

  /* renderRoster: everyone the team started, with a cell per week. */
  async function starters(m, year, teamId, E) {
    const data = await m.roster(Number(year));
    const team = data && data[teamId];
    if (!team || !team.players.length) return null;
    const REG = E.REGULAR_WEEKS;
    const leagueLast = Math.max(...Object.values(data).flatMap((t) => t.weeks));
    const last = Math.max(E.LAST_WEEK, leagueLast);
    const weeks = Array.from({ length: last }, (_, i) => i + 1);
    const played = new Set(team.weeks);
    const best = Math.max(...team.players.flatMap((p) => Object.values(p.weeks).filter((w) => w[1]).map((w) => w[0])), 1);
    const cell = (p, w) => {
      const wk = p.weeks[w];
      if (w > leagueLast) return { w, kind: "future", title: `Week ${w}: not played yet` };
      if (!played.has(w)) return { w, kind: "none", title: `Week ${w}: no game` };
      if (!wk) return { w, kind: "empty", title: `Week ${w}: not on the team` };
      const [pts, started, club] = wk;
      if (!started) return { w, kind: "bench", pts, club, title: `Week ${w}: bench · ${fmt(pts)} (${club})` };
      const fill = 0.25 + 0.75 * Math.max(0, pts) / best;
      return { w, kind: "start", fill: Number(fill.toFixed(2)), pts, club, title: `Week ${w}: started · ${fmt(pts)} (${club})` };
    };
    return {
      regularWeeks: REG,
      weeks,
      count: `${team.players.length} players`,
      players: team.players.map((p) => ({
        id: String(p.id), name: p.name, pos: p.pos || "", clubs: p.clubs.length ? p.clubs : ["FA"],
        starts: p.starts, pts: p.pts,
        cells: weeks.map((w) => cell(p, w)),
      })),
    };
  }

  B.recap = { week, box, boxWeeks, team };
})();
