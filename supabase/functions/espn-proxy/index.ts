// ESPN relay: opens PRIVATE ESPN leagues for espn.js.
//
// A private ESPN league answers only a request that carries a member's ESPN
// keys, the espn_s2 and SWID cookies. A page on this site can't attach
// cookies for espn.com, so this function makes the request to ESPN with the
// keys as cookies and hands ESPN's answer straight back. Public leagues
// never come here: the browser reads them from ESPN directly.
//
// The keys come one of two ways:
//   - as headers (x-espn-s2, x-espn-swid), from the browser they were typed
//     in, which keeps a copy of its own
//   - from the member's account: a signed-in member's keys are saved here
//     (POST ?action=save) so every device they sign in on, their phone
//     included, opens their private leagues. A request marked
//     x-lh-account: 1 and carrying their session uses them.
//
// A member can save keys for several ESPN accounts (one set per SWID, up
// to MAX_SETS). A league read with the account's keys tries each set until
// ESPN accepts one, the set named in x-lh-swid first.
//
// Saved keys are encrypted (AES-GCM, with ESPN_KEYS_SECRET, bound to the
// member's user id) before they reach the database, and only this function
// can read the table (supabase/migrations/20261002000000_espn_keys.sql).
// They never go back to a browser: ?action=status says which ESPN accounts
// (SWIDs) have keys saved. ?action=forget deletes them, or with &swid= one
// account's.
//
// ?action=leagues lists the member's ESPN fantasy football leagues (with
// either kind of keys), from the teams ESPN keeps on their profile, so the
// front page can offer them without anyone looking up a league id.
//
// What it will do with ESPN, and nothing else:
//   - GET only, to lm-api-reads.fantasy.espn.com, for fantasy football
//     league reads (a season, a league's history, its activity feed) and
//     the player list, and to fan.api.espn.com for the member's own list of
//     fantasy teams (?action=leagues). Nothing that writes, nothing else.
//   - Keys are never logged or sent anywhere but ESPN.
//
// Without Supabase (keys kept in each visitor's browser only): this file
// runs on its own anywhere Deno does, and without the Supabase settings
// below it simply leaves saving keys to accounts off.
//   on your computer, for the site served locally:
//     deno run --allow-net --allow-env supabase/functions/espn-proxy/index.ts
//     (http://localhost:8000; PORT=8001 to change it), then ESPN_PROXY_URL:
//     "http://localhost:8000" in account-config.js
//   for the live site, free on Deno Deploy (dash.deno.com): a new project
//     from this file, ALLOWED_ORIGINS set to the site's address, and its
//     https://<project>.deno.dev address as ESPN_PROXY_URL
//
// Deploy on Supabase:
//   supabase functions deploy espn-proxy --no-verify-jwt
//   supabase secrets set ALLOWED_ORIGINS=https://your-site.example
//   supabase secrets set ESPN_KEYS_SECRET=$(openssl rand -base64 32)
// ALLOWED_ORIGINS (comma-separated) limits which sites may use the relay;
// leave it unset only while testing. ESPN_KEYS_SECRET turns on saving keys
// to accounts (without it, keys stay in the browser they were typed in);
// changing it later makes every saved key unreadable, and members type
// theirs again. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are set by Supabase itself. The site finds the
// relay at <SUPABASE_URL>/functions/v1/espn-proxy, or at ESPN_PROXY_URL in
// account-config.js.

const ESPN_HOST = "lm-api-reads.fantasy.espn.com";
const PATHS = [
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}$/,
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}\/communication\/$/,
  /^\/apis\/v3\/games\/ffl\/leagueHistory\/\d{1,12}$/,
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/players$/,
];
const QUERY_KEYS = new Set(["view", "scoringPeriodId", "seasonId"]);

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const ALLOWED = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SECRET = env("ESPN_KEYS_SECRET");
const ACCOUNTS = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && SECRET);
const MAX_SETS = 10;

function cors(origin: string | null): Record<string, string> {
  const allow = !ALLOWED.length ? "*" : origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "x-espn-s2, x-espn-swid, x-fantasy-filter, x-lh-account, x-lh-swid, authorization, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (status: number, message: string, origin: string | null) => reply(status, { error: message }, origin);

// The ESPN address asked for, if it is one this relay may fetch.
function target(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== ESPN_HOST || url.port || url.username || url.password) return null;
  if (!PATHS.some((re) => re.test(url.pathname))) return null;
  for (const [key, value] of url.searchParams) {
    if (!QUERY_KEYS.has(key) || value.length > 40 || !/^[\w-]+$/.test(value)) return null;
  }
  url.hash = "";
  return url;
}

// espn_s2 is a long URL-safe token; SWID is a braced GUID.
type Keys = { s2: string; swid: string };
function tidy(s2: unknown, swid: unknown): Keys | null {
  const a = String(s2 ?? "").trim();
  const b = String(swid ?? "").trim().toUpperCase();
  return /^[A-Za-z0-9%+/=_.-]{40,2000}$/.test(a) && /^\{[0-9A-F-]{30,40}\}$/.test(b) ? { s2: a, swid: b } : null;
}

/* ------------------------------------------------------------ accounts */

// The signed-in member a request's session belongs to, checked with
// Supabase Auth (the relay runs with JWT verification off).
async function member(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!ACCOUNTS || !token || token === ANON_KEY) return null;
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

// The table, as the service role (which row-level security lets through).
function table(query: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/espn_keys${query}`, {
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

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
let keyPromise: Promise<CryptoKey> | null = null;
function cryptoKey() {
  if (!keyPromise) {
    keyPromise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET))
      .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  return keyPromise;
}
// Sealed to one member: the user id is the additional data, so a row moved
// to another member's id won't open. A row holds every set of keys the
// member has saved, one per ESPN account.
type Saved = Keys & { saved_at: string };
async function seal(sets: Saved[], userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({ sets }));
  const box = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await cryptoKey(), data));
  return `v1.${b64(iv)}.${b64(box)}`;
}
// Every set in a row; a row saved before several were allowed is one set.
async function unseal(sealed: string, userId: string, savedAt = ""): Promise<Saved[]> {
  try {
    const [v, iv, box] = sealed.split(".");
    if (v !== "v1") return [];
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, await cryptoKey(), unb64(box));
    const body = JSON.parse(new TextDecoder().decode(data));
    const raw: { s2?: unknown; swid?: unknown; saved_at?: unknown }[] = Array.isArray(body?.sets) ? body.sets : [body];
    return raw.map((k) => {
      const keys = tidy(k.s2, k.swid);
      return keys ? { ...keys, saved_at: typeof k.saved_at === "string" ? k.saved_at : savedAt } : null;
    }).filter((k): k is Saved => k !== null);
  } catch {
    return [];
  }
}
async function savedSets(userId: string): Promise<Saved[]> {
  const row = await savedRow(userId);
  return row ? await unseal(row.sealed, userId, row.saved_at) : [];
}
async function writeSets(userId: string, sets: Saved[]) {
  const res = sets.length
    ? await table("?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, sealed: await seal(sets, userId), saved_at: new Date().toISOString() }),
    })
    : await table(`?user_id=eq.${userId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`database answered ${res.status}`);
}
// What a browser is told about saved keys: which ESPN accounts, never the keys.
const accounts = (sets: Saved[]) => ({
  saved: sets.length > 0,
  saved_at: sets.reduce((t, k) => (k.saved_at > t ? k.saved_at : t), "") || null,
  accounts: sets.map((k) => ({ swid: k.swid, saved_at: k.saved_at || null })),
});

async function savedRow(userId: string): Promise<{ sealed: string; saved_at: string } | null> {
  const res = await table(`?user_id=eq.${userId}&select=sealed,saved_at`);
  if (!res.ok) throw new Error(`database answered ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function account(req: Request, action: string, origin: string | null) {
  if (!ACCOUNTS) return fail(501, "saving ESPN keys to accounts isn't set up", origin);
  const userId = await member(req);
  if (!userId) return fail(401, "sign in first", origin);
  try {
    const sets = await savedSets(userId);
    if (action === "status") return reply(200, accounts(sets), origin);
    if (req.method !== "POST") return fail(405, "POST only", origin);
    if (action === "save") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { /* checked below */ }
      const keys = tidy(body.s2, body.swid);
      if (!keys) return fail(400, "espn_s2 and SWID are both needed", origin);
      // One set per ESPN account: new keys for a saved account replace its old ones.
      const others = sets.filter((k) => k.swid !== keys.swid);
      if (others.length >= MAX_SETS) return fail(400, `keys for up to ${MAX_SETS} ESPN accounts can be saved`, origin);
      const next = [...others, { ...keys, saved_at: new Date().toISOString() }];
      await writeSets(userId, next);
      return reply(200, accounts(next), origin);
    }
    if (action === "forget") {
      const swid = new URL(req.url).searchParams.get("swid");
      const next = swid ? sets.filter((k) => k.swid !== String(swid).trim().toUpperCase()) : [];
      await writeSets(userId, next);
      return reply(200, accounts(next), origin);
    }
    return fail(400, "unknown action", origin);
  } catch {
    return fail(502, "the account store didn't answer", origin);
  }
}

/* ------------------------------------------------------------ the keys */

// The keys a request may be made with: the set it carries, or (marked
// x-lh-account: 1) every set the signed-in member has saved, the one named
// in x-lh-swid first. A Response is the reason there are none.
async function keysFor(req: Request, origin: string | null): Promise<Keys[] | Response> {
  if (req.headers.get("x-lh-account") === "1") {
    if (!ACCOUNTS) return fail(501, "saving ESPN keys to accounts isn't set up", origin);
    const userId = await member(req);
    if (!userId) return fail(401, "sign in first", origin);
    let sets: Saved[] = [];
    try { sets = await savedSets(userId); } catch { return fail(502, "the account store didn't answer", origin); }
    if (!sets.length) return fail(401, "no ESPN keys saved to this account", origin);
    const first = (req.headers.get("x-lh-swid") ?? "").trim().toUpperCase();
    return sets.slice().sort((a, b) => Number(b.swid === first) - Number(a.swid === first));
  }
  const keys = tidy(req.headers.get("x-espn-s2"), req.headers.get("x-espn-swid"));
  return keys ? [keys] : fail(400, "espn_s2 and SWID are both needed", origin);
}
// ESPN turning a set of keys away: a refusal, or a redirect to its home page.
const refused = (status: number) => status === 401 || status === 403 || (status >= 300 && status < 400);

const cookieHeaders = (keys: Keys) => ({
  "Cookie": `espn_s2=${keys.s2}; SWID=${keys.swid}`,
  "Accept": "application/json",
  "User-Agent": "league-history-relay/1.0",
});

/* ------------------------------------------------------------ their leagues */

type League = { id: number; name: string; season: number; team: string | null; size: number | null; logo: string | null; swid?: string };

// The football leagues among the fantasy teams on an ESPN profile, newest
// season of each league. ESPN keeps each team as a "preference" whose entry
// names its game, season and league (its group); the entry's address is the
// fallback for anything left out.
// deno-lint-ignore no-explicit-any
function footballLeagues(profile: any): League[] {
  const out = new Map<number, League>();
  for (const pref of Array.isArray(profile?.preferences) ? profile.preferences : []) {
    const e = pref?.metaData?.entry;
    if (!e || typeof e !== "object") continue;
    const url = typeof e.entryURL === "string" ? e.entryURL : "";
    const football = e.gameId === 1 || /^ffl$/i.test(String(e.abbrev ?? "")) || /\/football\//.test(url);
    if (!football) continue;
    const group = Array.isArray(e.groups) && e.groups[0] ? e.groups[0] : {};
    const id = Number(group.groupId) || Number(/[?&]leagueId=(\d+)/.exec(url)?.[1]);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 999999999999) continue;
    const season = Number(e.seasonId) || Number(/[?&]seasonId=(\d{4})/.exec(url)?.[1]) || 0;
    const had = out.get(id);
    if (had && had.season >= season) continue;
    const team = [e.entryLocation, e.entryNickname].filter((x) => typeof x === "string" && x.trim()).join(" ").trim();
    out.set(id, {
      id,
      name: String(group.groupName ?? "").trim().slice(0, 120) || `League ${id}`,
      season,
      team: team ? team.slice(0, 120) : null,
      size: Number(group.groupSize) || null,
      logo: typeof e.logoUrl === "string" && /^https:\/\//.test(e.logoUrl) ? e.logoUrl.slice(0, 500) : null,
    });
  }
  return [...out.values()].sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
}

// One ESPN account's leagues, each marked with the account (SWID) whose
// keys open it; a string is why there are none.
async function leaguesOf(keys: Keys): Promise<League[] | string> {
  const url = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(keys.swid)}` +
    "?displayHiddenPrefs=true&context=fantasy&useCookieAuth=true&source=fantasyapp-ios&featureFlags=challengeEntries";
  let res: Response;
  try {
    res = await fetch(url, { headers: cookieHeaders(keys), redirect: "manual", signal: AbortSignal.timeout(20000) });
  } catch {
    return "ESPN didn't answer";
  }
  if (refused(res.status) || res.status === 404) return "ESPN refused these keys";
  if (!res.ok) return `ESPN answered ${res.status}`;
  try {
    return footballLeagues(await res.json()).map((l) => ({ ...l, swid: keys.swid }));
  } catch {
    return "ESPN's answer wasn't readable";
  }
}

// Every saved ESPN account's leagues together; a league two accounts are in
// is listed once. Accounts ESPN turned away are named in `refused`.
async function leagues(req: Request, origin: string | null) {
  if (req.method !== "GET") return fail(405, "GET only", origin);
  const sets = await keysFor(req, origin);
  if (sets instanceof Response) return sets;
  const results = await Promise.all(sets.map(leaguesOf));
  const ok = results.filter((r): r is League[] => Array.isArray(r));
  if (!ok.length) return fail(results.some((r) => r === "ESPN refused these keys") ? 401 : 502, String(results[0]), origin);
  const byId = new Map<number, League>();
  ok.flat().forEach((l) => { const had = byId.get(l.id); if (!had || l.season > had.season) byId.set(l.id, l); });
  const list = [...byId.values()].sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
  const turnedAway = sets.filter((_, i) => !Array.isArray(results[i])).map((k) => k.swid);
  return new Response(JSON.stringify({ leagues: list, refused: turnedAway }), {
    status: 200,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

/* ------------------------------------------------------------ the relay */

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin not allowed", origin);

  const params = new URL(req.url).searchParams;
  const action = params.get("action");
  if (action === "leagues") return leagues(req, origin);
  if (action) return account(req, action, origin);
  if (req.method !== "GET") return fail(405, "GET only", origin);

  const url = target(params.get("url"));
  if (!url) return fail(400, "not an ESPN fantasy football league address", origin);

  // The keys: sent with the request, or the signed-in member's saved ones.
  const sets = await keysFor(req, origin);
  if (sets instanceof Response) return sets;

  const filter = req.headers.get("x-fantasy-filter");
  if (filter) {
    if (filter.length > 4000) return fail(400, "filter too long", origin);
    try { JSON.parse(filter); } catch { return fail(400, "filter is not JSON", origin); }
  }

  // Each set in turn until ESPN accepts one: a member's league belongs to
  // whichever of their ESPN accounts is in it.
  let res: Response | null = null;
  for (const keys of sets) {
    const headers: Record<string, string> = cookieHeaders(keys);
    if (filter) headers["X-Fantasy-Filter"] = filter;
    try {
      res = await fetch(url.href, { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
    } catch {
      return fail(502, "ESPN didn't answer", origin);
    }
    if (!refused(res.status)) break;
    await res.body?.cancel();
  }
  // ESPN redirects a request it won't serve to its home page: treat it as
  // the refusal it is.
  if (!res || refused(res.status)) return fail(401, "ESPN refused these keys", origin);
  return new Response(res.body, {
    status: res.status,
    headers: {
      ...cors(origin),
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      // The answer belongs to one member's sign-in: never cached in between.
      "Cache-Control": "private, no-store",
    },
  });
}

// On Supabase or Deno Deploy the platform sets the port; run on your own
// computer it is 8000, or PORT.
const port = Number(env("PORT"));
if (port) Deno.serve({ port }, handle);
else Deno.serve(handle);
