/* The app's side of the hidden web view that runs the site's own JavaScript.

   Loaded after account-config.js and before sleeper.js, so it can stand in
   for the browser pieces the app does natively:

     window.Account   the signed-in member, as account.js would expose it,
                      so espn.js can open private leagues with keys saved
                      to the account and chat.js can ask the league AI.
                      The app hands it the session (Bridge.setSession).

   and it opens window.Bridge, the namespace the app calls into. Every
   screen's bridge file (bridge-*.js) adds its own part: Bridge.season,
   Bridge.records, Bridge.office, Bridge.player, Bridge.chat... Each call
   the app makes is awaited and its answer sent back as JSON, so a bridge
   function returns plain data: no functions, no DOM, no cycles. */
(function () {
  "use strict";

  /* ------------------------------------------------------------ messages */

  function post(type, body) {
    try { window.webkit.messageHandlers.native.postMessage({ type, body }); } catch (err) { /* not in the app */ }
  }
  ["error", "warn"].forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      post("log", { level, text: args.map((a) => (a && a.stack) || (typeof a === "object" ? safeJSON(a) : String(a))).join(" ") });
    };
  });
  window.addEventListener("error", (e) => post("log", { level: "error", text: `${e.message} (${e.filename}:${e.lineno})` }));
  window.addEventListener("unhandledrejection", (e) => post("log", { level: "warn", text: `unhandled: ${(e.reason && e.reason.stack) || e.reason}` }));
  function safeJSON(v) { try { return JSON.stringify(v); } catch (err) { return String(v); } }

  /* ------------------------------------------------------------ players */

  /* The site's players file (data/players.json) is read from the site, as
     on the web, so it's never more than a day old. If the site can't be
     reached and nothing is cached yet (a first launch offline), the copy
     bundled with the app answers instead. */
  const nativeFetch = window.fetch.bind(window);
  const playersWaiters = [];
  function bundledPlayers() {
    return new Promise((resolve) => {
      playersWaiters.push(resolve);
      post("players", {});
    });
  }
  window.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : (input && input.url) || "";
    let isPlayers = false;
    try { isPlayers = new URL(raw, location.href).pathname.endsWith("/data/players.json"); } catch (err) { /* not a URL */ }
    if (!isPlayers) return nativeFetch(input, init);
    try {
      const res = await nativeFetch(input, init);
      if (res.ok) return res;
    } catch (err) { /* offline */ }
    const text = await bundledPlayers();
    return new Response(text || "{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  /* ------------------------------------------------------------ the member */

  let session = null;   // { accessToken, user: { id, email } }
  window.Account = {
    mode: "supabase",
    get user() { return session ? session.user : null; },
    ready: Promise.resolve(),
    accessToken: async () => {
      if (!session) throw new Error("Not signed in");
      return session.accessToken;
    },
    // No admit(): the app gates leagues itself, before it opens one.
  };

  /* ------------------------------------------------------------ the bridge */

  let model = null;
  const engines = new Map();

  /* A season for the app: everything the season carries except the raw
     matchups (box scores and player histories are asked for separately)
     and the scoring table. Results become objects, easier to read than
     Sleeper's [a, aScore, b, bScore] rows. */
  function seasonOut(s) {
    const { matchups, settings, results, ...rest } = s;
    const { scoring, weeksPerRound, ...set } = settings;
    const res = {};
    Object.keys(results).forEach((w) => {
      res[w] = results[w].map(([a, as, b, bs]) => ({ a, as, b, bs }));
    });
    return { ...rest, settings: set, results: res };
  }

  function summary(m) {
    return {
      leagueId: m.leagueId,
      name: m.name,
      avatar: m.avatar,
      platform: m.platform,
      demo: Boolean(m.demo),
      source: League.sourceName(m.leagueId),
      owners: m.owners,
      currentYear: m.current ? m.current.year : null,
      openingYear: m.opening ? m.opening.year : null,
      nflSeason: m.state ? Number(m.state.season) || null : null,
      nflWeek: m.state ? Number(m.state.week) || null : null,
      seasons: m.seasons.map(seasonOut),
    };
  }

  async function load() {
    model = await League.load(League.leagueId, {
      onProgress: (done, total) => post("progress", { done, total }),
    });
    return summary(model);
  }

  function requireModel() {
    if (!model) throw new Error("The league isn't loaded yet.");
    return model;
  }

  /* The season page's engine (season-engine.js) for a year, made once. */
  function seasonEngine(year) {
    const m = requireModel();
    const y = Number(year);
    if (!engines.has(y)) {
      const season = m.season(y);
      if (!season) throw new Error(`There is no ${y} season.`);
      engines.set(y, window.SeasonEngine(m, season));
    }
    return engines.get(y);
  }

  /* Player names for a list of ids, from the players file (or the
     platform's own players for ESPN). */
  async function playerNames(ids) {
    const db = await League.players();
    const out = {};
    (ids || []).forEach((pid) => {
      if (pid == null) return;
      const p = db[pid];
      out[pid] = p ? { name: p[0], pos: p[1], nfl: p[2] } : { name: /^[A-Z]{2,3}$/.test(pid) ? `${pid} D/ST` : `Player ${pid}`, pos: "?", nfl: "FA" };
    });
    return out;
  }

  window.Bridge = {
    post,
    load,
    model: requireModel,
    summary: () => summary(requireModel()),
    seasonEngine,
    playerNames,
    headshot: (h) => League.headshot(h),
    clubStyle: (abbr) => League.clubStyle(abbr),
    setSession(s) { session = s && s.accessToken ? s : null; return true; },
    // The app's answer to bundledPlayers().
    _players(text) { playersWaiters.splice(0).forEach((resolve) => resolve(text)); return true; },
    leagueData: () => requireModel().leagueData(),
  };
})();
