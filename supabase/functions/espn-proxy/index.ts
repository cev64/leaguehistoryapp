// ESPN relay: opens PRIVATE ESPN leagues for espn.js.
//
// A private ESPN league answers only a request that carries a member's ESPN
// sign-in cookies (espn_s2 and SWID). A page on this site can't attach
// cookies for espn.com, so the browser sends them here as headers instead,
// and this function makes the same request to ESPN with them as cookies and
// hands ESPN's answer straight back. Public leagues never come here: the
// browser reads them from ESPN directly.
//
// What it will do, and nothing else:
//   - GET only, to lm-api-reads.fantasy.espn.com, for fantasy football
//     league reads (a season, a league's history, its activity feed) and
//     the player list. Nothing that writes, nothing on another host.
//   - The cookies are used for that one request. They are not stored,
//     logged or sent anywhere but ESPN.
//
// Deploy:
//   supabase functions deploy espn-proxy --no-verify-jwt
//   supabase secrets set ALLOWED_ORIGINS=https://your-site.example
// ALLOWED_ORIGINS (comma-separated) limits which sites may use the relay;
// leave it unset only while testing. The site finds the relay at
// <SUPABASE_URL>/functions/v1/espn-proxy, or at ESPN_PROXY_URL in
// account-config.js.

const ESPN_HOST = "lm-api-reads.fantasy.espn.com";
const PATHS = [
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}$/,
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}\/communication\/$/,
  /^\/apis\/v3\/games\/ffl\/leagueHistory\/\d{1,12}$/,
  /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/players$/,
];
const QUERY_KEYS = new Set(["view", "scoringPeriodId", "seasonId"]);

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  const allow = !ALLOWED.length ? "*" : origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "x-espn-s2, x-espn-swid, x-fantasy-filter, authorization, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function fail(status: number, message: string, origin: string | null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "GET") return fail(405, "GET only", origin);
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin not allowed", origin);

  const url = target(new URL(req.url).searchParams.get("url"));
  if (!url) return fail(400, "not an ESPN fantasy football league address", origin);

  // espn_s2 is a long URL-safe token; SWID is a braced GUID.
  const s2 = (req.headers.get("x-espn-s2") ?? "").trim();
  const swid = (req.headers.get("x-espn-swid") ?? "").trim().toUpperCase();
  if (!/^[A-Za-z0-9%+/=_.-]{40,2000}$/.test(s2) || !/^\{[0-9A-F-]{30,40}\}$/.test(swid)) {
    return fail(400, "espn_s2 and SWID are both needed", origin);
  }

  const headers: Record<string, string> = {
    "Cookie": `espn_s2=${s2}; SWID=${swid}`,
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
  if (res.status >= 300 && res.status < 400) return fail(401, "ESPN refused these cookies", origin);
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
