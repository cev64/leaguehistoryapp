// The clubhouse's notifications: "Week 9 is final" on Tuesday morning,
// "Picks lock at 8:15 PM ET" on Thursday afternoon, "Week 9's awards are
// in" once voting closes. run.ts decides what's due and what each says;
// push.ts sends it (Web Push to browsers, APNs to the iPhone and iPad app).
//
// Called every hour by pg_cron (supabase/migrations/
// 20261021000200_clubhouse_push_schedule.sql), never by the pages:
//   POST /functions/v1/clubhouse-push
//     x-clubhouse-secret: <CLUBHOUSE_PUSH_SECRET>
//   ?dry=1               what it would send, without sending or recording
//   ?only=recap|pickem|awards
//   ?now=<ISO time>      pretend it's then (the season comes from the date,
//                        not Sleeper); with dry=1 to try a week out
//   ?league=<league_key> one league only
// Answers a report: { now, season, week, due, notes, sent, failed, removed,
// already, unsupported, skipped }. Only a dry run's lists what each
// notification says and why a league was skipped; a real run's has just
// how many (pg_net keeps the hourly run's answer in net._http_response,
// so it carries nobody's notifications). The function's log says which.
//
// What a notification carries, for the pages' service worker and the app:
//   Web Push (JSON)  { title, body, url, tag, kind, link }
//   APNs             { aps: { alert: { title, body }, sound, thread-id },
//                      kind, url, link }
//   url   https://pigskinpantheon.com/season.html?league=<current league id>
//         &season=<year>#w<week>-panel-recap (pick'em: -panel-results)
//   link  { league: <current league id>, season, week, view: "recap" | "results" }
//
// Deploy (README ▸ The clubhouse):
//   supabase secrets set CLUBHOUSE_PUSH_SECRET=… \
//     VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:… \
//     APNS_KEY_ID=… APNS_TEAM_ID=… APNS_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)" \
//     APNS_TOPIC=com.pigskinpantheon.app
//   supabase functions deploy clubhouse-push --no-verify-jwt
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set by Supabase. SITE_URL
// (optional) is the site's address, https://pigskinpantheon.com unless set.
// Without the VAPID keys browsers are skipped; without the APNs ones, the app.

import { apnsSigner, sendApns, sendWebPush, vapidSigner } from "./push.ts";
import { type Env, type Kind, KINDS, run } from "./run.ts";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const SECRET = env("CLUBHOUSE_PUSH_SECRET");

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The same length and every byte the same, in time that doesn't depend on
// where they differ.
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// The senders, set up once an instance (the keys are imported once).
let senders: Promise<Pick<Env, "webPush" | "apns">> | null = null;
function setUp(): Promise<Pick<Env, "webPush" | "apns">> {
  senders ??= (async () => {
    const out: Pick<Env, "webPush" | "apns"> = {};
    if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) {
      const sign = await vapidSigner(env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"), env("VAPID_SUBJECT") || "mailto:hello@pigskinpantheon.com");
      out.webPush = (d, payload, opts) => sendWebPush(d, payload, sign, opts);
    }
    if (env("APNS_KEY_ID") && env("APNS_TEAM_ID") && env("APNS_PRIVATE_KEY")) {
      const jwt = await apnsSigner(env("APNS_PRIVATE_KEY"), env("APNS_KEY_ID"), env("APNS_TEAM_ID"));
      const topic = env("APNS_TOPIC") || "com.pigskinpantheon.app";
      out.apns = (d, payload, opts) => sendApns(d, payload, jwt, { ...opts, topic });
    }
    return out;
  })().catch((err) => { senders = null; throw err; });
  return senders;
}

Deno.serve(async (req) => {
  if (!SECRET) return reply(501, { error: "CLUBHOUSE_PUSH_SECRET isn't set", code: "not_set_up" });
  if (!same(req.headers.get("x-clubhouse-secret") ?? "", SECRET)) return reply(401, { error: "not allowed", code: "not_allowed" });
  if (req.method !== "POST" && req.method !== "GET") return reply(405, { error: "POST only", code: "method" });

  const q = new URL(req.url).searchParams;
  const only = q.get("only");
  if (only && !KINDS.includes(only as Kind)) return reply(400, { error: "only is recap, pickem or awards", code: "bad_only" });
  const now = q.get("now") ? new Date(q.get("now")!) : undefined;
  if (now && Number.isNaN(now.getTime())) return reply(400, { error: "now is an ISO time", code: "bad_now" });
  const league = q.get("league");
  if (league && !/^([0-9]{6,24}|espn-[0-9]{1,15})$/.test(league)) return reply(400, { error: "no such league", code: "bad_league" });
  const dry = q.get("dry") === "1" || q.get("dry") === "true";

  try {
    const report = await run({ now, only: only as Kind | null, dry, league }, {
      SUPABASE_URL: env("SUPABASE_URL"),
      SERVICE_KEY: env("SUPABASE_SERVICE_ROLE_KEY"),
      SITE_URL: env("SITE_URL"),
      ...(dry ? {} : await setUp()),
    });
    console.log(`clubhouse-push: ${report.due.map((d) => `${d.kind} w${d.week}`).join(", ") || "nothing due"}; ` +
      `${report.notes.length} notes, ${report.sent} sent, ${report.failed} failed, ${report.removed} devices removed${dry ? " (dry run)" : ""}`);
    if (dry) return reply(200, report);
    for (const line of report.skipped) console.log(`clubhouse-push: skipped ${line}`);
    return reply(200, { ...report, notes: report.notes.length, skipped: report.skipped.length });
  } catch (err) {
    console.error("clubhouse-push:", err instanceof Error ? err.message : err);
    return reply(502, { error: err instanceof Error ? err.message : String(err), code: "failed" });
  }
});
