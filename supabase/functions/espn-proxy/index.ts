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
// Saved keys are encrypted (AES-GCM, with ESPN_KEYS_SECRET, bound to the
// member's user id) before they reach the database, and only this function
// can read the table (supabase/migrations/20261002000000_espn_keys.sql).
// They never go back to a browser: ?action=status only says whether they
// are saved. ?action=forget deletes them.
//
// What it will do with ESPN, and nothing else:
//   - GET only, to lm-api-reads.fantasy.espn.com, for fantasy football
//     league reads (a season, a league's history, its activity feed) and
//     the player list. Nothing that writes, nothing on another host.
//   - Keys are never logged or sent anywhere but ESPN.
//
// Deploy:
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

function cors(origin: string | null): Record<string, string> {
  const allow = !ALLOWED.length ? "*" : origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "x-espn-s2, x-espn-swid, x-fantasy-filter, x-lh-account, authorization, apikey, content-type",
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
// to another member's id won't open.
async function seal(keys: Keys, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(keys));
  const box = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await cryptoKey(), data));
  return `v1.${b64(iv)}.${b64(box)}`;
}
async function unseal(sealed: string, userId: string): Promise<Keys | null> {
  try {
    const [v, iv, box] = sealed.split(".");
    if (v !== "v1") return null;
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, await cryptoKey(), unb64(box));
    const keys = JSON.parse(new TextDecoder().decode(data));
    return tidy(keys.s2, keys.swid);
  } catch {
    return null;
  }
}

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
    if (action === "status") {
      const row = await savedRow(userId);
      return reply(200, { saved: Boolean(row), saved_at: row?.saved_at ?? null }, origin);
    }
    if (req.method !== "POST") return fail(405, "POST only", origin);
    if (action === "save") {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { /* checked below */ }
      const keys = tidy(body.s2, body.swid);
      if (!keys) return fail(400, "espn_s2 and SWID are both needed", origin);
      const saved_at = new Date().toISOString();
      const res = await table("?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: userId, sealed: await seal(keys, userId), saved_at }),
      });
      if (!res.ok) throw new Error(`database answered ${res.status}`);
      return reply(200, { saved: true, saved_at }, origin);
    }
    if (action === "forget") {
      const res = await table(`?user_id=eq.${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`database answered ${res.status}`);
      return reply(200, { saved: false, saved_at: null }, origin);
    }
    return fail(400, "unknown action", origin);
  } catch {
    return fail(502, "the account store didn't answer", origin);
  }
}

/* ------------------------------------------------------------ the relay */

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin not allowed", origin);

  const params = new URL(req.url).searchParams;
  const action = params.get("action");
  if (action) return account(req, action, origin);
  if (req.method !== "GET") return fail(405, "GET only", origin);

  const url = target(params.get("url"));
  if (!url) return fail(400, "not an ESPN fantasy football league address", origin);

  // The keys: sent with the request, or the signed-in member's saved ones.
  let keys: Keys | null = null;
  if (req.headers.get("x-lh-account") === "1") {
    if (!ACCOUNTS) return fail(501, "saving ESPN keys to accounts isn't set up", origin);
    const userId = await member(req);
    if (!userId) return fail(401, "sign in first", origin);
    let row = null;
    try { row = await savedRow(userId); } catch { return fail(502, "the account store didn't answer", origin); }
    keys = row ? await unseal(row.sealed, userId) : null;
    if (!keys) return fail(401, "no ESPN keys saved to this account", origin);
  } else {
    keys = tidy(req.headers.get("x-espn-s2"), req.headers.get("x-espn-swid"));
    if (!keys) return fail(400, "espn_s2 and SWID are both needed", origin);
  }

  const headers: Record<string, string> = {
    "Cookie": `espn_s2=${keys.s2}; SWID=${keys.swid}`,
    "Accept": "application/json",
    "User-Agent": "league-history-relay/1.0",
  };
  const filter = req.headers.get("x-fantasy-filter");
  if (filter) {
    if (filter.length > 4000) return fail(400, "filter too long", origin);
    try { JSON.parse(filter); } catch { return fail(400, "filter is not JSON", origin); }
    headers["X-Fantasy-Filter"] = filter;
  }

  let res: Response;
  try {
    res = await fetch(url.href, { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  } catch {
    return fail(502, "ESPN didn't answer", origin);
  }
  // ESPN redirects a request it won't serve to its home page: treat it as
  // the refusal it is.
  if (res.status >= 300 && res.status < 400) return fail(401, "ESPN refused these keys", origin);
  return new Response(res.body, {
    status: res.status,
    headers: {
      ...cors(origin),
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      // The answer belongs to one member's sign-in: never cached in between.
      "Cache-Control": "private, no-store",
    },
  });
});
