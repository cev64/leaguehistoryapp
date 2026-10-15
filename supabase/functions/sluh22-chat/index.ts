// The SLUH 22 league chat: the AI behind "Ask the League" on the league's
// history site. It is the same chat as Pigskin Pantheon's league-chat
// (github.com/cev64/leaguehistoryapp, supabase/functions/league-chat), cut
// down for one league with no accounts. It runs on Claude Haiku 5.5, on
// Anthropic's API.
//
// The site is static (GitHub Pages) and the league lives in its own files
// (league-data.js, the season pages, boxscores/, drafts/), which the
// visitor's browser already reads. So the browser (chat.js) sends two things:
//   - a digest of the league (every season's standings and playoffs, every
//     game's score, all-time records, head-to-head); it goes first in the
//     system prompt and is cached, so a follow-up (or another member's
//     question within a few minutes) reads it at a tenth of the price
//   - the conversation so far
// and this function adds the API key, the instructions and the tools, asks
// Claude, and streams the answer back.
//
// Anything finer than the digest (box scores, a player's history in the
// league, drafts, keepers, roster moves, lineup efficiency, weekly recaps) is
// a tool. The tools run in the BROWSER, on the site's own files: when the
// model calls one, the stream ends with the call, chat.js runs it and sends
// the result back as the next request.
//
// The browser speaks Claude's own format: content blocks of
// { type: "text" }, { type: "tool_use", id, name, input },
// { type: "tool_result", tool_use_id, content } and the model's
// { type: "thinking" } blocks, and a stop reason of end_turn, tool_use,
// max_tokens or refusal. The thinking blocks come back unchanged with the
// tool results, which Claude needs to carry on from where it was.
//
// Who may use it. The site has no sign-in, so the key is guarded by:
//   - the site's address: only pages served from SLUH22_ALLOWED_ORIGINS
//     (default https://cev64.github.io) are answered, and a request with no
//     Origin at all (a script, not a browser) is turned away
//   - an optional league passcode: set SLUH22_PASSCODE and the chat asks for
//     it once per device before it answers
//   - daily allowances: SLUH22_DAILY_QUESTIONS new questions per visitor a
//     day (30 unless set) and SLUH22_LEAGUE_DAILY for everyone together (300
//     unless set). They are counted in public.sluh22_chat_usage
//     (supabase/migrations/20261005000000_sluh22_chat.sql) under a hash of
//     the visitor's address, never the address itself. Until that migration
//     is applied the counts are kept in memory instead, which is looser.
// Claude is billed per question; the daily allowances cap what a day can
// cost.
//
// Deploy on Supabase (the same project as Pigskin Pantheon is fine; every
// function in a project shares its secrets):
//   supabase functions deploy sluh22-chat --no-verify-jwt
//   supabase secrets set SLUH22_ANTHROPIC_API_KEY=sk-ant-…   (or the project's
//     ANTHROPIC_API_KEY)
//   supabase secrets set SLUH22_PASSCODE=…                   (optional)
// Optional: SLUH22_ALLOWED_ORIGINS, SLUH22_DAILY_QUESTIONS,
// SLUH22_LEAGUE_DAILY, SLUH22_CLAUDE_MODEL (default claude-haiku-5-5) and
// SLUH22_EFFORT (how hard it thinks: low, medium or high; default low, the
// quickest).
//
// On your own computer, with the site served locally:
//   SLUH22_ANTHROPIC_API_KEY=sk-ant-… CHAT_OPEN=1 deno run --allow-net --allow-env \
//     supabase/functions/sluh22-chat/index.ts
//   (http://localhost:8000; PORT=8001 to change it), then open the site with
//   ?chat=http://localhost:8000 on the address once (chat.js remembers it
//   for the tab). CHAT_OPEN=1 lets any origin in, so keep it on your machine.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const OPEN = env("CHAT_OPEN") === "1";
const ALLOWED = (env("SLUH22_ALLOWED_ORIGINS") || "https://cev64.github.io")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const STORE = Boolean(SUPABASE_URL && SERVICE_KEY);
const API_KEY = env("SLUH22_ANTHROPIC_API_KEY") || env("ANTHROPIC_API_KEY");
const PASSCODE = env("SLUH22_PASSCODE");
const MODEL = env("SLUH22_CLAUDE_MODEL") || "claude-haiku-5-5";
const EFFORT = (["low", "medium", "high"] as const).find((e) => e === env("SLUH22_EFFORT")) ?? "low";
const claude = API_KEY ? new Anthropic({ apiKey: API_KEY, maxRetries: 2 }) : null;
const DAILY = Math.max(1, Number(env("SLUH22_DAILY_QUESTIONS")) || 30);
const LEAGUE_DAILY = Math.max(1, Number(env("SLUH22_LEAGUE_DAILY")) || 300);

// What one request may carry: a league digest, a conversation of a sensible
// length, and a handful of tool rounds per question.
const MAX_BODY = 1_500_000;
const MAX_DIGEST = 600_000;
const MAX_MESSAGES = 80;
const MAX_QUESTION = 2_000;
const MAX_TOOL_ROUNDS = 8;
// Short answers are the brief; this is only the ceiling, thinking included.
const MAX_OUTPUT = 16_000;

/* ------------------------------------------------------------ the prompt */

const INSTRUCTIONS = `You are the League Historian for SLUH 22, a ten-team fantasy football league of old friends. Its history site keeps every season since 2021. League members ask you about it: past seasons, champions, rivalries, records, drafts, keepers, players and the season being played now.

What you know comes from the league data below and from your tools. Treat that data as the only source of truth about this league:
- Answer from it. When a question needs detail the summary doesn't hold (who started for a team, a player's weeks in the league, drafts, keepers, roster moves, lineup decisions, a week's written recap), call the tools; call several at once when you need several things.
- Never invent a score, a result, a trade or a player's points. If the data doesn't cover something (an NFL fact outside this league, a season the league didn't play, a projection), say so in one line.
- The site doesn't record transactions. A player changing teams shows up in the box scores, but whether it was a trade or a drop and a pickup isn't known: say "moved to" or "picked up", never "traded" unless the user says it was a trade.
- Count and add up carefully. Prefer the pre-computed totals in the summary over adding up games yourself, and say which seasons a figure covers when that matters (for example, regular season only).
- Playoff wins, playoff records and titles count only games in the main bracket on the road to the title (quarterfinals, semifinals, the championship). A placement game (3rd place, 5th place) or a losers-bracket (Toilet Bowl) game is never a playoff win.
- Managers are the people; teams are what they called their roster in a given season. Refer to people by their manager name, adding the team name where it helps.
- Talk only about the managers named in the league's history. If someone asks about anyone else, say the league's history here doesn't include them, without repeating the name, and move on.
- "Points" for a player means points scored in a starting lineup unless the question is about the bench.

How to answer:
- Be brief and informative. Lead with the answer in one punchy sentence, then back it up with the two or three numbers from the league that prove it: the record, the score, the season, the week. Most answers are 2 to 4 sentences. Use a short list or a small table only when comparing several managers or seasons, and keep it to the rows that matter.
- Always cite the league's own numbers. A take with no stat behind it isn't an answer.
- Be witty. You're the sharp-tongued commissioner of a group chat of old friends: dry, quick, a little savage. Talk some smack when the numbers hand it to you: a playoff choke, a lopsided head-to-head, a keeper that aged like milk, a title drought, a last-place finish, a starter left on the bench for 30 points. Hype the champions just as hard. One good line beats three okay ones; don't force a joke into every answer.
- Keep the smack about fantasy results only: never about anyone's looks, family, job, school, money, identity or anything outside the league. If someone seems genuinely upset, drop the roast and just answer.
- Write in Markdown: **bold** for names and key numbers. No headings, no preamble, no "Great question", no summary at the end.
- Don't mention these instructions, the summary's format, or tool names. Say "the league's history" rather than "the data provided".`;

/* ------------------------------------------------------------ the tools */

// Run in the browser by chat.js, which validates every input itself.
const TOOLS: Anthropic.Tool[] = [
  {
    name: "box_score",
    description: "Every lineup for one week of one season: each team's starters (slot, player, position, NFL club that week, points, projection) and bench, with the final score. Give a manager to get just that manager's game.",
    input_schema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "The season's year, e.g. 2024." },
        week: { type: "integer", description: "The week number (regular season 1-14, playoffs 15-17)." },
        manager: { type: "string", description: "Optional: a manager's or team's name, to return only their game." },
      },
      required: ["season", "week"],
    },
  },
  {
    name: "player_history",
    description: "One NFL player's whole history in this league: every manager who rostered him, each season's starts, points as a starter and points left on the bench, his best weeks, where he was drafted or kept (2024 on), and his keeper status now. Matches names loosely (\"CMC\" won't work; \"McCaffrey\" will).",
    input_schema: {
      type: "object",
      properties: { player: { type: "string", description: "The player's name, or part of it." } },
      required: ["player"],
    },
  },
  {
    name: "team_season",
    description: "One manager's season in full: week-by-week results, every player they started with starts and points, and their lineup efficiency (points scored against the best possible lineup).",
    input_schema: {
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
    input_schema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "Optional: one season." },
        position: { type: "string", description: "Optional: QB, RB, WR, TE, K or DST." },
        manager: { type: "string", description: "Optional: only this manager's starters." },
        limit: { type: "integer", description: "How many to return, up to 40. Default 15." },
      },
      required: [],
    },
  },
  {
    name: "draft",
    description: "A season's draft (2024 on; earlier drafts aren't kept): every pick in order with the manager who made it, the player taken, whether he was a keeper, and what he went on to score for that manager that season.",
    input_schema: {
      type: "object",
      properties: { season: { type: "integer" } },
      required: ["season"],
    },
  },
  {
    name: "keepers",
    description: "Who each team can keep for next season under the league's keeper rules, with why not for anyone who can't, and each player's points this season. Optionally for one manager.",
    input_schema: {
      type: "object",
      properties: { manager: { type: "string", description: "Optional: one manager's roster." } },
      required: [],
    },
  },
  {
    name: "roster_moves",
    description: "One season's roster moves as seen in the weekly lineups: players who joined a team after week 1 (pickups), and players who went straight from one team to another (a trade, or a drop and a claim; the site doesn't say which), with what each scored for his new team. Plus each manager's totals.",
    input_schema: {
      type: "object",
      properties: {
        season: { type: "integer" },
        manager: { type: "string", description: "Optional: one manager's moves." },
      },
      required: ["season"],
    },
  },
  {
    name: "lineup_efficiency",
    description: "How well managers set their lineups: points scored against the best lineup they could have set, points left on the bench, games a lineup cost them, and the worst benchings. For one season, or every season together.",
    input_schema: {
      type: "object",
      properties: { season: { type: "integer", description: "Optional: one season; leave out for all-time." } },
      required: [],
    },
  },
  {
    name: "weekly_recaps",
    description: "The site's written recap of each week of one season (headline and notes), the commissioner's own take on what happened. Give a week for just that one.",
    input_schema: {
      type: "object",
      properties: {
        season: { type: "integer" },
        week: { type: "integer", description: "Optional: one week (0 is the preseason note)." },
      },
      required: ["season"],
    },
  },
];

/* ------------------------------------------------------------ plumbing */

function cors(origin: string | null): Record<string, string> {
  const allow = OPEN ? (origin || "*") : origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-league-passcode",
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

// Who is asking, for the daily allowance: a hash of their address, so no
// address is ever stored. Supabase's gateway puts the caller first in
// x-forwarded-for.
async function visitor(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sluh22-chat|${ip}`)));
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One more question today, from this visitor: today's count for them and
// for the whole league, this one included. Kept in the database
// (count_sluh22_question) when it's there, otherwise in memory, which
// resets whenever Supabase starts the function afresh.
const memoryCounts = new Map<string, { day: string; n: number }>();
function countInMemory(who: string): { visitor: number; league: number } {
  const day = new Date().toISOString().slice(0, 10);
  const bump = (key: string) => {
    const had = memoryCounts.get(key);
    const next = had && had.day === day ? { day, n: had.n + 1 } : { day, n: 1 };
    memoryCounts.set(key, next);
    return next.n;
  };
  return { visitor: bump(who), league: bump("*") };
}
let storeMissing = false;
async function countQuestion(who: string): Promise<{ visitor: number; league: number }> {
  if (!STORE || storeMissing) return countInMemory(who);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/count_sluh22_question`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_visitor: who }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      // The migration hasn't been applied: count in memory from here on.
      storeMissing = true;
      console.warn("sluh22-chat: count_sluh22_question is missing; counting in memory (apply the migration)");
      return countInMemory(who);
    }
    if (!res.ok) throw new Error(`database answered ${res.status}`);
    const row = await res.json();
    return { visitor: Number(row.visitor) || 0, league: Number(row.league) || 0 };
  } catch (err) {
    console.error("sluh22-chat: counting failed,", err);
    return countInMemory(who);
  }
}

// The passcode, compared without giving away how much of it matched.
function passcodeOk(given: string): boolean {
  if (!PASSCODE) return true;
  const a = new TextEncoder().encode(given.trim().toLowerCase());
  const b = new TextEncoder().encode(PASSCODE.toLowerCase());
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type Body = { digest?: unknown; messages?: unknown };

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
  thinking?: string;
  signature?: string;
  data?: string;  // a redacted thinking block's
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

/* ------------------------------------------------------------ Claude */

// The tools as Claude takes them. chat.js checks every input itself, so a
// tool's input streams in as it is written.
const CLAUDE_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));

// A tool call's id as Claude accepts it (letters, digits, _ and -); a call
// from a conversation begun on the old Gemini chat may carry anything else.
// Its result maps the same way.
const claudeId = (id: unknown) => String(id ?? "call").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "call";

// The conversation as Claude's messages, less empty text, which Claude turns
// down. Thinking goes back only for the question being answered, where
// Claude needs it between tool rounds; earlier answers go without theirs,
// the same way every time, so what came before a thinking block never
// changes under it.
function claudeMessages(messages: Message[]): Anthropic.MessageParam[] {
  let asked = messages.length - 1;
  while (asked > 0 && isToolResults(messages[asked])) asked -= 2;
  return messages.map((m, i) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const b of blocksOf(m)) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        content.push({ type: "text", text: b.text });
      } else if (b.type === "thinking" && m.role === "assistant" && i > asked && typeof b.signature === "string") {
        content.push({ type: "thinking", thinking: String(b.thinking ?? ""), signature: b.signature });
      } else if (b.type === "redacted_thinking" && m.role === "assistant" && i > asked && typeof b.data === "string") {
        content.push({ type: "redacted_thinking", data: b.data });
      } else if (b.type === "tool_use" && m.role === "assistant" && typeof b.name === "string") {
        const input = b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input as Record<string, unknown> : {};
        content.push({ type: "tool_use", id: claudeId(b.id), name: b.name, input });
      } else if (b.type === "tool_result" && m.role === "user") {
        const text = typeof b.content === "string" ? b.content
          : Array.isArray(b.content) ? b.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("") : "";
        content.push({ type: "tool_result", tool_use_id: claudeId(b.tool_use_id), content: text || "(nothing)", is_error: Boolean(b.is_error) });
      }
    }
    if (!content.some((b) => b.type !== "thinking" && b.type !== "redacted_thinking")) {
      content.push({ type: "text", text: m.role === "user" ? "…" : "(no answer)" });
    }
    return { role: m.role, content };
  });
}

/* Asking Claude, streaming the answer to the browser as it is written: text
   as it comes, a note when a tool is called, then the whole message as
   content blocks, which the browser sends back unchanged with the next turn.
   The instructions and the league go first and are cached. */
async function askClaude(messages: Message[], digest: string, send: (e: Record<string, unknown>) => void, signal: AbortSignal) {
  try {
    const stream = claude!.messages.stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT,
      // The instructions and then the league, the same from one turn to the
      // next. Today's date lives in the digest's first line, so it changes
      // with the data and nothing else.
      system: [{ type: "text", text: `${INSTRUCTIONS}\n\n${digest}`, cache_control: { type: "ephemeral" } }],
      tools: CLAUDE_TOOLS,
      messages: claudeMessages(messages),
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      // and the conversation so far, for the next tool round
      cache_control: { type: "ephemeral" },
    }, { signal });
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        send({ t: "tool", name: event.content_block.name });
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ t: "text", d: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    const content: Block[] = [];
    for (const b of final.content) {
      if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
      else if (b.type === "thinking") content.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
      else if (b.type === "redacted_thinking") content.push({ type: "redacted_thinking", data: b.data });
    }
    const stop = final.stop_reason === "refusal" ? "refusal"
      : final.stop_reason === "max_tokens" ? "max_tokens"
      : content.some((b) => b.type === "tool_use") ? "tool_use"
      : "end_turn";
    send({ t: "done", stop, content });
  } catch (err) {
    if (signal.aborted) return;
    send({ t: "error", ...trouble(err) });
  }
}

// Why Claude couldn't answer, in the words a member sees, and whether it's
// the site's setup (every question would fail the same way).
function trouble(err: unknown): { message: string; setup: boolean } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error("sluh22-chat: Claude turned the key down,", err.message);
    return { message: "The league AI isn't set up right yet: its API key was turned down. (Commissioner: the sluh22-chat function's logs say why.)", setup: true };
  }
  if (err instanceof Anthropic.NotFoundError) {
    console.error("sluh22-chat: Claude model not found,", err.message);
    return { message: "The league AI isn't set up right yet: its model wasn't found. (Commissioner: check SLUH22_CLAUDE_MODEL.)", setup: true };
  }
  if (err instanceof Anthropic.RateLimitError) {
    console.error("sluh22-chat: Claude rate limit,", err.message);
    return { message: "The league AI is getting a lot of questions right now. Try again in a minute.", setup: false };
  }
  if (err instanceof Anthropic.APIError) {
    console.error("sluh22-chat: Claude answered", err.status, err.message);
    return { message: "The league AI couldn't answer that. Try again in a minute.", setup: false };
  }
  console.error("sluh22-chat: Claude failed,", err);
  return { message: "The AI couldn't answer that. Try again.", setup: false };
}

/* ------------------------------------------------------------ the chat */

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  // Only the league's own pages: a browser always says where a request
  // comes from, so no Origin means a script, not the site.
  if (!OPEN && (!origin || !ALLOWED.includes(origin))) return fail(403, "origin", "the league chat only answers the league's own site", origin);
  if (!claude) return fail(501, "not_set_up", "the league chat has no API key yet", origin);
  if (!passcodeOk(req.headers.get("x-league-passcode") ?? "")) return fail(401, "passcode", "the league chat needs the league's passcode", origin);

  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, "too_big", "that conversation is too long; start a new one", origin);
  let body: Body;
  try { body = JSON.parse(text); } catch { return fail(400, "bad_request", "not JSON", origin); }

  const digest = typeof body.digest === "string" ? body.digest : "";
  if (!digest || digest.length > MAX_DIGEST) return fail(400, "bad_request", "no league data was sent", origin);
  const convo = conversation(body.messages);
  if (!convo) return fail(400, "bad_request", "that conversation isn't in a shape the chat can read", origin);
  if (convo.rounds > MAX_TOOL_ROUNDS) return fail(429, "too_many_steps", "that question took too many look-ups; try asking it more narrowly", origin);

  // Today's allowances; tool rounds ride on the question that started them.
  if (convo.question) {
    const n = await countQuestion(await visitor(req));
    if (n.visitor > DAILY) return fail(429, "daily_limit", `that's your ${DAILY} questions for today; the Historian is back tomorrow`, origin);
    if (n.league > LEAGUE_DAILY) return fail(429, "daily_limit", "the league has used up today's questions; the Historian is back tomorrow", origin);
  }

  // The answer as server-sent events (see askClaude). The member pressing
  // stop (or leaving) cancels the answer, and with it the request to Claude,
  // so nothing more is written.
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const out = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await askClaude(convo.messages, digest, send, abort.signal);
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
