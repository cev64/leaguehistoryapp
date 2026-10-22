/* Pigskin Pantheon Connect: the background.

   A private ESPN league opens with two cookies ESPN keeps once a member is
   signed in, espn_s2 and SWID. espn_s2 is HttpOnly, so the site's own
   scripts can't read it; this extension can, with the cookies permission.
   When the member clicks Connect ESPN on pigskinpantheon.com, the page asks
   content.js, content.js asks here, and this answers that one tab:

     both cookies there     { s2, swid }, at once
     no espn_s2             ESPN's sign-in page opens in a tab next to the
                            site's; once ESPN sets espn_s2 that tab closes,
                            the site's tab comes back to the front, and the
                            keys go to it
     fresh: true            (the page's keys were ended by ESPN, and this
                            browser still holds them) ESPN's sign-in opens
                            even with both cookies there, and only a new
                            espn_s2 is handed over
     ESPN tab closed first  { cancelled: true }
     ten minutes pass       { timedOut: true }, and the ESPN tab closes
     no access to espn.com  (Firefox lets a member switch it off) a page of
                            ours asks for it on a click, then the above

   Nothing is stored but which tab is waiting on which sign-in tab, in
   storage.session (so it outlives the background being shut down while
   the member types their password, and is gone when the browser closes),
   with, for a fresh sign-in, a SHA-256 digest of the espn_s2 to wait past.
   The cookies themselves are never stored, never logged, and never sent
   anywhere but the tab that asked, and only while that tab is still on the
   site. Nothing but those two cookies is read.

   One file for Chromium (a service worker) and Firefox (an event page);
   both can be shut down while idle, which is why the waiting is kept in
   storage.session and every listener is added at the top level. */

const api = globalThis.browser ?? globalThis.chrome;

const ESPN_URL = "https://www.espn.com/";
const LOGIN_URL = "https://www.espn.com/login";
const ESPN_ORIGINS = ["https://*.espn.com/*"];
const WAIT_MS = 10 * 60 * 1000;
const STATE_KEY = "pending";
const ID = /^[\w-]{1,64}$/;

/* ------------------------------------------------------------ the site */

// The origins content.js runs on, from the manifest, so the dev build's
// localhost is allowed in the dev build and nowhere else.
function siteOrigins() {
  const scripts = api.runtime.getManifest().content_scripts || [];
  return [...new Set(scripts.flatMap((c) => c.matches || []).map((p) => p.replace(/\/\*$/, "")))];
}
function onSite(url) {
  try { return siteOrigins().includes(new URL(url).origin); } catch (err) { return false; }
}

// The tab that asked, if it may: our own content script, in the top frame
// of a tab on the site. Anything else gets nothing.
function askerOf(sender) {
  if (!sender || sender.id !== api.runtime.id) return null;
  const tab = sender.tab;
  if (!tab || typeof tab.id !== "number" || tab.id < 0) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  if (!onSite(sender.url)) return null;
  if (sender.origin !== undefined && !siteOrigins().includes(sender.origin)) return null;
  return tab;
}

/* ------------------------------------------------------------ the cookies */

// Firefox: the tab's container. Chromium: the cookie store holding the tab
// (incognito has its own). Undefined is the default store.
async function storeFor(tab) {
  if (tab.cookieStoreId) return tab.cookieStoreId;
  try {
    const stores = await api.cookies.getAllCookieStores();
    const store = stores.find((s) => (s.tabIds || []).includes(tab.id));
    return store ? store.id : undefined;
  } catch (err) {
    return undefined;
  }
}
async function cookie(name, storeId) {
  const details = { url: ESPN_URL, name };
  if (storeId) details.storeId = storeId;
  try { return await api.cookies.get(details); } catch (err) { return null; }
}
// Both keys, or null while either is missing.
async function readKeys(storeId) {
  const [s2, swid] = await Promise.all([cookie("espn_s2", storeId), cookie("SWID", storeId)]);
  if (!s2 || !s2.value || !swid || !swid.value) return null;
  return { s2: s2.value, swid: swid.value };
}
// A fresh sign-in waits for espn_s2 to change; only a digest of the old
// one is kept to tell.
async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
// The keys, unless they're the ones a fresh sign-in waits past.
async function newKeys(storeId, not) {
  const keys = await readKeys(storeId);
  if (!keys || (not && (await digest(keys.s2)) === not)) return null;
  return keys;
}
async function hasEspnAccess() {
  try { return await api.permissions.contains({ origins: ESPN_ORIGINS }); } catch (err) { return true; }
}

/* ------------------------------------------------------------ who's waiting */

/* "<tab id>:<page's id>" -> { tabId, id, frameId, documentId, windowId,
   storeId, waitFor: "login" | "grant", waitTab, deadline, fresh, not }
   (not: the digest of the espn_s2 a fresh sign-in waits past). Read and
   written one change at a time, so two events can't undo each other. */
let chain = Promise.resolve();
function withState(change) {
  const run = chain.then(async () => {
    const got = await api.storage.session.get(STATE_KEY);
    const state = (got && got[STATE_KEY]) || {};
    const out = await change(state);
    await api.storage.session.set({ [STATE_KEY]: state });
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

// To the tab that asked, only while it's still on the site, and in
// Chromium only to the very page that asked (a reload is a new page).
async function deliver(p, message) {
  let tab;
  try { tab = await api.tabs.get(p.tabId); } catch (err) { return; }
  if (!tab || !onSite(tab.url)) return;
  const to = p.documentId ? { documentId: p.documentId } : { frameId: 0 };
  try { await api.tabs.sendMessage(p.tabId, { ...message, id: p.id }, to); } catch (err) { /* the page has gone */ }
}
const answer = (p, reply) => deliver(p, { type: "espn-answer", answer: reply });

async function focus(p) {
  try { await api.tabs.update(p.tabId, { active: true }); } catch (err) { /* closed */ }
  if (api.windows && typeof p.windowId === "number") {
    try { await api.windows.update(p.windowId, { focused: true }); } catch (err) { /* Android has no windows */ }
  }
}
async function closeTab(tabId) {
  if (typeof tabId !== "number") return;
  try { await api.tabs.remove(tabId); } catch (err) { /* already closed */ }
}

// A tab next to the site's, in its window and, for ESPN, (Firefox) its
// container, so the sign-in lands in the cookie store that's read.
async function openNextTo(tab, url) {
  const props = { url, active: true, openerTabId: tab.id };
  if (typeof tab.index === "number") props.index = tab.index + 1;
  if (typeof tab.windowId === "number") props.windowId = tab.windowId;
  if (tab.cookieStoreId && url === LOGIN_URL) props.cookieStoreId = tab.cookieStoreId;
  try { return await api.tabs.create(props); } catch (err) { return api.tabs.create({ url, active: true }); }
}

// The member has something to do in another tab first: ESPN's sign-in, or
// our page asking for access to espn.com. One such tab per asking tab: a
// second click reuses it.
async function waitOn(waitFor, tab, sender, id, storeId, { fresh = false, not = null } = {}) {
  const key = `${tab.id}:${id}`;
  const replaced = await withState(async (state) => {
    const older = Object.entries(state).filter(([k, p]) => p.tabId === tab.id && k !== key);
    let reuse = null;
    older.forEach(([k, p]) => {
      delete state[k];
      if (p.waitFor === waitFor && reuse === null) reuse = p.waitTab;
    });
    let waitTab = reuse;
    if (waitTab !== null) {
      try { await api.tabs.update(waitTab, { active: true }); } catch (err) { waitTab = null; }
    }
    if (waitTab === null) {
      const opened = await openNextTo(tab, waitFor === "grant" ? api.runtime.getURL("grant.html") : LOGIN_URL);
      waitTab = opened && typeof opened.id === "number" ? opened.id : null;
    }
    state[key] = {
      tabId: tab.id, id, frameId: 0, documentId: (sender && sender.documentId) || null,
      windowId: tab.windowId, storeId: storeId || null, waitFor, waitTab, deadline: Date.now() + WAIT_MS,
      fresh, not,
    };
    // The older asks from this tab are answered: this one takes over.
    return older.map(([, p]) => p);
  });
  replaced.forEach((p) => answer(p, { cancelled: true }));
  setTimeout(sweep, WAIT_MS + 1000);
  return { waiting: waitFor };
}

// Gives up on anything waiting more than ten minutes, closing the tab
// opened for it (as Cancel does). Run on every wake as well as by the
// timer, since the timer dies with the background.
async function sweep() {
  const now = Date.now();
  const expired = await withState((state) => {
    const out = [];
    Object.entries(state).forEach(([k, p]) => { if (p.deadline <= now) { delete state[k]; out.push(p); } });
    // A tab another ask still waits on stays open.
    out.forEach((p) => { if (Object.values(state).some((o) => o.waitTab === p.waitTab)) p.waitTab = null; });
    return out;
  });
  for (const p of expired) {
    await closeTab(p.waitTab);
    await answer(p, { timedOut: true });
  }
}

/* ------------------------------------------------------------ asking */

async function ask(msg, sender) {
  const tab = askerOf(sender);
  if (!tab || !ID.test(String(msg.id || ""))) return { error: "Not allowed." };
  sweep();
  const storeId = await storeFor(tab);
  const fresh = msg.fresh === true;
  if (!(await hasEspnAccess())) return waitOn("grant", tab, sender, msg.id, storeId, { fresh });
  const keys = await readKeys(storeId);
  if (keys && !fresh) return keys;
  return waitOn("login", tab, sender, msg.id, storeId, { fresh, not: keys ? await digest(keys.s2) : null });
}

// The page's Cancel: forget the ask and close the tab we opened for it.
async function cancel(msg, sender) {
  const tab = askerOf(sender);
  if (!tab || !ID.test(String(msg.id || ""))) return { error: "Not allowed." };
  const key = `${tab.id}:${msg.id}`;
  const p = await withState((state) => {
    const had = state[key] || null;
    delete state[key];
    if (had && Object.values(state).some((o) => o.waitTab === had.waitTab)) had.waitTab = null;
    return had;
  });
  if (p) await closeTab(p.waitTab);
  return { cancelled: true };
}

// The cookies settled after ESPN set (or changed) a key: anyone waiting on
// a sign-in in that cookie store with both keys now there (espn_s2 is the
// signed-in one: SWID alone is a visitor) is answered, and for a fresh
// sign-in only with a new espn_s2.
async function signedIn(storeId) {
  const done = await withState(async (state) => {
    const out = [];
    for (const [k, p] of Object.entries(state)) {
      if (p.waitFor !== "login") continue;
      if (p.storeId && storeId && p.storeId !== storeId) continue;
      const keys = await newKeys(p.storeId || undefined, p.not);
      if (!keys) continue;
      delete state[k];
      out.push([p, keys]);
    }
    return out;
  });
  for (const [p, keys] of done) {
    await closeTab(p.waitTab);
    await focus(p);
    await answer(p, keys);
  }
}

// Access to espn.com was granted: carry on with whoever was waiting on it.
async function granted() {
  if (!(await hasEspnAccess())) return;
  const waiting = await withState((state) => {
    const out = [];
    Object.entries(state).forEach(([k, p]) => { if (p.waitFor === "grant") { delete state[k]; out.push(p); } });
    return out;
  });
  for (const p of waiting) {
    await closeTab(p.waitTab);
    await focus(p);
    const keys = await readKeys(p.storeId || undefined);
    if (keys && !p.fresh) { await answer(p, keys); continue; }
    let tab;
    try { tab = await api.tabs.get(p.tabId); } catch (err) { continue; }
    if (!tab || !onSite(tab.url)) continue;
    await waitOn("login", tab, { documentId: p.documentId }, p.id, p.storeId, { fresh: p.fresh, not: keys ? await digest(keys.s2) : null });
    await deliver(p, { type: "espn-waiting", on: "login" });
  }
}

/* ------------------------------------------------------------ listeners */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return undefined;
  const reply = (work) => {
    work.then(sendResponse, (err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  };
  if (msg.type === "espn-keys") return reply(ask(msg, sender));
  if (msg.type === "espn-cancel") return reply(cancel(msg, sender));
  // From our own grant page, once the member has allowed access.
  if (msg.type === "pp-granted" && sender && sender.id === api.runtime.id && String(sender.url || "").startsWith(api.runtime.getURL(""))) {
    return reply(granted().then(() => ({ ok: true })));
  }
  return undefined;
});

// ESPN writes the pair (and often rewrites SWID) over a moment: the keys
// are read once a cookie store has been quiet for SETTLE_MS after its last
// change, so a pair being written isn't read half-done.
const SETTLE_MS = 600;
const settling = new Map(); // cookie store -> its timer
api.cookies.onChanged.addListener((change) => {
  const c = change && change.cookie;
  if (!c) return;
  if (c.name !== "espn_s2" && c.name !== "SWID") return;
  if (!/(^|\.)espn\.com$/.test(String(c.domain || "").replace(/^\./, ""))) return;
  const store = c.storeId || "";
  clearTimeout(settling.get(store));
  settling.set(store, setTimeout(() => { settling.delete(store); signedIn(c.storeId); }, SETTLE_MS));
});

// The member closed a tab: the ESPN tab (or our grant page) means they
// changed their mind; the site's tab means nobody is left to answer.
api.tabs.onRemoved.addListener((tabId) => {
  withState((state) => {
    const out = [];
    Object.entries(state).forEach(([k, p]) => {
      if (p.waitTab === tabId) { delete state[k]; out.push(p); } else if (p.tabId === tabId) delete state[k];
    });
    return out;
  }).then((list) => list.forEach((p) => answer(p, { cancelled: true, ...(p.waitFor === "grant" ? { needsAccess: true } : {}) })));
});

if (api.permissions && api.permissions.onAdded) api.permissions.onAdded.addListener(() => { granted(); injectIntoOpenTabs(); });

// Just added (or updated): the site's tabs already open get content.js now,
// so the Connect button appears without a reload. If the browser held back
// access to the sites (Firefox can), our page asks for it.
async function injectIntoOpenTabs() {
  const patterns = (api.runtime.getManifest().content_scripts || []).flatMap((c) => c.matches || []);
  let tabs = [];
  try { tabs = await api.tabs.query({ url: patterns }); } catch (err) { tabs = []; }
  await Promise.all(tabs.map((t) => api.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {})));
}
api.runtime.onInstalled.addListener(async () => {
  await injectIntoOpenTabs();
  const origins = api.runtime.getManifest().host_permissions || [];
  let ok = true;
  try { ok = await api.permissions.contains({ origins }); } catch (err) { ok = true; }
  if (!ok) {
    try { await api.tabs.create({ url: api.runtime.getURL("grant.html"), active: true }); } catch (err) { /* no tabs */ }
  }
});

sweep();
