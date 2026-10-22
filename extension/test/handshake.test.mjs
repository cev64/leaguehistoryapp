/* The extension's handshake against a mocked browser: background.js and
   content.js, each in its own sandbox, wired together the way Chromium
   wires them (runtime.sendMessage up, tabs.sendMessage down).

     node extension/test/handshake.test.mjs

   Exits non-zero, naming the case, if any fails. */
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const BACKGROUND = fs.readFileSync(path.join(DIR, "background.js"), "utf8");
const CONTENT = fs.readFileSync(path.join(DIR, "content.js"), "utf8");
const EXT = "ppconnecttestid";
const SITE = "http://localhost:8765";
const S2 = "AEB" + "x".repeat(120);
const SWID = "{1A2B3C4D-1111-2222-3333-444455556666}";
const SWID2 = "{9F8E7D6C-1111-2222-3333-444455556666}";
const S2B = "AEC" + "y".repeat(120);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(1); await tick(700); for (let i = 0; i < 20; i++) await tick(1); };

function event() {
  const ls = [];
  return {
    ls,
    addListener: (f) => ls.push(f),
    removeListener: (f) => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
    hasListener: (f) => ls.includes(f),
  };
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Browser {
  constructor() {
    this.session = {};
    this.jar = new Map();
    this.tabs = new Map();
    this.nextTab = 1;
    this.nextDoc = 1;
    this.access = true;
    this.now = 1_000_000;
    this.timers = [];
    this.pages = new Map(); // tab id -> the page's content world
    this.sent = []; // every tabs.sendMessage
    this.injected = [];
    this.focused = [];
    this.startBackground();
  }
  // Long timers (the ten-minute give-up) wait for advance(); short ones
  // (the pause for ESPN's cookies to settle) run in real time.
  fakeClock(ctx) {
    const b = this;
    ctx.Date = class extends Date { static now() { return b.now; } };
    ctx.setTimeout = (fn, ms) => {
      if (!ms || ms <= 1000) return setTimeout(fn, ms || 0);
      const t = { fn, at: b.now + ms, id: Symbol("t") };
      b.timers.push(t);
      return t.id;
    };
    ctx.clearTimeout = (id) => { b.timers = b.timers.filter((t) => t.id !== id); clearTimeout(id); };
  }
  async advance(ms) {
    this.now += ms;
    const due = this.timers.filter((t) => t.at <= this.now);
    this.timers = this.timers.filter((t) => t.at > this.now);
    due.forEach((t) => t.fn());
    await settle();
  }
  // A fresh background (installed, or woken after being shut down): new
  // listeners, the same storage.session.
  startBackground() {
    const b = this;
    const bg = {
      onMessage: event(), onInstalled: event(), onChanged: event(), onRemoved: event(), onAdded: event(),
    };
    this.bg = bg;
    const api = {
      runtime: {
        id: EXT,
        getManifest: () => clone(MANIFEST),
        getURL: (p) => `chrome-extension://${EXT}/${p}`,
        onMessage: bg.onMessage, onInstalled: bg.onInstalled,
      },
      storage: { session: {
        get: async (k) => (k in b.session ? { [k]: clone(b.session[k]) } : {}),
        set: async (o) => { Object.entries(o).forEach(([k, v]) => { b.session[k] = clone(v); }); },
      } },
      cookies: {
        get: async ({ url, name, storeId }) => {
          assert.equal(url, "https://www.espn.com/");
          if (!b.access) return null;
          return clone(b.jar.get(`${storeId || "0"}|${name}`)) || null;
        },
        getAllCookieStores: async () => [{ id: "0", tabIds: [...b.tabs.keys()] }],
        onChanged: bg.onChanged,
      },
      permissions: {
        contains: async () => b.access,
        onAdded: bg.onAdded,
      },
      tabs: {
        get: async (id) => { if (!b.tabs.has(id)) throw new Error("No tab"); return clone(b.tabs.get(id)); },
        create: async (props) => b.openTab(props.url, props),
        remove: async (id) => b.closeTab(id),
        update: async (id, props) => {
          if (!b.tabs.has(id)) throw new Error("No tab");
          if (props.active) { b.tabs.forEach((t) => { t.active = false; }); b.tabs.get(id).active = true; b.focused.push(id); }
          return clone(b.tabs.get(id));
        },
        query: async ({ url }) => [...b.tabs.values()].filter((t) => url.some((p) => t.url.startsWith(p.replace(/\*$/, "")))).map(clone),
        sendMessage: async (id, msg, opts = {}) => {
          b.sent.push({ id, msg: clone(msg), opts });
          const page = b.pages.get(id);
          if (!page) throw new Error("Could not establish connection. Receiving end does not exist.");
          if (opts.documentId && opts.documentId !== page.documentId) throw new Error("No such document");
          page.runtimeOnMessage.ls.forEach((l) => l(clone(msg), { id: EXT }));
        },
        onRemoved: bg.onRemoved,
      },
      windows: { update: async () => ({}) },
      scripting: {
        executeScript: async ({ target, files }) => { b.injected.push({ tabId: target.tabId, files }); b.loadContent(target.tabId); return []; },
      },
    };
    const ctx = { chrome: api, console, URL, Promise, Object, JSON, String, Number, Boolean, Array, Set, Map, Error, RegExp, crypto, TextEncoder, Uint8Array };
    this.fakeClock(ctx);
    vm.runInNewContext(BACKGROUND, ctx, { filename: "background.js" });
    return bg;
  }
  openTab(url, props = {}) {
    const id = this.nextTab++;
    const index = typeof props.index === "number" ? props.index : this.tabs.size;
    this.tabs.forEach((t) => { if (props.active !== false) t.active = false; });
    const tab = { id, url, index, windowId: 1, active: props.active !== false, openerTabId: props.openerTabId };
    this.tabs.set(id, tab);
    return clone(tab);
  }
  closeTab(id) {
    if (!this.tabs.has(id)) throw new Error("No tab");
    this.tabs.delete(id);
    this.pages.delete(id);
    this.bg.onRemoved.ls.forEach((l) => l(id, {}));
  }
  setCookie(name, value, storeId = "0") {
    const cookie = { name, value, domain: ".espn.com", storeId, httpOnly: name === "espn_s2" };
    this.jar.set(`${storeId}|${name}`, cookie);
    this.bg.onChanged.ls.forEach((l) => l({ removed: false, cookie: clone(cookie), cause: "explicit" }));
  }
  // What the browser tells the background about a message from a tab.
  senderFor(tabId, page) {
    const tab = this.tabs.get(tabId);
    return { id: EXT, tab: clone(tab), frameId: 0, url: tab.url, origin: new URL(tab.url).origin, documentId: page && page.documentId };
  }
  toBackground(msg, sender) {
    return new Promise((resolve) => {
      let answered = false;
      const respond = (r) => { answered = true; resolve(clone(r)); };
      let async = false;
      this.bg.onMessage.ls.forEach((l) => { if (l(clone(msg), sender, respond) === true) async = true; });
      if (!async && !answered) resolve(undefined);
    });
  }
  // A site tab with content.js loaded, and a page script that can post.
  sitePage(url = `${SITE}/index.html`) {
    const tab = this.openTab(url);
    return this.loadContent(tab.id);
  }
  loadContent(tabId) {
    const b = this;
    // Injected again into a page that has it: the same document and the
    // same isolated world, so the copy already there keeps the job.
    if (this.pages.has(tabId)) {
      const had = this.pages.get(tabId);
      vm.runInContext(CONTENT, had.ctx, { filename: "content.js" });
      return had;
    }
    const tab = this.tabs.get(tabId);
    const origin = new URL(tab.url).origin;
    const listeners = [];
    const docEvents = [];
    const window = {
      postMessage(data, target) {
        if (target !== origin && target !== "*") return;
        const copy = clone(data);
        page.posted.push(copy);
        setTimeout(() => listeners.slice().forEach((l) => l({ source: window, origin, data: clone(copy) })), 0);
      },
      addEventListener: (type, f) => { if (type === "message") listeners.push(f); },
      removeEventListener: (type, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    };
    const page = {
      tabId, origin, documentId: `doc${this.nextDoc++}`, posted: [], window, listeners, docEvents,
      activation: { isActive: true },
      runtimeOnMessage: event(),
      dataset: {},
      // The page script asking, as espn.js does.
      ask(id, { source = window, from = origin, type = "espn-connect", fresh = false } = {}) {
        const data = fresh ? { pp: type, id, fresh: true } : { pp: type, id };
        setTimeout(() => listeners.slice().forEach((l) => l({ source, origin: from, data: clone(data) })), 0);
      },
      of: (id) => page.posted.filter((m) => m.id === id && !/^espn-connect(-cancel)?$/.test(m.pp)),
      answer: (id) => page.posted.find((m) => m.id === id && m.pp === "espn-connect-answer"),
    };
    const api = {
      runtime: {
        id: EXT,
        getManifest: () => clone(MANIFEST),
        sendMessage: (msg) => b.toBackground(msg, b.senderFor(tabId, page)),
        onMessage: page.runtimeOnMessage,
      },
    };
    const ctx = {
      chrome: api, window, location: { origin },
      navigator: { userActivation: page.activation },
      document: {
        documentElement: { dataset: page.dataset },
        dispatchEvent: (e) => { docEvents.push(e.type); return true; },
      },
      Event: class { constructor(type) { this.type = type; } },
      console, Promise, Object, JSON, String, Map, RegExp, Boolean,
    };
    this.fakeClock(ctx);
    page.ctx = vm.createContext(ctx);
    vm.runInContext(CONTENT, page.ctx, { filename: "content.js" });
    this.pages.set(tabId, page);
    return page;
  }
  loginTabs() { return [...this.tabs.values()].filter((t) => t.url === "https://www.espn.com/login"); }
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("the page is marked and told the extension is here", async () => {
  const b = new Browser();
  const page = b.sitePage();
  assert.equal(page.dataset.ppConnect, MANIFEST.version);
  assert.deepEqual(page.docEvents, ["pp-connect-ready"]);
});

test("signed in to ESPN already: the site gets the keys at once", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("a1");
  await settle();
  assert.equal(page.of("a1")[0].pp, "espn-connect-ack");
  assert.deepEqual(page.answer("a1"), { pp: "espn-connect-answer", id: "a1", s2: S2, swid: SWID });
  assert.equal(b.loginTabs().length, 0);
});

test("a message from another origin, or another window, is ignored", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("x1", { from: "https://evil.example" });
  page.ask("x2", { source: { not: "the window" } });
  page.ask("x3", { type: "something-else" });
  await settle();
  assert.equal(page.of("x1").length + page.of("x2").length + page.of("x3").length, 0);
});

test("an ask without a click gets nothing from the background", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.activation.isActive = false;
  page.ask("n1");
  await settle();
  const a = page.answer("n1");
  assert.ok(a.error && !a.s2, "no keys without a user activation");
});

test("the background refuses foreign senders", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  const evil = b.openTab("https://evil.example/page");
  const site = b.openTab(`${SITE}/index.html`);
  const ask = { type: "espn-keys", id: "f1" };
  const refused = [
    b.senderFor(evil.id), // a tab on another site
    { ...b.senderFor(site.id), id: "someotherextension" }, // another extension
    { ...b.senderFor(site.id), frameId: 3 }, // a frame inside the site's page
    { ...b.senderFor(site.id), origin: "https://evil.example" }, // origin and URL disagree
    { ...b.senderFor(site.id), tab: undefined }, // not from a tab
    { ...b.senderFor(site.id), url: "http://localhost:9999/" }, // another localhost port
  ];
  for (const sender of refused) {
    const r = await b.toBackground(ask, sender);
    assert.deepEqual(r, { error: "Not allowed." }, JSON.stringify(sender));
  }
  assert.ok((await b.toBackground(ask, b.senderFor(site.id))).s2, "the site itself is answered");
});

test("not signed in: ESPN's sign-in opens next to the site, and the keys come when ESPN sets espn_s2", async () => {
  const b = new Browser();
  b.setCookie("SWID", SWID); // ESPN sets SWID before sign-in
  b.openTab("https://example.com/");
  const page = b.sitePage();
  const site = b.tabs.get(page.tabId);
  page.ask("l1");
  await settle();
  assert.deepEqual(page.of("l1").map((m) => m.pp), ["espn-connect-ack", "espn-connect-waiting"]);
  const [login] = b.loginTabs();
  assert.ok(login, "a sign-in tab");
  assert.equal(login.index, site.index + 1);
  assert.equal(login.openerTabId, site.id);
  b.setCookie("espn_s2", S2);
  await settle();
  assert.equal(b.loginTabs().length, 0, "the sign-in tab closed");
  assert.equal(b.tabs.get(site.id).active, true, "the site's tab is in front");
  assert.deepEqual(page.answer("l1"), { pp: "espn-connect-answer", id: "l1", s2: S2, swid: SWID });
  assert.deepEqual(b.session.pending, {}, "nothing left waiting");
});

test("closing the ESPN tab cancels", async () => {
  const b = new Browser();
  const page = b.sitePage();
  page.ask("c1");
  await settle();
  b.closeTab(b.loginTabs()[0].id);
  await settle();
  assert.deepEqual(page.answer("c1"), { pp: "espn-connect-answer", id: "c1", cancelled: true });
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  await settle();
  assert.ok(!b.sent.some((s) => s.msg.answer && s.msg.answer.s2), "no keys after the cancel");
});

test("the page's Cancel closes the ESPN tab", async () => {
  const b = new Browser();
  const page = b.sitePage();
  page.ask("k1");
  await settle();
  page.ask("k1", { type: "espn-connect-cancel" });
  await settle();
  assert.equal(b.loginTabs().length, 0);
  assert.deepEqual(page.answer("k1"), { pp: "espn-connect-answer", id: "k1", cancelled: true });
});

test("a background shut down mid-sign-in still answers", async () => {
  const b = new Browser();
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("r1");
  await settle();
  b.startBackground(); // the old one's listeners are gone with it
  b.setCookie("espn_s2", S2);
  await settle();
  assert.equal(b.loginTabs().length, 0);
  assert.equal(page.answer("r1").s2, S2);
});

test("after ten minutes it gives up", async () => {
  const b = new Browser();
  const page = b.sitePage();
  page.ask("t1");
  await settle();
  assert.equal(b.loginTabs().length, 1);
  await b.advance(10 * 60 * 1000 + 1500);
  assert.deepEqual(page.answer("t1"), { pp: "espn-connect-answer", id: "t1", timedOut: true });
  assert.deepEqual(b.session.pending, {});
  assert.equal(b.loginTabs().length, 0, "the ESPN tab it opened closed");
});

test("ESPN rewrites SWID just after espn_s2: the keys wait for the last change", async () => {
  const b = new Browser();
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("d1");
  await settle();
  b.setCookie("espn_s2", S2);
  await tick(400);
  b.setCookie("SWID", SWID2);
  await tick(400); // past the first change's pause, not the last's
  assert.equal(page.answer("d1"), undefined, "nothing read while the pair is still changing");
  await settle();
  assert.deepEqual(page.answer("d1"), { pp: "espn-connect-answer", id: "d1", s2: S2, swid: SWID2 });
  assert.equal(b.loginTabs().length, 0);
});

test("SWID alone is signed out: no answer, the sign-in tab stays", async () => {
  const b = new Browser();
  const page = b.sitePage();
  page.ask("w1");
  await settle();
  b.setCookie("SWID", SWID);
  await settle();
  assert.equal(page.answer("w1"), undefined);
  assert.equal(b.loginTabs().length, 1);
  assert.equal(Object.keys(b.session.pending).length, 1, "still waiting");
});

test("fresh: ESPN's sign-in opens with keys here, and only a new espn_s2 comes back", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("e1", { fresh: true });
  await settle();
  assert.deepEqual(page.of("e1").map((m) => m.pp), ["espn-connect-ack", "espn-connect-waiting"]);
  assert.equal(b.loginTabs().length, 1, "a sign-in tab, though keys are here");
  assert.ok(!JSON.stringify(b.session).includes(S2), "the old espn_s2 isn't kept, only its digest");
  b.setCookie("SWID", SWID);
  b.setCookie("espn_s2", S2); // written again, the same value
  await settle();
  assert.equal(page.answer("e1"), undefined, "the old keys aren't handed back");
  b.setCookie("espn_s2", S2B);
  await settle();
  assert.deepEqual(page.answer("e1"), { pp: "espn-connect-answer", id: "e1", s2: S2B, swid: SWID });
  assert.equal(b.loginTabs().length, 0);
});

test("the keys never go to a tab that left the site", async () => {
  const b = new Browser();
  b.setCookie("SWID", SWID);
  const page = b.sitePage();
  page.ask("g1");
  await settle();
  b.tabs.get(page.tabId).url = "https://evil.example/";
  b.setCookie("espn_s2", S2);
  await settle();
  assert.ok(!b.sent.some((s) => s.msg.answer && s.msg.answer.s2), "nothing sent");
});

test("no access to espn.com: our page asks for it, then the keys come", async () => {
  const b = new Browser();
  b.setCookie("espn_s2", S2);
  b.setCookie("SWID", SWID);
  b.access = false;
  const page = b.sitePage();
  page.ask("p1");
  await settle();
  const grant = [...b.tabs.values()].find((t) => t.url.endsWith("/grant.html"));
  assert.ok(grant, "the grant page opened");
  assert.equal(page.of("p1").at(-1).on, "grant");
  b.access = true;
  b.bg.onAdded.ls.forEach((l) => l({ origins: MANIFEST.host_permissions }));
  await settle();
  assert.ok(!b.tabs.has(grant.id), "the grant page closed");
  assert.equal(page.answer("p1").s2, S2);
  assert.equal(page.docEvents.length, 1, "injected again, the live copy kept the job");
});

test("installed while the site is open: content.js goes into its tabs", async () => {
  const b = new Browser();
  const site = b.openTab(`${SITE}/season.html?league=demo`);
  b.openTab("https://www.espn.com/");
  b.bg.onInstalled.ls.forEach((l) => l({ reason: "install" }));
  await settle();
  assert.equal(JSON.stringify(b.injected), JSON.stringify([{ tabId: site.id, files: ["content.js"] }]));
  assert.equal(b.pages.get(site.id).dataset.ppConnect, MANIFEST.version);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok    ${name}`); }
  catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack.split("\n").slice(0, 3).join("\n      ")}`); }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
