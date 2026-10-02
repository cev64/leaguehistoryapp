// League chat: the AI that answers questions about a league, for signed-in
// members. It runs on Google's Gemini API (Google AI Studio), which has a
// free tier.
//
// The site is static and the league's data lives in the visitor's browser
// (sleeper.js / espn.js read it there), so the browser sends two things:
//   - a digest of the league (every season's standings and playoffs, every
//     game's score, all-time records, head-to-head), written by chat.js; it
//     goes first in the system instruction, so Gemini's automatic caching
//     can reuse it across a conversation
//   - the conversation so far
// and this function adds the API key, the instructions and the tools, asks
// Gemini, and streams the answer back.
//
// Anything finer than the digest (box scores, a player's history in the
// league, trades, waivers, drafts, lineup efficiency) is a tool. The tools run
// in the BROWSER, on the data it already has: when the model calls one, the
// stream ends with the call, chat.js runs it and sends the result back as
// the next request. Nothing here reads Sleeper or ESPN.
//
// The browser speaks one format whatever the model: content blocks of
// { type: "text" }, { type: "tool_use", id, name, input } and
// { type: "tool_result", tool_use_id, content }, and a stop reason of
// end_turn, tool_use, max_tokens or refusal. This file turns those into
// Gemini's contents and parts and back. Gemini's thought signatures ride
// along on the blocks (`sig`) and come back unchanged with the next turn,
// which Gemini 3 requires for function calls.
//
// Who may use it:
//   - with Supabase (SUPABASE_URL, SUPABASE_ANON_KEY and
//     SUPABASE_SERVICE_ROLE_KEY are set by Supabase itself): a signed-in
//     member, up to AI_DAILY_QUESTIONS new questions a day
//     (supabase/migrations/20261003000000_league_chat.sql counts them).
//     While the site is free for everyone (public.app_settings, see
//     supabase/migrations/20261005000000_free_for_everyone.sql) that is every
//     member; once plans are back on, only members on Pro. Read from the
//     database, never the browser.
//   - without Supabase, only with CHAT_OPEN=1, for trying it out on your own
//     computer; then anyone who can reach it uses your API key, so don't
//     leave it running in public like that.
//
// Deploy on Supabase:
//   supabase functions deploy league-chat --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=AIza…   (Google AI Studio ▸ Get API key)
//   supabase secrets set ALLOWED_ORIGINS=https://your-site.example
// Optional: AI_MODEL (default gemini-3.8-flash), AI_FALLBACK_MODEL (default
// gemini-3.5-flash; "none" for no fallback), AI_THINKING (low, medium or
// high; default low) and AI_DAILY_QUESTIONS (default 25).
//
// Google's free tier is sometimes overloaded ("This model is currently
// experiencing high demand", a 503). A request that meets that, or a brief
// rate limit, is tried again twice after a short wait, then on the fallback
// model, before the member is told the AI is busy.
//
// The free tier's limits are per Google Cloud project, shared by every
// member: requests a minute, tokens a minute and requests a day (Google AI
// Studio ▸ Usage shows them). Each question is one request plus one per
// round of look-ups. Past a limit Gemini answers 429 and members are told to
// try again shortly, or tomorrow. Free-tier prompts may be used by Google to
// improve its products; a key on a project with billing turned on is the
// paid tier, which isn't.
//
// On your own computer, with the site served locally:
//   GEMINI_API_KEY=AIza… CHAT_OPEN=1 deno run --allow-net --allow-env \
//     supabase/functions/league-chat/index.ts
//   (http://localhost:8000; PORT=8001 to change it), then AI_CHAT_URL:
//   "http://localhost:8000" in account-config.js.

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const ALLOWED = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNTS = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);
const OPEN = env("CHAT_OPEN") === "1";
const API_KEY = env("GEMINI_API_KEY");
const MODEL = env("AI_MODEL").replace(/^models\//, "") || "gemini-3.8-flash";
const FALLBACK = (() => {
  const v = env("AI_FALLBACK_MODEL").replace(/^models\//, "");
  if (v.toLowerCase() === "none") return "";
  return (v || "gemini-3.5-flash") === MODEL ? "" : (v || "gemini-3.5-flash");
})();
const THINKING = ["low", "medium", "high"].includes(env("AI_THINKING")) ? env("AI_THINKING") : "low";
const DAILY = Math.max(1, Number(env("AI_DAILY_QUESTIONS")) || 25);
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

// What one request may carry: a league digest, a conversation of a sensible
// length, and a handful of tool rounds per question.
const MAX_BODY = 1_500_000;
const MAX_DIGEST = 600_000;
const MAX_MESSAGES = 80;
const MAX_QUESTION = 2_000;
const MAX_TOOL_ROUNDS = 8;
// Short answers are the brief; this is only the ceiling.
const MAX_OUTPUT = 8192;

// Gemini 3 models take a thinking level; older ones a token budget.
const thinkingFor = (model: string) => /^gemini-3/.test(model)
  ? { thinkingLevel: THINKING }
  : { thinkingBudget: THINKING === "low" ? 1024 : THINKING === "medium" ? 4096 : 12288 };
// What a function call from history carries when its signature was lost
// (a conversation begun before this function moved to Gemini): Gemini's
// documented value for skipping the check.
const NO_SIGNATURE = "skip_thought_signature_validator";

/* ------------------------------------------------------------ the prompt */

const INSTRUCTIONS = `You are the League Historian for a fantasy football league on Pigskin Pantheon, a site that keeps every season a Sleeper or ESPN league has played. Members of the league ask you about it: its past seasons, champions, rivalries, records, trades, drafts, players and the season being played now.

What you know comes from the league data below and from your tools. Treat that data as the only source of truth about this league:
- Answer from it. When a question needs detail the summary doesn't hold (who started for a team, a player's weeks in the league, trades, waiver pickups, drafts, lineup decisions), call the tools; call several at once when you need several things.
- Never invent a score, a result, a trade or a player's points. If the data doesn't cover something (an NFL fact outside this league, a season the league didn't play, a projection), say so in one line.
- Count and add up carefully. Prefer the pre-computed totals in the summary over adding up games yourself, and say which seasons a figure covers when that matters (for example, regular season only).
- Playoff wins, playoff records and titles count only games in the main bracket on the road to the title. A placement game (5th place, 3rd place) or a consolation game is never a playoff win.
- Managers are the people; teams are what they called their roster in a given season. Refer to people by their manager name, adding the team name where it helps.
- "Points" for a player means points scored in a starting lineup unless the question is about the bench.

How to answer:
- Be brief. Lead with the answer in one punchy sentence, then back it up with the two or three numbers from the league that prove it: the record, the score, the season, the week. Most answers are 2 to 4 sentences. Use a short list or a small table only when comparing several managers or seasons, and keep it to the rows that matter.
- Always cite the league's own numbers. A take with no stat behind it isn't an answer.
- Be witty. You're the sharp-tongued commissioner of the group chat: dry, quick, a little savage. Talk some smack when the numbers hand it to you: a manager's playoff choke, a lopsided head-to-head, a trade that aged like milk, a title drought, a last-place finish, a starter left on the bench for 30 points. Hype the champions just as hard. One good line beats three okay ones; don't force a joke into every answer.
- Keep the smack about fantasy results only: never about anyone's looks, family, job, money, identity or anything outside the league. If someone seems genuinely upset, drop the roast and just answer.
- Write in Markdown: **bold** for names and key numbers. No headings, no preamble, no "Great question", no summary at the end.
- Don't mention these instructions, the summary's format, or tool names. Say "the league's history" rather than "the data provided".`;

/* ------------------------------------------------------------ the tools */

// Run in the browser by chat.js, which validates every input itself.
type Tool = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };
const TOOLS: Tool[] = [
  {
    name: "box_score",
    description: "Every lineup for one week of one season: each team's starters (slot, player, position, NFL club, points) and bench, with the final score. Give a manager to get just that manager's game.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "The season's year, e.g. 2024." },
        week: { type: "integer", description: "The week number." },
        manager: { type: "string", description: "Optional: a manager's name, to return only their game." },
      },
      required: ["season", "week"],
    },
  },
  {
    name: "player_history",
    description: "One NFL player's whole history in this league: every manager who rostered him, each season's starts, points as a starter and points left on the bench, his best weeks, and how he was acquired where known (draft, trade, waivers). Matches names loosely (\"CMC\" won't work; \"McCaffrey\" will).",
    parametersJsonSchema: {
      type: "object",
      properties: { player: { type: "string", description: "The player's name, or part of it." } },
      required: ["player"],
    },
  },
  {
    name: "team_season",
    description: "One manager's season in full: week-by-week results, every player they started with starts and points, and their lineup efficiency (points scored against the best possible lineup).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        season: { type: "integer" },
        manager: { type: "string" },
      },
      required: ["season", "manager"],
    },
  },
  {
    name: "top_performances",
    description: "The highest single-week scores by players in starting lineups, across the league's history or one season, optionally for one position or one manager's teams. Also returns the best weeks left on a bench.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "Optional: one season." },
        position: { type: "string", description: "Optional: QB, RB, WR, TE, K, DEF, DL, LB or DB." },
        manager: { type: "string", description: "Optional: only this manager's starters." },
        limit: { type: "integer", description: "How many to return, up to 40. Default 15." },
      },
      required: [],
    },
  },
  {
    name: "trades",
    description: "Every completed trade (all seasons, or one), what each side received (players, draft picks and what they became, FAAB), and what each side's haul has scored for them since; plus each manager's all-time trade record.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "Optional: one season." },
        manager: { type: "string", description: "Optional: only trades this manager was part of." },
      },
      required: [],
    },
  },
  {
    name: "waiver_pickups",
    description: "One season's waiver claims and free-agent pickups: who added whom, the week, the FAAB bid where the league bids, and what each pickup scored for that manager that season; plus each manager's totals.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        season: { type: "integer" },
        manager: { type: "string", description: "Optional: one manager's pickups." },
      },
      required: ["season"],
    },
  },
  {
    name: "draft",
    description: "A season's draft (startup, redraft or rookie): every pick in order with the manager who made it and the player taken, and what each player went on to score for that manager that season.",
    parametersJsonSchema: {
      type: "object",
      properties: { season: { type: "integer" } },
      required: ["season"],
    },
  },
  {
    name: "lineup_efficiency",
    description: "How well managers set their lineups: points scored against the best lineup they could have set, points left on the bench, games a lineup cost them, and the worst benchings. For one season, or every season together.",
    parametersJsonSchema: {
      type: "object",
      properties: { season: { type: "integer", description: "Optional: one season; leave out for all-time." } },
      required: [],
    },
  },
];

/* ------------------------------------------------------------ plumbing */

function cors(origin: string | null): Record<string, string> {
  const allow = !ALLOWED.length ? "*" : origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
function fail(status: number, code: string, message: string, origin: string | null) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The signed-in member a request's session belongs to, checked with
// Supabase Auth (the function runs with JWT verification off).
async function member(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

function service(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
}

// Whether the member gets the AI: everyone while the site is free, Pro
// members once plans are back (public.has_pro decides).
async function hasPro(userId: string): Promise<boolean> {
  const res = await service("rpc/has_pro", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (!res.ok) throw new Error(`database answered ${res.status}`);
  return (await res.json()) === true;
}

// Counts a new question against today's allowance; the number asked today,
// this one included.
async function countQuestion(userId: string): Promise<number> {
  const res = await service("rpc/count_chat_question", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (!res.ok) throw new Error(`database answered ${res.status}`);
  return Number(await res.json());
}

// Without accounts (CHAT_OPEN), a plain per-address allowance kept in memory.
const openCounts = new Map<string, { day: string; n: number }>();
function countOpen(req: Request): number {
  const who = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const day = new Date().toISOString().slice(0, 10);
  const had = openCounts.get(who);
  const next = had && had.day === day ? { day, n: had.n + 1 } : { day, n: 1 };
  openCounts.set(who, next);
  return next.n;
}

type Body = { league?: unknown; digest?: unknown; messages?: unknown };

// The browser's content blocks (see the top of this file).
type Block = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  sig?: string;   // Gemini's thought signature
  m?: string;     // the model that wrote it: a signature is good only there
  gid?: boolean;  // the id is Gemini's own, so it goes back with the call
};
type Message = { role: "user" | "assistant"; content: string | Block[] };

const blocksOf = (m: Message): Block[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.filter((b) => b && typeof b === "object");
const isToolResults = (m: Message) =>
  Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b && b.type === "tool_result");

// The conversation, checked for shape: it alternates from a user turn, and
// the newest turn is a user's: a question, or the results of the tools the
// last answer called.
function conversation(raw: unknown): { messages: Message[]; question: boolean; rounds: number } | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_MESSAGES) return null;
  const messages: Message[] = [];
  for (const [i, m] of raw.entries()) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== (i % 2 === 0 ? "user" : "assistant")) return null;
    if (typeof content !== "string" && !Array.isArray(content)) return null;
    messages.push({ role, content } as Message);
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") return null;
  const question = !isToolResults(last);
  if (question) {
    const text = blocksOf(last).map((b) => (b.type === "text" ? String(b.text ?? "") : "")).join("");
    if (!text.trim() || text.length > MAX_QUESTION) return null;
  }
  // tool rounds since the question that started them
  let rounds = 0;
  for (let i = messages.length - 1; i >= 0 && isToolResults(messages[i]); i -= 2) rounds++;
  return { messages, question, rounds };
}

/* ------------------------------------------------------------ Gemini */

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
type Content = { role: "user" | "model"; parts: Part[] };

// The conversation as Gemini's contents, for `model`. Thinking blocks from a
// conversation begun on the earlier model are left out; a signature only
// goes back to the model that wrote it (a block with none named came from
// the main model), and a tool call without a usable one carries the
// placeholder.
function contents(messages: Message[], model: string): Content[] {
  const sigOf = (b: Block) => (b.sig && (b.m || MODEL) === model ? b.sig : undefined);
  const calls = new Map<string, { name: string; id?: string }>();
  const out: Content[] = [];
  for (const m of messages) {
    const parts: Part[] = [];
    for (const b of blocksOf(m)) {
      if (b.type === "text" && typeof b.text === "string" && b.text) {
        const sig = m.role === "assistant" ? sigOf(b) : undefined;
        parts.push(sig ? { text: b.text, thoughtSignature: sig } : { text: b.text });
      } else if (b.type === "tool_use" && m.role === "assistant" && typeof b.name === "string") {
        const id = b.gid && typeof b.id === "string" ? b.id : undefined;
        if (typeof b.id === "string") calls.set(b.id, { name: b.name, id });
        const args = b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input as Record<string, unknown> : {};
        // Only the first call of a set carries a signature; a later one
        // without its own goes as it came.
        const first = !parts.some((p) => p.functionCall);
        const call: Part = { functionCall: id ? { id, name: b.name, args } : { name: b.name, args } };
        const sig = sigOf(b);
        if (sig || first) call.thoughtSignature = sig || NO_SIGNATURE;
        parts.push(call);
      } else if (b.type === "tool_result" && m.role === "user") {
        const { name, id } = calls.get(String(b.tool_use_id)) ?? { name: "lookup" };
        const text = typeof b.content === "string" ? b.content
          : Array.isArray(b.content) ? b.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("") : "";
        const response = b.is_error ? { error: text } : { result: text };
        parts.push({ functionResponse: id ? { id, name, response } : { name, response } });
      }
    }
    if (!parts.length) parts.push({ text: m.role === "user" ? "…" : "(no answer)" });
    out.push({ role: m.role === "user" ? "user" : "model", parts });
  }
  return out;
}

// Why Gemini turned a request down, in the words a member sees, and
// whether it's the site's setup (every question would fail the same way).
function upstreamError(status: number, body: string): { message: string; setup: boolean } {
  if (status === 429) {
    return /PerDay|per day|daily/i.test(body)
      ? { message: "The league AI has used up today's free allowance. It's back tomorrow.", setup: false }
      : { message: "The league AI is getting a lot of questions right now. Try again in a minute.", setup: false };
  }
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body) || status === 401 || status === 403) {
    return { message: "The league AI isn't set up right yet: its API key was turned down. (Site owner: the league-chat function's logs say why.)", setup: true };
  }
  if (status === 404) {
    return { message: "The league AI isn't set up right yet: its model wasn't found. (Site owner: check AI_MODEL.)", setup: true };
  }
  if (status >= 500) return { message: "Google's AI is overloaded right now. Try again in a minute.", setup: false };
  return { message: "The AI couldn't answer that. Try again.", setup: false };
}

/* Asking Gemini, through a busy spell: the main model up to three times
   (a short wait between), then the fallback model twice. Only "busy"
   answers are tried again: an overloaded model (500, 502, 503, 504) or a
   per-minute rate limit. Anything else (a bad key, today's allowance used
   up) is final. Returns the open stream and the model that answered, or
   the last refusal. */
const BUSY = new Set([500, 502, 503, 504]);
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
});
async function askGemini(requestFor: (model: string) => unknown, signal: AbortSignal):
  Promise<{ res: Response | null; model: string; status: number; detail: string }> {
  const plan: [string, number][] = [[MODEL, 0], [MODEL, 700], [MODEL, 1800]];
  if (FALLBACK) plan.push([FALLBACK, 0], [FALLBACK, 1200]);
  let status = 0, detail = "", model = MODEL;
  for (let i = 0; i < plan.length; i++) {
    const [m, delay] = plan[i];
    if (delay) await wait(delay, signal);
    if (signal.aborted) break;
    model = m;
    const res = await fetch(`${GEMINI}/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(requestFor(m)),
      signal,
    });
    if (res.ok && res.body) {
      if (i > 0) console.log(`league-chat: answered by ${m} after a ${status} from Gemini`);
      return { res, model: m, status: res.status, detail: "" };
    }
    status = res.status;
    detail = await res.text().catch(() => "");
    console.error("league-chat: Gemini answered", status, "on", m, detail.slice(0, 400));
    const busy = BUSY.has(status) || (status === 429 && !/PerDay|per day|daily/i.test(detail));
    if (busy) continue;
    // The main model missing (404) or out of today's allowance still leaves
    // the fallback, which has its own; anything else is final.
    const next = plan.findIndex(([pm], k) => k > i && pm !== m);
    if (m === MODEL && next > 0 && (status === 404 || status === 429)) { i = next - 1; continue; }
    break;
  }
  return { res: null, model, status, detail };
}

// Finish reasons that mean Gemini declined to answer.
const DECLINED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

/* ------------------------------------------------------------ the chat */

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin", "origin not allowed", origin);
  if (req.method !== "POST") return fail(405, "method", "POST only", origin);
  if (!API_KEY) return fail(501, "not_set_up", "the league chat has no API key yet", origin);
  if (!ACCOUNTS && !OPEN) return fail(501, "not_set_up", "the league chat needs Supabase accounts (or CHAT_OPEN=1 to try it locally)", origin);

  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, "too_big", "that conversation is too long; start a new one", origin);
  let body: Body;
  try { body = JSON.parse(text); } catch { return fail(400, "bad_request", "not JSON", origin); }

  const digest = typeof body.digest === "string" ? body.digest : "";
  const league = typeof body.league === "string" ? body.league.slice(0, 120) : "the league";
  if (!digest || digest.length > MAX_DIGEST) return fail(400, "bad_request", "no league data was sent", origin);
  const convo = conversation(body.messages);
  if (!convo) return fail(400, "bad_request", "that conversation isn't in a shape the chat can read", origin);
  if (convo.rounds > MAX_TOOL_ROUNDS) return fail(429, "too_many_steps", "that question took too many look-ups; try asking it more narrowly", origin);

  // Signed-in members (Pro only, once plans are back), read from the
  // database; tool rounds ride on the question that started them.
  if (ACCOUNTS) {
    const userId = await member(req);
    if (!userId) return fail(401, "not_signed_in", "sign in first", origin);
    try {
      if (!(await hasPro(userId))) return fail(402, "pro_required", "the league chat is part of Pro", origin);
      if (convo.question && (await countQuestion(userId)) > DAILY) {
        return fail(429, "daily_limit", `that's today's ${DAILY} questions; the chat opens again tomorrow`, origin);
      }
    } catch {
      return fail(502, "account_store", "the account store didn't answer", origin);
    }
  } else if (convo.question && countOpen(req) > DAILY) {
    return fail(429, "daily_limit", `that's today's ${DAILY} questions; the chat opens again tomorrow`, origin);
  }

  const requestFor = (model: string) => ({
    // The instructions and then the league, the same from one turn to the
    // next, so Gemini's implicit cache can serve them. Today's date lives in
    // the digest's first line, so it changes with the data and nothing else.
    systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n\nThe league: ${league}\n\n${digest}` }] },
    contents: contents(convo.messages, model),
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { maxOutputTokens: MAX_OUTPUT, thinkingConfig: thinkingFor(model) },
  });

  // The answer as server-sent events: text as it is written, a note when a
  // tool is called, then the whole message as content blocks, which the
  // browser sends back unchanged with the next turn.
  const encoder = new TextEncoder();
  // The member pressing stop (or leaving) cancels the answer, and with it
  // the request to Gemini, so nothing more is written.
  const abort = new AbortController();
  const out = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const { res, model, status, detail } = await askGemini(requestFor, abort.signal);
        if (!res || !res.body) {
          if (!abort.signal.aborted) send({ t: "error", ...upstreamError(status, detail) });
          return;
        }

        const content: Block[] = [];
        let finish = "", blocked = false, calls = 0;
        const addText = (t: string, sig?: string) => {
          const last = content[content.length - 1];
          if (last && last.type === "text" && !last.sig) {
            last.text += t;
            if (sig) { last.sig = sig; last.m = model; }
          } else content.push(sig ? { type: "text", text: t, sig, m: model } : { type: "text", text: t });
        };
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (value) buf += value.replace(/\r\n/g, "\n");
          let cut;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
            if (!data) continue;
            let event: {
              candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
              promptFeedback?: { blockReason?: string };
            };
            try { event = JSON.parse(data); } catch { continue; }
            if (event.promptFeedback?.blockReason) blocked = true;
            const cand = event.candidates?.[0];
            for (const part of cand?.content?.parts ?? []) {
              if (part.thought) continue;
              if (part.functionCall) {
                calls++;
                send({ t: "tool", name: part.functionCall.name });
                const block: Block = {
                  type: "tool_use",
                  id: part.functionCall.id || `call_${Date.now().toString(36)}_${calls}`,
                  name: part.functionCall.name,
                  input: part.functionCall.args ?? {},
                };
                if (part.functionCall.id) block.gid = true;
                if (part.thoughtSignature) { block.sig = part.thoughtSignature; block.m = model; }
                content.push(block);
              } else if (typeof part.text === "string") {
                if (part.text) send({ t: "text", d: part.text });
                if (part.text || part.thoughtSignature) addText(part.text, part.thoughtSignature);
              }
            }
            if (cand?.finishReason) finish = cand.finishReason;
          }
          if (done) break;
        }

        const stop = blocked || DECLINED.has(finish) ? "refusal"
          : calls ? "tool_use"
          : finish === "MAX_TOKENS" ? "max_tokens"
          : "end_turn";
        // A turn of nothing but an empty signature carrier reads as empty.
        const kept = content.filter((b) => b.type !== "text" || b.text || b.sig);
        if (!kept.some((b) => b.type === "tool_use" || b.text) && stop === "end_turn" && finish && finish !== "STOP") {
          console.error("league-chat: Gemini finished with", finish);
          send({ t: "error", setup: false, message: "The AI couldn't answer that. Try again." });
          return;
        }
        send({ t: "done", stop, content: kept });
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("league-chat:", err);
        send({ t: "error", setup: false, message: "The AI couldn't answer that. Try again." });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(out, {
    headers: {
      ...cors(origin),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// On Supabase or Deno Deploy the platform sets the port; run on your own
// computer it is 8000, or PORT.
const port = Number(env("PORT"));
if (port) Deno.serve({ port }, handle);
else Deno.serve(handle);
