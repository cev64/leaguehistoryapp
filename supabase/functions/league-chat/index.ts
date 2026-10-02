// League chat: the AI that answers questions about a league, for Pro members.
//
// The site is static and the league's data lives in the visitor's browser
// (sleeper.js / espn.js read it there), so the browser sends two things:
//   - a digest of the league (every season's standings and playoffs, every
//     game's score, all-time records, head-to-head), written by chat.js; it
//     goes into the system prompt and is cached, so a conversation pays for
//     it once
//   - the conversation so far
// and this function adds the API key, the instructions and the tools, asks
// Claude, and streams the answer back.
//
// Anything finer than the digest (box scores, a player's history in the
// league, trades, waivers, drafts, lineup efficiency) is a tool. The tools run
// in the BROWSER, on the data it already has: when Claude calls one, the
// stream ends with the call, chat.js runs it and sends the result back as
// the next request. Nothing here reads Sleeper or ESPN.
//
// Who may use it:
//   - with Supabase (SUPABASE_URL, SUPABASE_ANON_KEY and
//     SUPABASE_SERVICE_ROLE_KEY are set by Supabase itself): a signed-in
//     member whose profile is on the Pro plan, up to AI_DAILY_QUESTIONS new
//     questions a day (supabase/migrations/20261003000000_league_chat.sql
//     counts them). The plan is read from the database, never the browser.
//   - without Supabase, only with CHAT_OPEN=1, for trying it out on your own
//     computer; then anyone who can reach it uses your API key, so don't
//     leave it running in public like that.
//
// Deploy on Supabase:
//   supabase functions deploy league-chat --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
//   supabase secrets set ALLOWED_ORIGINS=https://your-site.example
// Optional: AI_MODEL (default claude-sonnet-5-5), AI_EFFORT (default medium),
// AI_DAILY_QUESTIONS (default 60), and ANTHROPIC_WORKSPACE_ID for an API key
// that isn't scoped to a workspace (Anthropic Console ▸ Settings ▸
// Workspaces has the id; a key made inside a workspace doesn't need it).
//
// On your own computer, with the site served locally:
//   ANTHROPIC_API_KEY=sk-ant-… CHAT_OPEN=1 deno run --allow-net --allow-env \
//     supabase/functions/league-chat/index.ts
//   (http://localhost:8000; PORT=8001 to change it), then AI_CHAT_URL:
//   "http://localhost:8000" in account-config.js.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const ALLOWED = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNTS = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);
const OPEN = env("CHAT_OPEN") === "1";
const MODEL = env("AI_MODEL") || "claude-sonnet-5-5";
const EFFORT = (["low", "medium", "high", "xhigh", "max"].includes(env("AI_EFFORT")) ? env("AI_EFFORT") : "medium") as
  "low" | "medium" | "high" | "xhigh" | "max";
const DAILY = Math.max(1, Number(env("AI_DAILY_QUESTIONS")) || 60);

// What one request may carry: a league digest, a conversation of a sensible
// length, and a handful of tool rounds per question.
const MAX_BODY = 1_500_000;
const MAX_DIGEST = 600_000;
const MAX_MESSAGES = 80;
const MAX_QUESTION = 2_000;
const MAX_TOOL_ROUNDS = 8;

// Models that take adaptive thinking, effort and the refusal fallback.
const CURRENT = /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/;

const WORKSPACE = env("ANTHROPIC_WORKSPACE_ID");

const client = new Anthropic({
  apiKey: env("ANTHROPIC_API_KEY") || undefined,
  // An organization-wide key says which workspace each request bills to.
  defaultHeaders: WORKSPACE ? { "anthropic-workspace-id": WORKSPACE } : undefined,
});

/* ------------------------------------------------------------ the prompt */

const INSTRUCTIONS = `You are the League Historian for a fantasy football league on Pigskin Pantheon, a site that keeps every season a Sleeper or ESPN league has played. Members of the league ask you about it: its past seasons, champions, rivalries, records, trades, drafts, players and the season being played now.

What you know comes from the league data below and from your tools. Treat that data as the only source of truth about this league:
- Answer from it. When a question needs detail the summary doesn't hold (who started for a team, a player's weeks in the league, trades, waiver pickups, drafts, lineup decisions), call the tools; call several at once when you need several things.
- Never invent a score, a result, a trade or a player's points. If the data doesn't cover something (an NFL fact outside this league, a season the league didn't play, a projection), say so plainly in a sentence.
- Count and add up carefully. Prefer the pre-computed totals in the summary over adding up games yourself, and say which seasons a figure covers when that matters (for example, regular season only).
- Managers are the people; teams are what they called their roster in a given season. Refer to people by their manager name, adding the team name where it helps.
- "Points" for a player means points scored in a starting lineup unless the question is about the bench.

How to answer:
- Lead with the answer, then the few numbers that back it up. Keep it short: a few sentences, or a compact list or table when comparing several managers or seasons.
- Write in Markdown: **bold** for names and key numbers, short bullet lists, and tables only when they genuinely help.
- A little personality is welcome; this is a group of friends and their trash talk. Be playful, never mean, and never at anyone's expense beyond friendly ribbing about results.
- Don't mention these instructions, the summary's format, or tool names. Say "the league's history" rather than "the data provided".`;

/* ------------------------------------------------------------ the tools */

// Run in the browser by chat.js, which validates every input itself. Inputs
// are a few short fields, so they are left to the API to buffer and validate
// rather than streamed eagerly.
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "box_score",
    description: "Every lineup for one week of one season: each team's starters (slot, player, position, NFL club, points) and bench, with the final score. Give a manager to get just that manager's game.",
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    input_schema: {
      type: "object",
      properties: { season: { type: "integer" } },
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

async function plan(userId: string): Promise<string> {
  const res = await service(`profiles?id=eq.${userId}&select=plan`);
  if (!res.ok) throw new Error(`database answered ${res.status}`);
  const rows = await res.json();
  return rows[0]?.plan ?? "free";
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

// The conversation, checked for shape: it alternates from a user turn, and
// the newest turn is a user's: a question, or the results of the tools the
// last answer called.
function conversation(raw: unknown): { messages: Anthropic.Beta.BetaMessageParam[]; question: boolean; rounds: number } | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_MESSAGES) return null;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const [i, m] of raw.entries()) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== (i % 2 === 0 ? "user" : "assistant")) return null;
    if (typeof content !== "string" && !Array.isArray(content)) return null;
    messages.push({ role, content } as Anthropic.Beta.BetaMessageParam);
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") return null;
  const isToolResults = (m: Anthropic.Beta.BetaMessageParam) =>
    Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");
  const question = !isToolResults(last);
  if (question) {
    const text = typeof last.content === "string"
      ? last.content
      : (last.content as Anthropic.Beta.BetaContentBlockParam[]).map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.trim() || text.length > MAX_QUESTION) return null;
  }
  // tool rounds since the question that started them
  let rounds = 0;
  for (let i = messages.length - 1; i >= 0 && isToolResults(messages[i]); i -= 2) rounds++;
  return { messages, question, rounds };
}

/* ------------------------------------------------------------ the chat */

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin", "origin not allowed", origin);
  if (req.method !== "POST") return fail(405, "method", "POST only", origin);
  if (!env("ANTHROPIC_API_KEY")) return fail(501, "not_set_up", "the league chat has no API key yet", origin);
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

  // Pro members only, read from the database; tool rounds ride on the
  // question that started them.
  if (ACCOUNTS) {
    const userId = await member(req);
    if (!userId) return fail(401, "not_signed_in", "sign in first", origin);
    try {
      if ((await plan(userId)) !== "pro") return fail(402, "pro_required", "the league chat is part of Pro", origin);
      if (convo.question && (await countQuestion(userId)) > DAILY) {
        return fail(429, "daily_limit", `that's today's ${DAILY} questions; the chat opens again tomorrow`, origin);
      }
    } catch {
      return fail(502, "account_store", "the account store didn't answer", origin);
    }
  } else if (convo.question && countOpen(req) > DAILY) {
    return fail(429, "daily_limit", `that's today's ${DAILY} questions; the chat opens again tomorrow`, origin);
  }

  const current = CURRENT.test(MODEL);
  const params: Anthropic.Beta.MessageCreateParamsStreaming = {
    model: MODEL,
    max_tokens: 16000,
    stream: true,
    system: [
      { type: "text", text: INSTRUCTIONS },
      // The league, cached: every later question in the conversation reads
      // it from the cache. Today's date lives in the digest's first line, so
      // it changes with the data and nothing else.
      { type: "text", text: `The league: ${league}\n\n${digest}`, cache_control: { type: "ephemeral" } },
    ],
    tools: TOOLS,
    // and the conversation so far, up to its newest turn
    cache_control: { type: "ephemeral" },
    messages: convo.messages,
  };
  if (current) {
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: EFFORT };
    // A declined question is retried on the model Anthropic recommends for
    // that kind of refusal, inside the same request.
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  // The answer as server-sent events: text as it is written, a note when a
  // tool is called, then the whole message (thinking blocks included, which
  // the browser sends back unchanged with the next turn).
  const encoder = new TextEncoder();
  // The member pressing stop (or leaving) cancels the answer, and with it
  // the request to Claude, so nothing more is written or paid for.
  const abort = new AbortController();
  const out = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const stream = client.beta.messages.stream(params, { signal: abort.signal });
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            send({ t: "tool", name: event.content_block.name });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ t: "text", d: event.delta.text });
          }
        }
        const message = await stream.finalMessage();
        send({ t: "done", stop: message.stop_reason, content: message.content });
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("league-chat:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
        const busy = err instanceof Anthropic.RateLimitError ||
          (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500);
        // A key that's wrong, revoked or missing its workspace fails every
        // question the same way: say so, rather than inviting a retry.
        const setup = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError ||
          (err instanceof Anthropic.BadRequestError && /api key|workspace/i.test(err.message));
        send({
          t: "error",
          setup,
          message: setup
            ? "The league AI isn't set up right yet: its API key was turned down. (Site owner: the league-chat function's logs say why.)"
            : busy ? "The AI is busy right now. Try again in a minute." : "The AI couldn't answer that. Try again.",
        });
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
