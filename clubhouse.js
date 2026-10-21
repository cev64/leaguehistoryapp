/* The clubhouse: what a league's members do together week to week (league
   pick'em, the week's awards), worked out the same way on the site and in
   the app. Nothing here talks to the network: the pages and the app fetch a
   league's board from Supabase (supabase/migrations/
   20261021000000_league_clubhouse.sql) and hand it in, and everything is
   graded here from the league's own results, which every member already has.

     Clubhouse.leagueKey(model)        the league's lasting name in the
                                       database, or null for the demo
     Clubhouse.source(model)           "sleeper" | "espn"
     Clubhouse.gameKey(a, b)           a game's key: its two team ids, sorted
     Clubhouse.slate(season, week)     the week's games, [{ a, b, key }]
     Clubhouse.grade(season, board)    the pick'em standings (below)
     Clubhouse.AWARDS                  the week's awards
     Clubhouse.nominees(season, week)  who the week's results put up for each
     Clubhouse.awardWinners(board)     { week: { award: [team ids] } }
     Clubhouse.demoBoard(model, season, me, mine)
                                       the demo league's clubhouse: its other
                                       managers' picks and votes, made up the
                                       same way every time

   A board is what the database's pickem_board() returns (see the
   migration): { me, members: [owner ids], picks: [{ owner, week, game,
   winner, lock }], picked: { week: [owners] }, deadlines: { week: iso } }.
   Owner ids are the managers (team.ownerId, the same every season); a
   pick's teams are that season's team ids.

   Plain script, not a module, like sleeper.js: the pages load it before
   their own script and the app's engine loads it from the repository root. */
(function () {
  "use strict";

  const leagueKey = (model) => {
    if (!model || !model.leagueId || model.leagueId === "demo" || model.demo) return null;
    if (/^espn-\d+$/.test(model.leagueId)) return model.leagueId;
    // A Sleeper league's first season: each renewal gets a new league id,
    // the first one never changes. sleeper.js keeps it as rootLeagueId, the
    // end of the previous_league_id chain, whether or not that season
    // loaded; the oldest season on the model is the fallback.
    const first = (model.seasons || [])[0];
    const id = model.rootLeagueId || (first && first.leagueId);
    return /^\d{6,24}$/.test(String(id || "")) ? String(id) : null;
  };

  const source = (model) => (/^espn-/.test((model && model.leagueId) || "") ? "espn" : "sleeper");

  const gameKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // A game over two weeks (an ESPN two-week matchup) is picked in the week
  // it starts and scored in the week it ends.
  function spanOf(season) {
    const span = {};
    Object.values(season.multiWeeks || {}).forEach((weeks) => weeks.forEach((w) => { span[w] = weeks; }));
    return span;
  }
  const endOf = (span, w) => (span[w] ? span[w][span[w].length - 1] : w);
  const startsGame = (span, w) => !span[w] || span[w][0] === w;

  function slate(season, week) {
    const span = spanOf(season);
    if (!startsGame(span, week)) return [];
    return (season.schedule[week] || []).map(([a, b]) => ({ a, b, key: gameKey(a, b) }));
  }

  // The winner of every game a week's picks are about, once it's final:
  // { key: team id | "tie" }.
  function outcomes(season, week) {
    const span = spanOf(season);
    const end = endOf(span, week);
    const out = {};
    if (!(season.playedWeeks || []).includes(end)) return out;
    (season.results[end] || []).forEach(([a, as, b, bs]) => {
      out[gameKey(a, b)] = as > bs ? a : bs > as ? b : "tie";
    });
    return out;
  }

  /* The pick'em standings for a season:
       rows   [{ owner, team, correct, wrong, points, picked, perfect,
                 weeksWon, streak }] best first (points, then correct picks,
                 then fewest wrong)
       weeks  { week: { final, games, rows: [{ owner, correct, wrong, points,
                 picked }], best: [owners] } } for every week with picks
     A right pick is a point, a right Lock of the Week two; a tie in the game
     scores nothing either way. A perfect week is every game of a final week
     picked and right. */
  function grade(season, board) {
    const members = (board && board.members) || [];
    const teamOf = {};
    Object.entries(season.teams || {}).forEach(([id, t]) => { teamOf[t.ownerId] = id; });
    const byWeek = {};
    ((board && board.picks) || []).forEach((p) => {
      ((byWeek[p.week] = byWeek[p.week] || {})[p.owner] = byWeek[p.week][p.owner] || []).push(p);
    });

    const total = {};
    members.forEach((o) => {
      total[o] = { owner: o, team: teamOf[o] || null, correct: 0, wrong: 0, points: 0, picked: 0, perfect: 0, weeksWon: 0, streak: 0, run: 0 };
    });

    const weeks = {};
    Object.keys(byWeek).map(Number).sort((x, y) => x - y).forEach((w) => {
      const games = slate(season, w);
      const result = outcomes(season, w);
      const final = games.length > 0 && games.every((g) => g.key in result);
      const rows = members.map((o) => {
        const row = { owner: o, correct: 0, wrong: 0, points: 0, picked: 0 };
        (byWeek[w][o] || []).forEach((p) => {
          if (!games.some((g) => g.key === p.game)) return;
          row.picked += 1;
          const r = result[p.game];
          if (!r || r === "tie") return;
          if (r === p.winner) { row.correct += 1; row.points += p.lock ? 2 : 1; } else row.wrong += 1;
        });
        return row;
      });
      const top = Math.max(0, ...rows.map((r) => r.points));
      const best = final && top > 0 ? rows.filter((r) => r.points === top).map((r) => r.owner) : [];
      weeks[w] = { final, games: games.length, rows, best };
      rows.forEach((r) => {
        const t = total[r.owner];
        if (!t) return;
        t.correct += r.correct; t.wrong += r.wrong; t.points += r.points; t.picked += r.picked;
        if (final && r.picked === games.length && r.correct === games.length) t.perfect += 1;
        if (best.includes(r.owner)) t.weeksWon += 1;
      });
    });

    // The run of final weeks, latest first, each member finished at .500 or
    // better: their hot streak.
    const finals = Object.keys(weeks).map(Number).filter((w) => weeks[w].final).sort((x, y) => y - x);
    members.forEach((o) => {
      let run = 0;
      for (const w of finals) {
        const r = weeks[w].rows.find((x) => x.owner === o);
        if (!r || !r.picked || r.correct * 2 < r.correct + r.wrong) break;
        run += 1;
      }
      total[o].streak = run;
      delete total[o].run;
    });

    const rows = Object.values(total).sort((x, y) =>
      (y.points - x.points) || (y.correct - x.correct) || (x.wrong - y.wrong));
    return { rows, weeks };
  }

  /* ------------------------------------------------------------ awards */

  const AWARDS = [
    { id: "mvp", title: "Manager of the Week", short: "MVP", blurb: "The week's best showing.", emoji: "🏅" },
    { id: "choke", title: "Choke of the Week", short: "Choke", blurb: "The week's biggest letdown.", emoji: "🫠" },
    { id: "robbery", title: "Robbery of the Week", short: "Robbery", blurb: "The win nobody earned.", emoji: "🦹" },
  ];

  const fmt = (n) => Number(n).toFixed(2).replace(/\.?0+$/, "");

  /* Who a final week's results put up for each award, with why:
     { mvp: [{ team, reason }], choke: [...], robbery: [...] }. Anyone can
     still be voted for; these are the obvious ones. */
  function nominees(season, week) {
    const games = season.results[week] || [];
    if (!games.length) return null;
    const sides = [];
    games.forEach(([a, as, b, bs]) => {
      sides.push({ team: a, score: as, opp: b, oppScore: bs, won: as > bs, margin: as - bs });
      sides.push({ team: b, score: bs, opp: a, oppScore: as, won: bs > as, margin: bs - as });
    });
    const name = (id) => (season.teams[id] ? season.teams[id].name : id);
    const byScore = sides.slice().sort((x, y) => y.score - x.score);
    const place = (s) => byScore.indexOf(s) + 1;
    const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

    const mvp = byScore.slice(0, 3).map((s) => ({
      team: s.team,
      reason: `${fmt(s.score)} points, the week's ${place(s) === 1 ? "high" : `${ordinal(place(s))} best`}${s.won ? "" : `, and still lost to ${name(s.opp)}`}`,
    }));
    // A letdown: the losses with the most points behind them (lost despite
    // scoring), then the week's lowest scores.
    const choke = [];
    sides.filter((s) => !s.won && s.margin < 0).sort((x, y) => y.score - x.score).slice(0, 2).forEach((s) => {
      choke.push({ team: s.team, reason: `Lost with ${fmt(s.score)}, the week's ${ordinal(place(s))} best score` });
    });
    byScore.slice().reverse().forEach((s) => {
      if (choke.length >= 3 || choke.some((c) => c.team === s.team)) return;
      choke.push({ team: s.team, reason: `${fmt(s.score)} points, the week's ${place(s) === sides.length ? "low" : `${ordinal(sides.length - place(s) + 1)} lowest`}` });
    });
    // A robbery: a win with fewer points than half the league scored, or by
    // under five; the fewest points first. Failing any, the week's
    // lowest-scoring win.
    const median = byScore[Math.floor(byScore.length / 2)].score;
    const wins = sides.filter((s) => s.won).sort((x, y) => (x.score - y.score) || (x.margin - y.margin));
    const stolen = wins.filter((s) => s.score < median || s.margin < 5);
    const robbery = (stolen.length ? stolen : wins.slice(0, 1)).slice(0, 3).map((s) => ({
      team: s.team,
      reason: s.margin < 5 ? `Beat ${name(s.opp)} by ${fmt(s.margin)}` : `Won with ${fmt(s.score)}, the week's ${ordinal(sides.length - place(s) + 1)} lowest score`,
    }));
    return { mvp, choke, robbery };
  }

  // The winners of every week whose voting has closed: the most votes, a
  // tie sharing it. board.results is award_board()'s.
  function awardWinners(board) {
    const out = {};
    const best = {};
    ((board && board.results) || []).forEach((r) => {
      const k = `${r.week}|${r.award}`;
      best[k] = Math.max(best[k] || 0, r.votes);
    });
    ((board && board.results) || []).forEach((r) => {
      if (r.votes !== best[`${r.week}|${r.award}`]) return;
      ((out[r.week] = out[r.week] || {})[r.award] = out[r.week][r.award] || []).push(r.nominee);
    });
    return out;
  }

  /* ------------------------------------------------------------ the demo */

  // A small seeded generator, so the demo's league-mates pick the same way
  // on every visit.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (text) => [...String(text)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

  /* The demo league's clubhouse, as the database would answer it: every
     other manager is a member who has picked every week up to the next one
     to be played and voted on every final week, as a fair player would
     (mostly the better record, sometimes not). `me` is the manager the
     visitor has claimed (or null), `mine` their own picks and votes kept on
     the device: { picks: [{ week, game, winner, lock }], votes: [{ week,
     award, nominee }] }. Returns { pickem, awards } in the boards' shapes;
     the week to be picked counts as open, every week before it as locked. */
  function demoBoard(model, season, me, mine) {
    const ownerOf = (id) => season.teams[id] && season.teams[id].ownerId;
    const owners = Object.values(season.teams).map((t) => t.ownerId).filter(Boolean);
    const played = season.playedWeeks || [];
    const last = played.length ? played[played.length - 1] : 0;
    const open = last + 1;
    const regular = (season.settings && season.settings.regularWeeks) || 14;
    const picks = [];
    const picked = {};

    // Records as they stood before a week, for the league-mates' hunches.
    const recordBefore = (w) => {
      const wins = {};
      played.filter((x) => x < w).forEach((x) => (season.results[x] || []).forEach(([a, as, b, bs]) => {
        wins[a] = (wins[a] || 0) + (as > bs ? 1 : 0);
        wins[b] = (wins[b] || 0) + (bs > as ? 1 : 0);
      }));
      return wins;
    };

    owners.forEach((owner) => {
      if (owner === me) return;
      const r = rng(hash(`${season.year}|${owner}`));
      const skill = 0.55 + r() * 0.2;
      for (let w = 1; w <= Math.min(open, regular); w++) {
        const games = slate(season, w);
        if (!games.length) continue;
        const wins = recordBefore(w);
        const result = outcomes(season, w);
        const lockAt = Math.floor(r() * games.length);
        const weekPicks = games.map((g, i) => {
          const fav = (wins[g.a] || 0) >= (wins[g.b] || 0) ? g.a : g.b;
          const other = fav === g.a ? g.b : g.a;
          // A league-mate who knows their league: right a fair share of the
          // time once the week is in, otherwise their hunch.
          const actual = result[g.key];
          const winner = actual && actual !== "tie" ? (r() < skill ? actual : (actual === g.a ? g.b : g.a)) : (r() < 0.7 ? fav : other);
          return { owner, week: w, game: g.key, winner, lock: i === lockAt };
        });
        // The open week: everyone but the visitor has picked. Before the
        // visitor has claimed a team, the seat they'll take is the one
        // still to pick, so the count never reads as if they had.
        if (w === open) { if (me || owner !== owners[0]) (picked[w] = picked[w] || []).push(owner); }
        else picks.push(...weekPicks);
      }
    });
    ((mine && mine.picks) || []).forEach((p) => picks.push({ owner: me, week: p.week, game: p.game, winner: p.winner, lock: Boolean(p.lock) }));
    if (me && (mine && mine.picks || []).some((p) => p.week === open)) (picked[open] = picked[open] || []).push(me);

    // Votes: every week whose next week has been played is closed.
    const results = [];
    const voters = {};
    const myVotes = ((mine && mine.votes) || []).slice();
    played.forEach((w) => {
      const nom = nominees(season, w);
      if (!nom) return;
      const closed = played.includes(w + 1);
      AWARDS.forEach((award) => {
        const tally = {};
        owners.forEach((owner) => {
          if (owner === me) return;
          const r = rng(hash(`${season.year}|${w}|${award.id}|${owner}`));
          const list = nom[award.id];
          const pick = list[Math.min(list.length - 1, Math.floor(r() * r() * list.length))];
          // Nobody votes for their own team for MVP.
          const team = pick.team === Object.keys(season.teams).find((id) => ownerOf(id) === owner) && award.id === "mvp" && list[1] ? list[1].team : pick.team;
          tally[team] = (tally[team] || 0) + 1;
        });
        const mineHere = myVotes.find((v) => v.week === w && v.award === award.id);
        if (mineHere) tally[mineHere.nominee] = (tally[mineHere.nominee] || 0) + 1;
        if (closed) Object.entries(tally).forEach(([nominee, votes]) => results.push({ week: w, award: award.id, nominee, votes }));
        else ((voters[w] = voters[w] || {})[award.id] = Object.values(tally).reduce((s, n) => s + n, 0));
      });
    });

    const deadlines = {};
    for (let w = 1; w <= 18; w++) deadlines[w] = w <= last ? "2000-01-01T00:00:00Z" : "2999-01-01T00:00:00Z";
    const closes = {};
    for (let w = 1; w <= 18; w++) closes[w] = played.includes(w + 1) ? "2000-01-01T00:00:00Z" : "2999-01-01T00:00:00Z";
    return {
      pickem: { me, members: owners, picks, picked, deadlines, demo: true },
      awards: { mine: myVotes, voters, results, closes, demo: true },
    };
  }

  window.Clubhouse = { leagueKey, source, gameKey, slate, outcomes, grade, AWARDS, nominees, awardWinners, demoBoard };
})();
