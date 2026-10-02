/* Ask the League: an AI that answers questions about the league on screen.

   A button in the corner of every league page opens a chat. Members ask
   anything about the league (champions, rivalries, records, trades, drafts,
   a player's history with them, this season) and the League Historian
   answers from the league's own data. It is part of Pro: on the free plan
   the same button opens a look at it and the way to upgrade.

   How it gets its answers:
     - the league as text (`digestOf`): every season's format, standings,
       champion, every game's score and every playoff game, plus all-time
       tables worked out here (records, head-to-head, streaks, titles), so
       the AI never has to add up hundreds of games itself
     - tools for anything finer (`TOOLS`): box scores, a player's history in
       the league, a manager's season, the best weeks, trades, waivers,
       drafts and lineup efficiency. The AI asks for one, this file works it
       out from the data the page already has, and sends it back.
   Both go to the league-chat function (supabase/functions/league-chat),
   which holds the API key, checks the member is on Pro, and streams the
   answer back. Nothing about the league is stored anywhere but this
   browser: the conversation is kept in sessionStorage so it follows the
   member from page to page, and is gone when the tab is.

   Settings: AI_CHAT_URL in account-config.js, or Supabase's
   <SUPABASE_URL>/functions/v1/league-chat once SUPABASE_URL is set.

   Plain script, loaded after sleeper.js and account.js on each league page.
   It waits for the page's own League.load (and so for the account gate),
   then puts its button up. */
(function () {
  "use strict";

  const CFG = window.ACCOUNT_CONFIG || {};
  const ENDPOINT = CFG.AI_CHAT_URL ||
    (CFG.SUPABASE_URL ? `${String(CFG.SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/league-chat` : "");
  const PRO_PRICE = (CFG.PLANS && CFG.PLANS.pro && CFG.PLANS.pro.price) || "$5/month";
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 640px)");
  // A conversation this long is closed for a fresh one: the AI reads all of
  // it on every question. One question can add up to 18 turns (eight
  // look-ups), which still fits under the function's 80.
  const MAX_TURNS = 60;
  const MAX_TOOL_ROUNDS = 8;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const f2 = (n) => Number(n || 0).toFixed(2);
  const f1 = (n) => Number(n || 0).toFixed(1);
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ================================================================
     The league as text
     ================================================================ */

  const BENCH = new Set(["BE", "IR", "TX"]);

  // Every played game, oldest first, with both managers.
  function gamesOf(model) {
    const out = [];
    model.seasons.forEach((s) => {
      s.playedWeeks.forEach((w) => (s.results[w] || []).forEach(([a, aScore, b, bScore]) => {
        if (!s.teams[a] || !s.teams[b]) return;
        out.push({ year: s.year, week: w, a, b, aScore, bScore, aOwner: s.teams[a].ownerId, bOwner: s.teams[b].ownerId, label: null, bracket: null });
      }));
      s.postseason.filter((g) => g.played && g.a && g.b && s.teams[g.a] && s.teams[g.b]).forEach((g) => {
        out.push({ year: s.year, week: g.week, a: g.a, b: g.b, aScore: g.aScore, bScore: g.bScore,
          aOwner: s.teams[g.a].ownerId, bOwner: s.teams[g.b].ownerId, label: g.label, bracket: g.bracket, titlePath: g.titlePath, p: g.p });
      });
    });
    return out.sort((x, y) => x.year - y.year || x.week - y.week);
  }

  const hasGames = (s) => s.playedWeeks.length > 0 || s.postseason.some((g) => g.played);

  function scoringLine(st) {
    const sc = st.scoring || {};
    const bits = [];
    const rec = Number(sc.rec || 0);
    bits.push(rec === 1 ? "full PPR" : rec === 0.5 ? "half PPR" : rec ? `${rec} per reception` : "standard (no PPR)");
    if (sc.pass_td != null) bits.push(`${sc.pass_td}-pt passing TDs`);
    if (Number(sc.bonus_rec_te)) bits.push(`TE premium +${sc.bonus_rec_te}`);
    if (sc.pass_int != null && Number(sc.pass_int) !== -1) bits.push(`${sc.pass_int} per interception`);
    return bits.join(", ");
  }

  function formatLine(s) {
    const st = s.settings;
    const kind = ["redraft", "keeper", "dynasty"][st.leagueType] || "redraft";
    const lineup = (st.rosterPositions || []).filter((p) => !["BN", "IR", "TAXI"].includes(p));
    const bench = (st.rosterPositions || []).filter((p) => p === "BN").length;
    const parts = [
      `${st.numTeams} teams`, kind,
      `${st.regularWeeks}-week regular season`,
      st.playoffTeams ? `${st.playoffTeams}-team playoffs from week ${st.playoffWeekStart}` : "no playoffs",
      st.playoffTeams ? (st.playoffType === 0 ? "losers play a toilet bowl (the last team standing finishes last)" : "losers play a consolation bracket") : "",
      st.median ? "a weekly extra game against the league median (counted in records)" : "",
      st.divisions.length > 1 ? `divisions: ${st.divisions.join(", ")}` : "",
      st.waiverType === 2 ? `FAAB waivers ($${st.waiverBudget})` : "",
      lineup.length ? `lineup ${lineup.map((p) => ({ SUPER_FLEX: "SF", WRRB_FLEX: "W/R", REC_FLEX: "W/T", IDP_FLEX: "IDP" }[p] || p)).join(" ")}${bench ? ` + ${bench} bench` : ""}` : "",
      Object.keys(st.scoring || {}).length ? `scoring: ${scoringLine(st)}` : "",
    ];
    return parts.filter(Boolean).join(" · ");
  }

  async function digestOf(model) {
    const owners = model.owners;
    const name = (oid) => (owners[oid] ? owners[oid].name : "Unknown");
    const seasons = model.seasons.filter(hasGames);
    const live = model.seasons.find((s) => !s.finished && hasGames(s));
    const upcoming = model.seasons.find((s) => s.preseason && !hasGames(s));
    const games = gamesOf(model);
    const L = [];
    const today = new Date().toISOString().slice(0, 10);

    L.push(`Today is ${today}. Platform: ${model.platform === "espn" ? "ESPN" : "Sleeper"}.`);
    L.push(`Seasons with games: ${seasons.map((s) => s.year).join(", ") || "none yet"}.${live ? ` The ${live.year} season is in progress (regular season through week ${live.playedWeeks[live.playedWeeks.length - 1] || 0} of ${live.settings.regularWeeks}).` : ""}${upcoming ? ` The ${upcoming.year} season hasn't started yet.` : ""}`);
    const newest = model.seasons[model.seasons.length - 1];
    if (newest) L.push(`Format (${newest.year}): ${formatLine(newest)}.`);

    /* managers */
    L.push("", "## Managers (the people; team names change by season)");
    Object.entries(owners).forEach(([oid, o]) => {
      const mine = model.seasons.filter((s) => Object.values(s.teams).some((t) => t.ownerId === oid));
      const teams = mine.map((s) => `${s.year} "${Object.values(s.teams).find((t) => t.ownerId === oid).name}"`);
      L.push(`- ${o.name}: ${mine.length} season${mine.length === 1 ? "" : "s"} (${teams.join(", ")})`);
    });

    /* all-time tables */
    const career = {};
    const c = (oid) => (career[oid] = career[oid] || {
      seasons: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0, titles: [], seconds: [], lasts: [], apps: 0,
      pw: 0, pl: 0, finishes: [], high: null, low: null,
    });
    seasons.forEach((s) => {
      Object.values(s.teams).forEach((t) => {
        const r = c(t.ownerId);
        r.seasons++;
        r.w += t.wins; r.l += t.losses; r.t += t.ties; r.pf += t.pf; r.pa += t.pa;
        if (s.finished && t.finalRank) r.finishes.push(t.finalRank);
        if (s.settings.playoffTeams && t.regularRank && t.regularRank <= s.settings.playoffTeams && (s.finished || s.postseason.some((g) => g.played))) r.apps++;
      });
      if (s.champion) c(s.teams[s.champion].ownerId).titles.push(s.year);
      if (s.runnerUp) c(s.teams[s.runnerUp].ownerId).seconds.push(s.year);
      if (s.lastPlace) c(s.teams[s.lastPlace].ownerId).lasts.push(s.year);
    });
    games.forEach((g) => {
      [[g.aOwner, g.aScore, g.bScore], [g.bOwner, g.bScore, g.aScore]].forEach(([oid, mine, theirs]) => {
        const r = c(oid);
        if (!g.bracket) r.gp++;
        if (g.bracket === "W") { if (mine > theirs) r.pw++; else if (mine < theirs) r.pl++; }
        if (!r.high || mine > r.high.pts) r.high = { pts: mine, year: g.year, week: g.week };
        if (mine > 0 && (!r.low || mine < r.low.pts)) r.low = { pts: mine, year: g.year, week: g.week };
      });
    });
    L.push("", `## All-time, by manager (${seasons.map((s) => s.year).join(", ")}${live ? `; ${live.year} so far` : ""})`,
      "Regular-season records and points are the official standings (weekly median games included where played). Playoff record counts winners-bracket games only.",
      "manager | seasons | regular season W-L-T (win%) | PF | PA | PF/game | titles | runner-up | last place | playoff trips | playoff W-L | finishes | highest / lowest game");
    Object.entries(career).sort((a, b) => b[1].titles.length - a[1].titles.length || (b[1].w / Math.max(1, b[1].w + b[1].l)) - (a[1].w / Math.max(1, a[1].w + a[1].l)))
      .forEach(([oid, r]) => {
        const dec = r.w + r.l + r.t;
        L.push([
          name(oid), r.seasons, `${r.w}-${r.l}${r.t ? `-${r.t}` : ""} (${dec ? pct((r.w + r.t / 2) / dec) : "–"})`,
          f2(r.pf), f2(r.pa), r.gp ? f2(r.pf / r.gp) : "–",
          r.titles.length ? `${r.titles.length} (${r.titles.join(", ")})` : "0",
          r.seconds.length ? `${r.seconds.length} (${r.seconds.join(", ")})` : "0",
          r.lasts.length ? `${r.lasts.length} (${r.lasts.join(", ")})` : "0",
          r.apps, `${r.pw}-${r.pl}`,
          r.finishes.length ? `${r.finishes.join(", ")} (avg ${f1(r.finishes.reduce((x, y) => x + y, 0) / r.finishes.length)})` : "–",
          r.high ? `${f2(r.high.pts)} (${r.high.year} wk ${r.high.week}) / ${f2(r.low.pts)} (${r.low.year} wk ${r.low.week})` : "–",
        ].join(" | "));
      });

    /* head-to-head */
    const h2h = {};
    games.forEach((g) => {
      const [x, y] = [g.aOwner, g.bOwner].sort();
      const r = (h2h[`${x}|${y}`] = h2h[`${x}|${y}`] || { x, y, xw: 0, yw: 0, t: 0, xpf: 0, ypf: 0, pxw: 0, pyw: 0, last: null });
      const xs = g.aOwner === x ? g.aScore : g.bScore, ys = g.aOwner === x ? g.bScore : g.aScore;
      r.xpf += xs; r.ypf += ys;
      if (xs > ys) { r.xw++; if (g.bracket === "W") r.pxw++; } else if (ys > xs) { r.yw++; if (g.bracket === "W") r.pyw++; } else r.t++;
      r.last = `${g.year} wk ${g.week}: ${name(g.aOwner)} ${f2(g.aScore)}–${f2(g.bScore)} ${name(g.bOwner)}`;
    });
    L.push("", "## Head-to-head, every meeting (regular season and every postseason game)");
    Object.values(h2h).sort((p, q) => (q.xw + q.yw + q.t) - (p.xw + p.yw + p.t)).forEach((r) => {
      const playoff = r.pxw + r.pyw ? ` (winners-bracket games ${r.pxw}-${r.pyw})` : "";
      L.push(`- ${name(r.x)} ${r.xw}-${r.yw}${r.t ? `-${r.t}` : ""} ${name(r.y)}${playoff}; points ${f2(r.xpf)}–${f2(r.ypf)}; last: ${r.last}`);
    });

    /* records */
    const sides = [];
    games.forEach((g) => {
      sides.push({ oid: g.aOwner, pts: g.aScore, opp: g.bOwner, oppPts: g.bScore, g });
      sides.push({ oid: g.bOwner, pts: g.bScore, opp: g.aOwner, oppPts: g.aScore, g });
    });
    const when = (g) => `${g.year} wk ${g.week}${g.label ? `, ${g.label}` : ""}`;
    const sideLine = (x) => `${name(x.oid)} ${f2(x.pts)} vs ${name(x.opp)} ${f2(x.oppPts)} (${when(x.g)})`;
    const gameLine = (g) => `${name(g.aOwner)} ${f2(g.aScore)}–${f2(g.bScore)} ${name(g.bOwner)} (${when(g)}, margin ${f2(Math.abs(g.aScore - g.bScore))})`;
    L.push("", "## League records (every game, playoffs included)");
    L.push("Highest scores:", ...sides.slice().sort((p, q) => q.pts - p.pts).slice(0, 12).map((x, i) => `${i + 1}. ${sideLine(x)}`));
    L.push("Lowest scores:", ...sides.filter((x) => x.pts > 0).sort((p, q) => p.pts - q.pts).slice(0, 10).map((x, i) => `${i + 1}. ${sideLine(x)}`));
    L.push("Biggest blowouts:", ...games.slice().sort((p, q) => Math.abs(q.aScore - q.bScore) - Math.abs(p.aScore - p.bScore)).slice(0, 10).map((g, i) => `${i + 1}. ${gameLine(g)}`));
    L.push("Closest games:", ...games.slice().sort((p, q) => Math.abs(p.aScore - p.bScore) - Math.abs(q.aScore - q.bScore)).slice(0, 10).map((g, i) => `${i + 1}. ${gameLine(g)}`));
    L.push("Highest combined:", ...games.slice().sort((p, q) => (q.aScore + q.bScore) - (p.aScore + p.bScore)).slice(0, 5).map((g, i) => `${i + 1}. ${gameLine(g)} = ${f2(g.aScore + g.bScore)}`));
    L.push("Highest scores in a loss:", ...sides.filter((x) => x.pts < x.oppPts).sort((p, q) => q.pts - p.pts).slice(0, 5).map((x, i) => `${i + 1}. ${sideLine(x)}`));
    L.push("Lowest scores in a win:", ...sides.filter((x) => x.pts > x.oppPts).sort((p, q) => p.pts - q.pts).slice(0, 5).map((x, i) => `${i + 1}. ${sideLine(x)}`));

    const teamSeasons = [];
    seasons.forEach((s) => Object.values(s.teams).forEach((t) => {
      const gp = s.playedWeeks.length;
      if (gp) teamSeasons.push({ s, t, gp });
    }));
    const tsLine = (x) => `${name(x.t.ownerId)} ("${x.t.name}", ${x.s.year}${x.s.finished ? "" : " so far"}): ${x.t.wins}-${x.t.losses}${x.t.ties ? `-${x.t.ties}` : ""}, PF ${f2(x.t.pf)}, PA ${f2(x.t.pa)}${x.t.finalRank ? `, finished ${x.t.finalRank}` : ""}`;
    const winPct = (x) => (x.t.wins + x.t.ties / 2) / Math.max(1, x.t.wins + x.t.losses + x.t.ties);
    L.push("Best regular seasons by record:", ...teamSeasons.slice().sort((p, q) => winPct(q) - winPct(p) || q.t.pf - p.t.pf).slice(0, 6).map((x, i) => `${i + 1}. ${tsLine(x)}`));
    L.push("Worst regular seasons by record:", ...teamSeasons.slice().sort((p, q) => winPct(p) - winPct(q) || p.t.pf - q.t.pf).slice(0, 5).map((x, i) => `${i + 1}. ${tsLine(x)}`));
    L.push("Most points per game in a season:", ...teamSeasons.slice().sort((p, q) => q.t.pf / q.gp - p.t.pf / p.gp).slice(0, 6).map((x, i) => `${i + 1}. ${tsLine(x)} (${f2(x.t.pf / x.gp)}/game)`));
    L.push("Fewest points per game in a season:", ...teamSeasons.slice().sort((p, q) => p.t.pf / p.gp - q.t.pf / q.gp).slice(0, 5).map((x, i) => `${i + 1}. ${tsLine(x)} (${f2(x.t.pf / x.gp)}/game)`));
    L.push("Most points against per game in a season (unluckiest schedules):", ...teamSeasons.slice().sort((p, q) => q.t.pa / q.gp - p.t.pa / p.gp).slice(0, 5).map((x, i) => `${i + 1}. ${tsLine(x)} (${f2(x.t.pa / x.gp)} against/game)`));

    // Streaks run across seasons, game by game, regular season and
    // winners-bracket games; a tie ends both kinds.
    const streak = {};
    games.filter((g) => !g.bracket || g.bracket === "W").forEach((g) => {
      [[g.aOwner, g.aScore - g.bScore], [g.bOwner, g.bScore - g.aScore]].forEach(([oid, d]) => {
        const r = (streak[oid] = streak[oid] || { cur: 0, bestW: null, bestL: null, start: null });
        const kind = d > 0 ? 1 : d < 0 ? -1 : 0;
        if (!kind || Math.sign(r.cur) !== kind) { r.cur = kind; r.start = g; } else r.cur += kind;
        const span = `${r.start.year} wk ${r.start.week} to ${g.year} wk ${g.week}`;
        if (r.cur > 0 && (!r.bestW || r.cur > r.bestW.n)) r.bestW = { n: r.cur, span };
        if (r.cur < 0 && (!r.bestL || -r.cur > r.bestL.n)) r.bestL = { n: -r.cur, span };
      });
    });
    L.push("Longest streaks (regular season and winners bracket, across seasons):");
    Object.entries(streak).sort((p, q) => ((q[1].bestW || {}).n || 0) - ((p[1].bestW || {}).n || 0)).forEach(([oid, r]) => {
      L.push(`- ${name(oid)}: longest winning ${r.bestW ? `${r.bestW.n} (${r.bestW.span})` : "0"}; longest losing ${r.bestL ? `${r.bestL.n} (${r.bestL.span})` : "0"}; current ${r.cur > 0 ? `W${r.cur}` : r.cur < 0 ? `L${-r.cur}` : "none"}`);
    });

    /* each season */
    seasons.forEach((s) => {
      const tm = (id) => (s.teams[id] ? `${name(s.teams[id].ownerId)}` : "?");
      const throughWeek = s.playedWeeks[s.playedWeeks.length - 1] || 0;
      L.push("", `## ${s.year} season${s.finished ? "" : ` (in progress: through week ${throughWeek} of ${s.settings.regularWeeks})`}`);
      L.push(`Format: ${formatLine(s)}.`);
      if (s.titleGame && s.champion) {
        const g = s.titleGame, loser = g.winner === g.a ? g.b : g.a;
        const ws = g.winner === g.a ? g.aScore : g.bScore, ls = g.winner === g.a ? g.bScore : g.aScore;
        L.push(`Champion: ${tm(s.champion)} ("${s.teams[s.champion].name}"), beat ${tm(loser)} ${f2(ws)}–${f2(ls)} in the final (week ${g.week}).`);
      } else if (s.champion) L.push(`Champion: ${tm(s.champion)} ("${s.teams[s.champion].name}").`);
      if (s.runnerUp) L.push(`Runner-up: ${tm(s.runnerUp)}.`);
      if (s.lastPlace) L.push(`Last place: ${tm(s.lastPlace)}.`);
      L.push(`Standings (regular-season order${s.finished ? " → final place" : ""}): team (manager) W-L-T, PF, PA`);
      s.standing.forEach((id, i) => {
        const t = s.teams[id];
        const seed = s.settings.playoffTeams && i < s.settings.playoffTeams ? ` [playoff seed ${i + 1}]` : "";
        const div = t.division && s.settings.divisions.length > 1 ? ` [${t.division}]` : "";
        L.push(`${i + 1}. "${t.name}" (${name(t.ownerId)}) ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}, PF ${f2(t.pf)}, PA ${f2(t.pa)}${seed}${div}${t.finalRank && s.finished ? ` → finished ${t.finalRank}` : ""}`);
      });
      L.push("Regular-season games (manager score–score manager):");
      s.playedWeeks.filter((w) => w <= s.settings.regularWeeks).forEach((w) => {
        const line = (s.results[w] || []).map(([a, as, b, bs]) => `${tm(a)} ${f2(as)}–${f2(bs)} ${tm(b)}`).join("; ");
        const med = s.medianResults && s.medianResults[w] ? ` | vs median: ${Object.entries(s.medianResults[w]).map(([id, r]) => `${tm(id)} ${r}`).join(", ")}` : "";
        if (line) L.push(`Wk ${w}: ${line}${med}`);
      });
      const post = s.postseason.filter((g) => g.played && g.a && g.b);
      if (post.length) {
        L.push("Postseason:");
        post.sort((x, y) => x.week - y.week || (x.bracket === "W" ? -1 : 1)).forEach((g) => {
          L.push(`Wk ${g.week} ${g.bracket === "W" || /^losers/i.test(g.label) ? "" : "losers bracket, "}${g.label}: ${tm(g.a)} ${f2(g.aScore)}–${f2(g.bScore)} ${tm(g.b)} → ${tm(g.winner)} ${g.bracket === "L" && s.settings.playoffType === 0 ? "moves on (toilet bowl: the loser is spared)" : "wins"}`);
        });
      }
      if (!s.finished) {
        const next = Object.keys(s.schedule).map(Number).filter((w) => w > throughWeek).sort((a, b) => a - b)[0];
        if (next && s.schedule[next]) L.push(`Next up, week ${next}: ${s.schedule[next].map(([a, b]) => `${tm(a)} vs ${tm(b)}`).join("; ")}`);
      }
    });
    if (upcoming) L.push("", `## ${upcoming.year} season: not started. Format: ${formatLine(upcoming)}.`);

    /* who each manager has leaned on */
    try {
      const st = await Promise.race([model.starters(), sleep(20000).then(() => null)]);
      if (st) {
        L.push("", "## Each manager's most-started players, all seasons");
        Object.entries(st.owners).forEach(([oid, o]) => {
          L.push(`- ${name(oid)}: ${o.players.slice(0, 8).map((p) => `${p.name} (${p.pos}, ${p.starts} starts)`).join(", ")}`);
        });
      }
    } catch (err) { /* players file unavailable: the tools still have it */ }

    return L.join("\n");
  }

  /* ================================================================
     Tools: worked out here, from the data the page already has
     ================================================================ */

  function managerFinder(model) {
    const entries = [];
    Object.entries(model.owners).forEach(([oid, o]) => entries.push([oid, norm(o.name)]));
    model.seasons.forEach((s) => Object.values(s.teams).forEach((t) => entries.push([t.ownerId, norm(t.name)])));
    return (q) => {
      const n = norm(q);
      if (!n) return null;
      const hit = entries.find(([, e]) => e === n) || entries.find(([, e]) => e.startsWith(n)) ||
        entries.find(([, e]) => e.includes(n)) || entries.find(([, e]) => n.includes(e) && e.length > 2);
      return hit ? hit[0] : null;
    };
  }

  let insightsJob = null;
  function insights() {
    if (window.Insights) return Promise.resolve(window.Insights);
    if (!insightsJob) {
      insightsJob = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "insights.js";
        s.onload = () => resolve(window.Insights);
        s.onerror = () => { insightsJob = null; reject(new Error("couldn't load the front office")); };
        document.head.appendChild(s);
      });
    }
    return insightsJob;
  }

  class ToolError extends Error {}

  function toolkit(model) {
    const owners = model.owners;
    const name = (oid) => (owners[oid] ? owners[oid].name : "Unknown");
    const findManager = managerFinder(model);
    const years = () => model.seasons.map((s) => s.year).join(", ");
    const seasonOf = (y) => {
      const s = model.season(y);
      if (!s) throw new ToolError(`There is no ${y} season in this league. Seasons: ${years()}.`);
      return s;
    };
    const managerOf = (q) => {
      const oid = findManager(q);
      if (!oid) throw new ToolError(`No manager or team called "${q}". Managers: ${Object.values(owners).map((o) => o.name).join(", ")}.`);
      return oid;
    };
    const teamIn = (s, oid) => Object.keys(s.teams).find((id) => s.teams[id].ownerId === oid) || null;
    const who = (s, id) => (s.teams[id] ? `${name(s.teams[id].ownerId)} ("${s.teams[id].name}")` : `team ${id}`);
    const labelFor = (s, week, a, b) => {
      if (week <= s.settings.regularWeeks) return null;
      const g = s.postseason.find((x) => x.weeks && x.weeks.includes(week) && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
      return g ? `${g.bracket === "L" ? "losers bracket " : ""}${g.label}` : "consolation";
    };
    let dbJob = null;
    const players = () => (dbJob = dbJob || window.League.players());

    async function box_score({ season, week, manager }) {
      const s = seasonOf(season);
      const box = await model.boxWeek(season, week);
      if (!box || !box.games.length) throw new ToolError(`No final box scores for ${season} week ${week} (it hasn't been played, or ${window.League.sourceName()} no longer keeps lineups for it). Played weeks: ${s.playedWeeks.join(", ")}.`);
      let list = box.games;
      if (manager) {
        const tid = teamIn(s, managerOf(manager));
        list = list.filter((g) => g.home === tid || g.away === tid);
        if (!list.length) throw new ToolError(`${name(findManager(manager))} didn't play in ${season} week ${week}.`);
      }
      const side = (g, tid, pts) => {
        const lu = g.lineups[tid] || [];
        const starters = lu.filter((p) => p.starter).map((p) => `${p.slot} ${p.name} (${p.pos}, ${p.nfl}) ${f2(p.pts)}`);
        const bench = lu.filter((p) => !p.starter).map((p) => `${p.name} (${p.pos}${p.slot === "IR" ? ", IR" : ""}) ${f2(p.pts)}`);
        return `${who(s, tid)}: ${f2(pts)}\n  starters: ${starters.join("; ") || "none listed"}\n  bench: ${bench.join("; ") || "none"}`;
      };
      return "NFL clubs shown are where each player is now, not necessarily where he played then.\n\n" + list.map((g) => {
        const label = labelFor(s, week, g.home, g.away);
        return `${season} week ${week}${label ? ` (${label})` : ""}\n${side(g, g.home, g.homeScore)}\n${side(g, g.away, g.awayScore)}`;
      }).join("\n\n");
    }

    async function player_history({ player }) {
      const idx = await model.playerIndex();
      const q = norm(player);
      if (!q) throw new ToolError("Name a player.");
      const scored = idx.players.map((p) => {
        const n = norm(p.n);
        const last = n.split(" ").slice(1).join(" ");
        const score = n === q ? 4 : last === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0;
        return [score, p];
      }).filter(([sc]) => sc).sort((a, b) => b[0] - a[0] || b[1].r.length - a[1].r.length);
      if (!scored.length) throw new ToolError(`No player matching "${player}" has been on a roster in this league.`);
      const p = scored[0][1];
      const others = scored.slice(1, 6).map(([, x]) => `${x.n} (${x.p})`);
      const groups = new Map();
      p.r.forEach(([year, week, teamId, slot, pts]) => {
        const key = `${year}|${teamId}`;
        if (!groups.has(key)) groups.set(key, { year, teamId, weeks: 0, starts: 0, pts: 0, bench: 0, best: null });
        const g = groups.get(key);
        g.weeks++;
        if (BENCH.has(slot)) g.bench += pts;
        else { g.starts++; g.pts += pts; if (!g.best || pts > g.best.pts) g.best = { week, pts }; }
      });
      const lines = [`${p.n} (${p.p}) in this league:`];
      [...groups.values()].sort((a, b) => a.year - b.year).forEach((g) => {
        const t = idx.teams[g.year] && idx.teams[g.year][g.teamId];
        lines.push(`- ${g.year}, ${t ? `${t[2]} ("${t[0]}")` : g.teamId}: on the roster ${g.weeks} weeks, started ${g.starts} for ${f2(g.pts)} pts${g.starts ? ` (${f2(g.pts / g.starts)}/start, best ${f2(g.best.pts)} in week ${g.best.week})` : ""}; ${f2(g.bench)} pts on the bench`);
      });
      const best = p.r.filter((r) => !BENCH.has(r[3])).sort((a, b) => b[4] - a[4]).slice(0, 5);
      if (best.length) {
        lines.push(`Best starts: ${best.map(([y, w, tid, , pts]) => `${f2(pts)} (${y} wk ${w}, ${idx.teams[y] && idx.teams[y][tid] ? idx.teams[y][tid][2] : tid})`).join("; ")}`);
      }
      // How he got to each team: the draft, trades, waivers. The
      // transactions are many requests the first time, so they get a while.
      try {
        const [drafts, txns] = await Promise.race([
          Promise.all([model.drafts(), model.transactions()]),
          sleep(15000).then(() => { throw new Error("slow"); }),
        ]);
        const moves = [];
        drafts.filter((d) => d.done).forEach((d) => d.picks.filter((pk) => String(pk.pid) === String(p.id)).forEach((pk) => {
          const s = model.season(d.leagueYear);
          moves.push(`${d.year} draft: round ${pk.round}, pick ${pk.no} overall, by ${s && s.teams[`r${pk.rosterId}`] ? name(s.teams[`r${pk.rosterId}`].ownerId) : `roster ${pk.rosterId}`}`);
        }));
        model.seasons.forEach((s) => (txns[s.year] || []).filter((t) => t.status === "complete" && t.adds && t.adds[p.id] != null).forEach((t) => {
          const to = s.teams[`r${t.adds[p.id]}`];
          const fromRid = t.drops && t.drops[p.id];
          const from = fromRid != null ? s.teams[`r${fromRid}`] : null;
          const wk = Math.max(1, Number(t.leg) || 1);
          if (t.type === "trade") moves.push(`${s.year} week ${wk}: traded to ${to ? name(to.ownerId) : "?"}${from ? ` by ${name(from.ownerId)}` : ""}`);
          else if (t.type === "waiver") moves.push(`${s.year} week ${wk}: waiver claim by ${to ? name(to.ownerId) : "?"}${t.settings && t.settings.waiver_bid != null ? ` ($${t.settings.waiver_bid})` : ""}`);
          else if (t.type === "free_agent") moves.push(`${s.year} week ${wk}: free-agent pickup by ${to ? name(to.ownerId) : "?"}`);
        }));
        if (moves.length) lines.push(`How he moved: ${moves.join("; ")}`);
      } catch (err) { /* the weeks above still say where he played */ }
      if (others.length) lines.push(`Other players matching "${player}": ${others.join(", ")}`);
      return lines.join("\n");
    }

    async function team_season({ season, manager }) {
      const s = seasonOf(season);
      const oid = managerOf(manager);
      const tid = teamIn(s, oid);
      if (!tid) throw new ToolError(`${name(oid)} didn't play in ${season}.`);
      const t = s.teams[tid];
      const lines = [`${name(oid)} in ${season}, as "${t.name}": ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}, PF ${f2(t.pf)}, PA ${f2(t.pa)}, regular-season rank ${t.regularRank}${t.finalRank && s.finished ? `, finished ${t.finalRank}` : ""}.`];
      const results = [];
      s.playedWeeks.forEach((w) => (s.results[w] || []).forEach(([a, as, b, bs]) => {
        if (a !== tid && b !== tid) return;
        const mine = a === tid ? as : bs, theirs = a === tid ? bs : as, opp = a === tid ? b : a;
        results.push(`wk ${w} ${mine > theirs ? "W" : mine < theirs ? "L" : "T"} ${f2(mine)}–${f2(theirs)} vs ${name(s.teams[opp].ownerId)}${s.medianResults && s.medianResults[w] && s.medianResults[w][tid] ? ` (median ${s.medianResults[w][tid]})` : ""}`);
      }));
      s.postseason.filter((g) => g.played && (g.a === tid || g.b === tid)).forEach((g) => {
        const mine = g.a === tid ? g.aScore : g.bScore, theirs = g.a === tid ? g.bScore : g.aScore, opp = g.a === tid ? g.b : g.a;
        results.push(`wk ${g.week} ${g.label}: ${mine > theirs ? "W" : "L"} ${f2(mine)}–${f2(theirs)} vs ${s.teams[opp] ? name(s.teams[opp].ownerId) : "?"}`);
      });
      lines.push(`Games: ${results.join("; ") || "none yet"}`);
      const roster = await model.roster(season);
      const mine = roster && roster[tid];
      if (mine && mine.players.length) {
        lines.push(`Players started (starts, points as a starter): ${mine.players.slice(0, 30).map((p) => `${p.name} (${p.pos}) ${p.starts}, ${f2(p.pts)}`).join("; ")}`);
      }
      try {
        const I = await insights();
        const ls = await I.lineupSeason(model, season);
        const row = ls && ls.rows.find((r) => r.teamId === tid);
        if (row) {
          const rank = ls.rows.indexOf(row) + 1;
          lines.push(`Lineup efficiency: ${pct(row.efficiency)} (${rank} of ${ls.rows.length}), ${f2(row.left)} pts left on the bench, ${row.perfect} perfect lineups, ${row.costGames} game${row.costGames === 1 ? "" : "s"} lost to lineup choices.`);
          const worst = ls.blunders.filter((b) => b.teamId === tid).slice(0, 3);
          if (worst.length) { const db = await players(); lines.push(`Worst benchings: ${worst.map((b) => `week ${b.week}: ${blunderText(b, db)}`).join("; ")}`); }
        }
      } catch (err) { /* lineup data unavailable */ }
      return lines.join("\n");
    }

    // A week's costliest call: the benched player who'd have added most, and
    // the starter (or empty slot) he should have replaced.
    function blunderText(b, db) {
      const nm = (x) => (db[x.pid] ? db[x.pid][0] : `player ${x.pid}`);
      const instead = b.started ? `${nm(b.started)} (${f2(b.started.pts)})` : "an empty slot";
      return `benched ${nm(b.benched)} (${f2(b.benched.pts)}) for ${instead}, cost ${f2(b.cost)} pts`;
    }

    async function top_performances({ season, position, manager, limit }) {
      const idx = await model.playerIndex();
      if (season) seasonOf(season);
      const oid = manager ? managerOf(manager) : null;
      const pos = position ? String(position).toUpperCase().replace("DST", "DEF").replace("D/ST", "DEF") : null;
      const n = Math.max(1, Math.min(40, Number(limit) || 15));
      const starts = [], benched = [];
      idx.players.forEach((p) => {
        const ppos = p.p === "DST" ? "DEF" : p.p;
        if (pos && ppos !== pos) return;
        p.r.forEach(([y, w, tid, slot, pts]) => {
          if (season && y !== season) return;
          const t = idx.teams[y] && idx.teams[y][tid];
          if (oid && (!t || t[1] !== oid)) return;
          const row = { p, y, w, t, pts };
          (BENCH.has(slot) ? benched : starts).push(row);
        });
      });
      const line = (x, i) => `${i + 1}. ${x.p.n} (${x.p.p}) ${f2(x.pts)}, ${x.y} wk ${x.w}, ${x.t ? `${x.t[2]} ("${x.t[0]}")` : "?"}`;
      const scope = `${season || "all seasons"}${pos ? `, ${pos}` : ""}${oid ? `, ${name(oid)}'s teams` : ""}`;
      return [
        `Best starts (${scope}):`, ...starts.sort((a, b) => b.pts - a.pts).slice(0, n).map(line),
        `Best weeks left on a bench (${scope}):`, ...benched.sort((a, b) => b.pts - a.pts).slice(0, Math.min(n, 8)).map(line),
      ].join("\n");
    }

    async function trades({ season, manager }) {
      if (season) seasonOf(season);
      const oid = manager ? managerOf(manager) : null;
      const I = await insights();
      const all = (await I.trades(model)).trades;
      const list = all.filter((t) => (!season || t.year === season) && (!oid || t.sides.some((s) => s.ownerId === oid)));
      if (!list.length) return `No completed trades${season ? ` in ${season}` : ""}${oid ? ` involving ${name(oid)}` : ""}.`;
      const item = (s, g) => {
        if (g.kind === "player") return `${g.name}${g.pos ? ` (${g.pos})` : ""}: ${f2(g.pts)} pts in ${g.starts} starts for them since`;
        if (g.kind === "pick") return `${g.season} round ${g.round} pick${g.became ? ` (became ${g.became.name}${g.passedOn ? ", traded on before it was used" : `: ${f2(g.pts)} pts in ${g.starts} starts`})` : g.pending ? " (not used yet)" : ""}`;
        if (g.kind === "faab") return `$${g.amount} FAAB`;
        return g.kind;
      };
      const lines = [`${list.length} trade${list.length === 1 ? "" : "s"}${season ? ` in ${season}` : ""}${oid ? ` involving ${name(oid)}` : ""}, newest first. Points are what each side's haul scored in that manager's starting lineup from the trade on.`];
      list.slice(0, 40).forEach((t) => {
        const s = model.season(t.year);
        lines.push(`${t.year} week ${t.week}: ${t.sides.map((x) => name(x.ownerId)).join(" ⇄ ")}${t.winner ? ` → won (so far) by ${name(s.teams[t.winner].ownerId)} by ${f2(t.margin)}` : ""}${t.pending ? " (picks still to be used)" : ""}`);
        t.sides.forEach((x) => lines.push(`  ${name(x.ownerId)} got: ${x.got.map((g) => item(x, g)).join("; ") || "nothing"} (total ${f2(x.total)})`));
      });
      if (list.length > 40) lines.push(`…and ${list.length - 40} older trades.`);
      const table = I.tradersOf(list);
      lines.push("Trade records (won = came out ahead in points; net = points got minus points given away):");
      table.forEach((r) => lines.push(`- ${name(r.ownerId)}: ${r.trades} trades, won ${r.won}, got ${f2(r.got)}, gave ${f2(r.gave)}, net ${f2(r.net)}`));
      return lines.join("\n");
    }

    async function waiver_pickups({ season, manager }) {
      const s = seasonOf(season);
      const oid = manager ? managerOf(manager) : null;
      const I = await insights();
      const w = await I.waivers(model, season);
      if (!w || !w.pickups.length) return `No waiver or free-agent pickups recorded in ${season}.`;
      const tidName = (id) => (s.teams[id] ? name(s.teams[id].ownerId) : id);
      const picks = w.pickups.filter((p) => !oid || p.ownerId === oid);
      const lines = [`${season} pickups${oid ? ` by ${name(oid)}` : ""}${w.faab ? ` (FAAB, $${w.budget} budget)` : ""}, by points scored for the team that added them that season:`];
      picks.slice(0, 30).forEach((p, i) => lines.push(`${i + 1}. ${p.name} (${p.pos}) by ${tidName(p.teamId)}, week ${p.week}, ${p.kind === "waiver" ? (p.bid != null ? `$${p.bid} bid` : "waiver claim") : "free agent"}: ${f2(p.pts)} pts in ${p.starts} starts`));
      lines.push("By manager:");
      w.rows.filter((r) => !oid || r.ownerId === oid).forEach((r) => lines.push(`- ${tidName(r.teamId)}: ${r.adds} adds, ${f2(r.pts)} pts from them, ${r.hits} started 3+ times${w.faab ? `, $${r.spent} spent${r.perDollar ? ` (${f2(r.perDollar)} pts per $)` : ""}` : ""}`));
      return lines.join("\n");
    }

    async function draft({ season }) {
      const s = seasonOf(season);
      const drafts = (await model.drafts()).filter((d) => d.done && (d.leagueYear === season || d.year === season));
      if (!drafts.length) return `No completed draft is recorded for ${season}.`;
      const d = drafts.sort((a, b) => b.picks.length - a.picks.length)[0];
      const db = await players();
      const roster = await model.roster(d.leagueYear).catch(() => null);
      const ds = model.season(d.leagueYear) || s;
      const lines = [`${d.year} draft (${d.type || "snake"}, ${d.rounds} rounds). Pick: manager: player (position) → points he scored as that manager's starter that season.`];
      d.picks.slice().sort((a, b) => a.no - b.no).forEach((pk) => {
        const tid = `r${pk.rosterId}`;
        const team = ds.teams[tid];
        const pl = db[pk.pid];
        const got = roster && roster[tid] && roster[tid].players.find((x) => String(x.id) === String(pk.pid));
        lines.push(`${pk.round}.${String(pk.slot || "").padStart(2, "0")} (#${pk.no}) ${team ? name(team.ownerId) : `roster ${pk.rosterId}`}: ${pl ? `${pl[0]} (${pl[1]})` : `player ${pk.pid}`}${got ? ` → ${f2(got.pts)} in ${got.starts} starts` : " → 0 starts"}`);
      });
      return lines.join("\n");
    }

    async function lineup_efficiency({ season }) {
      const I = await insights();
      if (season) {
        const s = seasonOf(season);
        const ls = await I.lineupSeason(model, season);
        if (!ls || !ls.rows.length) return `No lineups are recorded for ${season}.`;
        const lines = [`${season} lineup efficiency (points scored ÷ best possible lineup), weeks ${ls.weeks[0]}–${ls.weeks[ls.weeks.length - 1]}:`];
        ls.rows.forEach((r, i) => lines.push(`${i + 1}. ${name(r.ownerId)}: ${pct(r.efficiency)}, ${f2(r.left)} pts left on the bench, ${r.perfect} perfect weeks, ${r.costGames} game${r.costGames === 1 ? "" : "s"} lost to lineup choices`));
        if (ls.blunders.length) {
          const db = await players();
          lines.push("Costliest benchings:");
          ls.blunders.slice(0, 8).forEach((b) => lines.push(`- week ${b.week}, ${s.teams[b.teamId] ? name(s.teams[b.teamId].ownerId) : "?"}: ${blunderText(b, db)}`));
        }
        return lines.join("\n");
      }
      const rows = await I.lineupAllTime(model);
      if (!rows.length) return "No lineups are recorded.";
      return ["All-time lineup efficiency (points scored ÷ best possible lineup):",
        ...rows.map((r, i) => `${i + 1}. ${name(r.ownerId)}: ${pct(r.efficiency)} over ${r.seasons} seasons (${r.weeks} weeks), ${f2(r.left)} pts left on the bench, ${r.costGames} games lost to lineup choices`)].join("\n");
    }

    return { box_score, player_history, team_season, top_performances, trades, waiver_pickups, draft, lineup_efficiency };
  }

  // Every tool's input, checked before it runs: the AI's input is data, and
  // a wrong type gets an error back rather than a wrong answer.
  const INT = (v, lo, hi) => {
    const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
    return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
  };
  const STR = (v) => (typeof v === "string" && v.trim() && v.length <= 80 ? v.trim() : undefined);
  const SCHEMA = {
    box_score: { season: [INT, true, 1990, 2100], week: [INT, true, 0, 30], manager: [STR, false] },
    player_history: { player: [STR, true] },
    team_season: { season: [INT, true, 1990, 2100], manager: [STR, true] },
    top_performances: { season: [INT, false, 1990, 2100], position: [STR, false], manager: [STR, false], limit: [INT, false, 1, 100] },
    trades: { season: [INT, false, 1990, 2100], manager: [STR, false] },
    waiver_pickups: { season: [INT, true, 1990, 2100], manager: [STR, false] },
    draft: { season: [INT, true, 1990, 2100] },
    lineup_efficiency: { season: [INT, false, 1990, 2100] },
  };
  function checkInput(tool, input) {
    const schema = SCHEMA[tool];
    if (!schema) throw new ToolError(`There is no tool called ${tool}.`);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolError("The input must be an object.");
    const out = {};
    for (const [key, [type, required, lo, hi]] of Object.entries(schema)) {
      const raw = input[key];
      if (raw == null || raw === "") {
        if (required) throw new ToolError(`"${key}" is required.`);
        continue;
      }
      const v = type(raw, lo, hi);
      if (v === undefined) throw new ToolError(`"${key}" isn't valid: ${JSON.stringify(raw).slice(0, 60)}.`);
      out[key] = v;
    }
    return out;
  }

  /* ================================================================
     Talking to the league-chat function
     ================================================================ */

  class ChatError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function post(body, signal, onEvent) {
    if (!ENDPOINT) throw new ChatError("", "not_set_up");
    const headers = { "Content-Type": "application/json" };
    if (CFG.SUPABASE_ANON_KEY) headers.apikey = CFG.SUPABASE_ANON_KEY;
    const token = window.Account && window.Account.mode === "supabase" ? await window.Account.accessToken().catch(() => null) : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (CFG.SUPABASE_ANON_KEY) headers.Authorization = `Bearer ${CFG.SUPABASE_ANON_KEY}`;

    let res;
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ChatError("The league AI didn't answer. Check your connection and try again.", "network");
    }
    if (!res.ok) {
      let answer = {};
      try { answer = await res.json(); } catch (err) { /* not JSON */ }
      const msg = answer.error ? answer.error.charAt(0).toUpperCase() + answer.error.slice(1) + "." : `The league AI answered ${res.status}.`;
      throw new ChatError(msg, answer.code || `http_${res.status}`);
    }
    // Server-sent events, one JSON object per `data:` line.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", done = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch (err) { continue; }
        if (event.t === "error") throw new ChatError(event.message || "The league AI couldn't answer that.", event.setup ? "not_set_up_upstream" : "upstream");
        if (event.t === "done") done = event;
        else onEvent(event);
      }
      if (end) break;
    }
    if (!done) throw new ChatError("The answer was cut off. Try again.", "cut_off");
    return done;
  }

  /* ================================================================
     Markdown, safely: everything is escaped first, then a small set of
     marks is turned back on.
     ================================================================ */

  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  }

  function markdown(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out.push(`<h4>${inline(h[2])}</h4>`); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="lhc-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
          i++;
        }
        out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
        continue;
      }
      // A paragraph always takes its first line (a table row whose
      // separator hasn't streamed in yet reads as text for now).
      const para = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !isTableRow(lines[i])) {
        para.push(lines[i++]);
      }
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }
    return out.join("");
  }

  /* ================================================================
     The chat window
     ================================================================ */

  const ICON = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l1.9 5.3 5.3 1.9-5.3 1.9L12 17.2l-1.9-5.3L4.8 10l5.3-1.9z"/><path d="M18.6 14.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    ball: '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="32" rx="25" ry="15" transform="rotate(-35 32 32)"/><path d="M22 42L42 22M27 31l6 6M31 27l6 6M23 35l6 6M35 23l6 6" class="lhc-laces"/></svg>',
  };

  const WORKING = {
    start: ["Reading the record book", "Flipping through old seasons", "Checking the standings"],
    box_score: "Pulling the box scores",
    player_history: "Tracing a player's history",
    team_season: "Going through that season",
    top_performances: "Searching the best weeks",
    trades: "Digging through every trade",
    waiver_pickups: "Checking the waiver wire",
    draft: "Opening the draft board",
    lineup_efficiency: "Grading lineups",
  };

  function suggestions(model) {
    const out = [];
    const finished = model.seasons.filter((s) => s.finished && s.champion);
    const live = model.seasons.find((s) => !s.finished && s.playedWeeks.length);
    const owners = Object.entries(model.owners);
    if (finished.length > 1) out.push("Who has won the most championships?");
    else if (finished.length) out.push(`How did ${model.owners[finished[0].teams[finished[0].champion].ownerId].name} win the ${finished[0].year} title?`);
    out.push("What's the highest score in league history?");
    if (owners.length >= 2) {
      // the most-played rivalry
      const n = {};
      gamesOf(model).forEach((g) => { const k = [g.aOwner, g.bOwner].sort().join("|"); n[k] = (n[k] || 0) + 1; });
      const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const [x, y] = top[0].split("|");
        out.push(`${model.owners[x].name} vs ${model.owners[y].name}: who owns the rivalry?`);
      }
    }
    if (live) out.push(`Who's been the unluckiest team in ${live.year}?`);
    out.push("Who has won the most trades?");
    out.push("Who leaves the most points on the bench?");
    return out.slice(0, 4);
  }

  function mount(model) {
    const leagueKey = `lh-chat:${model.leagueId}`;
    const tools = toolkit(model);
    let digestJob = null;
    const digest = () => (digestJob = digestJob || digestOf(model).catch((err) => { digestJob = null; throw err; }));
    let history = [];   // what the API sees: every turn, tool calls included
    let shown = [];     // what the member sees: { role, text, error? }
    let busy = null;    // the AbortController of the answer being written
    let opened = false;

    try {
      const saved = JSON.parse(sessionStorage.getItem(leagueKey) || "null");
      if (saved && saved.v === 1) { history = saved.history || []; shown = saved.shown || []; }
    } catch (err) { /* nothing saved */ }
    const save = () => {
      try { sessionStorage.setItem(leagueKey, JSON.stringify({ v: 1, history, shown })); } catch (err) { /* full or blocked */ }
    };

    const pro = () => !window.Account || window.Account.isPro;

    /* ---- the button ---- */
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "lhc-fab";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    const drawFab = () => {
      fab.innerHTML = `<span class="lhc-fab-ring" aria-hidden="true"></span>
        <span class="lhc-fab-icon">${ICON.spark}</span>
        <span class="lhc-fab-label">Ask the League</span>
        ${pro() ? "" : '<span class="lhc-pro-tag">PRO</span>'}`;
      fab.setAttribute("aria-label", pro() ? "Ask the League: chat with the league's AI" : "Ask the League: the league's AI, part of Pro");
    };
    drawFab();
    document.body.appendChild(fab);
    requestAnimationFrame(() => fab.classList.add("in"));

    /* ---- the panel ---- */
    const panel = document.createElement("section");
    panel.className = "lhc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Ask the League");
    panel.hidden = true;
    const avatar = model.avatar
      ? `<img src="${esc(model.avatar)}" alt="" width="40" height="40" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'lhc-head-mark',innerHTML:'🏈'}))">`
      : '<span class="lhc-head-mark">🏈</span>';
    panel.innerHTML = `
      <header class="lhc-head">
        <div class="lhc-head-glow" aria-hidden="true"></div>
        <div class="lhc-head-avatar">${avatar}<span class="lhc-head-spark">${ICON.spark}</span></div>
        <div class="lhc-head-copy">
          <span class="lhc-kicker">${esc(model.name)}</span>
          <h2>League Historian</h2>
        </div>
        <button type="button" class="lhc-icon-btn" data-act="fresh" aria-label="New chat" title="New chat">${ICON.fresh}</button>
        <button type="button" class="lhc-icon-btn" data-act="close" aria-label="Close">${ICON.close}</button>
      </header>
      <div class="lhc-body"><div class="lhc-log" role="log" aria-live="polite"></div></div>
      <form class="lhc-compose">
        <textarea rows="1" maxlength="1000" placeholder="Ask about any season, rivalry, trade…" aria-label="Your question"></textarea>
        <button type="submit" class="lhc-send" aria-label="Send">${ICON.send}</button>
      </form>
      <p class="lhc-fine">The AI can get things wrong. Check the record book for anything that matters.</p>`;
    document.body.appendChild(panel);

    const log = panel.querySelector(".lhc-log");
    const body = panel.querySelector(".lhc-body");
    const form = panel.querySelector(".lhc-compose");
    const input = form.querySelector("textarea");
    const send = form.querySelector(".lhc-send");

    const scrollDown = (smooth = true) => {
      body.scrollTo({ top: body.scrollHeight, behavior: smooth && !REDUCE.matches ? "smooth" : "auto" });
    };
    const nearBottom = () => body.scrollHeight - body.scrollTop - body.clientHeight < 120;

    function open() {
      if (opened) return;
      opened = true;
      draw();
      panel.hidden = false;
      fab.setAttribute("aria-expanded", "true");
      document.documentElement.classList.add("lhc-open");
      // Grows out of the button.
      const r = fab.getBoundingClientRect();
      panel.style.setProperty("--from-x", `${r.left + r.width / 2}px`);
      panel.style.setProperty("--from-y", `${r.top + r.height / 2}px`);
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add("open")));
      if (pro()) digest(); // start reading the league while they type
      setTimeout(() => { if (pro() && !PHONE.matches) input.focus({ preventScroll: true }); if (shown.length) scrollDown(false); }, 60);
    }
    function close() {
      if (!opened) return;
      opened = false;
      panel.classList.remove("open");
      fab.setAttribute("aria-expanded", "false");
      document.documentElement.classList.remove("lhc-open");
      const done = () => { if (!opened) panel.hidden = true; };
      if (REDUCE.matches) done(); else setTimeout(done, 380);
      fab.focus({ preventScroll: true });
    }
    fab.addEventListener("click", () => (opened ? close() : open()));
    panel.querySelector('[data-act="close"]').addEventListener("click", close);
    panel.querySelector('[data-act="fresh"]').addEventListener("click", () => {
      if (busy) busy.abort();
      history = [];
      shown = [];
      save();
      draw();
      input.focus({ preventScroll: true });
    });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    /* ---- drawing ---- */
    function bubble(m, i) {
      if (m.role === "user") return `<div class="lhc-msg lhc-user" style="--i:${i}"><div class="lhc-bubble">${esc(m.text)}</div></div>`;
      return `<div class="lhc-msg lhc-ai" style="--i:${i}">
        <span class="lhc-ai-mark" aria-hidden="true">${ICON.spark}</span>
        <div class="lhc-bubble${m.error ? " lhc-bubble-error" : ""}">${m.error ? `<p>${esc(m.text)}</p>${m.retry ? '<button type="button" class="lhc-retry" data-act="retry">Try again</button>' : ""}` : markdown(m.text)}</div>
      </div>`;
    }

    function welcome() {
      return `<div class="lhc-welcome">
        <div class="lhc-orb" aria-hidden="true">
          <span class="lhc-orb-ball">${ICON.ball}</span>
          <span class="lhc-orbit"><i></i><i></i><i></i></span>
        </div>
        <h3>Ask me anything about ${esc(model.name)}</h3>
        <p>Every season, game, trade, draft and box score in the league's history. Rivalries, records, who choked, who got fleeced.</p>
        <div class="lhc-chips">${suggestions(model).map((q, i) => `<button type="button" class="lhc-chip" style="--i:${i}" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      </div>`;
    }

    function paywall() {
      return `<div class="lhc-locked">
        <div class="lhc-teaser" aria-hidden="true">
          <div class="lhc-msg lhc-user"><div class="lhc-bubble">Who has the most titles?</div></div>
          <div class="lhc-msg lhc-ai"><span class="lhc-ai-mark">${ICON.spark}</span><div class="lhc-bubble"><span class="lhc-skel" style="width:88%"></span><span class="lhc-skel" style="width:72%"></span><span class="lhc-skel" style="width:54%"></span></div></div>
          <div class="lhc-msg lhc-user"><div class="lhc-bubble">Worst trade ever?</div></div>
          <div class="lhc-msg lhc-ai"><span class="lhc-ai-mark">${ICON.spark}</span><div class="lhc-bubble"><span class="lhc-skel" style="width:80%"></span><span class="lhc-skel" style="width:62%"></span></div></div>
        </div>
        <div class="lhc-lock-card">
          <span class="lhc-lock-icon">${ICON.lock}</span>
          <span class="lhc-lock-kicker">League History Pro</span>
          <h3>Your league's own AI historian</h3>
          <p>Ask anything about ${esc(model.name)} and get the answer in seconds, straight from every season you've played.</p>
          <ul>
            <li style="--i:0">${ICON.check}Records, rivalries and head-to-head</li>
            <li style="--i:1">${ICON.check}Every trade, draft and waiver pickup</li>
            <li style="--i:2">${ICON.check}Box scores and player histories</li>
            <li style="--i:3">${ICON.check}Plus unlimited leagues and no ads</li>
          </ul>
          <button type="button" class="lhc-upgrade" data-act="upgrade"><span>Go Pro · ${esc(PRO_PRICE)}</span></button>
          <span class="lhc-lock-fine">Cancel any time.</span>
        </div>
      </div>`;
    }

    function draw() {
      panel.classList.toggle("is-locked", !pro());
      if (!pro()) {
        log.innerHTML = paywall();
        log.querySelector('[data-act="upgrade"]').addEventListener("click", () => window.Account && window.Account.upgrade());
        form.hidden = true;
        panel.querySelector(".lhc-fine").hidden = true;
        panel.querySelector('[data-act="fresh"]').hidden = true;
        return;
      }
      form.hidden = false;
      panel.querySelector(".lhc-fine").hidden = false;
      panel.querySelector('[data-act="fresh"]').hidden = !shown.length;
      log.innerHTML = shown.length ? shown.map(bubble).join("") : welcome();
      if (!ENDPOINT && !shown.length) {
        log.insertAdjacentHTML("beforeend", `<div class="lhc-note">${window.Account && window.Account.mode === "preview"
          ? "Preview mode: the league AI isn't connected yet. Set <code>AI_CHAT_URL</code> in account-config.js (or connect Supabase) and deploy <code>supabase/functions/league-chat</code>."
          : "The league AI isn't switched on for this site yet."}</div>`);
      }
      log.querySelectorAll(".lhc-chip").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));
      const retry = log.querySelector('[data-act="retry"]');
      if (retry) retry.addEventListener("click", () => {
        const last = shown.length >= 2 && shown[shown.length - 2].role === "user" ? shown[shown.length - 2].text : null;
        if (!last) return;
        shown = shown.slice(0, -2);
        ask(last);
      });
      if (shown.length >= MAX_TURNS / 2 || history.length >= MAX_TURNS) {
        log.insertAdjacentHTML("beforeend", '<div class="lhc-note">This chat is getting long. Start a new one (↻ above) to keep going.</div>');
      }
      updateSend();
    }

    function updateSend() {
      const full = history.length >= MAX_TURNS;
      send.classList.toggle("is-stop", Boolean(busy));
      send.innerHTML = busy ? ICON.stop : ICON.send;
      send.setAttribute("aria-label", busy ? "Stop" : "Send");
      send.disabled = !busy && (!input.value.trim() || full);
      input.disabled = full && !busy;
    }

    const autosize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    };
    input.addEventListener("input", () => { autosize(); updateSend(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) { busy.abort(); return; }
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      autosize();
      ask(q);
    });

    /* ---- asking ---- */
    async function ask(question) {
      if (busy || !pro() || history.length >= MAX_TURNS) return;
      const mark = history.length;
      const markShown = shown.length;
      history.push({ role: "user", content: question });
      shown.push({ role: "user", text: question });
      if (log.querySelector(".lhc-welcome, .lhc-note")) log.innerHTML = shown.slice(0, -1).map(bubble).join("");
      panel.querySelector('[data-act="fresh"]').hidden = false;
      log.insertAdjacentHTML("beforeend", bubble(shown[shown.length - 1], 0));

      // The answer's bubble: a status line while it works, then the words.
      log.insertAdjacentHTML("beforeend", `<div class="lhc-msg lhc-ai is-working">
        <span class="lhc-ai-mark" aria-hidden="true">${ICON.spark}</span>
        <div class="lhc-bubble"><div class="lhc-status"><span class="lhc-dots"><i></i><i></i><i></i></span><span class="lhc-status-text">${WORKING.start[0]}…</span></div><div class="lhc-answer"></div></div>
      </div>`);
      const msgEl = log.lastElementChild;
      const statusEl = msgEl.querySelector(".lhc-status-text");
      const answerEl = msgEl.querySelector(".lhc-answer");
      scrollDown();

      let text = "";
      let frame = 0;
      const paint = () => {
        frame = 0;
        const follow = nearBottom();
        answerEl.innerHTML = markdown(text) + '<span class="lhc-caret" aria-hidden="true"></span>';
        msgEl.classList.toggle("has-text", Boolean(text));
        if (follow) scrollDown(false);
      };
      const setStatus = (words) => {
        if (statusEl.textContent === `${words}…`) return;
        statusEl.textContent = `${words}…`;
        statusEl.classList.remove("swap");
        void statusEl.offsetWidth; // restart the fade
        statusEl.classList.add("swap");
      };
      let tick = 0;
      const cycler = setInterval(() => { if (!text) setStatus(WORKING.start[++tick % WORKING.start.length]); }, 2600);

      busy = new AbortController();
      updateSend();
      try {
        const leagueText = await digest();
        for (let round = 0; ; round++) {
          if (round > MAX_TOOL_ROUNDS) throw new ChatError("That one needed too many look-ups. Try asking it more narrowly.", "too_many_steps");
          if (text && !/\n\n$/.test(text)) text += "\n\n";
          const done = await post({ league: model.name, digest: leagueText, messages: history }, busy.signal, (event) => {
            if (event.t === "text") {
              text += event.d;
              if (!frame) frame = requestAnimationFrame(paint);
            } else if (event.t === "tool") {
              setStatus(WORKING[event.name] || "Looking it up");
              msgEl.classList.add("is-looking");
            }
          });
          if (done.stop === "refusal") throw new ChatError("The league AI won't answer that one. Try asking another way.", "refusal");
          // An empty turn can't be sent back next time; it stands as a line.
          const content = Array.isArray(done.content) && done.content.length ? done.content
            : [{ type: "text", text: "I couldn't find an answer to that." }];
          const uses = content.filter((b) => b.type === "tool_use");
          if (done.stop === "max_tokens" && uses.length) throw new ChatError("That answer ran too long. Try asking something narrower.", "max_tokens");
          history.push({ role: "assistant", content });
          if (done.stop !== "tool_use" || !uses.length) break;
          // The AI asked for detail: work it out here and send it back,
          // every result in one turn.
          msgEl.classList.add("is-looking");
          const results = await Promise.all(uses.map(async (u) => {
            try {
              const out = await tools[u.name](checkInput(u.name, u.input));
              return { type: "tool_result", tool_use_id: u.id, content: String(out).slice(0, 40000) };
            } catch (err) {
              const known = err instanceof ToolError;
              if (!known) console.warn("Ask the League tool:", u.name, err);
              return { type: "tool_result", tool_use_id: u.id, is_error: true, content: known ? err.message : "That couldn't be worked out from the data here." };
            }
          }));
          history.push({ role: "user", content: results });
          msgEl.classList.remove("is-looking");
          setStatus("Writing it up");
        }
        if (frame) cancelAnimationFrame(frame);
        clearInterval(cycler);
        const final = text.trim() || "I couldn't find an answer to that in the league's history.";
        shown.push({ role: "assistant", text: final });
        save();
        msgEl.classList.remove("is-working", "is-looking");
        msgEl.classList.add("is-done");
        answerEl.innerHTML = markdown(final);
        msgEl.querySelector(".lhc-status").remove();
      } catch (err) {
        if (frame) cancelAnimationFrame(frame);
        clearInterval(cycler);
        // The question and anything after it come off the conversation, so
        // the next one starts clean.
        history.length = mark;
        const stopped = err.name === "AbortError";
        if (stopped) {
          // What was written so far stays on screen, marked as stopped; the
          // AI won't see it.
          shown.length = markShown;
          if (text.trim()) shown.push({ role: "user", text: question }, { role: "assistant", text: `${text.trim()}\n\n*(stopped)*` });
        } else {
          if (err.code === "pro_required") { window.Account && window.Account.ready.then(() => draw()); }
          const message = err.code === "not_set_up"
            ? (window.Account && window.Account.mode === "preview"
              ? "Preview mode: the league AI isn't connected yet. Set AI_CHAT_URL in account-config.js (or connect Supabase) and deploy supabase/functions/league-chat."
              : "The league AI isn't switched on for this site yet.")
            : err.message || "Something went wrong. Try again.";
          shown.push({ role: "assistant", text: message, error: true, retry: !["not_set_up", "not_set_up_upstream", "pro_required", "daily_limit"].includes(err.code) });
        }
        save();
        draw();
        scrollDown();
      } finally {
        busy = null;
        updateSend();
        if (opened && !PHONE.matches) input.focus({ preventScroll: true });
      }
    }

    // A plan change (upgrading, or preview's switch) redraws both.
    if (window.Account && window.Account.on) window.Account.on(() => { drawFab(); if (opened && !busy) draw(); });
    // A chat already under way on another page opens where it left off.
    if (shown.length && sessionStorage.getItem(`${leagueKey}:open`) === "1") open();
    addEventListener("pagehide", () => {
      try { sessionStorage.setItem(`${leagueKey}:open`, opened ? "1" : "0"); } catch (err) { /* blocked */ }
    });
  }

  function start() {
    if (!window.League || !window.League.leagueId || document.querySelector(".lhc-fab")) return;
    // The page has asked for its league by now; this waits on the same load
    // (and on the account gate inside it).
    window.League.load(window.League.leagueId).then(mount).catch(() => { /* the page says why */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0));
  else setTimeout(start, 0);

  // For tests and the curious: the text the AI is given about a league.
  window.LeagueChat = { digestOf, toolkit, markdown };
})();
