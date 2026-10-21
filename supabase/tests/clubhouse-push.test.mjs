/* The clubhouse's push sender (supabase/functions/clubhouse-push), run in
   Node: run.ts and push.ts are plain TypeScript over fetch and Web Crypto,
   and Node 22.18+ runs TypeScript as is. Two parts:

   1. The cryptography, checked against independent code: a Web Push
      payload is decrypted with `http_ece` (what the web-push npm package
      uses), and the VAPID and APNs JWTs are verified with Node's crypto.
   2. Whole runs of run() against a pretend database (PostgREST), Sleeper
      and push services (global fetch replaced): what's due when, what each
      notification says, that it's recorded before it's sent and never sent
      twice, and that dead devices are forgotten.

     mkdir -p /tmp/pgtest && (cd /tmp/pgtest && npm init -y && npm i @electric-sql/pglite web-push)
     PGLITE_DIR=/tmp/pgtest node supabase/tests/clubhouse-push.test.mjs

   (PGLITE_DIR is the folder with web-push in it, shared with
   clubhouse.test.mjs.) Exits non-zero if anything fails. */
import fs from 'fs';
import path from 'path';
import nodeCrypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FN = path.join(ROOT, 'supabase/functions/clubhouse-push');
const dir = process.env.PGLITE_DIR;
if (!dir) {
  console.error('Set PGLITE_DIR to a folder where `npm i web-push` was run (see the top of this file).');
  process.exit(2);
}
const need = createRequire(path.join(path.resolve(dir), 'package.json'));
const ece = need('http_ece');
const webpush = need('web-push');
const push = await import(path.join(FN, 'push.ts'));
const run_ = await import(path.join(FN, 'run.ts'));
const { run, recapTime, clock } = run_;

let passed = 0, failed = 0;
const outbox = [], sleeperReads = [];
const ok = (cond, what) => { if (cond) passed++; else { failed++; console.error(`  FAIL ${what}`); } };
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, `${what}\n       got  ${g}\n       want ${w}`);
};
const section = (name) => console.log(`- ${name}`);
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ------------------------------------------------------------ 1. crypto
section('Web Push: encrypted as RFC 8291 says (decrypted by http_ece)');
const browser = nodeCrypto.createECDH('prime256v1');
browser.generateKeys();
const authSecret = nodeCrypto.randomBytes(16);
const message = { title: 'Lamb Chops League', body: 'Week 9 is final. You beat Taco Truck 130.44–100.1 and you\'re 10–8.' };
const sealed = await push.encryptWebPush(new TextEncoder().encode(JSON.stringify(message)), b64u(browser.getPublicKey()), b64u(authSecret));
const opened = ece.decrypt(Buffer.from(sealed), { version: 'aes128gcm', privateKey: browser, authSecret: b64u(authSecret) });
eq(JSON.parse(opened.toString('utf8')), message, 'the browser reads what was sent');
eq([sealed.length - JSON.stringify(message).length > 86, new DataView(sealed.buffer).getUint32(16), sealed[20]], [true, 4096, 65], 'one record, rs 4096, the sender key in the header');

section('VAPID: the key pair web-push generates, and a JWT a push service accepts');
const vapid = webpush.generateVAPIDKeys();
const sign = await push.vapidSigner(vapid.publicKey, vapid.privateKey, 'mailto:hello@pigskinpantheon.com');
const header = await sign('https://fcm.googleapis.com/fcm/send/abc');
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header) || [];
eq(k, vapid.publicKey, 'k is the public key');
const verifyJwt = (token, publicKey) => {
  const [h, c, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(c, 'base64url')),
    valid: nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')),
  };
};
const vapidPub = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256',
  x: b64u(Buffer.from(vapid.publicKey, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(vapid.publicKey, 'base64url').subarray(33)) }, format: 'jwk' });
let v = verifyJwt(jwt, vapidPub);
eq([v.valid, v.header.alg, v.claims.aud, v.claims.sub], [true, 'ES256', 'https://fcm.googleapis.com', 'mailto:hello@pigskinpantheon.com'], 'signed by the VAPID key, for the push service');
ok(v.claims.exp > Date.now() / 1000 + 11 * 3600 && v.claims.exp <= Date.now() / 1000 + 24 * 3600, 'expires in 12 hours (at most 24)');

section('APNs: a provider token from a .p8 key');
const { privateKey: apnsPriv, publicKey: apnsPub } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = apnsPriv.export({ type: 'pkcs8', format: 'pem' });
for (const [what, text] of [['as the file', p8], ['pasted with \\n for line breaks', p8.replace(/\n/g, '\\n')]]) {
  const token = await (await push.apnsSigner(text, 'ABC123DEFG', 'TEAM123456'))();
  v = verifyJwt(token, apnsPub);
  eq([v.valid, v.header.alg, v.header.kid, v.claims.iss, Math.abs(v.claims.iat - Date.now() / 1000) < 5], [true, 'ES256', 'ABC123DEFG', 'TEAM123456', true], `the key ${what}`);
}

section('VAPID: signed again when less than an hour is left');
{
  const realNow = Date.now;
  const sign2 = await push.vapidSigner(vapid.publicKey, vapid.privateKey, 'mailto:hello@pigskinpantheon.com');
  const first = await sign2('https://fcm.googleapis.com/fcm/send/a');
  eq(await sign2('https://fcm.googleapis.com/fcm/send/b'), first, 'the same JWT for the same push service');
  try {
    Date.now = () => realNow() + 10 * 3600e3;
    eq(await sign2('https://fcm.googleapis.com/fcm/send/a'), first, '10 hours on (2 left): still the same');
    Date.now = () => realNow() + 11.5 * 3600e3;
    const later = await sign2('https://fcm.googleapis.com/fcm/send/a');
    const exp = verifyJwt(/t=([^,]+)/.exec(later)[1], vapidPub).claims.exp;
    ok(later !== first && exp > realNow() / 1000 + 23 * 3600, '11½ hours on (½ left): a new one, good for 12 more');
  } finally { Date.now = realNow; }
}

section('Web Push: only to the browsers\' push services');
for (const good of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
  'https://web.push.apple.com/QGuQyavXutnMH6Yo8EmBNO', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) ok(push.pushEndpointOk(good), `${good} is one`);
for (const bad of ['http://fcm.googleapis.com/fcm/send/abc', 'https://evil.example/fcm/send/abc', 'https://fcm.googleapis.com.evil.example/x',
  'https://fcm.googleapis.com@evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
  'https://fcm.googleapis.com:443/x', 'https://FCM.googleapis.com/x', 'https://fcm.googleapis.com./x', 'https://169.254.169.254/latest/meta-data',
  'https://localhost/x', 'https://evilpush.apple.com/x', 'https://push.apple.com/x', 'https://fcm.googleapis.com/a b', 'nonsense']) {
  ok(!push.pushEndpointOk(bad), `${bad} isn't`);
}
const before = outbox.length;
let sent = await push.sendWebPush({ token: 'https://evil.example/x', p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) }, {}, sign, { ttl: 60 });
eq([sent.ok, sent.gone, outbox.length - before], [false, true, 0], 'an address elsewhere is never posted to, and is gone');
sent = await push.sendWebPush({ token: 'https://fcm.googleapis.com/fcm/send/k', p256dh: 'AAAA', auth: 'BBBB' }, {}, sign, { ttl: 60 });
eq([sent.ok, sent.gone, /bad keys/.test(sent.reason), outbox.length - before], [false, true, true, 0], 'keys that can\'t be used: gone');

section('safe text');
const ctl = (n) => String.fromCharCode(n);
eq(run_.safeText(`Lamb${ctl(10)}Chops${ctl(0x202e)} ${ctl(7)}League${ctl(0x200b)}`, 60), 'Lamb Chops League', 'control, zero-width and direction characters out');
eq([run_.safeText('x'.repeat(300), 200).length, run_.safeText('x'.repeat(300), 200).endsWith('…')], [200, true], 'cut to length, with an ellipsis');
eq(run_.safeText(null, 10), '', 'nothing is nothing');

section('times, in Eastern');
eq(recapTime(new Date('2026-11-06T01:15:00Z')).toISOString(), '2026-11-10T14:00:00.000Z', 'week 9 (Thu Nov 5): the recap from Tue Nov 10, 9 AM EST');
eq(recapTime(new Date('2026-09-10T00:20:00Z')).toISOString(), '2026-09-15T13:00:00.000Z', 'week 1 (Wed Sep 9): Tue Sep 15, 9 AM EDT');
eq(recapTime(new Date('2027-01-09T18:00:00Z')).toISOString(), '2027-01-12T14:00:00.000Z', 'week 18 (a Saturday): Tue Jan 12');
eq(recapTime(new Date('2026-10-30T00:15:00Z')).toISOString(), '2026-11-03T14:00:00.000Z', 'week 8 kicks off in EDT, its Tuesday is in EST');
eq([clock(new Date('2026-11-13T01:15:00Z')), clock(new Date('2026-11-26T17:30:00Z'))], ['8:15 PM ET', '12:30 PM ET'], 'lock times');

// ------------------------------------------------------------ 2. whole runs
/* The pretend world, 2026: the real schedule (the nfl_weeks seed), one
   Sleeper league of four teams and one ESPN league.

   Lamb Chops (ann, r1) and Bear Claws (r3) win every odd week, Taco Truck
   (r2) and Night Owls (eve, r4) every even one, with the median on: by
   week 9 ann is 10–8 and eve 4–14. */
const seed = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261021000100_nfl_weeks_2026.sql'), 'utf8');
const K = Object.fromEntries([...seed.matchAll(/\(2026,\s*(\d+), '([^']+)'\)/g)].map((m) => [Number(m[1]), m[2]]));
K[19] = '2027-01-15T01:15:00.000Z'; // the formula: Thu Jan 14, 8:15 PM EST

const SUPA = 'https://project.supabase.test';
const U = { ann: 'u-ann', bob: 'u-bob', cat: 'u-cat', dan: 'u-dan', eve: 'u-eve', mal: 'u-mal' };
// L1 is the league's key (its 2024 season), M1 its 2025 season and S1 its
// 2026 one: S1 → M1 → L1 on Sleeper. ATT is someone else's league.
const L1 = '1100000000000000001', M1 = '1150000000000000001', S1 = '1200000000000000001', E1 = 'espn-555';
const ATT = '1900000000000000666', LOOPA = '1400000000000000001', LOOPB = '1400000000000000002';
const LONG = (i) => `13000000000000000${String(i).padStart(2, '0')}`;
const FCM = 'https://fcm.googleapis.com/fcm/send';
let tables;
const saw = (id, season = 2026, name = 'Lamb Chops League') => ({ seen_league_id: id, seen_season: season, seen_name: name });
function reset() {
  tables = {
    // What each member's page saw (claim_manager's seen_*): the newest
    // season's id, the season, the league's name.
    league_members: [
      { league_key: L1, owner_id: 'ownerA', user_id: U.ann, notify_recap: true, notify_pickem: true, notify_awards: true, ...saw(S1) },
      { league_key: L1, owner_id: 'ownerB', user_id: U.bob, notify_recap: false, notify_pickem: true, notify_awards: true, ...saw(S1) },
      { league_key: L1, owner_id: 'ownerD', user_id: U.dan, notify_recap: true, notify_pickem: true, notify_awards: true, ...saw(S1) },
      { league_key: L1, owner_id: 'ownerE', user_id: U.eve, notify_recap: true, notify_pickem: true, notify_awards: true, ...saw(S1) },
      { league_key: E1, owner_id: '{SWID-CAT}', user_id: U.cat, notify_recap: true, notify_pickem: true, notify_awards: true, ...saw(E1, 2026, 'Office League') },
    ],
    push_devices: [
      { id: 1, user_id: U.ann, kind: 'web', token: `${FCM}/ann`, p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret), apns_env: null, failures: 0 },
      { id: 2, user_id: U.ann, kind: 'apns', token: 'aa'.repeat(32), p256dh: null, auth: null, apns_env: 'sandbox', failures: 0 },
      { id: 3, user_id: U.eve, kind: 'web', token: `${FCM}/eve-gone`, p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret), apns_env: null, failures: 0 },
      { id: 4, user_id: U.cat, kind: 'apns', token: 'cc'.repeat(32), p256dh: null, auth: null, apns_env: 'production', failures: 0 },
      { id: 5, user_id: U.bob, kind: 'apns', token: 'bb'.repeat(32), p256dh: null, auth: null, apns_env: 'production', failures: 0 },
    ],
    // The sender's own: nothing checked yet.
    clubhouse_leagues: [],
    push_sends: [],
    pickem_picks: [{ league_key: L1, season: 2026, week: 10, user_id: U.eve, game: 'r1|r4', winner: 'r4' }],
    award_votes: [
      { league_key: L1, season: 2026, week: 9, award: 'mvp', nominee: 'r3', user_id: U.ann },
      { league_key: L1, season: 2026, week: 9, award: 'mvp', nominee: 'r3', user_id: U.bob },
      { league_key: L1, season: 2026, week: 9, award: 'mvp', nominee: 'r1', user_id: U.eve },
      { league_key: L1, season: 2026, week: 9, award: 'choke', nominee: 'r4', user_id: U.ann },
    ],
  };
}
const sleeper = {
  league: { name: 'Lamb Chops League', season: '2026', previous_league_id: M1, settings: { playoff_week_start: 15, start_week: 1, league_average_match: 1 } },
  // Every other league Sleeper knows, by id.
  leagues: {
    [M1]: { name: 'Lamb Chops League', season: '2025', previous_league_id: L1 },
    [L1]: { name: 'Lamb Chops League', season: '2024', previous_league_id: null },
    [ATT]: { name: 'FREE MONEY click here', season: '2026', previous_league_id: null },
    // Two leagues that name each other, and a chain of 42 renewals back to L1.
    [LOOPA]: { name: 'Loop', season: '2026', previous_league_id: LOOPB },
    [LOOPB]: { name: 'Loop', season: '2025', previous_league_id: LOOPA },
    ...Object.fromEntries(Array.from({ length: 42 }, (_, i) => [LONG(i), { name: 'Long', season: '2026', previous_league_id: i === 41 ? L1 : LONG(i + 1) }])),
  },
  noGames: new Set([12]),
  rosters: [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: ['ownerA', 'ownerB', 'ownerD', 'ownerE'][id - 1], co_owners: null })),
  users: [
    { user_id: 'ownerA', display_name: 'ann', metadata: { team_name: 'Lamb Chops' } },
    { user_id: 'ownerB', display_name: 'bob', metadata: { team_name: 'Taco Truck' } },
    { user_id: 'ownerD', display_name: 'dan', metadata: { team_name: 'Bear Claws' } },
    { user_id: 'ownerE', display_name: 'eve', metadata: {} },
  ],
  matchups(week) {
    if (this.noGames.has(week)) return [];
    if (week > 9) return week <= 14 ? [1, 2, 3, 4].map((id) => ({ roster_id: id, matchup_id: id <= 2 ? 1 : 2, points: 0 })) : [];
    const odd = week % 2 === 1;
    const pts = odd ? { 1: 130.44, 2: 100.1, 3: 120, 4: 90 } : { 1: 95, 2: 125, 3: 105, 4: 115 };
    const game = odd ? { 1: 1, 2: 1, 3: 2, 4: 2 } : { 1: 1, 3: 1, 2: 2, 4: 2 };
    return [1, 2, 3, 4].map((id) => ({ roster_id: id, matchup_id: game[id], points: pts[id], custom_points: null }));
  },
};

// PostgREST, as far as the sender uses it: eq / in / gte filters, order,
// limit and offset (at most 1000 rows an answer, as Supabase's max-rows),
// an insert that ignores or merges duplicates, an update, a delete.
const KEYS = { push_sends: ['user_id', 'league_key', 'kind', 'season', 'week'], clubhouse_leagues: ['league_key'] };
const PAGING = new Set(['select', 'on_conflict', 'order', 'limit', 'offset']);
function filters(url) {
  const out = [];
  for (const [col, raw] of url.searchParams) {
    if (PAGING.has(col)) continue;
    const m = /^(eq|in|gte)\.(.*)$/.exec(raw);
    if (!m) throw new Error(`filter ${col}=${raw}`);
    if (m[1] === 'gte') { out.push((row) => row[col] != null && Number(row[col]) >= Number(m[2])); continue; }
    const values = m[1] === 'eq' ? [m[2]] : m[2].replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
    out.push((row) => values.includes(String(row[col])));
  }
  return (row) => out.every((f) => f(row));
}
const reads = [];
function page(url, rows) {
  const order = (url.searchParams.get('order') || '').split(',').filter(Boolean);
  const sorted = order.length ? rows.slice().sort((x, y) => {
    for (const c of order) { const a = String(x[c] ?? ''), b = String(y[c] ?? ''); if (a !== b) return a < b ? -1 : 1; }
    return 0;
  }) : rows;
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
  return sorted.slice(offset, offset + limit);
}

let webAnswer = () => 201, apnsAnswer = () => ({ status: 200 });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const json = (body, status = 200) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.origin === SUPA) {
    if (init.headers?.Authorization !== 'Bearer service-key') return json({ message: 'no key' }, 401);
    const [, , , what] = url.pathname.split('/'); // /rest/v1/<table or rpc>
    if (what === 'rpc') {
      const { p_season, p_week } = JSON.parse(init.body);
      return p_season === 2026 && K[p_week] ? json(K[p_week]) : json({ message: 'no week' }, 400);
    }
    const table = tables[what];
    if (!table) return json({ message: `no table ${what}` }, 404);
    const method = init.method || 'GET';
    if (method === 'GET') { reads.push(url.href); return json(page(url, table.filter(filters(url)))); }
    if (method === 'DELETE') { tables[what] = table.filter((r) => !filters(url)(r)); return json(undefined, 204); }
    if (method === 'PATCH') { table.filter(filters(url)).forEach((r) => Object.assign(r, JSON.parse(init.body))); return json(undefined, 204); }
    if (method === 'POST') {
      const row = JSON.parse(init.body);
      const key = KEYS[what] || [];
      const there = table.find((r) => key.every((c) => String(r[c]) === String(row[c])));
      if (there && /merge-duplicates/.test(init.headers?.Prefer || '')) { Object.assign(there, row); return json(undefined, 201); }
      if (there) return json([], 201);
      table.push(row);
      return json([row], 201);
    }
  }
  if (url.origin === 'https://api.sleeper.app') {
    if (url.pathname === '/v1/state/nfl') return json({ week: 11, season: '2026', season_type: 'regular' });
    const m = /^\/v1\/league\/(\d+)(?:\/(rosters|users|matchups)(?:\/(\d+))?)?$/.exec(url.pathname);
    if (!m) return json(null, 404);
    sleeperReads.push(m[1]);
    if (m[1] !== S1) return json(m[2] ? [] : sleeper.leagues[m[1]] ?? null); // Sleeper answers null for no such league
    if (!m[2]) return json(sleeper.league);
    if (m[2] === 'matchups') return json(sleeper.matchups(Number(m[3])));
    return json(sleeper[m[2]]);
  }
  if (url.origin === 'https://fcm.googleapis.com') {
    outbox.push({ to: url.href, headers: init.headers, body: init.body, redirect: init.redirect });
    const status = webAnswer(url.href);
    return new Response('', { status, headers: status >= 300 && status < 400 ? { Location: 'http://169.254.169.254/' } : {} });
  }
  if (url.host === 'api.push.apple.com' || url.host === 'api.sandbox.push.apple.com') {
    outbox.push({ to: url.href, headers: init.headers, body: JSON.parse(init.body), redirect: init.redirect });
    const a = apnsAnswer(url.href);
    return json(a.reason ? { reason: a.reason } : undefined, a.status);
  }
  throw new Error(`unexpected fetch ${url.href}`);
};

const jwtFor = await push.apnsSigner(p8, 'ABC123DEFG', 'TEAM123456');
const env = {
  SUPABASE_URL: SUPA, SERVICE_KEY: 'service-key',
  webPush: (d, payload, opts) => push.sendWebPush(d, payload, sign, opts),
  apns: (d, payload, opts) => push.sendApns(d, payload, jwtFor, { ...opts, topic: 'com.pigskinpantheon.app' }),
};
const at = (iso) => new Date(iso);
const said = (report) => report.notes.map((n) => `${n.kind} ${n.user_id}: ${n.body}`).sort();

section('nothing is due mid-week');
reset();
let report = await run({ now: at('2026-11-09T15:00:00Z'), dry: true }, env); // Mon Nov 9, 10 AM EST
eq([report.season, report.week, report.due], [2026, 9, []], 'Monday of week 9: the week is still going');
report = await run({ now: at('2026-11-10T13:30:00Z'), dry: true }, env); // Tue 8:30 AM EST
eq(report.due, [], 'Tuesday 8:30 AM: not yet');

section('recap: Tuesday after week 9 (dry run)');
report = await run({ now: at('2026-11-10T14:05:00Z'), dry: true }, env); // Tue 9:05 AM EST
eq(report.due, [{ kind: 'recap', week: 9 }], 'the week 9 recap is due');
eq(said(report), [
  "recap u-ann: Week 9 is final. You beat Taco Truck 130.44–100.1 and you're 10–8.",
  'recap u-cat: Week 9 is final. See the recap and vote on the week\'s awards.',
  "recap u-eve: Week 9 is final. Bear Claws got you 120–90. You're 4–14.",
], 'a personal line for Sleeper, a plain one for ESPN; not bob (recap off) or dan (no device)');
const annNote = report.notes.find((n) => n.user_id === U.ann);
eq([annNote.title, annNote.url, annNote.link, annNote.devices],
  ['Lamb Chops League', `https://pigskinpantheon.com/season.html?league=${S1}&season=2026#w9-panel-recap`, { league: S1, season: 2026, week: 9, view: 'recap' }, 2],
  'the title, the deep links and her two devices');
eq([tables.push_sends.length, outbox.length], [0, 0], 'a dry run records and sends nothing');
report = await run({ now: at('2026-11-12T23:00:00Z'), dry: true, only: 'recap' }, env);
eq(report.due, [{ kind: 'recap', week: 9 }], 'still due Thursday afternoon');
report = await run({ now: at('2026-11-10T14:05:00Z'), dry: true, league: E1 }, env);
eq(said(report).length, 1, '?league= keeps to one league');

section('recap: sent for real');
webAnswer = (to) => (to.endsWith('eve-gone') ? 410 : 201);
apnsAnswer = (to) => (to.includes('cccc') ? { status: 400, reason: 'BadDeviceToken' } : { status: 200 });
report = await run({ now: at('2026-11-10T14:05:00Z') }, env);
eq([report.sent, report.failed, report.removed], [2, 2, 2], 'ann\'s two devices took it; eve\'s browser (410) and cat\'s token (BadDeviceToken) are gone');
eq(tables.push_sends.map((r) => `${r.user_id} ${r.kind} ${r.season} w${r.week} ${r.league_key}`).sort(),
  [`u-ann recap 2026 w9 ${L1}`, `u-cat recap 2026 w9 ${E1}`, `u-eve recap 2026 w9 ${L1}`], 'each recorded once');
eq(tables.push_devices.map((d) => d.id).sort(), [1, 2, 5], 'the dead devices are forgotten');
const web = outbox.find((m) => m.to.endsWith('/send/ann'));
const webPayload = JSON.parse(ece.decrypt(Buffer.from(web.body), { version: 'aes128gcm', privateKey: browser, authSecret: b64u(authSecret) }).toString());
eq(webPayload, {
  title: 'Lamb Chops League', body: "Week 9 is final. You beat Taco Truck 130.44–100.1 and you're 10–8.",
  url: `https://pigskinpantheon.com/season.html?league=${S1}&season=2026#w9-panel-recap`,
  tag: `recap-${L1}-2026-9`, kind: 'recap', link: { league: S1, season: 2026, week: 9, view: 'recap' },
}, 'the browser gets the whole payload');
eq([web.headers['Content-Encoding'], web.headers.Urgency, Number(web.headers.TTL) > 86000, /^vapid t=.+, k=/.test(web.headers.Authorization)],
  ['aes128gcm', 'normal', true, true], 'with Web Push\'s headers');
const apple = outbox.find((m) => m.to === `https://api.sandbox.push.apple.com/3/device/${'aa'.repeat(32)}`);
ok(apple, 'ann\'s debug build goes to the APNs sandbox');
eq(apple.body, {
  aps: { alert: { title: 'Lamb Chops League', body: "Week 9 is final. You beat Taco Truck 130.44–100.1 and you're 10–8." }, sound: 'default', 'thread-id': L1 },
  kind: 'recap', url: `https://pigskinpantheon.com/season.html?league=${S1}&season=2026#w9-panel-recap`,
  link: { league: S1, season: 2026, week: 9, view: 'recap' },
}, 'the app gets an alert and the link');
eq([apple.headers['apns-topic'], apple.headers['apns-push-type'], apple.headers['apns-collapse-id'], /^bearer ey/.test(apple.headers.authorization)],
  ['com.pigskinpantheon.app', 'alert', `recap-${L1}-2026-9`, true], 'with APNs\' headers');
const sentBefore = outbox.length;
report = await run({ now: at('2026-11-10T15:05:00Z') }, env);
eq([report.notes.length, report.already, outbox.length - sentBefore], [0, 1, 0], 'the next hour: ann already has it, nothing goes twice');

section('pickem: Thursday afternoon before week 10');
// (Week 9's recap stays due until week 10 kicks off, for anyone who
// turns it on late: ?only=pickem keeps to the reminder.)
report = await run({ now: at('2026-11-12T20:30:00Z'), dry: true, only: 'pickem' }, env); // Thu 3:30 PM EST, 4h45 before
eq(report.due, [], '3:30 PM: too early');
report = await run({ now: at('2026-11-12T21:00:00Z'), dry: true, only: 'pickem' }, env); // 4:00 PM EST
eq(report.due, [{ kind: 'pickem', week: 10 }], '4:00 PM: the reminder is due');
eq(said(report), [
  'pickem u-ann: Picks lock at 8:15 PM ET. Make your Week 10 picks in Lamb Chops League.',
  'pickem u-bob: Picks lock at 8:15 PM ET. Make your Week 10 picks in Lamb Chops League.',
], 'to members without picks (not eve, who has picked; cat has no device left)');
eq(report.notes[0].url, `https://pigskinpantheon.com/season.html?league=${S1}&season=2026#w10-panel-results`, 'opening the week\'s matchups');
report = await run({ now: at('2026-11-13T01:05:00Z'), dry: true, only: 'pickem' }, env);
eq(report.due, [], '10 minutes before: too late to be useful');

section('awards: once week 9\'s voting closes');
report = await run({ now: at('2026-11-13T02:00:00Z'), dry: true }, env); // Thu 9 PM EST
eq(report.due, [{ kind: 'awards', week: 9 }], 'week 10 has kicked off: week 9\'s awards are in');
eq(said(report), [
  "awards u-ann: Week 9's awards are in: Bear Claws is Manager of the Week.",
  "awards u-bob: Week 9's awards are in: Bear Claws is Manager of the Week.",
], 'the most votes wins');
tables.award_votes.push({ league_key: L1, season: 2026, week: 9, award: 'mvp', nominee: 'r1', user_id: U.dan });
report = await run({ now: at('2026-11-13T02:00:00Z'), dry: true }, env);
eq(said(report)[0], "awards u-ann: Week 9's awards are in: Lamb Chops and Bear Claws share Manager of the Week.", 'a tie shares it');
tables.award_votes = tables.award_votes.filter((x) => !(x.user_id === U.bob || x.user_id === U.ann && x.award === 'mvp'));
report = await run({ now: at('2026-11-13T02:00:00Z'), dry: true }, env);
eq(said(report)[0], "awards u-ann: Week 9's awards are in: you're Manager of the Week!", 'and a winner hears it as theirs');
tables.award_votes = [];
report = await run({ now: at('2026-11-13T02:00:00Z'), dry: true }, env);
eq([report.notes.length, report.skipped], [0, [`awards ${L1}: nothing to say`]], 'nobody voted: no notification');
report = await run({ now: at('2026-11-13T15:00:00Z'), dry: true }, env);
eq(report.due, [], '13 hours later: too late');

section('the rest of the season');
reset();
report = await run({ now: at('2026-12-15T15:00:00Z'), dry: true, only: 'recap' }, env); // Tue after week 14
eq(said(report).filter((s) => s.includes('u-ann')), [], 'week 14 has no scores in the pretend league: no recap');
ok(report.skipped.includes(`recap ${L1}: nothing to say`), 'and says why');
report = await run({ now: at('2026-12-17T22:00:00Z'), dry: true, only: 'pickem' }, env); // Thu before week 15
eq([report.due, said(report)], [[{ kind: 'pickem', week: 15 }], []],
  'week 15 is the Sleeper league\'s playoffs (no pick\'em), and the ESPN league didn\'t pick in week 14');
tables.league_members.filter((m) => m.league_key === L1).forEach((m) => Object.assign(m, saw(M1, 2025)));
report = await run({ now: at('2026-11-10T14:05:00Z'), dry: true }, env);
ok(report.skipped.includes(`recap ${L1}: not opened this season`) && said(report).length === 1, 'a league nobody has opened this season is left out');

const TUESDAY = '2026-11-10T14:05:00Z'; // the week 9 recap
const ctrl = (n) => String.fromCharCode(n);
const member = (owner, user, seenAs, extra = {}) => ({ league_key: L1, owner_id: owner, user_id: user, notify_recap: true, notify_pickem: true, notify_awards: true, ...seenAs, ...extra });
const webDevice = (id, user, token, extra = {}) => ({ id, user_id: user, kind: 'web', token, p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret), apns_env: null, failures: 0, ...extra });
webAnswer = () => 201; apnsAnswer = () => ({ status: 200 });

section('which league: only one Sleeper says leads back to the key');
reset();
// mal claims a manager nobody has and says the league is now ATT, and so do
// four friends: more pages saw ATT than S1.
tables.league_members.push(member('ownerZ', U.mal, saw(ATT, 2026, 'FREE MONEY')),
  ...[1, 2, 3, 4].map((i) => member(`ownerZ${i}`, `u-mal${i}`, saw(ATT, 2026))));
tables.push_devices.push(webDevice(9, U.mal, `${FCM}/mal`));
sleeperReads.length = 0;
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
eq(said(report).filter((x) => x.includes('u-mal')), [], 'a claim on no manager of the league gets nothing');
ok(report.skipped.includes(`recap ${L1}: 1 claim on no manager of the league`), 'and the report says so');
eq(report.notes.filter((n) => n.league_key === L1).map((n) => [n.title, n.link.league]), [['Lamb Chops League', S1], ['Lamb Chops League', S1]],
  'everyone else\'s notification is Sleeper\'s name and S1, the season that leads back to the key');
ok(sleeperReads.includes(ATT) && sleeperReads.includes(M1), 'ATT was tried first (most pages saw it) and doesn\'t lead back; S1 → M1 → L1 does');
eq(tables.clubhouse_leagues, [], 'a dry run keeps nothing');
report = await run({ now: at(TUESDAY), only: 'recap' }, env);
const row = tables.clubhouse_leagues[0];
eq([tables.clubhouse_leagues.length, row.league_key, row.source, row.current_league_id, row.current_season, row.name, row.verified_at],
  [1, L1, 'sleeper', S1, 2026, 'Lamb Chops League', TUESDAY.replace('Z', '.000Z')], 'a real run keeps the checked league');
ok(!outbox.some((m) => m.to.endsWith('/mal')), 'nothing went to mal');

tables.league_members.filter((m) => m.league_key === L1).forEach((m) => Object.assign(m, saw(ATT)));
tables.push_sends = [];
sleeperReads.length = 0;
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
eq([report.notes.filter((n) => n.league_key === L1).map((n) => n.link.league), sleeperReads.includes(ATT)], [[S1, S1], false],
  'once checked, the league stays S1 whatever the pages say (and nothing else is tried)');
report = await run({ now: at(TUESDAY), only: 'recap' }, env);
eq(tables.clubhouse_leagues.map((r) => r.current_league_id), [S1], 'and a real run doesn\'t replace it');

tables.clubhouse_leagues = [];
tables.push_sends = [];
report = await run({ now: at(TUESDAY), only: 'recap' }, env);
eq([report.notes.filter((n) => n.league_key === L1).length, tables.clubhouse_leagues],
  [0, []], 'when no season the pages saw leads back, the league gets nothing, and nothing is kept');
ok(report.skipped.includes(`recap ${L1}: no 2026 league on Sleeper that leads back to it`), 'and the report says why');

tables.league_members.filter((m) => m.league_key === L1).forEach((m) => Object.assign(m, saw(LOOPA)));
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
ok(report.skipped.includes(`recap ${L1}: no 2026 league on Sleeper that leads back to it`), 'two leagues naming each other end it');
tables.league_members.filter((m) => m.league_key === L1).forEach((m) => Object.assign(m, saw(LONG(0))));
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
ok(report.skipped.includes(`recap ${L1}: no 2026 league on Sleeper that leads back to it`), '42 seasons back is too far (40 at most)');
tables.league_members.filter((m) => m.league_key === L1).forEach((m) => Object.assign(m, saw(LONG(5))));
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
ok(report.skipped.includes(`recap ${L1}: 3 claims on no manager of the league`), '37 back is fine (and none of its managers have claimed: ann, eve and mal get nothing)');

section('names in a notification are made safe');
reset();
const was = { league: sleeper.league.name, team: sleeper.users[1].metadata.team_name };
sleeper.league.name = `Lamb${ctrl(10)}Chops ${ctrl(0x202e)}League`;
sleeper.users[1].metadata.team_name = `Taco${ctrl(7)}${ctrl(13)}Truck ${'z'.repeat(60)}`;
tables.league_members.find((m) => m.user_id === U.cat).seen_name = `Office${ctrl(0x2028)}League${ctrl(0x200f)}`;
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
const ann9 = report.notes.find((n) => n.user_id === U.ann);
eq([ann9.title, ann9.body], ['Lamb Chops League', `Week 9 is final. You beat Taco Truck ${'z'.repeat(28)}… 130.44–100.1 and you're 10–8.`],
  'Sleeper\'s names lose their control characters, and a team\'s is cut at 40');
eq(report.notes.find((n) => n.user_id === U.cat).title, 'Office League', 'an ESPN member\'s title is the name their own page saw, made safe');
tables.league_members.find((m) => m.user_id === U.cat).seen_name = null;
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
eq(report.notes.find((n) => n.user_id === U.cat).title, 'Your ESPN league', 'or, without one, "Your ESPN league"');
sleeper.league.name = was.league; sleeper.users[1].metadata.team_name = was.team;

section('devices: no redirects, failures counted, the APNs environment kept');
reset();
tables.push_devices[0].failures = 3;
tables.push_devices.push(
  webDevice(10, U.dan, `${FCM}/dan-bad-keys`, { p256dh: 'AAAA', auth: 'BBBB' }),
  webDevice(11, U.dan, 'https://169.254.169.254/latest/meta-data'),
  webDevice(12, U.dan, `${FCM}/dan-redirect`));
webAnswer = (to) => (to.endsWith('eve-gone') ? 500 : to.endsWith('dan-redirect') ? 301 : 201);
outbox.length = 0;
report = await run({ now: at(TUESDAY), only: 'recap' }, env);
const dev = (id) => tables.push_devices.find((d) => d.id === id);
eq([dev(10), dev(11)], [undefined, undefined], 'keys that can\'t be used and an address that isn\'t a push service are forgotten');
ok(!outbox.some((m) => /dan-bad-keys|169\.254/.test(m.to)), 'without posting anything to them');
eq([dev(12).failures, dev(3).failures, dev(1).failures], [1, 1, 0], 'a redirect and a 500 count a failure each; a send that gets through clears them');
ok(outbox.length > 0 && outbox.every((m) => m.redirect === 'manual'), 'no redirect is followed');
const annWeb = outbox.find((m) => m.to.endsWith('/send/ann'));
const topic = `recap9-${nodeCrypto.createHash('sha256').update(L1).digest().subarray(0, 6).toString('base64url')}`;
eq([annWeb.headers.Topic, annWeb.headers.Topic.length <= 32, /^[A-Za-z0-9_-]+$/.test(annWeb.headers.Topic)], [topic, true, true],
  'the Topic is the kind, the week and the league, in at most 32 URL-safe characters');
for (let i = 2; i <= 5; i++) {
  tables.push_sends = [];
  report = await run({ now: at(TUESDAY), only: 'recap' }, env);
  if (i === 4) eq([dev(3)?.failures, dev(12)?.failures], [4, 4], 'four in a row: still kept');
}
eq([dev(3), dev(12)], [undefined, undefined], 'five in a row: forgotten');

reset();
tables.league_members.push({ league_key: E1, owner_id: '{SWID-ANN}', user_id: U.ann, notify_recap: true, ...saw(E1) });
webAnswer = () => 503;
apnsAnswer = () => ({ status: 403, reason: 'InvalidProviderToken' });
report = await run({ now: at(TUESDAY), only: 'recap' }, env);
eq([report.notes.filter((n) => n.user_id === U.ann).length, dev(1).failures], [2, 1], 'an outage counts once a run, however many notifications a device was sent');
eq([dev(2).failures, dev(4).failures], [0, 0], 'and the sender\'s own key refused (403) doesn\'t count against the device');
webAnswer = () => 201; apnsAnswer = () => ({ status: 200 });

reset();
outbox.length = 0;
apnsAnswer = (to) => (to.includes('bbbb') && to.startsWith('https://api.push.apple.com/') ? { status: 400, reason: 'BadDeviceToken' } : { status: 200 });
report = await run({ now: at('2026-11-12T21:00:00Z'), only: 'pickem' }, env);
eq(outbox.filter((m) => m.to.includes('bbbb')).map((m) => new URL(m.to).host), ['api.push.apple.com', 'api.sandbox.push.apple.com'],
  'a token production calls BadDeviceToken is tried once on the sandbox');
eq([dev(5)?.apns_env, report.removed], ['sandbox', 0], 'which took it: the device is kept, as a sandbox one');
apnsAnswer = () => ({ status: 200 });

section('reading every row, a page at a time');
reset();
for (let i = 0; i < 1100; i++) {
  tables.push_sends.push({ user_id: `u-${String(i).padStart(4, '0')}`, league_key: L1, kind: 'recap', season: 2026, week: 9 });
  tables.league_members.push({ league_key: E1, owner_id: `a${String(i).padStart(4, '0')}`, user_id: `u-${String(i).padStart(4, '0')}`, notify_recap: true, ...saw(E1) });
}
tables.push_sends.push({ user_id: U.ann, league_key: L1, kind: 'recap', season: 2026, week: 9 });
reads.length = 0;
report = await run({ now: at(TUESDAY), dry: true, only: 'recap' }, env);
eq([said(report).some((x) => x.includes('u-ann')), report.already], [false, 1], 'ann\'s recap, past the first 1000 sends, is seen as sent');
ok(said(report).some((x) => x.includes('u-cat')), 'cat, past the first 1000 members, is still sent to');
ok(reads.some((r) => r.includes('push_sends') && r.includes('offset=1000')) && reads.some((r) => r.includes('league_members') && r.includes('offset=1000')),
  'both read on past 1000');

section('week 18\'s awards, and weeks with nothing to pick');
reset();
tables.award_votes = [U.ann, U.bob].map((u) => ({ league_key: L1, season: 2026, week: 18, award: 'mvp', nominee: 'r3', user_id: u }));
report = await run({ now: at('2027-01-15T02:00:00Z'), dry: true }, env);
eq([report.due, said(report)], [[{ kind: 'awards', week: 18 }], [
  "awards u-ann: Week 18's awards are in: Bear Claws is Manager of the Week.",
  "awards u-bob: Week 18's awards are in: Bear Claws is Manager of the Week.",
  "awards u-eve: Week 18's awards are in: Bear Claws is Manager of the Week.",
]], 'week 18\'s awards go once its voting closes (the formula\'s week 19 kickoff)');
report = await run({ now: at('2027-01-15T14:00:00Z'), dry: true }, env);
eq(report.due, [], 'and not 12 hours after');
report = await run({ now: at('2026-11-25T21:00:00Z'), dry: true, only: 'pickem' }, env); // 4 hours before week 12
eq([report.due, said(report)], [[{ kind: 'pickem', week: 12 }], [`pickem u-cat: Picks lock at ${clock(new Date(K[12]))}. Make your Week 12 picks.`]],
  'a Sleeper week without matchups has nothing to pick (the ESPN league, through week 14, is reminded)');
ok(report.skipped.includes(`pickem ${L1}: nothing to say`), 'and the report says so');
tables.league_members.push({ league_key: E1, owner_id: '{SWID-FAY}', user_id: 'u-fay', notify_pickem: true, ...saw(E1) });
tables.pickem_picks.push({ league_key: E1, season: 2026, week: 15, user_id: 'u-fay', game: 'e1|e2', winner: 'e1' });
report = await run({ now: at('2026-12-17T22:00:00Z'), dry: true, only: 'pickem' }, env);
eq(said(report), [`pickem u-cat: Picks lock at ${clock(new Date(K[15]))}. Make your Week 15 picks.`],
  'past week 14, an ESPN league is reminded once someone there has picked the week (it has games)');

section('the hourly run answers counts only');
{
  const secret = 'sekrit';
  const vars = { CLUBHOUSE_PUSH_SECRET: secret, SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
  let handler = null;
  globalThis.Deno = { env: { get: (k) => vars[k] }, serve: (h) => { handler = h; } };
  await import(path.join(FN, 'index.ts'));
  reset();
  const call = async (q) => (await handler(new Request(`${SUPA}/functions/v1/clubhouse-push?${q}`, { method: 'POST', headers: { 'x-clubhouse-secret': secret } }))).json();
  const real = await call(`now=${TUESDAY}&only=recap`);
  eq([typeof real.notes, typeof real.skipped, real.due], ['number', 'number', [{ kind: 'recap', week: 9 }]], 'a real run: how many, not what');
  ok(!JSON.stringify(real).includes('Week 9 is final'), 'no notification\'s words in it');
  const dry = await call(`now=${TUESDAY}&only=recap&dry=1`);
  ok(Array.isArray(dry.notes) && dry.notes.length > 0, 'a dry run lists them');
  eq((await handler(new Request(`${SUPA}/functions/v1/clubhouse-push`, { method: 'POST' }))).status, 401, 'without the secret: no');
  delete globalThis.Deno;
}

section('the season comes from Sleeper when it\'s really now');
report = await run({ dry: true }, env);
eq(report.season, 2026, 'Sleeper says 2026');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
