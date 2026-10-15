/* Bridge.chat: the league's half of Ask the League, for the app's chat
   screen (Features/Chat). The site's chat.js runs here unmodified but never
   mounts (the page's .lhc-fab stops it); it exports window.LeagueChat =
   { digestOf, toolkit, markdown }, and this file adds what the app needs
   around it. The conversation and the streaming request to the league-chat
   function are the app's (Swift, URLSession); this side writes the league
   out as text, offers the welcome's suggestions, and runs the AI's tools.

   SCHEMA / checkInput and suggestions are chat.js's own, copied verbatim:
   chat.js doesn't export them. Keep them in step with chat.js. */
(function () {
  "use strict";

  const B = window.Bridge;
  const CFG = window.ACCOUNT_CONFIG || {};
  const ENDPOINT = CFG.AI_CHAT_URL ||
    (CFG.SUPABASE_URL ? `${String(CFG.SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/league-chat` : "");

  const LC = () => {
    if (!window.LeagueChat) throw new Error("The league AI's script didn't load.");
    return window.LeagueChat;
  };

  /* ------------------------------------------------ chat.js, copied */

  function gamesOf(model) {
    const out = [];
    model.seasons.forEach((s) => {
      s.playedWeeks.forEach((w) => (s.results[w] || []).forEach(([a, aScore, b, bScore]) => {
        if (!s.teams[a] || !s.teams[b]) return;
        out.push({ year: s.year, week: w, a, b, aScore, bScore, aOwner: s.teams[a].ownerId, bOwner: s.teams[b].ownerId });
      }));
      s.postseason.filter((g) => g.played && g.a && g.b && s.teams[g.a] && s.teams[g.b]).forEach((g) => {
        out.push({ year: s.year, week: g.week, a: g.a, b: g.b, aScore: g.aScore, bScore: g.bScore,
          aOwner: s.teams[g.a].ownerId, bOwner: s.teams[g.b].ownerId });
      });
    });
    return out.sort((x, y) => x.year - y.year || x.week - y.week);
  }

  function suggestions(model) {
    const out = [];
    const finished = model.seasons.filter((s) => s.finished && s.champion);
    const live = model.seasons.find((s) => !s.finished && s.playedWeeks.length);
    const owners = Object.entries(model.owners);
    if (finished.length > 1) out.push("Who has won the most championships?");
    else if (finished.length) out.push(`How did ${model.owners[finished[0].teams[finished[0].champion].ownerId].name} win the ${finished[0].year} title?`);
    out.push("What's the highest score in league history?");
    if (owners.length >= 2) {
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

  class ToolError extends Error {}
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
  // chat.js's own ToolError (a different class) is known by its name.
  const isToolError = (err) => err instanceof ToolError || Boolean(err && err.constructor && err.constructor.name === "ToolError");

  /* ------------------------------------------------ per league */

  // One digest and one toolkit per model, as chat.js's mount() keeps them.
  let forModel = null, digestJob = null, tools = null;
  function league() {
    const model = B.model();
    if (forModel !== model) {
      forModel = model;
      digestJob = null;
      tools = null;
    }
    return model;
  }

  /* What the chat screen draws before anything is asked, and where it sends
     the questions. No plans or prices: the app sells nothing. */
  function intro() {
    const model = league();
    return {
      name: model.name,
      endpoint: ENDPOINT,
      anonKey: CFG.SUPABASE_ANON_KEY || null,
      suggestions: suggestions(model),
    };
  }

  /* The league as text, written once (the same on every turn). */
  function digest() {
    const model = league();
    if (!digestJob) digestJob = LC().digestOf(model).catch((err) => { digestJob = null; throw err; });
    return digestJob;
  }

  /* The tools the AI asked for, every result in one turn, as chat.js's ask
     loop sends them back. `uses` is the answer's tool_use blocks as JSON. */
  async function runTools(uses) {
    const model = league();
    if (!tools) tools = LC().toolkit(model);
    const list = typeof uses === "string" ? JSON.parse(uses) : uses;
    return Promise.all((list || []).map(async (u) => {
      try {
        const out = await tools[u.name](checkInput(u.name, u.input));
        return { type: "tool_result", tool_use_id: u.id, content: String(out).slice(0, 40000) };
      } catch (err) {
        const known = isToolError(err);
        if (!known) console.warn("Ask the League tool:", u.name, err);
        return { type: "tool_result", tool_use_id: u.id, is_error: true, content: known ? err.message : "That couldn't be worked out from the data here." };
      }
    }));
  }

  B.chat = { intro, digest, runTools };
})();
