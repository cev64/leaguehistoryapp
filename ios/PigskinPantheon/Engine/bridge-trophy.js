/* Bridge.trophy: the trophy room's exhibits for the app's native hall.

   The first half is trophy/accolades.js, lifted verbatim (only `export`
   dropped, and the two page links turned into app routes), so every
   honour, plaque and locker says exactly what the site's says. The second
   half is what trophy/app.js does with the league before building the
   hall (loadLeague), and the words trophy/locker.js puts on each piece of a
   team locker's wall, so the app only has to sculpt and arrange them. */
(function () {
  "use strict";

  /* ======================================== trophy/accolades.js (verbatim) */
  /* Turns the raw league record into the list of things the hall puts on a
     pedestal. Nothing here knows about three.js — it produces plain exhibit
     objects, and the 3D layer decides how to sculpt each `kind`.

     The hall is one continuous gallery divided into wings. Wing order is the
     order you walk past them, so it doubles as the rail order. */

  /* Every team that played is in the hall. */
  const inTheHall = (team) => Boolean(team);

  // Pages elsewhere on the site, for the league the hall was built for.
  // In the app a link is a route the native side opens: "season:<year>" or
  // "manager:<ownerId>" (LeagueRoute.season / .manager).
  const seasonHref = (year) => `season:${year}`;
  const profileHref = (ownerId) => `manager:${ownerId}`;

  const fmt = (value, digits = 2) =>
    Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const ordinal = (n) => {
    const rules = new Intl.PluralRules("en-US", { type: "ordinal" });
    const suffix = { one: "st", two: "nd", few: "rd", other: "th" }[rules.select(n)];
    return `${n}${suffix}`;
  };

  /* Every game of every season, flattened, with both sides resolved to their
     team record for that year. Almost every record below is a scan over this. */
  function flattenGames(data) {
    const rows = [];
    data.seasons.forEach((season) => {
      const push = (game, stage) => {
        const a = season.teams[game.a];
        const b = season.teams[game.b];
        if (!a || !b) return;
        rows.push({
          year: season.year,
          week: game.week,
          stage,
          label: game.label || "Regular Season",
          winner: game.aScore >= game.bScore ? a : b,
          loser: game.aScore >= game.bScore ? b : a,
          winScore: Math.max(game.aScore, game.bScore),
          loseScore: Math.min(game.aScore, game.bScore),
          sides: [
            { team: a, points: game.aScore, opponent: b, against: game.bScore },
            { team: b, points: game.bScore, opponent: a, against: game.aScore }
          ]
        });
      };
      season.regularGames.forEach((game) => push(game, "regular"));
      season.postseasonGames.forEach((game) => push(game, "post"));
    });
    return rows;
  }

  /* Per-owner career totals. Teams whose owner has left the league (they are in
     the season standings but not in the owners map) are counted in the game
     records but get no hall-of-fame pillar — same rule the record book uses. */
  function careerTotals(data) {
    const careers = {};
    Object.entries(data.owners).forEach(([ownerId, owner]) => {
      careers[ownerId] = {
        ownerId,
        ...owner,
        seasons: [],
        wins: 0,
        losses: 0,
        pf: 0,
        pa: 0,
        titles: [],
        cellars: [],
        finishes: [],
        playoffWins: 0,
        playoffLosses: 0,
        bestWeek: null
      };
    });

    data.seasons.forEach((season) => {
      const size = Object.keys(season.teams).length;
      Object.values(season.teams).forEach((team) => {
        const career = careers[team.ownerId];
        if (!career || !inTheHall(team)) return;
        career.seasons.push({ year: season.year, ...team });
        career.wins += team.wins;
        career.losses += team.losses;
        career.pf += team.pf;
        career.pa += team.pa;
        career.finishes.push({ year: season.year, rank: team.finalRank });
        if (team.finalRank === 1) career.titles.push(season.year);
        if (team.officialLastPlace || team.finalRank === size) career.cellars.push(season.year);
      });

      season.postseasonGames.forEach((game) => {
        // The winner's bracket on the road to the title; placement games aside.
        if (!game.titlePath) return;
        const a = season.teams[game.a];
        const b = season.teams[game.b];
        const won = game.aScore >= game.bScore ? a : b;
        const lost = game.aScore >= game.bScore ? b : a;
        if (careers[won.ownerId]) careers[won.ownerId].playoffWins += 1;
        if (careers[lost.ownerId]) careers[lost.ownerId].playoffLosses += 1;
      });
    });

    flattenGames(data).filter((row) => row.sides.every((side) => inTheHall(side.team))).forEach((row) => {
      row.sides.forEach((side) => {
        const career = careers[side.team.ownerId];
        if (!career) return;
        if (!career.bestWeek || side.points > career.bestWeek.points) {
          career.bestWeek = { points: side.points, year: row.year, week: row.week };
        }
      });
    });

    Object.values(careers).forEach((career) => {
      career.games = career.wins + career.losses;
      career.pct = career.games ? career.wins / career.games : 0;
      career.ppg = career.games ? career.pf / career.games : 0;
      career.bestFinish = career.finishes.length ? Math.min(...career.finishes.map((f) => f.rank)) : null;
      career.podiums = career.finishes.filter((f) => f.rank <= 3).length;
    });

    return careers;
  }

  /* Every game each manager has played, in order: a season's regular season,
     then its bracket (third-place game included), then the next season. Runs are
     a manager's, not a team's, so they carry across years and renames — winning
     the last three games of one season and the first two of the next is five
     straight. `data.liveSeason`, when the season in progress could be read, adds
     its games, so a run still going is measured to its latest result. */
  function ownerTimelines(data) {
    const lines = {};
    const add = (team, year, week, order, mine, theirs) => {
      if (!inTheHall(team)) return;
      (lines[team.ownerId] || (lines[team.ownerId] = [])).push({
        team, year, week, order: year * 100 + order,
        result: mine > theirs ? "win" : mine < theirs ? "loss" : "tie"
      });
    };
    const both = (teams, year, game, order) => {
      add(teams[game.a], year, game.week, order, game.aScore, game.bScore);
      add(teams[game.b], year, game.week, order, game.bScore, game.aScore);
    };

    data.seasons.forEach((season) => {
      season.regularGames.forEach((g) => both(season.teams, season.year, g, g.week));
      season.postseasonGames.forEach((g) => both(season.teams, season.year, g, g.week + 0.5));
      (data.thirdPlaceGames || []).filter((g) => g.year === season.year).forEach((g) => {
        add(season.teams[g.winner], season.year, g.week, g.week + 0.5, 1, 0);
        add(season.teams[g.loser], season.year, g.week, g.week + 0.5, 0, 1);
      });
    });

    const live = data.liveSeason;
    if (live) {
      Object.entries(live.results).forEach(([week, games]) => {
        games.forEach(([a, aScore, b, bScore]) =>
          both(live.teams, live.year, { week: Number(week), a, aScore, b, bScore }, Number(week)));
      });
    }

    Object.values(lines).forEach((line) => line.sort((x, y) => x.order - y.order));
    return lines;
  }

  /* The longest run of one result in a manager's timeline. `team` is the side
     that ended it, and `live` marks a run that is still going. */
  function bestRun(line, outcome, liveYear) {
    let best = null;
    let start = 0;
    line.forEach((game, i) => {
      if (game.result !== outcome) { start = i + 1; return; }
      const run = i - start + 1;
      if (!best || run > best.run) {
        best = {
          run, team: game.team,
          from: { year: line[start].year, week: line[start].week },
          to: { year: game.year, week: game.week },
          live: i === line.length - 1 && game.year === liveYear
        };
      }
    });
    return best;
  }

  /* Longest run of one result by any manager. Pass "loss" for the other end of
     it. `tied` lists every manager's run of that length, the first included. */
  function longestStreak(data, outcome = "win") {
    const liveYear = data.liveSeason && data.liveSeason.year;
    const runs = Object.values(ownerTimelines(data))
      .map((line) => bestRun(line, outcome, liveYear))
      .filter(Boolean);
    if (!runs.length) return null;
    const length = Math.max(...runs.map((run) => run.run));
    const tied = runs.filter((run) => run.run === length);
    return { ...tied[0], tied };
  }

  // A streak plaque: one run and its dates, or every run that shares the mark.
  function streakPlaque(plaque, id, label, streak, verb) {
    const { tied } = streak;
    if (tied.length > 1) {
      return plaque(
        id, label, `${streak.run}`, tied.map((s) => s.team.name).join(" & "),
        `${tied.length} managers share it`,
        `${tied.map((s) => s.team.owner).join(" and ")} have each ${verb} ${streak.run} straight.`,
        null, streak.team.color, streak.team.icon,
        tied.map((s) => ({ label: s.team.owner, value: `${streakSpan(s)}${s.live ? " · still going" : ""}` })),
        crestsOf(tied.map((s) => s.team))
      );
    }
    return plaque(
      id, label, `${streak.run}`, streak.team.name,
      streakSpan(streak),
      `${streak.team.owner} ${verb} ${streak.run} straight ${streakWhen(streak)}${streak.live ? ", and counting" : ""}.`,
      streak.team.ownerId, streak.team.color, streak.team.icon
    );
  }

  // "2025 · weeks 7–16", or "Week 15, 2025 – Week 2, 2026" for a run across years.
  const streakSpan = (s) => (s.from.year === s.to.year
    ? `${s.to.year} · weeks ${s.from.week}–${s.to.week}`
    : `Week ${s.from.week}, ${s.from.year} – Week ${s.to.week}, ${s.to.year}`);

  // "in 2025, from week 7 to week 16", or "from week 15 of 2025 to week 2 of 2026".
  const streakWhen = (s) => (s.from.year === s.to.year
    ? `in ${s.to.year}, from week ${s.from.week} to week ${s.to.week}`
    : `from week ${s.from.week} of ${s.from.year} to week ${s.to.week} of ${s.to.year}`);

  function championExhibits(data, careers) {
    // Newest first: you walk in on the reigning champion and travel back through
    // the years.
    const items = [...data.seasons].sort((a, b) => b.year - a.year).map((season) => {
      const champ = Object.values(season.teams).find((team) => team.finalRank === 1);
      if (!champ) return null;
      const runnerUp = Object.values(season.teams).find((team) => team.finalRank === 2);
      const final = season.postseasonGames.find((game) => game.label === "Championship");
      const size = Object.keys(season.teams).length;

      let finalLine = "";
      if (final) {
        const a = season.teams[final.a];
        const champScore = a === champ ? final.aScore : final.bScore;
        const foeScore = a === champ ? final.bScore : final.aScore;
        const foe = a === champ ? season.teams[final.b] : a;
        finalLine = `${fmt(champScore)} – ${fmt(foeScore)} over ${foe.name}`;
      }

      return {
        id: `champ-${season.year}`,
        kind: "cup",
        year: season.year,
        title: String(season.year),
        subtitle: champ.name,
        owner: champ.owner,
        ownerId: champ.ownerId,
        icon: champ.icon,
        color: champ.color,
        plate: `${season.year} CHAMPION`,
        blurb: `${champ.owner} took the ${season.year} title with ${champ.name}, finishing ${champ.wins}–${champ.losses} across a ${size}-team field.`,
        stats: [
          { label: "Record", value: `${champ.wins}–${champ.losses}` },
          { label: "Points For", value: fmt(champ.pf) },
          { label: "Points Against", value: fmt(champ.pa) },
          ...(finalLine ? [{ label: "Title Game", value: finalLine }] : []),
          ...(runnerUp ? [{ label: "Runner-Up", value: runnerUp.name }] : [])
        ],
        links: [
          { label: `${season.year} Season`, href: seasonHref(season.year) },
          ...(careers[champ.ownerId]
            ? [{ label: `${champ.owner}'s Profile`, href: profileHref(champ.ownerId) }]
            : [])
        ]
      };
    }).filter(Boolean);

    return items;
  }

  function hallOfFameExhibits(careers) {
    return Object.values(careers)
      .filter((career) => career.seasons.length)
      .sort((a, b) =>
        b.titles.length - a.titles.length ||
        b.pct - a.pct ||
        b.wins - a.wins
      )
      .map((career) => ({
        id: `hof-${career.ownerId}`,
        kind: "pillar",
        title: career.currentTeam,
        subtitle: career.name,
        owner: career.name,
        ownerId: career.ownerId,
        icon: career.icon,
        color: career.color,
        rings: career.titles.length,
        plate: career.name.toUpperCase(),
        blurb: career.titles.length
          ? `${career.titles.length === 1 ? "A title" : `${career.titles.length} titles`} in ${career.titles.join(", ")}, over ${career.seasons.length} ${career.seasons.length === 1 ? "season" : "seasons"} on record.`
          : `${career.seasons.length} ${career.seasons.length === 1 ? "season" : "seasons"} on record, best finish ${ordinal(career.bestFinish)}.`,
        stats: [
          { label: "Titles", value: career.titles.length ? `${career.titles.length} · ${career.titles.join(", ")}` : "—" },
          { label: "All-Time Record", value: `${career.wins}–${career.losses} (${(career.pct * 100).toFixed(1)}%)` },
          { label: "Playoff Record", value: `${career.playoffWins}–${career.playoffLosses}` },
          { label: "Points For", value: fmt(career.pf) },
          { label: "Points / Game", value: fmt(career.ppg) },
          { label: "Best Finish", value: ordinal(career.bestFinish) },
          ...(career.bestWeek
            ? [{ label: "Best Week", value: `${fmt(career.bestWeek.points)} · W${career.bestWeek.week} ${career.bestWeek.year}` }]
            : []),
          { label: "Seasons", value: career.seasons.map((s) => s.year).join(", ") }
        ],
        links: [{ label: "Full Profile", href: profileHref(career.ownerId) }]
      }));
  }

  /* The two walls face each other across the same numbers, so they share the
     ways of slicing them.

     Teams the record book keeps out of its leaderboards stay out of the walls
     too, and not only as holders: a whole game is dropped if either side is one
     of them, because a plaque names the opponent as well as the winner. Every
     mark here is therefore between teams the hall recognises, and falls to the
     next one that qualifies. */
  function marks(data, careers) {
    const games = flattenGames(data).filter((row) => row.sides.every((side) => inTheHall(side.team)));
    return {
      games,
      // One row per team per game, which is what a "best/worst week" is about.
      sides: games.flatMap((row) =>
        row.sides.map((side) => ({ ...side, year: row.year, week: row.week, stage: row.stage, label: row.label }))
      ),
      seasonTeams: data.seasons.flatMap((season) =>
        Object.values(season.teams).filter(inTheHall).map((team) => ({
          ...team, year: season.year, size: Object.keys(season.teams).length
        }))
      ),
      // A single season is too small a sample to hold a career mark — unless the
      // league is young enough that nobody has two, in which case one will do.
      veterans: (() => {
        const played = Object.values(careers).filter((career) => career.seasons.length);
        const seasoned = played.filter((career) => career.seasons.length >= 2);
        return seasoned.length ? seasoned : played;
      })(),
      // Both return null on an empty list: a couple of these marks are drawn from
      // filtered sets that a small enough league could leave empty.
      top: (list, score) => (list.length ? list.reduce((best, item) => (score(item) > score(best) ? item : best)) : null),
      bottom: (list, score) => (list.length ? list.reduce((worst, item) => (score(item) < score(worst) ? item : worst)) : null),
      allTied: (list, score) => {
        const best = Math.max(...list.map(score));
        return list.filter((item) => score(item) === best);
      }
    };
  }

  /* Builds the plaque object for one mark. `tarnished` swaps brass for pewter,
     which is how the lowlight wall tells itself apart from the record wall. */
  function plaqueMaker(careers, { prefix, tarnished = false }) {
    return (id, label, value, holder, meta, blurb, ownerId, color, icon, stats = [], holders = []) => ({
      id: `${prefix}-${id}`,
      kind: "plaque",
      tarnished,
      title: label,
      subtitle: holder,
      owner: holder,
      ownerId,
      icon,
      color,
      bigValue: value,
      plate: label.toUpperCase(),
      meta,
      blurb,
      stats,
      // A shared mark puts every holder's crest on the plaque, side by side.
      holders: holders.length > 1 ? holders : null,
      // Some marks are held by managers who left before this record book existed,
      // and have no profile to send anyone to. A shared mark links each holder's.
      links: holders.length > 1
        ? holders.filter((h) => careers[h.ownerId])
          .map((h) => ({ label: `${h.name} · Profile`, href: profileHref(h.ownerId) }))
        : ownerId && careers[ownerId]
          ? [{ label: `${holder} · Profile`, href: profileHref(ownerId) }]
          : []
    });
  }

  // The crest for each holder of a shared mark, from their careers or their teams.
  const crestsOf = (list) => list.map((h) => ({
    ownerId: h.ownerId, color: h.color, icon: h.icon, name: h.name || h.owner
  }));

  function recordExhibits(data, careers) {
    const { games, sides, seasonTeams, veterans, top, bottom, allTied } = marks(data, careers);
    const streak = longestStreak(data, "win");

    const bestWeek = top(sides, (s) => s.points);
    const bestSeasonPf = top(seasonTeams, (t) => t.pf);
    const bestSeasonRecord = top(seasonTeams, (t) => t.wins - t.losses / 100);
    const blowout = top(games, (g) => g.winScore - g.loseScore);
    const nailBiter = bottom(games, (g) => g.winScore - g.loseScore);
    const shootout = top(games, (g) => g.winScore + g.loseScore);
    // A mark can be shared. Where it is, every holder goes on the plaque.
    const titleHolders = allTied(veterans, (c) => c.titles.length);
    const titleCount = titleHolders[0].titles.length;
    const mostTitles = titleHolders[0];
    const bestPct = top(veterans, (c) => c.pct);
    const playoffWinHolders = allTied(veterans, (c) => c.playoffWins);
    const mostPlayoffWins = playoffWinHolders[0];

    const plaque = plaqueMaker(careers, { prefix: "rec" });

    return [
      plaque(
        "high-week", "Highest Week", fmt(bestWeek.points), bestWeek.team.name,
        `Week ${bestWeek.week} · ${bestWeek.year}`,
        `${bestWeek.team.owner} hung ${fmt(bestWeek.points)} on ${bestWeek.opponent.name} in week ${bestWeek.week} of ${bestWeek.year}. Nobody has come closer since.`,
        bestWeek.team.ownerId, bestWeek.team.color, bestWeek.team.icon,
        [{ label: "Opponent", value: `${bestWeek.opponent.name} · ${fmt(bestWeek.against)}` }]
      ),
      plaque(
        "season-points", "Most Points, Season", fmt(bestSeasonPf.pf), bestSeasonPf.name,
        `${bestSeasonPf.year} · ${bestSeasonPf.wins}–${bestSeasonPf.losses}`,
        `${bestSeasonPf.owner} scored ${fmt(bestSeasonPf.pf)} across the ${bestSeasonPf.year} regular season — ${fmt(bestSeasonPf.pf / (bestSeasonPf.wins + bestSeasonPf.losses))} a week.`,
        bestSeasonPf.ownerId, bestSeasonPf.color, bestSeasonPf.icon,
        [
          { label: "Finish", value: ordinal(bestSeasonPf.finalRank) },
          { label: "Points Against", value: fmt(bestSeasonPf.pa) }
        ]
      ),
      plaque(
        "best-record", "Best Season Record", `${bestSeasonRecord.wins}–${bestSeasonRecord.losses}`, bestSeasonRecord.name,
        `${bestSeasonRecord.year}`,
        `${bestSeasonRecord.owner} went ${bestSeasonRecord.wins}–${bestSeasonRecord.losses} in ${bestSeasonRecord.year} and finished ${ordinal(bestSeasonRecord.finalRank)}.`,
        bestSeasonRecord.ownerId, bestSeasonRecord.color, bestSeasonRecord.icon,
        [{ label: "Points For", value: fmt(bestSeasonRecord.pf) }]
      ),
      plaque(
        "blowout", "Biggest Blowout", fmt(blowout.winScore - blowout.loseScore), blowout.winner.name,
        `Week ${blowout.week} · ${blowout.year}`,
        `${blowout.winner.name} ${fmt(blowout.winScore)}, ${blowout.loser.name} ${fmt(blowout.loseScore)}. A ${fmt(blowout.winScore - blowout.loseScore)}-point margin in week ${blowout.week} of ${blowout.year}.`,
        blowout.winner.ownerId, blowout.winner.color, blowout.winner.icon,
        [{ label: "Final", value: `${fmt(blowout.winScore)} – ${fmt(blowout.loseScore)}` }]
      ),
      plaque(
        "nail-biter", "Closest Finish", fmt(nailBiter.winScore - nailBiter.loseScore), nailBiter.winner.name,
        `Week ${nailBiter.week} · ${nailBiter.year}${nailBiter.stage === "post" ? ` · ${nailBiter.label}` : ""}`,
        `${nailBiter.winner.name} edged ${nailBiter.loser.name} by ${fmt(nailBiter.winScore - nailBiter.loseScore)} in week ${nailBiter.week} of ${nailBiter.year}.`,
        nailBiter.winner.ownerId, nailBiter.winner.color, nailBiter.winner.icon,
        [{ label: "Final", value: `${fmt(nailBiter.winScore)} – ${fmt(nailBiter.loseScore)}` }]
      ),
      plaque(
        "shootout", "Highest-Scoring Game", fmt(shootout.winScore + shootout.loseScore), `${shootout.winner.name} vs ${shootout.loser.name}`,
        `Week ${shootout.week} · ${shootout.year}`,
        `${fmt(shootout.winScore)} to ${fmt(shootout.loseScore)} — ${fmt(shootout.winScore + shootout.loseScore)} combined points in week ${shootout.week} of ${shootout.year}.`,
        shootout.winner.ownerId, shootout.winner.color, shootout.winner.icon
      ),
      plaque(
        "titles", "Most Championships", String(titleCount),
        titleHolders.map((c) => c.currentTeam).join(" & "),
        titleHolders.map((c) => c.titles.join(", ")).join(" · "),
        titleHolders.length > 1
          ? `${titleHolders.map((c) => c.name).join(" and ")} are tied at ${titleCount} titles apiece.`
          : `${mostTitles.name} has taken ${titleCount} of the league's titles.`,
        titleHolders.length > 1 ? null : mostTitles.ownerId,
        mostTitles.color, mostTitles.icon,
        titleHolders.map((c) => ({ label: c.name, value: `${c.titles.length} · ${c.titles.join(", ")}` })),
        crestsOf(titleHolders)
      ),
      plaque(
        "win-pct", "Best Win Rate", `${(bestPct.pct * 100).toFixed(1)}%`, bestPct.currentTeam,
        `${bestPct.wins}–${bestPct.losses} all-time`,
        `${bestPct.name} wins ${(bestPct.pct * 100).toFixed(1)}% of the time across ${bestPct.seasons.length} seasons.`,
        bestPct.ownerId, bestPct.color, bestPct.icon,
        [{ label: "Points / Game", value: fmt(bestPct.ppg) }]
      ),
      playoffWinHolders.length > 1
        ? plaque(
          "playoff-wins", "Most Playoff Wins", String(mostPlayoffWins.playoffWins),
          playoffWinHolders.map((c) => c.currentTeam).join(" & "),
          `${playoffWinHolders.length} managers share it`,
          `${playoffWinHolders.map((c) => c.name).join(" and ")} have each won ${mostPlayoffWins.playoffWins} games once the bracket starts.`,
          null, mostPlayoffWins.color, mostPlayoffWins.icon,
          playoffWinHolders.map((c) => ({ label: c.name, value: `${c.playoffWins}–${c.playoffLosses} in the bracket` })),
          crestsOf(playoffWinHolders)
        )
        : plaque(
          "playoff-wins", "Most Playoff Wins", String(mostPlayoffWins.playoffWins), mostPlayoffWins.currentTeam,
          `${mostPlayoffWins.playoffWins}–${mostPlayoffWins.playoffLosses} in the bracket`,
          `${mostPlayoffWins.name} has won ${mostPlayoffWins.playoffWins} games once the bracket starts.`,
          mostPlayoffWins.ownerId, mostPlayoffWins.color, mostPlayoffWins.icon
        ),
      ...(streak ? [streakPlaque(plaque, "streak", "Longest Win Streak", streak, "won")] : [])
    ];
  }

  /* Champions, and how they did the season after. A title defence only counts
     where the league actually played the following year and the same manager
     came back — the worst of them leads the plaque. */
  function titleDefences(data) {
    const seasons = [...data.seasons].sort((a, b) => a.year - b.year);
    const defences = [];

    seasons.forEach((season, index) => {
      const next = seasons[index + 1];
      if (!next) return;
      const champ = Object.values(season.teams).find((team) => team.finalRank === 1);
      if (!champ) return;
      const after = Object.values(next.teams).find((team) => team.ownerId === champ.ownerId);
      if (!after) return;
      defences.push({
        year: season.year,
        champ,
        after: { ...after, year: next.year, size: Object.keys(next.teams).length }
      });
    });

    return defences.sort((a, b) => b.after.finalRank - a.after.finalRank);
  }

  /* The record wall's mirror. Same seasons, same games, read from the other end.
     Nobody is going to be thrilled to hold one of these, so the plaques are
     pewter rather than brass and the wording states the fact and stops. */
  function lowlightExhibits(data, careers) {
    const { games, sides, seasonTeams, veterans, top, bottom, allTied } = marks(data, careers);
    const slump = longestStreak(data, "loss");

    const worstWeek = bottom(sides, (s) => s.points);
    const fewestSeasonPf = bottom(seasonTeams, (t) => t.pf);
    const worstSeasonRecord = bottom(seasonTeams, (t) => t.wins - t.losses / 100);
    const defences = titleDefences(data);
    const snoozer = bottom(games, (g) => g.winScore + g.loseScore);
    const worstPct = bottom(veterans, (c) => c.pct);
    const cellarHolders = allTied(
      Object.values(careers).filter((c) => c.seasons.length),
      (c) => c.cellars.length
    );
    const cellarCount = cellarHolders[0].cellars.length;
    // Counting playoff losses would punish a manager for qualifying often, so
    // this is a rate, over managers who have actually been in the bracket.
    const worstBracket = bottom(
      veterans.filter((c) => c.playoffWins + c.playoffLosses >= 3),
      (c) => c.playoffWins / (c.playoffWins + c.playoffLosses)
    );

    // The season that scored like a contender and finished like nothing of the
    // sort: most points among teams that ended in the bottom half of their field.
    const hardLuck = top(
      seasonTeams.filter((t) => t.finalRank > t.size / 2),
      (t) => t.pf
    );

    const plaque = plaqueMaker(careers, { prefix: "low", tarnished: true });

    return [
      plaque(
        "cold-week", "Coldest Week", fmt(worstWeek.points), worstWeek.team.name,
        `Week ${worstWeek.week} · ${worstWeek.year}`,
        `${fmt(worstWeek.points)} points. ${worstWeek.opponent.name} put up ${fmt(worstWeek.against)} the same week.`,
        worstWeek.team.ownerId, worstWeek.team.color, worstWeek.team.icon,
        [{ label: "Opponent", value: `${worstWeek.opponent.name} · ${fmt(worstWeek.against)}` }]
      ),
      plaque(
        "few-points", "Fewest Points, Season", fmt(fewestSeasonPf.pf), fewestSeasonPf.name,
        `${fewestSeasonPf.year} · ${fewestSeasonPf.wins}–${fewestSeasonPf.losses}`,
        `${fewestSeasonPf.owner} managed ${fmt(fewestSeasonPf.pf)} across the whole of ${fewestSeasonPf.year} — ${fmt(fewestSeasonPf.pf / (fewestSeasonPf.wins + fewestSeasonPf.losses))} a week.`,
        fewestSeasonPf.ownerId, fewestSeasonPf.color, fewestSeasonPf.icon,
        [{ label: "Finish", value: ordinal(fewestSeasonPf.finalRank) }]
      ),
      plaque(
        "worst-record", "Worst Season Record", `${worstSeasonRecord.wins}–${worstSeasonRecord.losses}`, worstSeasonRecord.name,
        `${worstSeasonRecord.year}`,
        `${worstSeasonRecord.owner} went ${worstSeasonRecord.wins}–${worstSeasonRecord.losses} in ${worstSeasonRecord.year}, finishing ${ordinal(worstSeasonRecord.finalRank)} of ${worstSeasonRecord.size}.`,
        worstSeasonRecord.ownerId, worstSeasonRecord.color, worstSeasonRecord.icon,
        [{ label: "Points For", value: fmt(worstSeasonRecord.pf) }]
      ),
      ...(slump ? [streakPlaque(plaque, "slump", "Longest Losing Streak", slump, "lost")] : []),
      ...(defences.length ? [plaque(
        "defence", "Worst Title Defence", ordinal(defences[0].after.finalRank), defences[0].after.name,
        `${defences[0].year} champion, ${defences[0].after.year} finish`,
        `${defences[0].after.owner} won it all in ${defences[0].year}, then finished ${ordinal(defences[0].after.finalRank)} of ${defences[0].after.size} the very next season at ${defences[0].after.wins}–${defences[0].after.losses}.`,
        defences[0].after.ownerId, defences[0].after.color, defences[0].after.icon,
        [
          { label: `${defences[0].year} (champion)`, value: `${defences[0].champ.wins}–${defences[0].champ.losses} · ${fmt(defences[0].champ.pf)}` },
          { label: `${defences[0].after.year}`, value: `${defences[0].after.wins}–${defences[0].after.losses} · ${fmt(defences[0].after.pf)}` }
        ]
      )] : []),
      plaque(
        "snoozer", "Lowest-Scoring Game", fmt(snoozer.winScore + snoozer.loseScore),
        `${snoozer.winner.name} vs ${snoozer.loser.name}`,
        `Week ${snoozer.week} · ${snoozer.year}`,
        `${fmt(snoozer.winScore)} to ${fmt(snoozer.loseScore)} in week ${snoozer.week} of ${snoozer.year}. Somebody had to win it.`,
        snoozer.winner.ownerId, snoozer.winner.color, snoozer.winner.icon
      ),
      plaque(
        "worst-rate", "Worst Win Rate", `${(worstPct.pct * 100).toFixed(1)}%`, worstPct.currentTeam,
        `${worstPct.wins}–${worstPct.losses} all-time`,
        `${worstPct.name} wins ${(worstPct.pct * 100).toFixed(1)}% of the time across ${worstPct.seasons.length} seasons.`,
        worstPct.ownerId, worstPct.color, worstPct.icon,
        [{ label: "Points / Game", value: fmt(worstPct.ppg) }]
      ),
      plaque(
        "cellars", "Most Last-Place Finishes", String(cellarCount),
        cellarHolders.map((c) => c.currentTeam).join(" & "),
        cellarHolders.map((c) => c.cellars.join(", ")).join(" · "),
        cellarHolders.length > 1
          ? `${cellarHolders.map((c) => c.name).join(" and ")} have finished last ${cellarCount} times each.`
          : `${cellarHolders[0].name} has finished last ${cellarCount} times.`,
        cellarHolders.length > 1 ? null : cellarHolders[0].ownerId,
        cellarHolders[0].color, cellarHolders[0].icon,
        cellarHolders.map((c) => ({ label: c.name, value: c.cellars.join(", ") || "—" })),
        crestsOf(cellarHolders)
      ),
      ...(worstBracket ? [plaque(
        "playoff-rate", "Worst Playoff Record", `${worstBracket.playoffWins}–${worstBracket.playoffLosses}`,
        worstBracket.currentTeam,
        `${((worstBracket.playoffWins / (worstBracket.playoffWins + worstBracket.playoffLosses)) * 100).toFixed(0)}% in the bracket`,
        `${worstBracket.name} keeps reaching the playoffs and keeps going home: ${worstBracket.playoffWins} wins from ${worstBracket.playoffWins + worstBracket.playoffLosses} bracket games.`,
        worstBracket.ownerId, worstBracket.color, worstBracket.icon,
        [{ label: "All-Time Record", value: `${worstBracket.wins}–${worstBracket.losses}` }]
      )] : []),
      ...(hardLuck ? [plaque(
        "hard-luck", "Hard-Luck Season", fmt(hardLuck.pf), hardLuck.name,
        `${hardLuck.year} · ${ordinal(hardLuck.finalRank)} of ${hardLuck.size}`,
        `${hardLuck.owner} scored ${fmt(hardLuck.pf)} in ${hardLuck.year} — more than most champions manage — and still finished ${ordinal(hardLuck.finalRank)}. Opponents put up ${fmt(hardLuck.pa)}.`,
        hardLuck.ownerId, hardLuck.color, hardLuck.icon,
        [
          { label: "Record", value: `${hardLuck.wins}–${hardLuck.losses}` },
          { label: "Points Against", value: fmt(hardLuck.pa) }
        ]
      )] : [])
    ];
  }

  function cellarExhibits(data) {
    const items = [];
    [...data.seasons].sort((a, b) => b.year - a.year).forEach((season) => {
      const size = Object.keys(season.teams).length;
      const cellar = Object.values(season.teams).find(
        (team) => team.officialLastPlace || team.finalRank === size
      );
      if (!cellar) return;
      items.push({
        id: `cellar-${season.year}`,
        kind: "toilet",
        year: season.year,
        title: String(season.year),
        subtitle: cellar.name,
        owner: cellar.owner,
        ownerId: cellar.ownerId,
        icon: cellar.icon,
        color: cellar.color,
        plate: `${season.year} · LAST PLACE`,
        blurb: `${cellar.owner} finished dead last in ${season.year} at ${cellar.wins}–${cellar.losses}, scoring ${fmt(cellar.pf)} while giving up ${fmt(cellar.pa)}.`,
        stats: [
          { label: "Record", value: `${cellar.wins}–${cellar.losses}` },
          { label: "Points For", value: fmt(cellar.pf) },
          { label: "Points Against", value: fmt(cellar.pa) },
          { label: "Field", value: `${size} teams` }
        ],
        links: [{ label: `${season.year} Season`, href: seasonHref(season.year) }]
      });
    });
    return items;
  }

  /* ------------------------------------------------------------ team lockers */

  /* Everything one manager has to be proud of, gathered in one place.

     The hall's walls are league-wide — one holder per mark. A locker is the
     opposite: it belongs to a single manager and every one of them has something
     in it, so the plaques here are personal bests rather than records, and there
     are no lowlights at all. */
  function playoffSeasons(data) {
    // A season a team reached the bracket in, how far they got, and whether
    // they skipped its first round.
    const byOwner = {};
    data.seasons.forEach((season) => {
      const reached = {};
      const titleGames = season.postseasonGames.filter((game) => game.titlePath);
      const rounds = Math.max(0, ...titleGames.map((game) => game.r || 0));
      titleGames.forEach((game) => {
        [game.a, game.b].forEach((key) => {
          const team = season.teams[key];
          if (!inTheHall(team)) return;
          const was = reached[team.ownerId];
          const deepest = Math.max(was ? was.round : 0, game.r || 0);
          const first = Math.min(was ? was.first : Infinity, game.r || 1);
          reached[team.ownerId] = {
            year: season.year,
            team,
            round: deepest,
            first,
            bye: first > 1,
            reached: window.League.gameName(deepest, rounds)
          };
        });
      });
      Object.entries(reached).forEach(([ownerId, entry]) => {
        (byOwner[ownerId] || (byOwner[ownerId] = [])).push(entry);
      });
    });
    return byOwner;
  }

  /* Where a manager finished, for the three places that earn a trophy. First
     takes the league trophy, second a silver bowl, third a bronze one. */
  function podiums(data, careers) {
    const byOwner = {};
    const PLACE = { 1: "gold", 2: "silver", 3: "bronze" };

    data.seasons.forEach((season) => {
      Object.values(season.teams).forEach((team) => {
        if (!inTheHall(team) || !PLACE[team.finalRank]) return;
        (byOwner[team.ownerId] || (byOwner[team.ownerId] = [])).push({
          year: season.year,
          place: team.finalRank,
          metal: PLACE[team.finalRank],
          team,
          size: Object.keys(season.teams).length
        });
      });
    });

    return byOwner;
  }

  /* Division champions: the regular-season leader of each of a season's
     Sleeper divisions. A league without divisions has none. */
  function divisionCrowns(data) {
    const byOwner = {};
    data.seasons.forEach((season) => {
      Object.values(season.teams).filter((team) => team.divisionChamp && inTheHall(team)).forEach((team) => {
        (byOwner[team.ownerId] || (byOwner[team.ownerId] = new Set())).add(season.year);
      });
    });
    return byOwner;
  }

  /* The two honours the regular season hands out on its own, before a bracket is
     drawn: a gold star for scoring the most points, and a red-white-and-blue
     ribbon for finishing with the most wins. They are read off the standings, so
     a team can take one, both or neither in a year it never reached the playoffs
     — and in 2024 the league's top scorer and its best record were two different
     managers, which is the whole reason both hang on the wall.

     The leaders are found across every team that played that season, departed
     managers included. If the year was led by somebody who is no longer in the
     league, nobody still here gets to claim it. Wins tie often, so a ribbon is
     shared; points, scored to two decimal places, effectively never do, but the
     tie is honoured the same way if it ever comes. */
  function seasonHonours(data) {
    const byOwner = {};

    data.seasons.forEach((season) => {
      const teams = Object.values(season.teams);
      if (!teams.length) return;
      const size = teams.length;
      const topPoints = Math.max(...teams.map((team) => team.pf));
      const topWins = Math.max(...teams.map((team) => team.wins));
      const scorers = teams.filter((team) => team.pf === topPoints);
      const winners = teams.filter((team) => team.wins === topWins);

      scorers.filter(inTheHall).forEach((team) => {
        const others = scorers.filter((other) => other !== team).map((other) => other.name);
        (byOwner[team.ownerId] || (byOwner[team.ownerId] = [])).push({
          kind: "star",
          year: season.year,
          team,
          id: `points-${season.year}`,
          title: `${season.year} Scoring Title`,
          subtitle: team.name,
          blurb: others.length
            ? `${team.name} put up ${fmt(team.pf)} points across the ${season.year} regular season, level with ${others.join(", ")} for the most in the league.`
            : `${team.name} put up ${fmt(team.pf)} points across the ${season.year} regular season — more than any of the other ${size - 1} teams in the league.`,
          stats: [
            { label: "Points For", value: fmt(team.pf) },
            { label: "Per Game", value: fmt(team.pf / Math.max(1, team.wins + team.losses)) },
            { label: "Record", value: `${team.wins}–${team.losses}` },
            { label: "Finish", value: ordinal(team.finalRank) },
            ...(others.length ? [{ label: "Shared With", value: others.join(", ") }] : [])
          ]
        });
      });

      winners.filter(inTheHall).forEach((team) => {
        const others = winners.filter((other) => other !== team).map((other) => other.name);
        (byOwner[team.ownerId] || (byOwner[team.ownerId] = [])).push({
          kind: "ribbon",
          year: season.year,
          team,
          id: `wins-${season.year}`,
          title: `${season.year} Best Record`,
          subtitle: team.name,
          blurb: others.length
            ? `${team.name} finished the ${season.year} regular season at ${team.wins}–${team.losses}, tied for the most wins in the league with ${others.join(", ")}.`
            : `${team.name} finished the ${season.year} regular season at ${team.wins}–${team.losses}, the most wins of any team that year.`,
          stats: [
            { label: "Record", value: `${team.wins}–${team.losses}` },
            { label: "Points For", value: fmt(team.pf) },
            { label: "Points Against", value: fmt(team.pa) },
            { label: "Finish", value: ordinal(team.finalRank) },
            ...(others.length ? [{ label: "Shared With", value: others.join(", ") }] : [])
          ]
        });
      });
    });

    // Newest first. The wall splits them into a row of stars and a row of
    // ribbons, so each row comes out in season order on its own.
    Object.values(byOwner).forEach((list) => {
      list.sort((a, b) => (b.year - a.year) || (a.kind === "star" ? -1 : 1));
    });

    return byOwner;
  }

  /* A manager's biggest win, by margin. */
  function biggestWin(data, ownerId) {
    let best = null;
    flattenGames(data)
      .filter((row) => row.sides.every((side) => inTheHall(side.team)))
      .forEach((row) => {
        if (row.winner.ownerId !== ownerId) return;
        const margin = row.winScore - row.loseScore;
        if (!best || margin > best.margin) {
          best = { margin, year: row.year, week: row.week, row };
        }
      });
    return best;
  }

  function ownStreak(data, ownerId) {
    const line = ownerTimelines(data)[ownerId];
    return line ? bestRun(line, "win", data.liveSeason && data.liveSeason.year) : null;
  }

  function buildLockers(data, careers) {
    const playoffs = playoffSeasons(data);
    const trophyCase = podiums(data, careers);
    const crowns = divisionCrowns(data);
    const honourRoll = seasonHonours(data);
    const lockers = {};

    Object.values(careers).filter((career) => career.seasons.length).forEach((career) => {
      const crowned = crowns[career.ownerId] || new Set();
      const berths = (playoffs[career.ownerId] || [])
        .map((berth) => ({ ...berth, division: crowned.has(berth.year) }))
        .sort((a, b) => b.year - a.year);
      const trophies = (trophyCase[career.ownerId] || []).sort((a, b) => b.year - a.year);
      /* Each honour is pinned to the berth of its own year rather than kept in a
         list of its own. A star and a ribbon belong to a season, and the pennant
         for that season is already on the wall saying which season it was, so the
         wall hangs them on its corners.

         An honour can outlive its pennant: leading the league in points is done
         over fourteen weeks and does not require reaching the bracket. Nobody has
         managed one without the other yet, but the ones that have no pennant to
         sit on are kept aside rather than dropped. */
      const honours = honourRoll[career.ownerId] || [];
      const stars = honours.filter((honour) => honour.kind === "star");
      const ribbons = honours.filter((honour) => honour.kind === "ribbon");
      berths.forEach((berth) => {
        berth.star = stars.find((honour) => honour.year === berth.year) || null;
        berth.ribbon = ribbons.find((honour) => honour.year === berth.year) || null;
      });
      const looseHonours = honours.filter((honour) => !berths.some((berth) => berth.year === honour.year));
      // Still on the locker's own card, where it costs nothing; it is only the
      // plaque of it that is gone from the wall.
      const bestFinish = Math.min(...career.finishes.map((f) => f.rank));
      const bestSeason = career.seasons.reduce((best, s) => (s.pf > best.pf ? s : best));
      const streak = ownStreak(data, career.ownerId);
      const rout = biggestWin(data, career.ownerId);

      // Personal bests only. A locker celebrates; the hall keeps the arguments.
      const plaques = [
        ...(rout ? [{
          id: "rout",
          title: "Biggest Win",
          bigValue: fmt(rout.margin),
          meta: `Week ${rout.week} · ${rout.year}`,
          blurb: `${rout.row.winner.name} ${fmt(rout.row.winScore)}, ${rout.row.loser.name} ${fmt(rout.row.loseScore)} — ${fmt(rout.margin)} points clear in week ${rout.week} of ${rout.year}.`,
          stats: [
            { label: "Final", value: `${fmt(rout.row.winScore)} – ${fmt(rout.row.loseScore)}` },
            { label: "Opponent", value: rout.row.loser.name }
          ]
        }] : []),
        ...(career.bestWeek ? [{
          id: "week",
          title: "Highest Week",
          bigValue: fmt(career.bestWeek.points),
          meta: `Week ${career.bestWeek.week} · ${career.bestWeek.year}`,
          blurb: `${fmt(career.bestWeek.points)} points in week ${career.bestWeek.week} of ${career.bestWeek.year} — the most ${career.name} has ever put up.`,
          stats: []
        }] : []),
        {
          id: "season-points",
          title: "Best Scoring Season",
          bigValue: fmt(bestSeason.pf),
          meta: `${bestSeason.year} · ${bestSeason.wins}–${bestSeason.losses}`,
          blurb: `${bestSeason.teamName || bestSeason.name} scored ${fmt(bestSeason.pf)} across ${bestSeason.year}.`,
          stats: [{ label: "Finish", value: ordinal(bestSeason.finalRank) }]
        },
        ...(streak ? [{
          id: "streak",
          title: "Longest Win Streak",
          bigValue: String(streak.run),
          meta: streakSpan(streak),
          blurb: `${streak.run} straight wins ${streakWhen(streak)}${streak.live ? ", and counting" : ""}.`,
          stats: []
        }] : []),
        ...(career.playoffWins ? [{
          id: "playoff-wins",
          title: "Playoff Wins",
          bigValue: String(career.playoffWins),
          meta: `${career.playoffWins}–${career.playoffLosses} in the bracket`,
          blurb: `${career.name} has won ${career.playoffWins} ${career.playoffWins === 1 ? "game" : "games"} once the bracket starts.`,
          stats: []
        }] : [])
      ];

      lockers[career.ownerId] = {
        ownerId: career.ownerId,
        name: career.name,
        team: career.currentTeam,
        icon: career.icon,
        color: career.color,
        titles: [...career.titles].sort((a, b) => b - a),
        trophies,
        berths,
        stars,
        ribbons,
        looseHonours,
        plaques,
        seasons: career.seasons,
        summary: [
          `${career.seasons.length} ${career.seasons.length === 1 ? "season" : "seasons"}`,
          career.titles.length ? `${career.titles.length} ${career.titles.length === 1 ? "title" : "titles"}` : null,
          berths.length ? `${berths.length} playoff ${berths.length === 1 ? "berth" : "berths"}` : null,
          crowned.size ? `${crowned.size} division ${crowned.size === 1 ? "title" : "titles"}` : null,
          stars.length ? `${stars.length} scoring ${stars.length === 1 ? "title" : "titles"}` : null,
          ribbons.length ? `${ribbons.length} best ${ribbons.length === 1 ? "record" : "records"}` : null,
          `${career.wins}–${career.losses}`
        ].filter(Boolean).join(" · "),
        stats: [
          { label: "All-Time Record", value: `${career.wins}–${career.losses} (${(career.pct * 100).toFixed(1)}%)` },
          { label: "Playoff Record", value: `${career.playoffWins}–${career.playoffLosses}` },
          { label: "Points For", value: fmt(career.pf) },
          { label: "Points / Game", value: fmt(career.ppg) },
          { label: "Best Finish", value: ordinal(bestFinish) },
          { label: "Seasons", value: career.seasons.map((s) => s.year).join(", ") }
        ]
      };
    });

    return lockers;
  }

  function buildHall(data) {
    const careers = careerTotals(data);
    const years = data.seasons.map((season) => season.year);

    const wings = [
      {
        id: "champions",
        name: "Champions",
        kicker: "The Cup Room",
        accent: "#f2c14a",
        blurb: "Every title the league has handed out.",
        items: championExhibits(data, careers)
      },
      {
        id: "hall",
        name: "Hall of Fame",
        kicker: "The Managers",
        accent: "#8fb6ff",
        blurb: "One pillar per manager, career carved into it.",
        items: hallOfFameExhibits(careers)
      },
      {
        id: "records",
        name: "Record Wall",
        kicker: "The Marks",
        accent: "#7fe0c0",
        blurb: "The numbers nobody has beaten yet.",
        items: recordExhibits(data, careers)
      },
      {
        id: "lowlights",
        name: "Lowlight Wall",
        kicker: "The Other Marks",
        accent: "#7f93b8",
        blurb: "The same numbers, read from the wrong end.",
        items: lowlightExhibits(data, careers)
      },
      {
        id: "cellar",
        name: "The Cellar",
        kicker: "Wall of Shame",
        accent: "#d0705a",
        blurb: "Somebody has to finish last.",
        items: cellarExhibits(data)
      }
    ];

    // A flat rail index across every wing: panning never leaves the hall.
    const rail = [];
    wings.forEach((wing, wingIndex) => {
      wing.start = rail.length;
      wing.items.forEach((item, itemIndex) => {
        item.wing = wing.id;
        item.wingName = wing.name;
        item.accent = wing.accent;
        item.wingIndex = wingIndex;
        item.itemIndex = itemIndex;
        item.railIndex = rail.length;
        rail.push(item);
      });
      wing.count = wing.items.length;
    });

    return {
      wings,
      rail,
      careers,
      lockers: buildLockers(data, careers),
      summary: {
        seasons: data.seasons.length,
        firstYear: Math.min(...years),
        lastYear: Math.max(...years),
        managers: Object.keys(data.owners).length,
        titles: wings[0].items.length,
        games: flattenGames(data).length
      }
    };
  }

  /* ============================================ trophy/app.js (loadLeague) */

  /* The league the hall is for. Finished seasons fill the hall; the season
     being played is read only for runs still going, since win and loss
     streaks carry across years. */
  function hallData() {
    const model = window.Bridge.model();
    const data = model.leagueData();
    const live = data.seasons.find((season) => season.live && season.regularGames.length);
    const results = {};
    if (live) {
      live.regularGames.forEach((g) => (results[g.week] = results[g.week] || []).push([g.a, g.aScore, g.b, g.bScore]));
    }
    return {
      name: model.name,
      logos: model.logos || {},
      owners: data.owners,
      seasons: data.seasons.filter((season) => !season.live),
      liveSeason: live ? { year: live.year, teams: live.teams, results } : null
    };
  }

  /* ======================================= trophy/locker.js (the words) */

  /* Every piece a locker wall can carry, in the order a trophy case fills
     up, each with the words it says when it is tapped. The app hangs them;
     these are locker.js's honourPiece, pennantPiece, trophyPiece,
     plaquePiece and the flag's caption, as plain data. */
  const lockerOrdinal = (n) => {
    const suffix = { 1: "st", 2: "nd", 3: "rd" }[n] || "th";
    return `${n}${suffix}`;
  };

  function lockerWall(locker) {
    const honourPiece = (honour) => ({
      kind: honour.kind,
      year: honour.year,
      meta: {
        id: honour.id,
        kind: honour.kind,
        title: honour.title,
        subtitle: honour.subtitle,
        blurb: honour.blurb,
        stats: honour.stats,
        links: [{ label: `${honour.year} Season`, href: seasonHref(honour.year) }]
      }
    });

    const pennantPiece = (berth) => ({
      kind: "pennant",
      year: berth.year,
      division: Boolean(berth.division),
      // The star for that season on the left post, the ribbon on the right.
      badges: [
        ...(berth.star ? [{ side: -1, piece: honourPiece(berth.star) }] : []),
        ...(berth.ribbon ? [{ side: 1, piece: honourPiece(berth.ribbon) }] : [])
      ],
      meta: {
        id: `berth-${berth.year}`,
        kind: "pennant",
        title: berth.division ? `${berth.year} Division Champs` : `${berth.year} Playoffs`,
        subtitle: berth.team.name,
        blurb: berth.division
          ? `${locker.name} topped their division in ${berth.year} at ${berth.team.wins}–${berth.team.losses}${berth.bye ? " and sat out the first round" : ""}.`
          : `${locker.name} reached the ${berth.year} bracket with ${berth.team.name}, ${berth.team.wins}–${berth.team.losses} in the regular season.`,
        stats: [
          { label: "Record", value: `${berth.team.wins}–${berth.team.losses}` },
          { label: "Points For", value: berth.team.pf.toFixed(2) },
          { label: "Finish", value: `${berth.team.finalRank}` },
          { label: "Reached", value: berth.reached },
          ...(berth.bye ? [{ label: "First Round", value: "Bye" }] : [])
        ],
        links: [{ label: `${berth.year} Season`, href: seasonHref(berth.year) }]
      }
    });

    const PLACE = { 1: "Champion", 2: "Runner-up", 3: "Third place" };
    const trophyPiece = (entry) => ({
      kind: entry.place === 1 ? "title" : "bowl",
      year: entry.year,
      metal: entry.metal,
      place: entry.place,
      meta: {
        id: `place-${entry.year}`,
        kind: entry.place === 1 ? "title" : "bowl",
        title: `${entry.year} ${PLACE[entry.place]}`,
        subtitle: entry.team.name,
        blurb: entry.lost
          ? `${locker.name} won the ${entry.year} league title. The season's box scores did not survive.`
          : `${locker.name} finished ${lockerOrdinal(entry.place)} of ${entry.size} in ${entry.year} at ${entry.team.wins}–${entry.team.losses}.`,
        stats: entry.lost ? [] : [
          { label: "Record", value: `${entry.team.wins}–${entry.team.losses}` },
          { label: "Points For", value: entry.team.pf.toFixed(2) },
          { label: "Points Against", value: entry.team.pa.toFixed(2) }
        ],
        links: [{ label: `${entry.year} Season`, href: seasonHref(entry.year) }]
      }
    });

    const plaquePiece = (entry) => ({
      kind: "plaque",
      bigValue: entry.bigValue,
      line: entry.meta,
      meta: {
        id: `plaque-${entry.id}`,
        kind: "plaque",
        title: entry.title,
        subtitle: entry.bigValue,
        meta: entry.meta,
        blurb: entry.blurb,
        stats: entry.stats,
        links: []
      }
    });

    return {
      flag: {
        id: "flag",
        kind: "flag",
        title: locker.team,
        subtitle: locker.name,
        blurb: `${locker.name} has run ${locker.team} for ${locker.seasons.length} ${locker.seasons.length === 1 ? "season" : "seasons"}. ${locker.summary}.`,
        stats: locker.stats,
        links: [{ label: "Full Profile", href: profileHref(locker.ownerId) }]
      },
      since: locker.seasons.length ? locker.seasons[0].year : null,
      pennants: [...locker.berths.map(pennantPiece), ...locker.looseHonours.map((honour) => honourPiece(honour))],
      trophies: locker.trophies.map(trophyPiece),
      plaques: locker.plaques.map(plaquePiece)
    };
  }

  /* ================================================================ out */

  /* The whole hall, as the app draws it: the wings in walking order, every
     exhibit on the rail, and a locker for every manager who has played. */
  function hall() {
    const data = hallData();
    if (!data.seasons.length) {
      throw new Error(`The trophy room opens once the league has finished a season on ${window.League.sourceName()}. Until then, the season page has everything so far.`);
    }
    const built = buildHall(data);
    const lockers = {};
    Object.entries(built.lockers).forEach(([ownerId, locker]) => {
      lockers[ownerId] = {
        ownerId: locker.ownerId,
        name: locker.name,
        team: locker.team,
        icon: locker.icon,
        color: locker.color,
        summary: locker.summary,
        titles: locker.titles,
        wall: lockerWall(locker)
      };
    });
    const strip = (item) => {
      const { wing, wingName, accent, wingIndex, itemIndex, railIndex, ...rest } = item;
      return { ...rest, wing, wingName, accent, wingIndex, itemIndex, railIndex };
    };
    return {
      name: data.name,
      logos: data.logos,
      wings: built.wings.map(({ items, ...wing }) => wing),
      rail: built.rail.map(strip),
      lockers,
      summary: built.summary
    };
  }

  window.Bridge.trophy = { hall };
})();
