/* Bridge.records: the record book (alltime.html) for the app's Record Book
   tab and its manager profiles. The page's own logic, lifted from its
   script (createProfiles, renderHero, renderTitleTable, sortRows,
   highlightTiles, seasonRows, renderWinsChart, renderStarters, renderH2H)
   and handed back as plain data, so the numbers and words match the site.

     Bridge.records.book()            hero badge, champions, last places,
                                      all-time standings with every sort order
     Bridge.records.profile(ownerId)  one manager's history (the drawer)
     Bridge.records.starters(ownerId) most-started players (async)
     Bridge.records.search(query)     the "Search any player" field (async) */
(function () {
  "use strict";

  const B = window.Bridge;

  const fmt = (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (wins, losses) => {
    const games = wins + losses;
    return games ? (wins / games).toFixed(3).replace(/^0/, "") : ".000";
  };
  const ordinal = (n) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  };
  const signed = (value) => `${value >= 0 ? "+" : ""}${fmt(value)}`;

  /* ------------------------------------------------------------ profiles */

  /* alltime.html createProfiles, unchanged. */
  function createProfiles(LEAGUE_DATA, seasons) {
    const profiles = {};

    Object.entries(LEAGUE_DATA.owners).forEach(([ownerId, owner]) => {
      profiles[ownerId] = {
        ownerId,
        ...owner,
        seasons: [],
        wins: 0,
        losses: 0,
        pf: 0,
        pa: 0,
        championshipYears: [],
        lastPlaceYears: [],
        finishes: {},
        highestWeek: null,
        bestSeason: null,
        playoffWins: 0,
        playoffLosses: 0,
        streak: { run: 0, best: null },
        biggestWin: null,
        h2h: {}
      };
    });

    const addH2H = (ownerId, opponentId, pfValue, paValue) => {
      if (!profiles[ownerId] || !profiles[opponentId]) return;
      if (!profiles[ownerId].h2h[opponentId]) {
        profiles[ownerId].h2h[opponentId] = { opponentId, wins: 0, losses: 0, pf: 0, pa: 0, games: 0 };
      }
      const row = profiles[ownerId].h2h[opponentId];
      row.games += 1;
      row.pf += pfValue;
      row.pa += paValue;
      if (pfValue > paValue) row.wins += 1;
      else row.losses += 1;
    };

    const recordGame = (season, game, label = "Regular Season") => {
      const aTeam = season.teams[game.a];
      const bTeam = season.teams[game.b];
      const aOwner = aTeam.ownerId;
      const bOwner = bTeam.ownerId;

      addH2H(aOwner, bOwner, game.aScore, game.bScore);
      addH2H(bOwner, aOwner, game.bScore, game.aScore);

      [[aOwner, game.aScore, game.bScore, bOwner], [bOwner, game.bScore, game.aScore, aOwner]].forEach(([id, mine, theirs, opp]) => {
        const p = profiles[id];
        if (!p) return;
        if (mine > theirs) {
          p.streak.run += 1;
          if (p.streak.run === 1) p.streak.from = season.year;
          if (!p.streak.best || p.streak.run > p.streak.best.length) {
            p.streak.best = { length: p.streak.run, fromYear: p.streak.from, toYear: season.year };
          }
          if (!p.biggestWin || mine - theirs > p.biggestWin.margin) {
            p.biggestWin = { margin: mine - theirs, year: season.year, week: game.week, opponentId: opp };
          }
        } else {
          p.streak.run = 0;
        }
      });

      [
        { ownerId: aOwner, team: aTeam, opponentId: bOwner, points: game.aScore },
        { ownerId: bOwner, team: bTeam, opponentId: aOwner, points: game.bScore }
      ].forEach((entry) => {
        if (!profiles[entry.ownerId]) return;
        const current = profiles[entry.ownerId].highestWeek;
        if (!current || entry.points > current.points) {
          profiles[entry.ownerId].highestWeek = {
            year: season.year, week: game.week, points: entry.points,
            teamName: entry.team.name, opponentId: entry.opponentId, label
          };
        }
      });
    };

    [...seasons]
      .sort((a, b) => a.year - b.year)
      .forEach((season) => {
        Object.entries(season.teams).forEach(([teamId, team]) => {
          const profile = profiles[team.ownerId];
          if (!profile || team.excludeFromHome) return;
          profile.seasons.push({
            year: season.year, teamId, teamName: team.name,
            wins: team.wins, losses: team.losses, pf: team.pf, pa: team.pa,
            finalRank: team.finalRank, live: Boolean(season.live)
          });
          profile.wins += team.wins;
          profile.losses += team.losses;
          profile.pf += team.pf;
          profile.pa += team.pa;
          if (season.live) return;
          profile.finishes[season.year] = team.finalRank;

          if (team.finalRank === 1) profile.championshipYears.push(season.year);
          if (team.officialLastPlace || team.finalRank === Object.keys(season.teams).length) profile.lastPlaceYears.push(season.year);

          if (!profile.bestSeason || team.pf > profile.bestSeason.points) {
            profile.bestSeason = { year: season.year, points: team.pf, teamName: team.name };
          }
        });

        [...season.regularGames].sort((a, b) => a.week - b.week).forEach((game) => recordGame(season, game));

        (season.live ? [] : season.postseasonGames).forEach((game) => {
          recordGame(season, game, game.label);
          if (game.titlePath) {
            const aOwner = season.teams[game.a].ownerId;
            const bOwner = season.teams[game.b].ownerId;
            if (game.aScore > game.bScore) {
              if (profiles[aOwner]) profiles[aOwner].playoffWins += 1;
              if (profiles[bOwner]) profiles[bOwner].playoffLosses += 1;
            } else {
              if (profiles[bOwner]) profiles[bOwner].playoffWins += 1;
              if (profiles[aOwner]) profiles[aOwner].playoffLosses += 1;
            }
          }
        });
      });

    Object.values(profiles).forEach((profile) => {
      profile.seasons.sort((a, b) => a.year - b.year);
      profile.diff = profile.pf - profile.pa;
      profile.games = profile.wins + profile.losses;
      profile.pct = profile.games ? profile.wins / profile.games : 0;
      profile.pfg = profile.games ? profile.pf / profile.games : 0;
      const finishes = Object.values(profile.finishes).filter(Boolean);
      profile.bestFinish = finishes.length ? Math.min(...finishes) : null;
      profile.worstFinish = finishes.length ? Math.max(...finishes) : null;
      Object.values(profile.h2h).forEach((row) => {
        row.diff = row.pf - row.pa;
        row.pct = row.games ? row.wins / row.games : 0;
      });
    });

    return profiles;
  }

  /* buildProfiles, kept for as long as the model is the same one. */
  let cache = null;
  function state() {
    const model = B.model();
    if (cache && cache.model === model) return cache;
    const LEAGUE_DATA = model.leagueData();
    const profiles = createProfiles(LEAGUE_DATA, LEAGUE_DATA.seasons);
    Object.keys(profiles).forEach((id) => { if (!profiles[id].seasons.length) delete profiles[id]; });
    const liveSeason = LEAGUE_DATA.seasons.find((season) => season.live && season.throughWeek) || null;
    cache = { model, LEAGUE_DATA, profiles, profileList: Object.values(profiles), liveSeason };
    return cache;
  }

  /* ------------------------------------------------------------ sorting */

  const allTimeDefaults = { team: "asc", wins: "desc", pct: "desc", pf: "desc", pa: "asc", diff: "desc", pfg: "desc" };
  const h2hDefaults = { team: "asc", wins: "desc", pct: "desc", pf: "desc", pa: "asc", diff: "desc" };

  function sortRows(rows, st, valueFn) {
    return [...rows].sort((a, b) => {
      const aValue = valueFn(a, st.key);
      const bValue = valueFn(b, st.key);
      const comparison = typeof aValue === "string" ? aValue.localeCompare(bValue) : aValue - bValue;
      if (comparison !== 0) return st.direction === "asc" ? comparison : -comparison;
      return b.wins - a.wins || b.pf - a.pf;
    });
  }

  /* Every order a table can be put in, keyed "key:direction", as lists of
     ids: the app re-sorts without asking again. */
  function orders(rows, defaults, valueFn, idOf) {
    const out = {};
    Object.keys(defaults).forEach((key) => {
      ["asc", "desc"].forEach((direction) => {
        out[`${key}:${direction}`] = sortRows(rows, { key, direction }, valueFn).map(idOf);
      });
    });
    return out;
  }

  function who(profile) {
    const logos = state().model.logos || {};
    // A drawn picture (the demo's initials) is drawn natively by the app's
    // TeamBadge, which only needs to know it is one.
    let logo = logos[profile.ownerId] || profile.logo || null;
    if (logo && logo.startsWith("data:image/svg")) logo = "data:image/svg";
    return {
      ownerId: profile.ownerId,
      name: profile.name,
      currentTeam: profile.currentTeam,
      icon: profile.icon || "",
      color: profile.color || null,
      logo,
    };
  }

  /* ------------------------------------------------------------ the book */

  function book() {
    const { LEAGUE_DATA, profiles, profileList, liveSeason } = state();

    // renderHero
    const finished = LEAGUE_DATA.seasons.filter((season) => !season.live).length;
    const badge = liveSeason
      ? `Through ${liveSeason.year} · Week ${liveSeason.throughWeek}`
      : `${finished} season${finished === 1 ? "" : "s"}`;

    // renderTitleTable
    const titleTable = (yearsOf, mark) => profileList
      .filter((profile) => yearsOf(profile).length)
      .sort((a, b) => yearsOf(b).length - yearsOf(a).length || Math.max(...yearsOf(b)) - Math.max(...yearsOf(a)))
      .map((profile, index) => ({
        rank: index + 1,
        ownerId: profile.ownerId,
        count: yearsOf(profile).length,
        marks: `${mark.repeat(yearsOf(profile).length)} ${yearsOf(profile).length}`,
        years: yearsOf(profile).join(", "),
      }));

    const allTimeValue = (profile, key) => key === "team" ? profile.currentTeam.toLowerCase() : profile[key];

    return {
      name: LEAGUE_DATA.name || state().model.name,
      badge,
      managers: profileList.map((p) => ({
        ...who(p),
        wins: p.wins,
        losses: p.losses,
        pf: p.pf,
        pa: p.pa,
        pfg: p.pfg,
        diff: p.diff,
        record: `${p.wins}–${p.losses}`,
        pct: pct(p.wins, p.losses),
        pfText: fmt(p.pf),
        paText: fmt(p.pa),
        pfgText: p.pfg.toFixed(1),
        diffText: signed(p.diff),
        seasons: p.seasons.length,
      })),
      champions: titleTable((p) => p.championshipYears, "🏆"),
      lastPlaces: titleTable((p) => p.lastPlaceYears, "💩"),
      defaults: allTimeDefaults,
      orders: orders(profileList, allTimeDefaults, allTimeValue, (p) => p.ownerId),
      start: { key: "wins", direction: "desc" },
    };
  }

  /* ------------------------------------------------------------ a manager */

  function profile(ownerId) {
    const { LEAGUE_DATA, profiles } = state();
    const p = profiles[ownerId];
    if (!p) throw new Error("This manager has no seasons on record.");

    const yearsAtFinish = (rank) => p.seasons.filter((season) => season.finalRank === rank).map((season) => season.year);

    // highlightTiles
    const tile = (kind, icon, label, value, meta, chips) => ({ kind, icon, label, value: value == null ? "" : String(value), meta: meta == null ? null : String(meta), chips: chips || null });
    const finishYears = (rank) => yearsAtFinish(rank).join(", ");
    const week = p.highestWeek;
    const win = p.biggestWin;
    const streak = p.streak.best;
    const best = p.seasons.filter((season) => !season.live)
      .reduce((top, season) => (!top || season.wins > top.wins || (season.wins === top.wins && season.pf > top.pf) ? season : top), null);
    const highlights = [
      p.championshipYears.length
        ? tile("gold", "🏆", p.championshipYears.length === 1 ? "Champion" : `${p.championshipYears.length}× Champion`, "", null, p.championshipYears)
        : p.bestFinish ? tile("gold", "🏅", "Best finish", ordinal(p.bestFinish), finishYears(p.bestFinish)) : null,
      p.lastPlaceYears.length
        ? tile("red", "💩", p.lastPlaceYears.length === 1 ? "Last place" : `${p.lastPlaceYears.length}× Last place`, "", null, p.lastPlaceYears)
        : p.worstFinish ? tile("green", "🛡️", "Never last", `Low: ${ordinal(p.worstFinish)}`, finishYears(p.worstFinish)) : null,
      week ? tile("fire", "🔥", "Biggest week", fmt(week.points), `Week ${week.week} · ${week.year}`) : null,
      win ? tile("blue", "💥", "Biggest win", `+${fmt(win.margin)}`, `vs ${profiles[win.opponentId] ? profiles[win.opponentId].currentTeam : ""} · ${win.year}`) : null,
      streak ? tile("purple", "📈", "Longest win streak", `${streak.length} straight`, streak.fromYear === streak.toYear ? streak.toYear : `${streak.fromYear}–${String(streak.toYear).slice(2)}`) : null,
      best ? tile("navy", "⭐", "Best season", `${best.wins}–${best.losses}`, `${best.year} · ${fmt(best.pf)} pts`) : null,
    ].filter(Boolean);

    // seasonRows, newest first
    const seasons = [...p.seasons].reverse().map((season) => {
      const s = LEAGUE_DATA.seasons.find((x) => x.year === season.year);
      const size = s ? Object.keys(s.teams).length : 0;
      const place = season.live ? "live"
        : season.finalRank <= 3 ? String(season.finalRank)
        : season.finalRank === size ? "last" : "mid";
      return {
        year: season.year, teamId: season.teamId, teamName: season.teamName,
        record: `${season.wins}–${season.losses}`, finalRank: season.finalRank == null ? null : season.finalRank,
        live: season.live, place,
      };
    });

    // renderWinsChart: finished seasons only; the height is the longest
    // regular season on record.
    const chartSeasons = p.seasons.filter((season) => !season.live);
    const maxWins = Math.max(1, ...LEAGUE_DATA.seasons.flatMap((season) =>
      Object.values(season.teams).map((team) => team.wins + team.losses + (team.ties || 0))));
    const chart = {
      maxWins,
      ticks: [0, Math.round(maxWins / 2), maxWins],
      points: chartSeasons.map((season) => ({ year: season.year, wins: season.wins })),
    };

    // renderH2H
    const h2hRows = Object.values(p.h2h).filter((row) => profiles[row.opponentId]);
    const h2hValue = (row, key) => {
      if (!profiles[row.opponentId]) return "";
      if (key === "team") return profiles[row.opponentId].currentTeam.toLowerCase();
      return row[key];
    };
    const h2h = h2hRows.map((row) => ({
      ...who(profiles[row.opponentId]),
      wins: row.wins, losses: row.losses, games: row.games,
      record: `${row.wins}–${row.losses}`,
      pct: pct(row.wins, row.losses),
      pf: fmt(row.pf), pa: fmt(row.pa),
      diff: row.diff, diffText: signed(row.diff),
    }));

    return {
      ...who(p),
      ownerLine: `${p.name} · ${p.seasons.length} season${p.seasons.length === 1 ? "" : "s"}`,
      stats: [
        { label: "Record", value: `${p.wins}–${p.losses}` },
        { label: "Playoffs", value: `${p.playoffWins}–${p.playoffLosses}` },
        { label: "Titles", value: String(p.championshipYears.length) },
        { label: "Last Places", value: String(p.lastPlaceYears.length) },
      ],
      highlights,
      seasons,
      chart,
      h2h,
      h2hDefaults,
      h2hOrders: orders(h2hRows, h2hDefaults, h2hValue, (row) => row.opponentId),
      h2hStart: { key: "pct", direction: "desc" },
    };
  }

  /* ------------------------------------------------------------ starters */

  /* renderStarters: the top ten, a cell per season the manager played. */
  async function starters(ownerId) {
    let data = null;
    try { data = await B.model().starters(); } catch (err) { data = null; }
    const entry = data && data.owners[ownerId];
    if (!entry || !entry.players.length) {
      return { message: data ? "No box scores for this manager yet." : "Lineups could not be loaded.", years: [], players: [] };
    }
    const years = entry.seasons;
    const most = Math.max(...entry.players.flatMap((p) => Object.values(p.years).map((y) => y[0])));
    return {
      message: null,
      years,
      players: entry.players.map((p, i) => ({
        rank: i + 1,
        id: String(p.id),
        name: p.name,
        pos: p.pos,
        nfl: p.nfl || "FA",
        starts: p.starts,
        cells: years.map((y) => {
          if (!p.years[y]) return { year: y, n: 0, clubs: [], fill: 0, title: `${y}: no starts` };
          const [n, ...clubs] = p.years[y];
          const fill = .1 + .3 * (n / most);
          return { year: y, n, clubs: clubs.map((c) => c || "FA"), fill: Number(fill.toFixed(2)), title: `${y}: ${n} start${n === 1 ? "" : "s"} · ${clubs.join(" / ")}` };
        }),
      })),
    };
  }

  /* ------------------------------------------------------------ search */

  /* PlayerCard.search (player-card.js): names containing every word typed,
     in any order, accents and punctuation ignored; the most-started first.
     The rows as ui.js's playerFinder writes them. */
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "");
  async function search(query, limit = 8) {
    const d = await B.model().playerIndex();
    if (!d) return [];
    const words = norm(String(query || "")).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return d.players
      .filter((p) => { const n = norm(p.n); return words.every((w) => n.includes(w)); })
      .map((p) => {
        const starts = p.r.filter((r) => r[3] !== "BE" && r[3] !== "IR");
        return { id: p.id, name: p.n, pos: p.p, club: p.r[p.r.length - 1][6], headshot: p.h,
          starts: starts.length, pts: starts.reduce((t, r) => t + r[4], 0),
          seasons: [...new Set(p.r.map((r) => r[0]))], prefix: norm(p.n).startsWith(words[0]) };
      })
      .sort((a, b) => (b.prefix - a.prefix) || b.starts - a.starts || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((h) => {
        const yrs = h.seasons.length > 1 ? `${h.seasons[0]}–${String(h.seasons[h.seasons.length - 1]).slice(2)}` : String(h.seasons[0]);
        let photo = null;
        if (h.headshot && h.pos !== "DST") {
          try { photo = B.headshot(h.headshot); } catch (err) { photo = null; }
        }
        return { id: String(h.id), name: h.name, pos: h.pos, club: h.club || "FA", photo, starts: h.starts,
          line: `${h.pos} · ${h.club || "FA"} · ${yrs}` };
      });
  }

  /* Starts loading the player data before the first letter is typed. */
  async function warm() {
    try { await B.model().playerIndex(); } catch (err) { /* the search says so */ }
    return true;
  }

  B.records = { book, profile, starters, search, warm };
})();
