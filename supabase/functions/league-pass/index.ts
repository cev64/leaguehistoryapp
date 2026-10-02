// League Pass: Pro for a whole league, $20 per member a year, bought by one
// member (the pass's owner) for everyone (supabase/migrations/
// 20261004000000_league_pass.sql has the tables and what members can do).
//
// This function is the part that touches Stripe:
//   POST ?action=checkout  { league_id, league_ids, league_name,
//                            league_avatar, seats, return_url }
//     starts a pending pass and a Stripe Checkout for `seats` years of the
//     per-member price; the stripe-webhook function turns the pass on when
//     it's paid. Answers { url } to send the buyer to.
//   POST ?action=seats     { pass_id, seats }
//     the owner changes how many members the pass covers; Stripe charges
//     (or credits) the difference for the rest of the year straight away.
//
// Deploy:
//   supabase functions deploy league-pass --no-verify-jwt
//   supabase secrets set STRIPE_LEAGUE_PRICE_ID=price_…
// STRIPE_SECRET_KEY (shared with stripe-webhook) and ALLOWED_ORIGINS as for
// the other functions. The price is a recurring yearly price of $20 per
// unit in Stripe; a pass's seats are its quantity.

import Stripe from "https://esm.sh/stripe@16?target=deno";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const ALLOWED = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const PRICE = env("STRIPE_LEAGUE_PRICE_ID");
const MIN_SEATS = 2;
const MAX_SEATS = 60;

const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { httpClient: Stripe.createFetchHttpClient() });

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
function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (status: number, code: string, message: string, origin: string | null) =>
  reply(status, { error: message, code }, origin);

// The signed-in member, checked with Supabase Auth (JWT verification is off).
async function member(req: Request): Promise<{ id: string; email: string | null } | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? { id: user.id, email: typeof user.email === "string" ? user.email : null } : null;
  } catch {
    return null;
  }
}

// The database as the service role.
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`database answered ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const LEAGUE_ID = /^([0-9]{6,24}|espn-[0-9]{1,12})$/;
const seatsOk = (n: unknown) => Number.isInteger(n) && (n as number) >= MIN_SEATS && (n as number) <= MAX_SEATS;

// Where Stripe sends the buyer back: a page of the site that asked, never
// anywhere else.
function backTo(raw: unknown, origin: string | null): URL | null {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    if (ALLOWED.length ? !ALLOWED.includes(url.origin) : url.origin !== origin) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function checkout(req: Request, who: { id: string; email: string | null }, origin: string | null) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const leagueId = String(body.league_id ?? "");
  const seats = Number(body.seats);
  if (!LEAGUE_ID.test(leagueId)) return fail(400, "bad_league", "that isn't a Sleeper or ESPN league", origin);
  if (!seatsOk(seats)) return fail(400, "bad_seats", `a League Pass covers ${MIN_SEATS} to ${MAX_SEATS} members`, origin);
  const back = backTo(body.return_url, origin);
  if (!back) return fail(400, "bad_return", "checkout must return to this site", origin);
  const ids = (Array.isArray(body.league_ids) ? body.league_ids : []).map(String).filter((x) => LEAGUE_ID.test(x)).slice(0, 39);

  const [profile] = await rest(`profiles?id=eq.${who.id}&select=stripe_customer_id,email`);
  const [pass] = await rest("league_passes", {
    method: "POST",
    body: JSON.stringify({
      owner_id: who.id, league_id: leagueId, league_ids: [...new Set([leagueId, ...ids])],
      league_name: String(body.league_name ?? "").slice(0, 120) || null,
      league_avatar: /^https:\/\//.test(String(body.league_avatar ?? "")) ? String(body.league_avatar).slice(0, 300) : null,
      seats, status: "pending",
    }),
  });
  await rest("league_pass_members", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ pass_id: pass.id, user_id: who.id, role: "owner" }),
  });

  const done = new URL(back);
  done.searchParams.set("pass", pass.id);
  done.searchParams.set("paid", "1");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: PRICE, quantity: seats }],
    client_reference_id: who.id,
    ...(profile?.stripe_customer_id ? { customer: profile.stripe_customer_id } : { customer_email: who.email ?? profile?.email ?? undefined }),
    metadata: { kind: "league", pass_id: pass.id, user_id: who.id },
    subscription_data: { metadata: { kind: "league", pass_id: pass.id, user_id: who.id } },
    allow_promotion_codes: true,
    success_url: done.href,
    cancel_url: back.href,
  });
  return reply(200, { url: session.url, pass_id: pass.id }, origin);
}

async function changeSeats(req: Request, who: { id: string }, origin: string | null) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const passId = String(body.pass_id ?? "");
  const seats = Number(body.seats);
  if (!/^[0-9a-f-]{36}$/.test(passId)) return fail(400, "bad_pass", "no such pass", origin);
  if (!seatsOk(seats)) return fail(400, "bad_seats", `a League Pass covers ${MIN_SEATS} to ${MAX_SEATS} members`, origin);
  const [pass] = await rest(`league_passes?id=eq.${passId}&owner_id=eq.${who.id}&select=id,stripe_subscription_id,seats`);
  if (!pass || !pass.stripe_subscription_id) return fail(404, "bad_pass", "no such pass", origin);
  const members = await rest(`league_pass_members?pass_id=eq.${passId}&removed_at=is.null&select=user_id`);
  if (seats < members.length) {
    return fail(400, "seats_in_use", `${members.length} members have joined: remove some before going below that`, origin);
  }
  const sub = await stripe.subscriptions.retrieve(pass.stripe_subscription_id);
  const item = sub.items.data[0];
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: seats }],
    // the difference for the rest of the year, charged (or credited) now
    proration_behavior: "always_invoice",
  });
  // The webhook says the same a moment later; this saves the wait.
  await rest(`league_passes?id=eq.${passId}`, { method: "PATCH", body: JSON.stringify({ seats }) });
  return reply(200, { seats }, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return fail(403, "origin", "origin not allowed", origin);
  if (req.method !== "POST") return fail(405, "method", "POST only", origin);
  if (!env("STRIPE_SECRET_KEY") || !PRICE) return fail(501, "not_set_up", "League Pass payments aren't set up yet", origin);
  const who = await member(req);
  if (!who) return fail(401, "not_signed_in", "sign in first", origin);
  const action = new URL(req.url).searchParams.get("action");
  try {
    if (action === "checkout") return await checkout(req, who, origin);
    if (action === "seats") return await changeSeats(req, who, origin);
    return fail(400, "bad_action", "unknown action", origin);
  } catch (err) {
    console.error("league-pass:", err instanceof Error ? err.message : err);
    return fail(502, "upstream", "the payment didn't start: try again in a moment", origin);
  }
});
