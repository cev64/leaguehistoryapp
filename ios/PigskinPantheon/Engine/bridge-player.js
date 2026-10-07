/* Bridge.player: the player card and the player search (player-card.js),
   as plain data for the app's Player screens. The card's numbers and words
   are worked out here, the way player-card.js's build() and render() work
   them out, so the app shows exactly what the site's card shows; the app
   only draws them.

     Bridge.player.card(id)            everything one player's card shows
     Bridge.player.search(q, limit)    the search's hits (PlayerCard.search)
     Bridge.player.popular(limit)      the league's most-started players
     Bridge.player.brief(ids)          search-style rows for given ids */
(function () {
  "use strict";

  const B = window.Bridge;

  /* Each club's primary colour for the card's header, which carries white
     text: the box scores' table, except Pittsburgh's gold gives way to its
     black (player-card.js NFL_COLORS). */
  const NFL_COLORS = {
    ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
    CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00",
    DAL: "#041E42", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
    HOU: "#03202F", IND: "#002C5F", JAX: "#101820", KC: "#E31837",
    LAC: "#0080C6", LAR: "#003594", LV: "#111111", MIA: "#008E97",
    MIN: "#4F2683", NE: "#002244", NO: "#A08A5B", NYG: "#0B2265",
    NYJ: "#125740", PHI: "#004C54", PIT: "#101820", SEA: "#002244",
    SF: "#AA0000", TB: "#D50A0A", TEN: "#0C2340", WSH: "#5A1414",
  };
  const NAVY = "#304f91";

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (n) => Number(n).toFixed(1);

  /* ------------------------------------------------------------ the data */

  let data = null;
  let loading = null;
  function load() {
    if (!loading) {
      loading = Promise.resolve(B.model().playerIndex()).then((json) => {
        json.byId = new Map(json.players.map((p) => [p.id, p]));
        data = json;
        return json;
      });
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  function teamOf(season, id) {
    const t = data.teams[season] && data.teams[season][id];
    return t ? { id, name: t[0], ownerId: t[1], owner: t[2], color: t[3], season }
      : { id, name: id, ownerId: id, owner: "", color: "#8693a1", season };
  }

  /* ------------------------------------------------------------ the card */

  // player-card.js build(), as is.
  function build(p) {
    const rows = p.r.map(([season, week, teamId, slot, pts, proj, club]) => {
      const game = ((data.games[season] || {})[week] || {})[teamId];
      const started = slot !== "BE" && slot !== "IR";
      let result = null;
      if (game) result = game[1] > game[2] ? "W" : game[1] < game[2] ? "L" : "T";
      return { season, week, team: teamOf(season, teamId), slot, pts, proj, club, started, game, result,
        playoff: week > (data.regularWeeks[season] || 14) };
    });
    const starts = rows.filter((r) => r.started);
    const total = starts.reduce((t, r) => t + r.pts, 0);
    const best = starts.slice().sort((a, b) => b.pts - a.pts);
    const wins = starts.filter((r) => r.result === "W").length;
    // A title counts only if he was in the winning team's starting lineup
    // for the championship game itself.
    const titles = starts.filter((r) => r.result === "W" && r.game && r.game[3] === "Championship");
    const losses = starts.filter((r) => r.result === "L").length;

    // Managers, most starts first; a manager keeps his history through renames.
    const mgrs = new Map();
    for (const r of rows) {
      const m = mgrs.get(r.team.ownerId) || { ...r.team, names: new Set(), seasons: new Set(), starts: 0, pts: 0, w: 0, l: 0, weeks: 0 };
      m.names.add(r.team.name);
      m.seasons.add(r.season);
      m.weeks++;
      if (r.started) { m.starts++; m.pts += r.pts; if (r.result === "W") m.w++; if (r.result === "L") m.l++; }
      m.color = r.team.color;
      m.lastTeam = r.team;
      mgrs.set(r.team.ownerId, m);
    }
    const managers = [...mgrs.values()].sort((a, b) => b.starts - a.starts || b.weeks - a.weeks);
    const seasons = [...new Set(rows.map((r) => r.season))];
    const lastClub = rows[rows.length - 1].club;
    return { rows, starts, total, best, wins, losses, titles, managers, seasons, lastClub };
  }

  const slotWord = (r) => (r.started ? r.slot : r.slot === "IR" ? "IR" : "bench");
  const resultWord = (r) => (r.result === "W" ? "Won" : r.result === "L" ? "Lost" : "Tied");

  async function card(id) {
    await load();
    const p = data.byId.get(String(id));
    if (!p) return { found: false, message: "No league history for this player." };

    const s = build(p);
    const lead = s.managers[0];
    const leadColor = lead ? lead.color : NAVY;
    const isDst = p.p === "DST";
    const perStart = s.starts.length ? s.total / s.starts.length : 0;
    const top = s.best[0];
    // The log's shading is on his own scale: his best start is the darkest.
    const bestPts = Math.max(1, ...s.starts.map((r) => r.pts));

    // The timeline (render's): one grid a full league season wide, newest
    // season on top, weeks to come as placeholders.
    const lastOf = (season) => Math.max(...Object.keys(data.games[season] || {}).map(Number));
    const columns = Math.max(...data.seasons.map(lastOf));
    const current = data.seasons[data.seasons.length - 1];
    const labelReg = data.regularWeeks[current] || 14;
    const timeline = s.seasons.slice().reverse().map((season) => {
      const inSeason = s.rows.filter((r) => r.season === season);
      const played = Math.max(lastOf(season), ...inSeason.map((r) => r.week));
      const lastWeek = season === current ? columns : played;
      const reg = data.regularWeeks[season] || 14;
      const byWeek = new Map(inSeason.map((r) => [r.week, r]));
      const cells = Array.from({ length: lastWeek }, (_, i) => {
        const w = i + 1;
        const r = byWeek.get(w);
        if (w > played) return { week: w, kind: "future", color: null, tip: `${season} week ${w}: not played yet` };
        if (!r) {
          const before = inSeason.filter((x) => x.week < w).pop();
          const idle = before && !((data.games[season] || {})[w] || {})[before.team.id];
          return idle
            ? { week: w, kind: "none", color: null, tip: `${season} week ${w}: ${before.team.name} had no game` }
            : { week: w, kind: "empty", color: null, tip: `${season} week ${w}: not on a roster` };
        }
        return { week: w, kind: r.started ? "start" : "bench", color: r.team.color,
          tip: `${season} week ${w}: ${r.team.name} · ${slotWord(r)} · ${fmt(r.pts)}` };
      });
      const owners = [...new Map(inSeason.map((r) => [r.team.ownerId, r.team])).values()];
      // At most two logos, then a count, when there are more than three.
      const shown = owners.length > 3 ? owners.slice(0, 2) : owners;
      return {
        season, reg, cells,
        owners: shown,
        more: owners.length > 3 ? owners.length - 2 : 0,
        moreNames: owners.length > 3 ? owners.slice(2).map((t) => t.owner).join(", ") : "",
      };
    });

    const managers = s.managers.map((m) => ({
      ownerId: m.ownerId, owner: m.owner, color: m.color,
      team: m.lastTeam,
      names: [...m.names],
      seasons: [...m.seasons].join(", "),
      starts: m.starts, weeks: m.weeks,
      pts: fmt1(m.pts), record: `${m.w}–${m.l}`,
    }));

    const topGames = s.best.slice(0, 3).map((r, i) => {
      const opp = r.game ? teamOf(r.season, r.game[0]) : null;
      const round = r.playoff && r.game && r.game[3] ? ` · ${r.game[3]}` : "";
      return {
        rank: i + 1,
        title: `${r.team.name}${opp ? ` vs ${opp.name}` : ""}`,
        detail: `${r.season} · Week ${r.week}${round}${r.result ? ` · ${resultWord(r)}` : ""}`,
        pts: fmt(r.pts),
        season: r.season, week: r.week, team: r.team, opp,
      };
    });

    // The game log: every week of each season, not just the weeks he was
    // rostered (render's showLog), newest first.
    const log = {};
    for (const yr of s.seasons) {
      const inSeason = s.rows.filter((r) => r.season === yr);
      const byWeek = new Map(inSeason.map((r) => [r.week, r]));
      const last = Math.max(lastOf(yr), ...inSeason.map((r) => r.week));
      const list = [];
      for (let w = 1; w <= last; w++) {
        const playoff = w > (data.regularWeeks[yr] || 14);
        const r = byWeek.get(w);
        if (!r) {
          const before = inSeason.filter((x) => x.week < w).pop();
          const idle = before && !((data.games[yr] || {})[w] || {})[before.team.id];
          list.push(idle
            ? { gap: true, season: yr, week: w, playoff, team: before.team, label: `${before.team.name} · no game`,
                tip: `${yr} week ${w}: ${before.team.name} had no game` }
            : { gap: true, season: yr, week: w, playoff, team: null, label: "Not on a roster",
                tip: `${yr} week ${w}: not on a roster` });
          continue;
        }
        const fill = r.started ? .22 + .78 * Math.max(0, r.pts) / bestPts : 0;
        const tip = `${r.season} week ${r.week}${r.playoff && r.game && r.game[3] ? ` (${r.game[3]})` : ""} · ${slotWord(r)}${r.proj == null ? "" : ` · projected ${fmt(r.proj)}`}${r.result && r.started ? ` · ${r.result === "W" ? "won" : r.result === "L" ? "lost" : "tied"}` : ""}`;
        // (The chip's ink is worked out in the app, against the card's
        // light or dark ground.)
        list.push({
          gap: false, season: yr, week: w, playoff, team: r.team, label: r.team.name,
          started: r.started, ptsText: fmt(r.pts), fill: Number(fill.toFixed(2)),
          opp: r.game ? r.game[0] : null, tip,
        });
      }
      log[yr] = list.reverse();
    }

    return {
      found: true,
      id: p.id,
      name: p.n,
      pos: p.p,
      isDst,
      photo: !isDst && p.h ? B.headshot(p.h) : null,
      club: s.lastClub || "FA",
      heroColor: NFL_COLORS[s.lastClub] || NAVY,
      titles: [...new Set(s.titles.map((r) => r.season))],
      managerCount: s.managers.length,
      managersTag: `${s.managers.length} manager${s.managers.length === 1 ? "" : "s"}`,
      tiles: {
        starts: s.starts.length,
        perStart: fmt(perStart),
        best: top ? fmt(top.pts) : "—",
        bestDetail: top ? `${top.season} wk ${top.week} · ${top.team.name}` : "Never started",
        bestGame: top && top.game ? { season: top.season, week: top.week, a: top.team.id, b: top.game[0] } : null,
        record: `${s.wins}–${s.losses}`,
      },
      leadColor,
      columns, labelReg,
      timeline,
      managers,
      top: topGames,
      seasons: s.seasons,
      latest: s.seasons[s.seasons.length - 1],
      log,
    };
  }

  /* ------------------------------------------------------------ search */

  /* Names containing every word typed, in any order, accents and
     punctuation ignored; the most-started first (PlayerCard.search). */
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "");

  function row(p, prefix) {
    const starts = p.r.filter((r) => r[3] !== "BE" && r[3] !== "IR");
    const seasons = [...new Set(p.r.map((r) => r[0]))];
    const club = p.r[p.r.length - 1][6] || "FA";
    const yrs = seasons.length > 1 ? `${seasons[0]}–${String(seasons[seasons.length - 1]).slice(2)}` : String(seasons[0]);
    // Every manager who has had him, most weeks first.
    const weeks = new Map();
    p.r.forEach(([season, , teamId]) => {
      const t = teamOf(season, teamId);
      const m = weeks.get(t.ownerId) || { ownerId: t.ownerId, owner: t.owner, team: t, weeks: 0 };
      m.weeks++; m.team = t;
      weeks.set(t.ownerId, m);
    });
    const owners = [...weeks.values()].sort((a, b) => b.weeks - a.weeks);
    return {
      id: p.id, name: p.n, pos: p.p, club,
      photo: p.p !== "DST" && p.h ? B.headshot(p.h) : null,
      starts: starts.length, pts: fmt(starts.reduce((t, r) => t + r[4], 0)),
      seasons, years: yrs,
      // The row shows the club as a chip beside this, so it isn't repeated.
      detail: `${p.p} · ${yrs}`,
      teams: owners.slice(0, 3).map((m) => m.team),
      prefix: Boolean(prefix),
    };
  }

  async function search(query, limit = 8) {
    await load();
    const words = norm(String(query || "")).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return data.players
      .filter((p) => { const n = norm(p.n); return words.every((w) => n.includes(w)); })
      .map((p) => row(p, norm(p.n).startsWith(words[0])))
      .sort((a, b) => (b.prefix - a.prefix) || b.starts - a.starts || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  // The league's most-started players, for the search before anything is typed.
  async function popular(limit = 12) {
    await load();
    return data.players
      .map((p) => row(p, false))
      .sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async function brief(ids) {
    await load();
    return (ids || []).map((id) => data.byId.get(String(id))).filter(Boolean).map((p) => row(p, false));
  }

  B.player = { card, search, popular, brief, ready: () => load().then((d) => d.players.length) };
})();
