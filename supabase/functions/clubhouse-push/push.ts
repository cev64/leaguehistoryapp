// Sending a notification to one device, with nothing but Web Crypto (so it
// runs the same on Supabase's edge runtime, in Deno and in Node 20+):
//
//   Web Push   the payload encrypted for the browser's subscription
//              (RFC 8291, aes128gcm) and signed for by the site's VAPID key
//              (RFC 8292), POSTed to the subscription's endpoint.
//   APNs       Apple's HTTP/2 API with token auth: an ES256 JWT from the
//              team's .p8 key, POSTed to api.push.apple.com (or the sandbox,
//              for a debug build's token).
//
// Each answers whether the device took it, and `gone` when the device has
// gone for good (unsubscribed, the app deleted, keys that can't be used, an
// address that isn't a push service) so the caller can forget it. Every
// request has 5 seconds and follows no redirect.

const enc = new TextEncoder();
// Bytes backed by a plain ArrayBuffer, what Web Crypto and fetch take (the
// type spelled this way so it reads the same in older and newer TypeScript).
const bytes = (n: number) => new Uint8Array(n);
type Bytes = ReturnType<typeof bytes>;

export function b64urlEncode(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(text: string): Bytes {
  let s = text.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = bytes(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// A JWT signed with ES256 (Web Crypto's ECDSA signature is already the raw
// r‖s a JWT wants).
async function es256(header: Record<string, unknown>, claims: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const part = (o: unknown) => b64urlEncode(enc.encode(JSON.stringify(o)));
  const input = `${part(header)}.${part(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input)));
  return `${input}.${b64urlEncode(sig)}`;
}

// `env`: the APNs environment that took it, when it isn't the one the
// device was registered with (the caller keeps the new one).
export type Sent = { ok: boolean; status: number; gone: boolean; reason?: string; env?: "sandbox" | "production" };
const TIMEOUT = 5000;

// ------------------------------------------------------------ Web Push

/* Whether a subscription's endpoint is on one of the browsers' push
   services (as clubhouse_push_endpoint_ok() in the migration): https, no
   port or user, on FCM (Chrome, Edge, Android), Mozilla's (Firefox),
   Apple's (Safari) or WNS (Windows). The sender posts nowhere else. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)+push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)+push\.apple\.com$/, /^([a-z0-9-]+\.)+notify\.windows\.com$/];
export function pushEndpointOk(endpoint: string): boolean {
  if (!/^https:\/\/[^/?#]+\/\S*$/.test(endpoint) || endpoint.length > 1000) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  // (The raw host, as the URL parser can rewrite one: a trailing dot, case.)
  const raw = endpoint.slice("https://".length).split("/")[0];
  return url.protocol === "https:" && !url.username && !url.password && !url.port && raw === url.hostname &&
    PUSH_HOSTS.some((h) => h.test(url.hostname));
}

/* The payload encrypted for one subscription (RFC 8291): an ephemeral ECDH
   key agreed with the browser's p256dh key, mixed with its auth secret, as
   one aes128gcm record (RFC 8188) whose header carries the salt and the
   ephemeral public key. */
export async function encryptWebPush(payload: Uint8Array, p256dh: string, auth: string): Promise<Bytes> {
  const uaPublic = b64urlDecode(p256dh);
  const secret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || secret.length < 16) throw new Error("bad subscription keys");
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(secret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(bytes(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, so it ends with the last-record delimiter (2) and no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = bytes(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

/* The site's VAPID key pair, as `npx web-push generate-vapid-keys` prints
   it: the public key is the 65-byte uncompressed point and the private key
   the 32-byte scalar, both base64url. */
export async function vapidSigner(publicKey: string, privateKey: string, subject: string) {
  const pub = b64urlDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY isn't an uncompressed P-256 key");
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", ext: true,
    x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: privateKey.trim(),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const byAudience = new Map<string, { jwt: string; exp: number }>();
  // The Authorization header for an endpoint: a JWT for its push service's
  // origin, good for 12 hours (the most is 24), signed again once it has
  // less than an hour left (an instance can outlive one).
  return async (endpoint: string): Promise<string> => {
    const aud = new URL(endpoint).origin;
    const now = Math.floor(Date.now() / 1000);
    let made = byAudience.get(aud);
    if (!made || made.exp - now < 3600) {
      const exp = now + 12 * 3600;
      made = { jwt: await es256({ typ: "JWT", alg: "ES256" }, { aud, exp, sub: subject }, key), exp };
      byAudience.set(aud, made);
    }
    return `vapid t=${made.jwt}, k=${publicKey.trim()}`;
  };
}

export async function sendWebPush(
  device: { token: string; p256dh: string; auth: string },
  payload: unknown,
  sign: (endpoint: string) => Promise<string>,
  opts: { ttl: number; urgency?: "normal" | "high"; topic?: string },
): Promise<Sent> {
  if (!pushEndpointOk(device.token)) return { ok: false, status: 0, gone: true, reason: "not a push service" };
  let body: Bytes;
  try {
    body = await encryptWebPush(enc.encode(JSON.stringify(payload)), device.p256dh, device.auth);
  } catch (err) {
    // Keys that aren't a P-256 point and an auth secret never will be.
    return { ok: false, status: 0, gone: true, reason: `bad keys: ${err instanceof Error ? err.message : err}` };
  }
  const headers: Record<string, string> = {
    Authorization: await sign(device.token),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.round(opts.ttl))),
    Urgency: opts.urgency ?? "normal",
  };
  // A newer notification with the same topic replaces one not yet shown.
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetch(device.token, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
  const ok = res.status >= 200 && res.status < 300;
  const reason = ok ? undefined : (await res.text().catch(() => "")).slice(0, 200) || (res.status >= 300 && res.status < 400 ? "redirect" : "");
  return { ok, status: res.status, gone: res.status === 404 || res.status === 410, reason };
}

// ------------------------------------------------------------ APNs

/* The APNs auth key: the .p8 file's contents (PKCS #8 PEM). Pasted into a
   secret its line breaks may arrive as "\n"; either way works. */
export async function apnsSigner(p8: string, keyId: string, teamId: string) {
  // (b64urlDecode reads plain base64 too.)
  const der = b64urlDecode(p8.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  let token = "", made = 0;
  // Apple wants the same token reused for up to an hour (and refreshed no
  // more often than every 20 minutes): one per run, renewed after 50.
  return async (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    if (!token || now - made > 50 * 60) {
      token = await es256({ alg: "ES256", kid: keyId.trim() }, { iss: teamId.trim(), iat: now }, key);
      made = now;
    }
    return token;
  };
}

/* To the device's environment's APNs host (a debug build's token is the
   sandbox's, a TestFlight or App Store build's production's). A token
   that host calls BadDeviceToken is tried once on the other, in case the
   build it came from said the wrong one: if that takes it, `env` says so;
   only a token neither knows is gone. */
export async function sendApns(
  device: { token: string; apns_env: string | null },
  payload: unknown,
  jwt: () => Promise<string>,
  opts: { topic: string; expires: Date; collapseId?: string; priority?: 5 | 10 },
): Promise<Sent> {
  const registered = device.apns_env === "sandbox" ? "sandbox" : "production";
  const first = await apnsTo(registered, device.token, payload, jwt, opts);
  if (first.ok || first.reason !== "BadDeviceToken") return first;
  const other = registered === "sandbox" ? "production" : "sandbox";
  const second = await apnsTo(other, device.token, payload, jwt, opts);
  if (second.ok) return { ...second, env: other };
  const gone = second.status === 410 || second.reason === "BadDeviceToken" || second.reason === "Unregistered";
  return { ...second, gone, reason: `${first.reason}; ${other}: ${second.reason || second.status}` };
}

async function apnsTo(
  env: "sandbox" | "production", token: string, payload: unknown, jwt: () => Promise<string>,
  opts: { topic: string; expires: Date; collapseId?: string; priority?: 5 | 10 },
): Promise<Sent> {
  const host = env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const headers: Record<string, string> = {
    authorization: `bearer ${await jwt()}`,
    "apns-topic": opts.topic,
    "apns-push-type": "alert",
    "apns-priority": String(opts.priority ?? 10),
    "apns-expiration": String(Math.floor(opts.expires.getTime() / 1000)),
    "content-type": "application/json",
  };
  if (opts.collapseId) headers["apns-collapse-id"] = opts.collapseId.slice(0, 64);
  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.ok) return { ok: true, status: res.status, gone: false };
  let reason = "";
  try { reason = String((await res.json())?.reason ?? ""); } catch { /* no body */ }
  // 410: the app is gone from the device (Unregistered comes with it).
  // BadDeviceToken: not a token for this host's environment (sendApns
  // tries the other before giving up on it).
  const gone = res.status === 410 || reason === "Unregistered";
  return { ok: false, status: res.status, gone, reason };
}
