/* The clubhouse on the season page: league pick'em, the week's awards voted
   by the league, the week's share card and the notification opt-in.

   What's worked out (the grading, the nominees, the demo's league-mates) is
   clubhouse.js, shared with the app; this is the page's side of it. The
   season page leaves placeholders where the cards go and calls
   ClubhouseUI.mount() once with what it knows:

     <div class="ch-slot" data-ch="pickem" data-week="9"></div>
         the pick week's Matchups view: make picks, the countdown, who has
         picked; once the week locks, how the league picked
     <div class="ch-slot" data-ch="results" data-week="8"></div>
         a played week's Results view: the week's pick'em, graded
     <div class="ch-slot" data-ch="awards" data-week="8"></div>
         a played week's Recap view: vote, or the winners once voting closes
     [data-ch-share="8"]
         a button that draws the week's share card

   A real league talks to Supabase through Account.rpc (account.js; the
   functions are in supabase/migrations/20261021000000_league_clubhouse.sql)
   and needs an account and a claimed team. The demo league (no league key)
   never touches the server: Clubhouse.demoBoard makes up its league-mates,
   and the visitor's team, picks and votes stay in this browser
   (localStorage "lh-clubhouse-demo-<season>").

   Plain script, loaded after clubhouse.js and before the page's script. */
(function () {
  "use strict";

  const C = window.Clubhouse;
  if (!C) return;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
  const codeOf = (err) => String((err && (err.message || err.msg)) || err || "").split(":")[0].trim();
  const explain = (err) => (window.Account && Account.explain ? Account.explain(err) : String((err && err.message) || err || "Something went wrong."));
  const svg = (paths, cls = "chip-icon") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    pickem: svg('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.2"/><path d="M5.2 8.2 7.1 10.1 10.9 6"/>'),
    award: svg('<circle cx="8" cy="6.2" r="3.6"/><path d="M5.9 9.2 4.8 13.6 8 12.1l3.2 1.5-1.1-4.4"/>'),
    lock: svg('<rect x="3.4" y="7.2" width="9.2" height="6.4" rx="1.6"/><path d="M5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8"/>', "ch-ico"),
    check: svg('<path d="M3.6 8.3 6.6 11.3 12.4 5"/>', "ch-ico"),
    cross: svg('<path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8"/>', "ch-ico"),
    share: svg('<rect x="2.6" y="3" width="10.8" height="10" rx="1.8"/><circle cx="6" cy="6.6" r="1.2"/><path d="m13.4 10.6-3.2-3.2-5.6 5.6"/>', "ch-ico"),
    list: svg('<path d="M2.8 4.3h10.4M2.8 8h10.4M2.8 11.7h10.4"/>', "ch-ico"),
    versus: svg('<path d="M2.6 4.6 5.5 8l-2.9 3.4M13.4 4.6 10.5 8l2.9 3.4M8 2.9v10.2"/>'),
    bell: svg('<path d="M4.2 11V7.4a3.8 3.8 0 0 1 7.6 0V11l1.2 1.4H3z"/><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>', "ch-ico"),
  };

  /* ------------------------------------------------------------ time */

  const dayTime = (t) => {
    const d = new Date(t);
    const far = d - Date.now() > 6 * 864e5 || d < Date.now() - 864e5;
    return d.toLocaleString(undefined, far
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" });
  };
  // "Locks Thu 8:15 PM", or a countdown on the day itself.
  function lockText(t, verb = "Locks") {
    const left = new Date(t) - Date.now();
    if (left <= 0) return verb === "Locks" ? "Locked" : "Closed";
    const mins = Math.max(1, Math.ceil(left / 60e3));
    if (mins < 60) return `${verb} in ${mins} min`;
    if (mins < 12 * 60) return `${verb} in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
    return `${verb} ${dayTime(t)}`;
  }

  /* The demo's deadlines are "never" (it's always the week before Week 9);
     it shows the next Thursday night kickoff, 8:15 PM in New York, in the
     visitor's own time. */
  function nextThursdayKickoff() {
    const ny = (t) => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(t));
      const get = (k) => (p.find((x) => x.type === k) || {}).value;
      return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour"), min: +get("minute"), wd: get("weekday") };
    };
    try {
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        const day = ny(now + i * 864e5);
        if (day.wd !== "Thu") continue;
        const guess = Date.UTC(day.y, day.m - 1, day.d, 20, 15);
        const at = ny(guess);
        const offset = Date.UTC(at.y, at.m - 1, at.d, at.h, at.min) - guess;
        const t = guess - offset;
        if (t > now) return new Date(t).toISOString();
      }
    } catch (err) { /* no time zones: an hour from now will do */ }
    return new Date(Date.now() + 36e5 * 30).toISOString();
  }

  /* ------------------------------------------------------------ small parts */

  // A page-wide live region, for what a tap did ("Voted Lamb Chops").
  let liveEl = null;
  function say(text) {
    if (!liveEl) {
      liveEl = document.createElement("div");
      liveEl.className = "ch-sr";
      liveEl.setAttribute("role", "status");
      liveEl.setAttribute("aria-live", "polite");
      document.body.appendChild(liveEl);
    }
    liveEl.textContent = "";
    setTimeout(() => { liveEl.textContent = text; }, 30);
  }

  const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

  /* A sheet: a bottom sheet on a phone, a floating card wider up. Focus
     stays inside it, Escape and the backdrop close it, and focus goes back
     to what opened it. */
  function openSheet({ kicker = "", title, body, cls = "", onClose }) {
    const opener = document.activeElement;
    const id = `chSheet${Math.random().toString(36).slice(2, 8)}`;
    const layer = document.createElement("div");
    layer.className = `ch-layer ${cls}`;
    layer.innerHTML = `<div class="ch-backdrop" data-ch-close></div>
      <section class="ch-sheet" role="dialog" aria-modal="true" aria-hidden="false" aria-labelledby="${id}" tabindex="-1">
        <header class="ch-sheet-head">
          <div>${kicker ? `<small>${kicker}</small>` : ""}<h2 id="${id}">${title}</h2></div>
          <button type="button" class="ch-x" data-ch-close aria-label="Close">&times;</button>
        </header>
        <div class="ch-sheet-body"></div>
      </section>`;
    const sheet = layer.querySelector(".ch-sheet");
    const bodyEl = layer.querySelector(".ch-sheet-body");
    const set = (html) => {
      const key = document.activeElement && layer.contains(document.activeElement) && document.activeElement.dataset.fk;
      bodyEl.innerHTML = html;
      const back = key && bodyEl.querySelector(`[data-fk="${CSS.escape(key)}"]`);
      if (back) back.focus();
    };
    set(body);
    document.body.appendChild(layer);
    document.documentElement.classList.add("ch-locked");
    requestAnimationFrame(() => layer.classList.add("open"));
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const f = [...sheet.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
      if (!f.length) { e.preventDefault(); sheet.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    layer.addEventListener("keydown", onKey);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      layer.classList.remove("open");
      document.documentElement.classList.remove("ch-locked");
      const gone = () => layer.remove();
      if (REDUCE.matches) gone(); else setTimeout(gone, 260);
      if (onClose) onClose();
      // (without scrolling: the page stays where the reader left it)
      if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
    }
    layer.addEventListener("click", (e) => { if (e.target.closest("[data-ch-close]")) close(); });
    // Back to another week or view: the sheet was about the one before.
    addEventListener("hashchange", close, { once: true });
    const firstFocus = sheet.querySelector(".ch-sheet-body " + FOCUSABLE) || sheet.querySelector(".ch-x");
    setTimeout(() => (firstFocus || sheet).focus({ preventScroll: true }), 40);
    return { layer, sheet, body: bodyEl, set, close };
  }

  /* ------------------------------------------------------------ this browser's push device */

  /* A Web Push subscription goes to whichever account registers it
     (register_push_device is an upsert on the endpoint), and account.js
     lets it go when that account signs out. It's registered again when the
     Leaderboard sheet opens, once a session on the season page, and when
     the browser rotates it (sw.js's pushsubscriptionchange tells the open
     tabs; a tab that wasn't open finds the new one on its next visit). */
  const b64 = (s) => {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const VAPID = () => String((window.ACCOUNT_CONFIG || {}).VAPID_PUBLIC_KEY || "").trim();
  const pushSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const canRegister = () => Boolean(window.Account && Account.user && Account.mode === "supabase" && Account.rpc && VAPID() && pushSupported() && Notification.permission === "granted");
  async function registerDevice(sub, force = false) {
    if (!sub || !canRegister()) return;
    const j = sub.toJSON ? sub.toJSON() : sub;
    if (!j || !j.endpoint) return;
    const mark = "lh-push-device";
    const id = `${Account.user.id} ${j.endpoint}`;
    if (!force) { try { if (sessionStorage.getItem(mark) === id) return; } catch (err) { /* register, then */ } }
    await Account.rpc("register_push_device", { p_kind: "web", p_token: j.endpoint, p_p256dh: j.keys && j.keys.p256dh, p_auth: j.keys && j.keys.auth, p_env: null });
    try { sessionStorage.setItem(mark, id); } catch (err) { /* once more next time */ }
  }
  async function syncDevice() {
    if (!canRegister()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await registerDevice(sub);
    } catch (err) { console.warn("Clubhouse: this browser's notifications weren't registered", err); }
  }
  if (pushSupported()) {
    navigator.serviceWorker.addEventListener("message", async (e) => {
      const m = e.data;
      if (!m || m.type !== "pushsubscriptionchange" || !window.Account) return;
      try {
        await Account.ready;
        if (!canRegister()) return;
        let sub = m.sub;
        if (!sub || !sub.endpoint) {
          // The worker couldn't subscribe again on its own: the page knows the key.
          const reg = await navigator.serviceWorker.ready;
          sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID()) });
        }
        await registerDevice(sub, true);
        if (m.old && m.old !== (sub.endpoint || (sub.toJSON && sub.toJSON().endpoint))) {
          Account.rpc("unregister_push_device", { p_token: m.old }).catch(() => { /* gone already */ });
        }
      } catch (err) { console.warn("Clubhouse: the new subscription wasn't registered", err); }
    });
  }

  /* ------------------------------------------------------------ the page */

  function mount(ctx) {
    const { model, season } = ctx;
    const YEAR = season.year;
    const KEY = C.leagueKey(model);
    const DEMO = !KEY && Boolean(model.demo || model.leagueId === "demo");
    if (!KEY && !DEMO) return null;

    const teams = season.teams;
    const REGULAR = (season.settings && season.settings.regularWeeks) || 14;
    const played = season.playedWeeks || [];
    const lastPlayed = played.length ? played[played.length - 1] : 0;
    const isPlayed = (w) => played.includes(w);
    const PICK_WEEK = ctx.pickWeek ? ctx.pickWeek() : null;
    const CURRENT = model.current || season;
    const teamOfOwner = (owner, s = season) => Object.keys(s.teams).find((id) => s.teams[id].ownerId === owner) || null;
    const cardHead = ctx.cardHead || ((title, chip, meta) => `<div class="card-head"><h3><span class="division-chip">${chip}</span>${title}</h3>${meta ? `<span>${meta}</span>` : ""}</div>`);

    const logoOf = (t) => {
      const src = t && t.ownerId && window.TEAM_LOGOS && window.TEAM_LOGOS[t.ownerId];
      return typeof src === "string" && /^(https?:\/\/|data:image\/)/i.test(src.trim()) ? src.trim() : "";
    };
    const badge = (t, cls = "") => {
      if (!t) return `<span class="mini-badge ${cls}" aria-hidden="true">?</span>`;
      const src = logoOf(t);
      return `<span class="mini-badge ${cls}" style="--team-color:${esc(t.color || "#304f91")}" aria-hidden="true">${src ? `<img class="team-logo" src="${esc(src)}" alt="">` : esc(t.icon || [...String(t.name || "?").trim()][0] || "?")}</span>`;
    };
    const tname = (id) => (teams[id] ? teams[id].name : "A former team");

    /* ---- state ------------------------------------------------------ */
    const S = {
      status: "idle",     // idle | loading | signedout | unavailable | unclaimed | ready | error
      error: "",
      claims: null,       // league_claims(): { claimed, mine }
      pickem: null,       // pickem_board()
      awards: null,       // award_board()
      drafts: {},         // week → { game: { winner, lock } }: the member's picks as tapped
      save: {},           // week → "saving" | "saved" | { error }
      pending: null,      // what to do once a team is claimed
      lockAt: {},         // week → its deadline, for a member yet to claim a team
    };
    let board = null;     // the Leaderboard sheet, while open
    const me = () => (S.claims && S.claims.mine && S.claims.mine.owner_id) || null;

    /* ---- the demo: everything on this device ----------------------- */
    const DEMO_KEY = `lh-clubhouse-demo-${YEAR}`;
    const DEMO_LOCK = DEMO ? nextThursdayKickoff() : null;
    function demoRead() {
      try { const v = JSON.parse(localStorage.getItem(DEMO_KEY) || "null"); return v && typeof v === "object" ? v : {}; } catch (err) { return {}; }
    }
    let demoMemory = null;   // storage blocked: this visit only
    const demoState = () => demoMemory || demoRead();
    function demoWrite(v) {
      demoMemory = v;
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)); demoMemory = null; } catch (err) { /* kept in memory */ }
    }
    function demoBoards() {
      const d = demoState();
      const owner = d.owner && Object.values(teams).some((t) => t.ownerId === d.owner) ? d.owner : null;
      const mine = {
        picks: owner && Array.isArray(d.picks) ? d.picks : [],
        votes: owner && Array.isArray(d.votes) ? d.votes : [],
      };
      const b = C.demoBoard(model, season, owner, mine);
      S.claims = { claimed: [], mine: owner ? { owner_id: owner } : null };
      S.pickem = b.pickem;
      S.awards = b.awards;
      S.status = owner ? "ready" : "unclaimed";
    }

    /* ---- a real league: Supabase ------------------------------------ */
    const rpc = (name, args) => Account.rpc(name, args);
    async function loadBoards() {
      const [p, a] = await Promise.all([
        rpc("pickem_board", { p_league_key: KEY, p_season: YEAR }),
        rpc("award_board", { p_league_key: KEY, p_season: YEAR }),
      ]);
      if (p && Array.isArray(p.members)) p.members = [...new Set(p.members)];
      S.pickem = p;
      S.awards = a;
    }
    async function load() {
      if (DEMO) { demoBoards(); return; }
      if (!window.Account || !Account.rpc) { S.status = "unavailable"; return; }
      S.status = "loading";
      // (after ensure() has kept this promise: painting asks for it)
      queueMicrotask(paint);
      await Account.ready;
      S.pickem = S.awards = S.claims = null;
      if (!Account.user) { S.status = "signedout"; return; }
      if (Account.mode !== "supabase") { S.status = "unavailable"; return; }
      try {
        S.claims = await rpc("league_claims", { p_league_key: KEY });
        if (!S.claims || !S.claims.mine) {
          // Not on the board yet: the deadlines the cards show, from the
          // database's own clock.
          await Promise.all([...new Set([PICK_WEEK, lastPlayed + 1].filter(Boolean))].map(async (w) => {
            try { S.lockAt[w] = await rpc("pick_deadline", { p_season: YEAR, p_week: w }); } catch (err) { /* no countdown */ }
          }));
          S.status = "unclaimed";
          return;
        }
        refreshLeague(S.claims.mine.owner_id);
        await loadBoards();
        S.status = "ready";
      } catch (err) {
        console.warn("Clubhouse:", err);
        const code = codeOf(err);
        if (code === "not_signed_in") S.status = "signedout";
        else if (code === "not_a_member") S.status = "unclaimed";
        else { S.status = "error"; S.error = explain(err); }
      }
    }
    /* claim_manager also records the league as this member's page sees it
       (its current season id, season and name). The push sender doesn't
       trust that: it checks the league with Sleeper and keeps its own
       clubhouse_leagues row. A Sleeper renewal gets a new id, so a member
       who claimed last season claims their own team again (a no-op for the
       claim) once a session, or when the season has moved on, to keep what
       their page saw current. */
    const claimArgs = (owner) => ({
      p_league_key: KEY,
      p_owner_id: owner,
      p_source: C.source(model),
      p_current_league_id: C.source(model) === "espn" ? model.leagueId : String(CURRENT.leagueId || model.leagueId),
      p_season: CURRENT.year,
      p_name: model.name || null,
    });
    function refreshLeague(owner) {
      const mark = `lh-clubhouse-league-${KEY}`;
      let seen = null;
      try { seen = sessionStorage.getItem(mark); } catch (err) { /* storage blocked: once per page */ }
      if (seen === String(CURRENT.year) || refreshLeague.done) return;
      refreshLeague.done = true;
      rpc("claim_manager", claimArgs(owner)).then(() => {
        try { sessionStorage.setItem(mark, String(CURRENT.year)); } catch (err) { /* once per page, then */ }
      }).catch((err) => console.warn("Clubhouse: league not refreshed", err));
    }

    let loading = null;
    const ensure = () => (loading = loading || load().catch((err) => { S.status = "error"; S.error = explain(err); }).finally(paint));
    const reload = () => { loading = null; return ensure(); };
    if (!DEMO && window.Account && Account.on) {
      let seen = Account.user ? Account.user.id : null;
      Account.on((acct) => {
        const now = acct.user ? acct.user.id : null;
        if (now === seen) return;
        seen = now;
        S.drafts = {};
        reload();
        syncDevice();
      });
      if (Account.ready) Account.ready.then(syncDevice);
    }

    /* ---- reading the boards ---------------------------------------- */
    const deadline = (w) => {
      if (DEMO) return w <= lastPlayed ? "2000-01-01T00:00:00Z" : DEMO_LOCK;
      return (S.pickem && S.pickem.deadlines && S.pickem.deadlines[w]) || S.lockAt[w];
    };
    const lockedNow = (w) => {
      const d = deadline(w);
      return isPlayed(w) || (d ? new Date(d) <= Date.now() : false);
    };
    const closesAt = (w) => {
      if (DEMO) return isPlayed(w + 1) ? "2000-01-01T00:00:00Z" : DEMO_LOCK;
      return (S.awards && S.awards.closes && S.awards.closes[w]) || S.lockAt[w + 1];
    };
    const voteOpen = (w) => isPlayed(w) && w <= REGULAR && Boolean(closesAt(w)) && new Date(closesAt(w)) > Date.now();
    const members = () => (S.pickem && S.pickem.members) || [];

    function savedPicks(w) {
      const out = {};
      const owner = me();
      ((S.pickem && S.pickem.picks) || []).forEach((p) => {
        if (p.week === w && p.owner === owner) out[p.game] = { winner: p.winner, lock: Boolean(p.lock) };
      });
      return out;
    }
    const picksOf = (w) => S.drafts[w] || savedPicks(w);

    function myVote(w, award) {
      const v = ((S.awards && S.awards.mine) || []).find((x) => x.week === w && x.award === award);
      return v ? v.nominee : null;
    }

    /* ---- acting: who may, and asking for what's missing ------------- */
    function needs(action) {
      if (S.status === "ready") return false;
      if (S.status === "signedout") { signIn(); return true; }
      if (S.status === "unclaimed") { S.pending = action; openClaim(); return true; }
      if (S.status === "loading" || S.status === "idle") { ensure().then(() => { if (S.status === "ready") action(); else if (S.status !== "error") needs(action); }); return true; }
      say(S.status === "unavailable" ? explain(new Error("unavailable")) : S.error || "The clubhouse couldn't be reached.");
      return true;
    }
    function signIn() {
      if (window.Account && Account.openSignIn) Account.openSignIn({ reason: "Sign in to play pick'em and vote on the week's awards with your league." });
    }

    /* ---- pick'em: tapping and saving -------------------------------- */
    const saving = {};       // week → the save chain
    const timers = {};
    function setPick(w, game, id) {
      if (lockedNow(w)) { say(explain(new Error("locked"))); return; }
      if (needs(() => setPick(w, game, id))) return;
      const d = { ...picksOf(w) };
      if (d[game] && d[game].winner === id) delete d[game];
      else d[game] = { winner: id, lock: Boolean(d[game] && d[game].lock) };
      S.drafts[w] = d;
      syncPickCards(w);
      queueSave(w);
    }
    function setLock(w, game) {
      if (lockedNow(w)) { say(explain(new Error("locked"))); return; }
      if (needs(() => setLock(w, game))) return;
      const d = {};
      Object.entries(picksOf(w)).forEach(([k, v]) => { d[k] = { ...v }; });
      if (!d[game]) { say("Pick a winner for that game first, then make it your lock."); flashHint(w, game); return; }
      const on = !d[game].lock;
      Object.values(d).forEach((p) => { p.lock = false; });
      d[game].lock = on;
      S.drafts[w] = d;
      syncPickCards(w);
      queueSave(w);
      say(on ? `Lock of the Week: ${tname(d[game].winner)}` : "No Lock of the Week");
    }
    function runSave(w) {
      clearTimeout(timers[w]);
      delete timers[w];
      saving[w] = (saving[w] || Promise.resolve()).then(() => save(w));
      return saving[w];
    }
    function queueSave(w) {
      S.save[w] = "pending";
      syncPickCards(w);
      clearTimeout(timers[w]);
      timers[w] = setTimeout(() => runSave(w), 650);
    }
    // Leaving the page (or the tab going to the background, which on a
    // phone may be the last chance): picks still waiting out the pause go now.
    const flushSaves = () => Object.keys(timers).forEach((w) => runSave(Number(w)));
    addEventListener("pagehide", flushSaves);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSaves(); });
    // The member's saved picks for the week, put on a board: the one on
    // hand, or the one a reload brings while the save was out.
    function keepSaved(b, owner, w, list) {
      if (!b || !owner) return;
      b.picks = (b.picks || []).filter((p) => !(p.week === w && p.owner === owner))
        .concat(list.map((p) => ({ owner, week: w, game: C.gameKey(p.a, p.b), winner: p.winner, lock: p.lock })));
      const who = new Set((b.picked || {})[w] || []);
      if (list.length) who.add(owner); else who.delete(owner);
      (b.picked = b.picked || {})[w] = [...who];
    }
    async function save(w) {
      const d = S.drafts[w] || {};
      const list = C.slate(season, w).filter((g) => d[g.key]).map((g) => ({ a: g.a, b: g.b, winner: d[g.key].winner, lock: Boolean(d[g.key].lock) }));
      S.save[w] = "saving";
      syncPickCards(w);
      try {
        if (DEMO) {
          const st = demoState();
          st.picks = (Array.isArray(st.picks) ? st.picks : []).filter((p) => p.week !== w)
            .concat(list.map((p) => ({ week: w, game: C.gameKey(p.a, p.b), winner: p.winner, lock: p.lock })));
          demoWrite(st);
          demoBoards();
        } else {
          const owner = me();
          const before = S.pickem;
          await rpc("save_picks", { p_league_key: KEY, p_season: YEAR, p_week: w, p_picks: list });
          if (S.pickem && S.pickem === before) keepSaved(S.pickem, owner, w, list);
          else {
            // The board was reloaded while the save was out (the countdown
            // reached the deadline, or the account changed): the server has
            // the picks, so they go on whichever board arrives, if it's
            // still this member's.
            Promise.resolve(loading).then(() => {
              if (S.pickem && me() && (!owner || me() === owner)) { keepSaved(S.pickem, me(), w, list); paint(); }
            });
          }
        }
        if (S.save[w] === "saving") S.save[w] = "saved";
      } catch (err) {
        console.warn("Clubhouse: picks not saved", err);
        S.save[w] = { error: explain(err) };
        if (codeOf(err) === "locked") { delete S.drafts[w]; reload(); }
      }
      syncPickCards(w);
    }
    function flashHint(w, game) {
      document.querySelectorAll(`.ch-pickem[data-week="${w}"] .ch-lock[data-game="${CSS.escape(game)}"]`).forEach((b) => {
        b.classList.remove("ch-nudge"); void b.offsetWidth; b.classList.add("ch-nudge");
      });
    }

    /* ---- votes ------------------------------------------------------ */
    async function vote(w, award, nominee) {
      if (!voteOpen(w)) { say(explain(new Error("closed"))); return; }
      if (needs(() => vote(w, award, nominee))) return;
      const was = myVote(w, award);
      const next = was === nominee ? null : nominee;
      const title = (C.AWARDS.find((a) => a.id === award) || {}).title || "the award";
      // optimistic: the board as it will be
      const before = JSON.stringify(S.awards);
      const mineList = (S.awards.mine || []).filter((x) => !(x.week === w && x.award === award));
      if (next) mineList.push({ week: w, award, nominee: next });
      S.awards.mine = mineList;
      if (!DEMO) {
        const v = (S.awards.voters = S.awards.voters || {});
        const row = (v[w] = v[w] || {});
        row[award] = Math.max(0, (row[award] || 0) + (was ? 0 : 1) - (next ? 0 : 1));
      }
      paintKind("awards");
      try {
        if (DEMO) {
          const st = demoState();
          st.votes = (Array.isArray(st.votes) ? st.votes : []).filter((x) => !(x.week === w && x.award === award));
          if (next) st.votes.push({ week: w, award, nominee: next });
          demoWrite(st);
          demoBoards();
        } else {
          await rpc("cast_vote", { p_league_key: KEY, p_season: YEAR, p_week: w, p_award: award, p_nominee: next });
        }
        say(next ? `Voted ${tname(next)} for ${title}` : `Vote for ${title} taken back`);
      } catch (err) {
        S.awards = JSON.parse(before);
        say(explain(err));
        awardError[`${w}|${award}`] = explain(err);
        if (["closed", "not_open"].includes(codeOf(err))) reload();
      }
      paintKind("awards");
    }
    const awardError = {};

    /* ---- claiming a team -------------------------------------------- */
    let claimSheet = null;
    function claimBody(error = "") {
      const taken = new Set((S.claims && S.claims.claimed) || []);
      const mine = me();
      const rows = Object.keys(CURRENT.teams).map((id) => ({ id, t: CURRENT.teams[id] }))
        .filter((x) => x.t.ownerId && !/^open-/.test(x.t.ownerId))
        .sort((a, b) => a.t.name.localeCompare(b.t.name));
      return `
        <p class="ch-lede">${DEMO
          ? "Choose a team to play the demo as. Your picks and votes stay on this device."
          : "Choose your team so the league knows which picks and votes are yours. You can change it later."}</p>
        ${error ? `<p class="ch-error" role="alert">${esc(error)}</p>` : ""}
        <div class="ch-claim-list" role="list">
          ${rows.map(({ id, t }) => {
            const isMine = t.ownerId === mine;
            const off = !isMine && taken.has(t.ownerId);
            return `<div role="listitem"><button type="button" class="ch-claim${isMine ? " mine" : ""}" data-ch-claim="${esc(t.ownerId)}" data-fk="claim-${esc(t.ownerId)}" ${off ? "disabled" : ""} aria-pressed="${isMine}" aria-label="${esc(t.name)}, ${esc(t.owner || "")}${isMine ? ", your team" : off ? ", already claimed" : ""}">
              ${badge(t)}
              <span class="ch-claim-copy"><strong>${esc(t.name)}</strong><span>${esc(t.owner || "")}</span></span>
              <span class="ch-claim-tag">${isMine ? "You" : off ? "Claimed" : ""}</span>
            </button></div>`;
          }).join("")}
        </div>
        ${mine ? `<button type="button" class="ch-link ch-release" data-ch-release data-fk="release">${DEMO ? "Stop playing the demo" : "None of these is me: let my team go"}</button>` : ""}`;
    }
    function openClaim() {
      if (claimSheet) return;
      claimSheet = openSheet({
        kicker: esc(model.name),
        title: me() ? "Change your team" : "Which team is yours?",
        body: claimBody(),
        cls: "ch-claim-sheet",
        onClose: () => { claimSheet = null; S.pending = null; },
      });
      claimSheet.body.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-ch-claim]");
        const rel = e.target.closest("[data-ch-release]");
        if (rel) { await release(); return; }
        if (!b || b.disabled) return;
        await claim(b.dataset.chClaim, b);
      });
    }
    async function claim(owner, button) {
      if (owner === me()) { if (claimSheet) claimSheet.close(); return; }
      if (button) { button.classList.add("busy"); button.disabled = true; }
      try {
        if (DEMO) {
          const st = demoState();
          // A new team in the demo takes over its made-up manager's season so
          // far (the weeks already locked), as the app does, so the
          // leaderboard has the visitor on it; their votes start fresh.
          const history = () => C.demoBoard(model, season, null, null).pickem.picks
            .filter((p) => p.owner === owner)
            .map((p) => ({ week: p.week, game: p.game, winner: p.winner, lock: Boolean(p.lock) }));
          demoWrite(st.owner === owner ? st : { owner, picks: history(), votes: [] });
          demoBoards();
        } else {
          S.claims = await rpc("claim_manager", claimArgs(owner));
          refreshLeague.done = true;
          await loadBoards();
          S.status = "ready";
        }
        S.drafts = {};
        const t = CURRENT.teams[teamOfOwner(owner, CURRENT)];
        say(`You're ${t ? t.name : "in"}.`);
        const then = S.pending;
        S.pending = null;
        if (claimSheet) claimSheet.close();
        paint();
        if (then) then();
      } catch (err) {
        if (claimSheet) {
          if (codeOf(err) === "taken") {
            try { S.claims = await rpc("league_claims", { p_league_key: KEY }); } catch (e) { /* keep the old list */ }
          }
          claimSheet.set(claimBody(explain(err)));
        } else say(explain(err));
      }
    }
    async function release() {
      try {
        if (DEMO) { demoWrite({}); demoBoards(); }
        else {
          await rpc("release_manager", { p_league_key: KEY });
          S.claims = { ...(S.claims || {}), mine: null };
          S.pickem = S.awards = null;
          S.status = "unclaimed";
          loading = Promise.resolve();
        }
        S.drafts = {};
        if (claimSheet) claimSheet.close();
        if (board) board.close();
        say("Your team is let go.");
        paint();
      } catch (err) { if (claimSheet) claimSheet.set(claimBody(explain(err))); }
    }

    /* =================================================================
       THE CARDS
       ================================================================= */

    const records = (() => {
      const cache = {};
      return (w) => (cache[w] = cache[w] || (ctx.records ? ctx.records(w) : {}));
    })();
    const recOf = (w, id) => { const s = records(w)[id]; return s ? s.record : ""; };

    // "6 of 10 have picked", and what that's out of.
    function pickedLine(w) {
      const all = members();
      if (!all.length) return "";
      const n = (((S.pickem && S.pickem.picked) || {})[w] || []).filter((o) => all.includes(o)).length;
      if (all.length === 1 && me()) return "Just you so far: send the league the link";
      return `${n} of ${all.length} have picked`;
    }

    // The save state beside the picks. It sits in a box of its own fixed
    // width and only its text and opacity change, so nothing moves.
    function saveState(w) {
      const s = S.save[w];
      if (!s) return { state: "idle", text: "Saved" };
      if (s === "pending" || s === "saving") return { state: "saving", text: "Saving…" };
      if (s === "saved") return { state: "saved", text: "Saved" };
      return { state: "bad", text: "Not saved", error: `Not saved: ${s.error}` };
    }

    function signedOutCard(w, kind) {
      const what = kind === "awards"
        ? `Vote on Week ${w}'s Manager, Choke and Robbery of the Week with your league.`
        : `Pick the winners of Week ${w}'s games with your league, and find out who really knows this league.`;
      return `<article class="card ch-card ch-invite">
        ${cardHead(kind === "awards" ? `Week ${w} Awards` : `Week ${w} Pick'em`, kind === "awards" ? ICON.award : ICON.pickem)}
        <div class="ch-invite-body">
          <p>${what}</p>
          <button type="button" class="ch-btn primary" data-ch-act="signin">Sign in to play</button>
        </div>
      </article>`;
    }

    /* ---- the pick week: the week's games, where the league picks ------

       One card: each game is one tile with both teams (badge, name,
       record, manager) and its "Rivalry & stakes" link. While picks are
       open and the visitor can play, tapping a team picks it and each
       game has a Lock toggle; otherwise the same tiles show without
       them, and the bar under the header says what's missing. Once the
       week locks, each tile shows how the league picked it.

       The card's markup never depends on the picks themselves:
       syncPickCards() puts them on the buttons (classes and attributes
       only), so a tap never redraws anything and nothing changes size. */
    function pickMode(w) {
      if (lockedNow(w)) return "locked";
      if (S.status === "ready") return "pick";
      if (DEMO) return "unclaimed";
      return ["signedout", "unclaimed", "unavailable", "error"].includes(S.status) ? S.status : "loading";
    }

    function pickBar(w, mode, games) {
      const board = S.pickem ? `<button type="button" class="ch-btn ch-board-btn" data-ch-act="board" data-fk="board-${w}" aria-label="Leaderboard">${ICON.list}<span>Leaderboard</span></button>` : "";
      const row = (sub, action, note = "") => `<div class="ch-pbar">
          <div class="ch-pbar-top">
            <span class="ch-pbar-title">${ICON.pickem}<strong>Pick'em</strong></span>
            <span class="ch-count">${esc(sub)}</span>
            ${action}
          </div>
          ${note}
        </div>`;
      if (mode === "pick") {
        const sv = saveState(w);
        return row(pickedLine(w), board, `<div class="ch-pbar-note">
            <p>Tap who wins each game. Your <strong>Lock</strong> counts double.${DEMO ? " Picks stay on this device." : ""}</p>
            <span class="ch-save" data-state="${sv.state}" role="status" aria-live="polite">${ICON.check}<span>${esc(sv.text)}</span></span>
          </div>`);
      }
      if (mode === "locked") {
        const n = (((S.pickem && S.pickem.picked) || {})[w] || []).length;
        return row(S.pickem ? `Locked · ${plural(n, "manager")} picked` : "Picks are locked", board,
          `<div class="ch-pbar-note"><p>${S.pickem ? "How the league picked each game. Graded as the results come in." : "You'll see how the league picked once the week is graded."}</p></div>`);
      }
      const prompt = (text, button) => `<div class="ch-pbar-note ch-prompt"><p>${text}</p>${button}</div>`;
      if (mode === "signedout") return row("", "", prompt("Pick the winners with your league, and find out who really knows it.", '<button type="button" class="ch-btn primary" data-ch-act="signin">Sign in to play pick\'em</button>'));
      if (mode === "unclaimed") return row(pickedLine(w), board, prompt(DEMO ? "Choose a team to play the demo's pick'em. Your picks stay on this device." : "Pick the winners with your league. First, which team is yours?", `<button type="button" class="ch-btn primary" data-ch-act="claim" data-fk="claim-${w}">${DEMO ? "Choose a team" : "Claim your team to pick"}</button>`));
      if (mode === "unavailable") return row("", "", prompt("Pick'em needs the league's server, which isn't connected on this copy of the site.", ""));
      if (mode === "error") return row("", "", prompt(esc(S.error || "The clubhouse couldn't be reached."), '<button type="button" class="ch-btn" data-ch-act="retry">Try again</button>'));
      return row("Loading…", "", "");
    }

    function pickCard(w) {
      const games = C.slate(season, w);
      if (!games.length) return null;          // the page's own tiles, then
      const mode = pickMode(w);
      const can = mode === "pick";
      const asOf = lastPlayed;
      const owner = me();
      const weekPicks = mode === "locked" && S.pickem ? (S.pickem.picks || []).filter((p) => p.week === w) : [];
      const mine = mode === "locked" ? savedPicks(w) : {};
      const rv = (g) => (ctx.rivalryButton ? ctx.rivalryButton(w, g.a, g.b) : "");

      const tile = (g, i) => {
        const label = `Game ${i + 1}: ${tname(g.a)} versus ${tname(g.b)}`;
        const count = { [g.a]: 0, [g.b]: 0 };
        let locks = 0;
        weekPicks.forEach((p) => { if (p.game === g.key && count[p.winner] != null) { count[p.winner] += 1; if (p.lock) locks += 1; } });
        const total = count[g.a] + count[g.b];
        const my = mine[g.key];
        const side = (id) => {
          const t = teams[id];
          const rec = recOf(asOf, id);
          const body = `${badge(t)}<span class="ch-team"><strong>${esc(tname(id))}</strong><span>${esc(rec)}${t && t.owner ? `${rec ? " · " : ""}${esc(t.owner)}` : ""}</span></span>`;
          if (can) {
            return `<button type="button" class="ch-side" data-ch-pick="${esc(g.key)}" data-id="${esc(id)}" data-fk="pick-${esc(g.key)}-${esc(id)}" aria-pressed="false" aria-label="${esc(tname(id))} to win${rec ? `, ${esc(rec)}` : ""}">
              ${body}<span class="ch-check" aria-hidden="true">${ICON.check}</span></button>`;
          }
          const isMine = Boolean(my && my.winner === id);
          const tally = mode === "locked" && S.pickem
            ? `<span class="ch-tally${total && count[id] > total - count[id] ? " lead" : ""}"><b>${count[id]}</b><small>${count[id] === 1 ? "pick" : "picks"}</small></span>` : "";
          return `<div class="ch-side static${isMine ? " mine" : ""}">${body}${isMine ? `<span class="ch-you-tag" title="${my.lock ? "Your Lock of the Week" : "Your pick"}">${my.lock ? ICON.lock : ""}You</span>` : ""}${tally}</div>`;
        };
        const head = can
          ? `<button type="button" class="ch-lock off" data-ch-lock="${esc(g.key)}" data-game="${esc(g.key)}" data-fk="lock-${esc(g.key)}" aria-pressed="false" aria-disabled="true" aria-label="Lock of the Week: ${esc(tname(g.a))} versus ${esc(tname(g.b))}">${ICON.lock}<span>Lock</span></button>`
          : mode === "locked" && S.pickem && total ? `<span class="ch-gm-split">${locks ? `${ICON.lock}${plural(locks, "lock")}` : ""}</span>` : "";
        const bar = mode === "locked" && S.pickem
          ? `<div class="ch-bar ch-gm-bar" aria-hidden="true"><i style="--w:${total ? (100 * count[g.a] / total).toFixed(1) : 50}%"></i></div>` : "";
        return `<div class="ch-gm${can ? " can" : ""}" role="group" aria-label="${esc(label)}" data-game="${esc(g.key)}">
            <div class="ch-gm-head"><span>Game ${i + 1}</span>${head}</div>
            ${side(g.a)}${side(g.b)}${bar}
            ${rv(g)}
          </div>`;
      };

      const dl = deadline(w);
      const meta = mode === "locked" ? "Picks locked"
        : dl ? `<span class="ch-countdown" data-deadline="${esc(dl)}">${esc(lockText(dl))}</span>` : "Not yet played";
      const foot = can
        ? `<div class="ch-foot"><span class="ch-progress" aria-live="off"></span></div>`
        : mode === "locked" && owner && S.pickem && !Object.keys(mine).length ? `<div class="ch-foot"><span class="ch-progress">You didn't pick this week.</span></div>` : "";
      return `<article class="card ch-card ch-pickem ch-mode-${mode}" data-week="${w}">
        ${cardHead(`Week ${w} Matchups`, ICON.versus, meta)}
        ${pickBar(w, mode, games)}
        <div class="ch-gms">${games.map(tile).join("")}</div>
        ${foot}
        ${ctx.whatIfLink ? ctx.whatIfLink(w) : ""}
      </article>`;
    }

    // The picks, put on the card's buttons: only what changed is touched.
    const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
    const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
    const saveTimers = {};
    function syncPickCards(w) {
      const d = picksOf(w);
      const games = C.slate(season, w);
      document.querySelectorAll(`.ch-pickem[data-week="${w}"]`).forEach((card) => {
        card.querySelectorAll(".ch-side[data-ch-pick]").forEach((b) => {
          const p = d[b.dataset.chPick];
          const on = Boolean(p && p.winner === b.dataset.id);
          b.classList.toggle("picked", on);
          b.classList.toggle("passed", Boolean(p) && !on);
          b.classList.toggle("locked", on && Boolean(p.lock));
          setAttr(b, "aria-pressed", String(on));
        });
        card.querySelectorAll(".ch-lock").forEach((b) => {
          const p = d[b.dataset.chLock];
          const on = Boolean(p && p.lock);
          b.classList.toggle("on", on);
          b.classList.toggle("off", !p);
          setAttr(b, "aria-pressed", String(on));
          setAttr(b, "aria-disabled", String(!p));
          setAttr(b, "title", p ? (on ? "Your Lock of the Week: worth 2 if right" : "Make this your Lock of the Week (worth 2)") : "Pick a winner first");
        });
        card.querySelectorAll(".ch-gm.can").forEach((g) => g.classList.toggle("done", Boolean(d[g.dataset.game])));
        const n = games.filter((g) => d[g.key]).length;
        const lock = Object.values(d).find((p) => p.lock);
        const sv = saveState(w);
        const prog = card.querySelector(".ch-progress");
        if (prog && card.classList.contains("ch-mode-pick")) {
          setText(prog, sv.error || `${n} of ${games.length} picked${lock ? ` · Lock: ${tname(lock.winner)}` : n ? " · no Lock yet" : ""}`);
          prog.classList.toggle("bad", Boolean(sv.error));
          setAttr(prog, "title", prog.textContent);
        }
        const save = card.querySelector(".ch-save");
        if (save) {
          // "Saved" fades back out a moment after it shows
          const state = sv.state === "saved" && S.save[`${w}:quiet`] ? "idle" : sv.state;
          setAttr(save, "data-state", state);
          setText(save.lastElementChild, sv.text);
          if (sv.error) setAttr(save, "title", sv.error); else save.removeAttribute("title");
        }
        setText(card.querySelector(".ch-count"), pickedLine(w));
      });
      if (S.save[w] === "saved" && !S.save[`${w}:quiet`]) {
        clearTimeout(saveTimers[w]);
        saveTimers[w] = setTimeout(() => { if (S.save[w] === "saved") { S.save[`${w}:quiet`] = true; syncPickCards(w); } }, 2400);
      } else if (S.save[w] !== "saved") delete S.save[`${w}:quiet`];
    }

    /* ---- a played week: how the league picked -----------------------

       The Results view already has a tile for every game, so each game's
       pick split goes on its own tile (decorateResults), and this card
       keeps the week's winner and every manager's points. */
    function weekPicksOf(w) {
      if (!S.pickem) return [];
      return (S.pickem.picks || []).filter((p) => p.week === w);
    }
    function gradedCard(w) {
      const games = C.slate(season, w);
      const weekPicks = weekPicksOf(w);
      if (!games.length || !weekPicks.length) return "";
      const G = C.grade(season, S.pickem);
      const wk = G.weeks[w];
      const final = Boolean(wk && wk.final);
      const owner = me();
      const mine = savedPicks(w);
      const ownerTeam = (o) => teamOfOwner(o);
      const nameOwner = (o) => { const id = ownerTeam(o); return id ? tname(id) : "A former manager"; };
      const best = (wk && wk.best) || [];
      const top = wk ? Math.max(0, ...wk.rows.map((r) => r.points)) : 0;

      const winnerLine = final && best.length
        ? `<div class="ch-winner">
            <span class="ch-trophy" aria-hidden="true">🏆</span>
            <div><small>Week ${w} winner${best.length > 1 ? "s" : ""}</small>
            <strong>${best.map((o) => `${badge(teams[ownerTeam(o)])}<span>${esc(nameOwner(o))}</span>`).join('<i aria-hidden="true">&amp;</i>')}</strong>
            <span>${plural(top, "point")} of ${games.length + 1} possible${best.includes(owner) ? " · that's you" : ""}</span></div>
          </div>`
        : !final ? `<p class="ch-pending">Graded as the results come in.</p>` : "";

      const scoreRows = wk ? wk.rows.filter((r) => r.picked).slice().sort((a, b) => (b.points - a.points) || (b.correct - a.correct)) : [];
      const scores = scoreRows.length ? `<div class="ch-scores">
          <div class="ch-scores-head"><span>Manager</span><span>Pts</span><span>Right</span></div>
          ${scoreRows.map((r) => `<div class="ch-score${r.owner === owner ? " me" : ""}${best.includes(r.owner) ? " best" : ""}">
            <span class="ch-score-team">${badge(teams[ownerTeam(r.owner)])}<span>${esc(nameOwner(r.owner))}${r.owner === owner ? ' <em>you</em>' : ""}</span></span>
            <b>${r.points}</b><span>${r.correct}–${r.wrong}</span>
          </div>`).join("")}
        </div>` : "";

      return `<article class="card ch-card ch-graded" data-week="${w}">
        ${cardHead(`Week ${w} Pick'em`, ICON.pickem, final ? "Final" : "Results in")}
        ${winnerLine}
        ${scores}
        <div class="ch-foot"><span class="ch-progress">${plural(scoreRows.length, "manager")} picked${owner && !Object.keys(mine).length ? " · you didn't pick this week" : ""} · each game's picks are on its tile</span>
          <button type="button" class="ch-btn ch-board-btn" data-ch-act="board" data-fk="board-${w}">${ICON.list}<span>Leaderboard</span></button></div>
      </article>`;
    }

    // One game's pick split, for its tile on the Results view: a, b in
    // the tile's order.
    function splitStrip(w, a, b) {
      const weekPicks = weekPicksOf(w);
      if (!weekPicks.length) return "";
      const key = C.gameKey(a, b);
      if (!C.slate(season, w).some((g) => g.key === key)) return "";
      const count = { [a]: 0, [b]: 0 };
      let locks = 0;
      weekPicks.forEach((p) => { if (p.game === key && count[p.winner] != null) { count[p.winner] += 1; if (p.lock) locks += 1; } });
      const total = count[a] + count[b];
      const won = C.outcomes(season, w)[key];
      const my = savedPicks(w)[key];
      const lead = count[a] === count[b] ? null : count[a] > count[b] ? a : b;
      const split = !total ? "No picks"
        : lead ? `${Math.max(count[a], count[b])}–${Math.min(count[a], count[b])} for ${tname(lead)}`
        : `Split ${count[a]}–${count[b]}`;
      const mark = !my ? ""
        : won && won !== "tie"
          ? (my.winner === won
            ? `<span class="ch-mark right" title="You picked ${esc(tname(my.winner))}: right">${ICON.check}<span class="ch-sr">You picked ${esc(tname(my.winner))}: right</span></span>`
            : `<span class="ch-mark wrong" title="You picked ${esc(tname(my.winner))}: wrong">${ICON.cross}<span class="ch-sr">You picked ${esc(tname(my.winner))}: wrong</span></span>`)
          : `<span class="ch-mark" title="Your pick">${esc(tname(my.winner))}</span>`;
      const lockMine = my && my.lock ? `<span class="ch-lock-tag" title="Your Lock of the Week">${ICON.lock}</span>` : "";
      return `<div class="ch-gpick">
          <div class="ch-gpick-row">
            <span class="ch-gpick-label">${ICON.pickem}Pick'em</span>
            <span class="ch-gpick-split">${esc(split)}${locks ? ` · ${plural(locks, "lock")}` : ""}</span>
            ${lockMine}${mark}
          </div>
          <div class="ch-bar" aria-hidden="true"><i style="--w:${total ? (100 * count[a] / total).toFixed(1) : 50}%"></i></div>
        </div>`;
    }
    function decorateResults(slot, w) {
      const stack = slot.parentElement;
      if (!stack) return;
      const on = isPlayed(w) && w <= REGULAR && Boolean(S.pickem);
      stack.querySelectorAll(".game-card").forEach((card) => {
        const old = card.querySelector(":scope > .ch-gpick");
        const ids = [...card.querySelectorAll(".game-side [data-team]")].map((el) => el.dataset.team);
        const html = on && ids.length === 2 ? splitStrip(w, ids[0], ids[1]) : "";
        if (old && old._html === html) return;
        if (old) old.remove();
        if (!html) return;
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        const el = tmp.firstElementChild;
        el._html = html;
        card.insertBefore(el, card.querySelector(":scope > .bx-open"));
      });
    }

    /* ---- the Recap: the week's awards -------------------------------- */
    function awardsCard(w) {
      if (w > REGULAR || !isPlayed(w)) return "";
      const nom = C.nominees(season, w);
      if (!nom) return "";
      const open = voteOpen(w);
      if (!open) return awardsResultCard(w);
      const all = members();
      const voters = (S.awards && S.awards.voters && S.awards.voters[w]) || {};
      const most = Math.max(0, ...C.AWARDS.map((a) => voters[a.id] || 0));
      const close = closesAt(w);
      const meta = [all.length ? `${most} of ${all.length} have voted` : "", close ? `results ${dayTime(close)}` : ""].filter(Boolean).join(" · ");
      const ids = Object.keys(teams).sort((a, b) => tname(a).localeCompare(tname(b)));
      return `<article class="card ch-card ch-awards" data-week="${w}">
        ${cardHead(`Week ${w} Awards`, ICON.award, "Voted by the league")}
        <div class="ch-intro"><p>One vote for each. The tallies stay hidden until voting closes.</p><span class="ch-count">${esc(meta)}</span></div>
        ${C.AWARDS.map((a) => {
          const mineNow = myVote(w, a.id);
          const list = nom[a.id] || [];
          const extra = mineNow && !list.some((x) => x.team === mineNow) ? [{ team: mineNow, reason: "Your pick" }] : [];
          const err = awardError[`${w}|${a.id}`];
          delete awardError[`${w}|${a.id}`];
          return `<section class="ch-award" aria-labelledby="chA${w}${a.id}">
            <div class="ch-award-head">
              <span class="ch-medal" aria-hidden="true">${a.emoji}</span>
              <div><h4 id="chA${w}${a.id}">${esc(a.title)}</h4><span>${esc(a.blurb)}${voters[a.id] ? ` · ${voters[a.id]} voted` : ""}</span></div>
            </div>
            <div class="ch-noms">
              ${list.concat(extra).map((x) => `<button type="button" class="ch-nom${mineNow === x.team ? " on" : ""}" data-ch-vote="${a.id}" data-id="${esc(x.team)}" data-fk="vote-${a.id}-${esc(x.team)}" aria-pressed="${mineNow === x.team}" aria-label="${esc(a.title)}: ${esc(tname(x.team))}. ${esc(x.reason)}">
                ${badge(teams[x.team])}<span class="ch-nom-copy"><strong>${esc(tname(x.team))}</strong><span>${esc(x.reason)}</span></span><span class="ch-check">${ICON.check}</span>
              </button>`).join("")}
              <label class="ch-other">
                <span>Someone else</span>
                <select data-ch-other="${a.id}" data-fk="other-${a.id}" aria-label="${esc(a.title)}: vote for someone else">
                  <option value="">Choose a team…</option>
                  ${ids.filter((id) => !list.some((x) => x.team === id)).map((id) => `<option value="${esc(id)}"${mineNow === id ? " selected" : ""}>${esc(tname(id))}</option>`).join("")}
                </select>
              </label>
            </div>
            ${err ? `<p class="ch-error" role="alert">${esc(err)}</p>` : ""}
          </section>`;
        }).join("")}
        <div class="ch-foot"><span class="ch-progress">${mineCount(w)} of 3 voted${DEMO ? " · kept on this device" : ""}</span>
          ${S.pickem ? `<button type="button" class="ch-btn" data-ch-act="board" data-fk="aboard-${w}">${ICON.list}Leaderboard</button>` : ""}</div>
      </article>`;
    }
    const mineCount = (w) => C.AWARDS.filter((a) => myVote(w, a.id)).length;

    function awardsResultCard(w) {
      const res = ((S.awards && S.awards.results) || []).filter((r) => r.week === w);
      if (!res.length) return "";
      const winners = C.awardWinners(S.awards)[w] || {};
      return `<article class="card ch-card ch-awards ch-awards-done" data-week="${w}">
        ${cardHead(`Week ${w} Awards`, ICON.award, "The league has voted")}
        <div class="ch-trophies">
          ${C.AWARDS.map((a) => {
            const tally = res.filter((r) => r.award === a.id).sort((x, y) => y.votes - x.votes);
            const won = winners[a.id] || [];
            if (!tally.length) return `<div class="ch-trophy-card none"><span class="ch-medal" aria-hidden="true">${a.emoji}</span><small>${esc(a.title)}</small><strong>No votes</strong></div>`;
            const top = tally[0].votes;
            const rest = tally.filter((r) => !won.includes(r.nominee)).slice(0, 3);
            return `<div class="ch-trophy-card">
              <span class="ch-medal" aria-hidden="true">${a.emoji}</span>
              <small>${esc(a.title)}</small>
              <strong>${won.map((id) => `${badge(teams[id])}<span>${esc(tname(id))}</span>`).join('<i aria-hidden="true">&amp;</i>')}</strong>
              <span class="ch-votes">${plural(top, "vote")}${won.length > 1 ? " each, a tie" : ""}${won.includes(teamOfOwner(me())) ? " · that's you" : ""}</span>
              ${rest.length ? `<span class="ch-also">${rest.map((r) => `${esc(tname(r.nominee))} ${r.votes}`).join(" · ")}</span>` : ""}
            </div>`;
          }).join("")}
        </div>
      </article>`;
    }

    /* ---- what goes in each slot -------------------------------------- */
    // A slot's card; null keeps what the page put in the slot.
    function slotHtml(kind, w) {
      if (kind === "pickem") return w === PICK_WEEK ? pickCard(w) : null;
      if (kind === "results") return isPlayed(w) && w <= REGULAR ? gradedCard(w) : "";
      if (kind === "awards") {
        if (S.status === "signedout") return w === lastPlayed && !season.finished && w <= REGULAR ? signedOutCard(w, "awards") : "";
        if (S.status === "unavailable" || S.status === "error") return "";
        return awardsCard(w);
      }
      return "";
    }

    function fillSlot(slot) {
      const kind = slot.dataset.ch;
      const w = Number(slot.dataset.week);
      if (slot._fallback == null) slot._fallback = slot.innerHTML;
      const waiting = !DEMO && (S.status === "idle" || S.status === "loading");
      if (waiting) ensure();
      // (the pick week's card has a loading state of its own: its tiles)
      let html = waiting && kind !== "pickem" ? "" : slotHtml(kind, w);
      if (html == null) html = slot._fallback;
      if (slot._html == null && html === slot._fallback) slot._html = html;
      if (slot._html !== html) {
        const key = document.activeElement && slot.contains(document.activeElement) && document.activeElement.dataset.fk;
        slot._html = html;
        slot.innerHTML = html;
        if (key) { const back = slot.querySelector(`[data-fk="${CSS.escape(key)}"]`); if (back) back.focus({ preventScroll: true }); }
      }
      if (kind === "pickem") syncPickCards(w);
      if (kind === "results") decorateResults(slot, w);
    }
    function paint() { document.querySelectorAll(".ch-slot").forEach(fillSlot); if (board) board.set(boardBody()); }
    function paintKind(kind) { document.querySelectorAll(`.ch-slot[data-ch="${kind}"]`).forEach(fillSlot); if (board) board.set(boardBody()); }

    // The season page redraws a view by replacing its contents; new slots
    // are filled as they arrive, before the browser paints them.
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches(".ch-slot")) fillSlot(n);
          if (n.querySelectorAll) n.querySelectorAll(".ch-slot").forEach(fillSlot);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    if (DEMO) demoBoards();
    document.querySelectorAll(".ch-slot").forEach(fillSlot);

    // The countdown, every half minute; past the deadline, the card locks.
    setInterval(() => {
      document.querySelectorAll(".ch-countdown[data-deadline]").forEach((el) => {
        const t = el.dataset.deadline;
        const text = lockText(t);
        if (el.textContent !== text) el.textContent = text;
        if (new Date(t) <= Date.now() && !DEMO) { delete el.dataset.deadline; reload(); }
      });
    }, 30e3);

    /* =================================================================
       THE LEADERBOARD
       ================================================================= */
    function boardBody() {
      if (!S.pickem) return `<p class="ch-lede">${S.status === "signedout" ? "Sign in to see your league's leaderboard." : "Choose your team to see the leaderboard."}</p>`;
      const G = C.grade(season, S.pickem);
      const owner = me();
      const anyFinal = Object.values(G.weeks).some((x) => x.final);
      const rank = [];
      G.rows.forEach((r, i) => {
        const prev = G.rows[i - 1];
        rank.push(prev && prev.points === r.points && prev.correct === r.correct && prev.wrong === r.wrong ? rank[i - 1] : i + 1);
      });
      const nameOwner = (o) => { const id = teamOfOwner(o); return id ? tname(id) : "A former manager"; };
      const myTeam = teams[teamOfOwner(owner)] || (CURRENT.teams[teamOfOwner(owner, CURRENT)]);

      const you = owner ? `<div class="ch-you">${badge(myTeam)}<span>You're <strong>${esc(myTeam ? myTeam.name : "in")}</strong></span>
          <button type="button" class="ch-link" data-ch-act="claim" data-fk="change">change</button></div>` : "";

      const standings = `<section class="ch-sec" aria-labelledby="chLbStand">
          <h3 id="chLbStand">Standings</h3>
          <div class="ch-lb" role="table" aria-label="Pick'em standings">
            <div class="ch-lb-row head" role="row"><span role="columnheader">#</span><span role="columnheader">Manager</span><span role="columnheader">Pts</span><span role="columnheader">W–L</span><span role="columnheader" title="Perfect weeks">Perf</span><span role="columnheader" title="Weeks won">Won</span><span role="columnheader" title="Weeks in a row at .500 or better">Streak</span></div>
            ${G.rows.map((r, i) => `<div class="ch-lb-row${r.owner === owner ? " me" : ""}" role="row">
              <span class="ch-rank" role="cell">${rank[i]}</span>
              <span class="ch-lb-team" role="cell">${badge(teams[r.team])}<strong class="ch-lb-name">${esc(nameOwner(r.owner))}</strong>${anyFinal && rank[i] === 1 && r.points > 0 ? '<em class="ch-oracle" title="The league\'s Oracle: the season\'s best picker">👑<span> Oracle</span></em>' : ""}${r.owner === owner ? '<em class="ch-me">you</em>' : ""}</span>
              <b role="cell">${r.points}</b>
              <span role="cell">${r.correct}–${r.wrong}</span>
              <span role="cell">${r.perfect || "–"}</span>
              <span role="cell">${r.weeksWon || "–"}</span>
              <span role="cell">${r.streak ? `${r.streak >= 3 ? "🔥" : ""}${r.streak}` : "–"}</span>
            </div>`).join("")}
          </div>
          <p class="ch-fine">A right pick is a point, a right Lock of the Week two. A perfect week is every game right.</p>
        </section>`;

      const wks = Object.keys(G.weeks).map(Number).sort((a, b) => b - a);
      const openWeek = PICK_WEEK && !lockedNow(PICK_WEEK) ? PICK_WEEK : null;
      const weekly = `<section class="ch-sec" aria-labelledby="chLbWeeks">
          <h3 id="chLbWeeks">Week by week</h3>
          <div class="ch-weeks">
            ${openWeek ? `<div class="ch-wk open"><span class="ch-wk-n">Wk ${openWeek}</span><span>${esc(pickedLine(openWeek))}</span><span class="ch-wk-pts">${esc(lockText(deadline(openWeek)))}</span></div>` : ""}
            ${wks.filter((w) => w !== openWeek).map((w) => {
              const x = G.weeks[w];
              const top = Math.max(0, ...x.rows.map((r) => r.points));
              return `<div class="ch-wk"><span class="ch-wk-n">Wk ${w}</span>
                <span class="ch-wk-who">${x.final ? (x.best.length ? x.best.map((o) => `<span class="ch-wk-one">${badge(teams[teamOfOwner(o)])}<span>${esc(nameOwner(o))}</span></span>`).join("") : "No winner") : "In progress"}</span>
                <span class="ch-wk-pts">${x.final ? `${top} pts` : "Locked"}</span></div>`;
            }).join("") || '<p class="ch-fine">No weeks picked yet.</p>'}
          </div>
        </section>`;

      const aw = C.awardWinners(S.awards);
      const awWeeks = Object.keys(aw).map(Number).sort((a, b) => b - a);
      const awards = awWeeks.length ? `<section class="ch-sec" aria-labelledby="chLbAwards">
          <h3 id="chLbAwards">Awards</h3>
          <div class="ch-weeks">
            ${awWeeks.map((w) => `<div class="ch-wk awards"><span class="ch-wk-n">Wk ${w}</span>
              <span class="ch-wk-awards">${C.AWARDS.map((a) => (aw[w][a.id] ? `<span title="${esc(a.title)}"><i aria-hidden="true">${a.emoji}</i><span class="ch-sr">${esc(a.title)}:</span> ${aw[w][a.id].map((id) => esc(tname(id))).join(" & ")}</span>` : "")).join("")}</span></div>`).join("")}
          </div>
        </section>` : "";

      return `${you}${standings}${weekly}${awards}${notifyHtml()}`;
    }
    function openBoard() {
      if (board) return;
      if (!S.pickem && needs(openBoard)) return;
      board = openSheet({
        kicker: `${esc(model.name)} · ${YEAR}`,
        title: "Pick'em Leaderboard",
        body: boardBody(),
        cls: "ch-board-sheet",
        onClose: () => { board = null; },
      });
      board.body.addEventListener("click", onBoardClick);
      refreshNotify();
    }
    async function onBoardClick(e) {
      const act = e.target.closest("[data-ch-act]");
      if (act && act.dataset.chAct === "claim") { openClaim(); return; }
      const n = e.target.closest("[data-ch-notify]");
      if (n) await notifyAction(n.dataset.chNotify, n);
    }

    /* =================================================================
       NOTIFICATIONS (Web Push), per league, in the Leaderboard sheet
       ================================================================= */
    const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const INSTALLED = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const N = { sub: null, checked: false, busy: false, error: "" };
    const KINDS = [
      { id: "recap", flag: "notify_recap", label: "Week is final", when: "Tuesdays, with how your week went" },
      { id: "pickem", flag: "notify_pickem", label: "Picks lock tonight", when: "Thursdays, if you haven't picked" },
      { id: "awards", flag: "notify_awards", label: "Awards are in", when: "When the week's voting closes" },
    ];
    function swReady() {
      return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("no_worker")), 6000)),
      ]);
    }
    /* What the sheet shows: this league's own switches, as the server has
       them (league_claims().mine.notify_*, all off until the member turns
       them on here or in the app), and whether this browser can receive
       them. Opening the sheet asks the server again, and registers this
       browser's subscription again (an upsert), so a subscription the
       browser rotated, or one last registered by another account, is this
       member's. */
    const flagOn = (k) => Boolean(S.claims && S.claims.mine && S.claims.mine[k.flag] === true);
    const anyOn = () => KINDS.some(flagOn);
    async function refreshNotify() {
      if (DEMO || !VAPID() || !pushSupported() || !me()) return;
      const owner = me();
      try {
        const reg = await swReady();
        N.sub = await reg.pushManager.getSubscription();
      } catch (err) { N.sub = null; }
      if (N.sub && Notification.permission === "granted") registerDevice(N.sub, true).catch(() => { /* next time */ });
      try {
        const c = await rpc("league_claims", { p_league_key: KEY });
        if (c && c.mine && c.mine.owner_id === owner && me() === owner) S.claims = c;
      } catch (err) { /* the flags as loaded */ }
      N.checked = true;
      if (board) board.set(boardBody());
    }
    function notifyHtml() {
      if (DEMO || !VAPID() || !me()) return "";
      const head = `<h3 id="chLbNotify">${ICON.bell}Notify me</h3>`;
      const wrap = (inner) => `<section class="ch-sec ch-notify" aria-labelledby="chLbNotify">${head}${inner}</section>`;
      if (IOS && !INSTALLED()) return wrap(`<p class="ch-fine">On iPhone and iPad, notifications come to the app on your Home Screen: tap Share, then Add to Home Screen, and turn them on from there.</p>`);
      if (!pushSupported()) return "";
      const league = esc(model.name || "this league");
      const kinds = `<ul class="ch-kinds">${KINDS.map((k) => `<li><strong>${k.label}</strong> <span>${k.when}</span></li>`).join("")}</ul>`;
      const err = N.error ? `<p class="ch-error" role="alert">${esc(N.error)}</p>` : "";
      if (Notification.permission === "denied") return wrap(`${kinds}<p class="ch-fine">Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.</p>`);
      if (!N.checked) return wrap(`<p class="ch-fine">Checking this browser…</p>`);
      const here = Boolean(N.sub) && Notification.permission === "granted";
      if (!here || !anyOn()) {
        const fine = !here && anyOn()
          ? `${league}'s notifications are on for your account, but not on this browser yet.`
          : `For ${league} only, on this browser.${Notification.permission === "granted" ? "" : " Your browser asks first."}`;
        return wrap(`${kinds}${err}<button type="button" class="ch-btn primary" data-ch-notify="on" data-fk="notify-on"${N.busy ? " disabled" : ""}>${N.busy ? "Turning on…" : "Turn on notifications"}</button>
          <p class="ch-fine">${fine}</p>`);
      }
      return wrap(`${err}<div class="ch-switches">${KINDS.map((k) => {
          const on = flagOn(k);
          return `<button type="button" class="ch-switch-row" role="switch" aria-checked="${on}" data-ch-notify="${k.id}" data-fk="notify-${k.id}"${N.busy ? " disabled" : ""}>
            <span><strong>${k.label}</strong><span>${k.when}</span></span><span class="ch-switch" aria-hidden="true"><i></i></span>
          </button>`;
        }).join("")}</div>
        <p class="ch-fine">For ${league} only, on this browser. Each league you're in has its own.</p>
        <button type="button" class="ch-link" data-ch-notify="off" data-fk="notify-off">Turn off notifications for ${league}</button>`);
    }
    async function notifyAction(what) {
      if (N.busy) return;
      N.error = "";
      N.busy = true;
      if (board) board.set(boardBody());
      const set = async (recap, pickem, awards) => {
        await rpc("set_league_notifications", { p_league_key: KEY, p_recap: recap, p_pickem: pickem, p_awards: awards });
        if (!S.claims || !S.claims.mine) return;   // reloading: the new claims have it
        const mine = { ...S.claims.mine };
        if (recap !== null) mine.notify_recap = recap;
        if (pickem !== null) mine.notify_pickem = pickem;
        if (awards !== null) mine.notify_awards = awards;
        S.claims.mine = mine;
      };
      try {
        if (what === "on") {
          // Only ever asked here, on the member's tap.
          const perm = await Notification.requestPermission();
          if (perm !== "granted") throw new Error(perm === "denied" ? "blocked" : "not_now");
          const reg = await swReady();
          let sub = await reg.pushManager.getSubscription();
          if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID()) });
          await registerDevice(sub, true);
          // This league, and no other: each league is turned on on its own.
          await set(true, true, true);
          N.sub = sub;
          say(`Notifications for ${model.name || "this league"} are on.`);
        } else if (what === "off") {
          // This league's switches, off. The browser stays subscribed for
          // any other league the member gets notifications from.
          await set(false, false, false);
          say(`Notifications for ${model.name || "this league"} are off.`);
        } else {
          const k = KINDS.find((x) => x.id === what);
          if (!k) return;
          const on = !flagOn(k);
          await set(k.id === "recap" ? on : null, k.id === "pickem" ? on : null, k.id === "awards" ? on : null);
          say(`${k.label}: ${on ? "on" : "off"}`);
        }
      } catch (err) {
        const code = codeOf(err);
        N.error = code === "blocked" ? "Notifications are blocked for this site."
          : code === "not_now" ? "Notifications weren't allowed. Tap again when you're ready."
          : code === "no_worker" ? "This browser couldn't set up notifications. Reload the page and try again."
          : explain(err);
      } finally {
        N.busy = false;
        if (board) board.set(boardBody());
      }
    }

    /* =================================================================
       THE SHARE CARD: the week as one picture for the group chat
       1080 × 1350. Team logos are drawn where their host allows it (a
       picture from a site that doesn't would make the canvas unsaveable);
       otherwise each team is its colour and initial.
       ================================================================= */
    function loadImage(src) {
      return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        const img = new Image();
        if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
        const done = (v) => { clearTimeout(t); resolve(v); };
        const t = setTimeout(() => done(null), 4000);
        img.onload = () => done(img.naturalWidth ? img : null);
        img.onerror = () => done(null);
        img.src = src;
      });
    }

    async function shareData(w) {
      const games = (season.results[w] || []).map(([a, as, b, bs]) => ({ a, as, b, bs }));
      const sides = [];
      games.forEach((g) => { sides.push({ id: g.a, pts: g.as, opp: g.b, oppPts: g.bs }); sides.push({ id: g.b, pts: g.bs, opp: g.a, oppPts: g.as }); });
      const byPts = sides.slice().sort((x, y) => y.pts - x.pts);
      const decided = games.filter((g) => g.as !== g.bs);
      const margin = (g) => Math.abs(g.as - g.bs);
      const blowout = decided.slice().sort((x, y) => margin(y) - margin(x))[0] || null;
      const closest = decided.slice().sort((x, y) => margin(x) - margin(y))[0] || null;
      const win = (g) => (g.as >= g.bs ? [g.a, g.as, g.b, g.bs] : [g.b, g.bs, g.a, g.as]);

      let table = null;
      if (ctx.standings && w <= REGULAR) {
        try {
          const now = ctx.standings(w);
          const prevWeek = played.filter((x) => x < w).pop();
          const prev = prevWeek ? ctx.standings(prevWeek) : null;
          table = now.seeds.slice(0, 3).map((id, i) => ({
            id, rank: i + 1, record: now.stats[id].record,
            move: prev && prev.seeds.includes(id) ? prev.seeds.indexOf(id) - i : 0,
          }));
        } catch (err) { table = null; }
      }

      let blunder = null, headline = null;
      try {
        const r = ctx.recap ? await Promise.race([ctx.recap(w), new Promise((res) => setTimeout(() => res(null), 5000))]) : null;
        if (r && r.lineup && r.lineup.blunder) {
          const b = r.lineup.blunder;
          blunder = { id: b.teamId, player: r.moves.pname(b.blunder.benched.pid), pts: b.blunder.benched.pts, cost: b.costGame };
        }
        if (r && r.headline) headline = r.headline.title;
      } catch (err) { /* without them */ }

      const aw = !voteOpen(w) && S.awards ? C.awardWinners(S.awards)[w] || null : null;
      let pick = null;
      if (S.pickem) {
        const x = C.grade(season, S.pickem).weeks[w];
        if (x && x.final && x.best.length) pick = { ids: x.best.map((o) => teamOfOwner(o)).filter(Boolean), pts: Math.max(...x.rows.map((r) => r.points)) };
      }
      return {
        w, games, headline,
        high: byPts[0], low: byPts[byPts.length - 1],
        blowout: blowout && win(blowout), blowoutBy: blowout && margin(blowout),
        closest: closest && win(closest), closestBy: closest && margin(closest),
        table, blunder, awards: aw, pick,
      };
    }

    async function drawCard(D, withLogos) {
      const W = 1080, H = 1350, PAD = 72;
      const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
      const BODY = 'Inter, "Segoe UI", Roboto, sans-serif';
      const GOLD = "#f6b73c", SOFT = "rgba(219,229,238,.72)", DIM = "rgba(219,229,238,.5)", RED = "#d71920";
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      if (!g.roundRect) g.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };

      // the pictures first, each one allowed or not
      const ids = new Set();
      [D.high, D.low].forEach((s) => s && ids.add(s.id));
      [D.blowout, D.closest].forEach((x) => x && (ids.add(x[0]), ids.add(x[2])));
      (D.table || []).forEach((r) => ids.add(r.id));
      if (D.blunder) ids.add(D.blunder.id);
      Object.values(D.awards || {}).forEach((l) => l.forEach((id) => ids.add(id)));
      ((D.pick && D.pick.ids) || []).forEach((id) => ids.add(id));
      const pics = {};
      if (withLogos) {
        await Promise.all([...ids].map(async (id) => { pics[id] = await loadImage(logoOf(teams[id])); }));
        pics.__league = await loadImage(typeof model.avatar === "string" && /^(https?:\/\/|data:image\/)/i.test(model.avatar) ? model.avatar : "");
      }

      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#102b43"); bg.addColorStop(0.38, "#071827"); bg.addColorStop(1, "#050f1a");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W * 0.85, 120, 10, W * 0.85, 120, 620);
      glow.addColorStop(0, "rgba(246,183,60,.16)"); glow.addColorStop(1, "rgba(246,183,60,0)");
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.fillStyle = RED; g.fillRect(0, 0, W, 10);

      const fit = (text, max, font) => {
        g.font = font;
        if (g.measureText(text).width <= max) return text;
        let t = text;
        while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
        return `${t.trimEnd()}…`;
      };
      const txt = (text, x, y, font, color, max = W - PAD * 2, align = "left") => {
        g.textAlign = align; g.fillStyle = color; g.fillText(fit(String(text), max, font), x, y);
        g.font = font;
        return Math.min(max, g.measureText(fit(String(text), max, font)).width);
      };
      const box = (x, y, w, h, fill = "rgba(255,255,255,.06)", rad = 18) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); };
      const mark = (id, x, cy, size) => {
        const t = teams[id];
        const pic = pics[id];
        g.save();
        g.beginPath(); g.roundRect(x, cy - size / 2, size, size, size * 0.3); g.clip();
        if (pic) g.drawImage(pic, x, cy - size / 2, size, size);
        else {
          g.fillStyle = (t && t.color) || "#304f91"; g.fillRect(x, cy - size / 2, size, size);
          g.fillStyle = "#fff"; g.font = `700 ${Math.round(size * 0.5)}px ${BODY}`; g.textAlign = "center";
          g.fillText((t && (t.icon || [...t.name.trim()][0])) || "?", x + size / 2, cy + size * 0.18);
        }
        g.restore();
      };
      const nm = (id) => tname(id);

      // the league and the week
      let y = PAD;
      const av = 92;
      if (pics.__league) {
        g.save(); g.beginPath(); g.arc(PAD + av / 2, y + av / 2, av / 2, 0, Math.PI * 2); g.clip();
        g.drawImage(pics.__league, PAD, y, av, av); g.restore();
      } else {
        g.fillStyle = "rgba(255,255,255,.1)"; g.beginPath(); g.arc(PAD + av / 2, y + av / 2, av / 2, 0, Math.PI * 2); g.fill();
        txt(([...String(model.name || "?").trim()][0] || "?").toUpperCase(), PAD + av / 2, y + av / 2 + 16, `700 44px ${DISPLAY}`, GOLD, av, "center");
      }
      txt(String(model.name || "").toUpperCase(), PAD + av + 26, y + 40, `700 32px ${BODY}`, GOLD, W - PAD * 2 - av - 26);
      txt(`${YEAR} season · the week in review`, PAD + av + 26, y + 78, `500 26px ${BODY}`, SOFT, W - PAD * 2 - av - 26);
      y += av + 150;
      txt(`WEEK ${D.w}`, PAD - 4, y, `700 176px ${DISPLAY}`, "#ffffff");
      y += 18;
      if (D.headline) {
        y += 50;
        txt(D.headline.toUpperCase(), PAD, y, `700 54px ${DISPLAY}`, GOLD);
        y += 10;
      }
      y += 30;

      const bottom = H - PAD - 64;
      const gap = 22, tw = (W - PAD * 2 - gap) / 2;

      // the four numbers
      const tiles = [];
      if (D.high) tiles.push(["HIGH SCORE", D.high.id, fmt(D.high.pts), D.high.pts < D.high.oppPts ? "and still lost" : `beat ${nm(D.high.opp)}`]);
      if (D.low) tiles.push(["LOW SCORE", D.low.id, fmt(D.low.pts), D.low.pts > D.low.oppPts ? "and still won" : `lost to ${nm(D.low.opp)}`]);
      if (D.blowout) tiles.push(["BIGGEST BLOWOUT", D.blowout[0], `by ${fmt(D.blowoutBy)}`, `over ${nm(D.blowout[2])}`]);
      if (D.closest) tiles.push(["CLOSEST GAME", D.closest[0], `by ${fmt(D.closestBy)}`, `over ${nm(D.closest[2])}`]);
      const th = 168;
      for (let i = 0; i < tiles.length; i += 2) {
        if (y + th > bottom) break;
        tiles.slice(i, i + 2).forEach(([label, id, big, sub], k) => {
          const x = PAD + k * (tw + gap);
          box(x, y, tw, th);
          txt(label, x + 24, y + 40, `700 21px ${BODY}`, GOLD, tw - 48);
          mark(id, x + 24, y + 86, 44);
          txt(nm(id), x + 82, y + 96, `700 28px ${BODY}`, "#ffffff", tw - 106);
          const bw = txt(big, x + 24, y + 144, `700 30px ${BODY}`, "#ffffff", tw - 48);
          txt(sub, x + 24 + bw + 12, y + 143, `500 22px ${BODY}`, SOFT, tw - 60 - bw);
        });
        y += th + gap;
      }

      // the standings, top three
      if (D.table && D.table.length && y + 46 + D.table.length * 62 <= bottom) {
        y += 8;
        txt("THE STANDINGS", PAD, y + 22, `700 21px ${BODY}`, GOLD);
        txt("RECORD", W - PAD, y + 22, `700 18px ${BODY}`, DIM, 200, "right");
        y += 40;
        D.table.forEach((r, i) => {
          const top = y + i * 62, cy = top + 31;
          if (i % 2 === 0) box(PAD - 14, top, W - PAD * 2 + 28, 62, "rgba(255,255,255,.04)", 14);
          txt(String(r.rank), PAD + 16, cy + 11, `700 32px ${DISPLAY}`, GOLD, 40, "center");
          const mv = r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : "–";
          txt(mv, PAD + 74, cy + 8, `700 21px ${BODY}`, r.move > 0 ? "#3ccf7a" : r.move < 0 ? "#ff6b6b" : DIM, 60, "center");
          mark(r.id, PAD + 116, cy, 38);
          txt(nm(r.id), PAD + 168, cy + 10, `600 28px ${BODY}`, "#ffffff", W - PAD * 2 - 168 - 170);
          txt(r.record, W - PAD, cy + 10, `700 28px ${BODY}`, "#ffffff", 160, "right");
        });
        y += D.table.length * 62 + gap + 6;
      }

      // the awards, once the league has voted; the pick'em winner
      const strip = (label, id, main, sub, x, w, size = 26) => {
        box(x, y, w, 124, "rgba(255,255,255,.05)");
        txt(label, x + 22, y + 36, `700 19px ${BODY}`, GOLD, w - 44);
        if (id) mark(id, x + 22, y + 76, 36);
        txt(main, x + (id ? 70 : 22), y + 86, `700 ${size}px ${BODY}`, "#ffffff", w - (id ? 92 : 44));
        if (sub) txt(sub, x + 22, y + 112, `500 19px ${BODY}`, SOFT, w - 44);
      };
      if (D.awards && Object.keys(D.awards).length && y + 124 <= bottom) {
        const aw = C.AWARDS.filter((a) => D.awards[a.id]);
        const w3 = (W - PAD * 2 - gap * (aw.length - 1)) / aw.length;
        aw.forEach((a, k) => {
          const list = D.awards[a.id];
          strip(`${a.emoji} ${a.short.toUpperCase()}`, list[0], list.map(nm).join(" & "), a.title, PAD + k * (w3 + gap), w3, aw.length > 2 ? 22 : 26);
        });
        y += 124 + gap;
      }
      const extras = [];
      if (D.pick) extras.push(["PICK'EM WINNER", D.pick.ids[0], D.pick.ids.map(nm).join(" & "), `${plural(D.pick.pts, "point")} · the league's best picker`]);
      if (D.blunder) extras.push(["BENCH BLUNDER", D.blunder.id, `Benched ${D.blunder.player}`, `${fmt(D.blunder.pts)} pts on the bench${D.blunder.cost ? " · cost the game" : ""} · ${nm(D.blunder.id)}`]);
      if (extras.length && y + 124 <= bottom) {
        const w2 = extras.length > 1 ? tw : W - PAD * 2;
        extras.slice(0, 2).forEach(([label, id, main, sub], k) => strip(label, id, main, sub, PAD + k * (w2 + gap), w2));
        y += 124 + gap;
      }

      g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(PAD, H - PAD - 34, W - PAD * 2, 2);
      txt("PIGSKIN PANTHEON", PAD, H - PAD + 6, `700 24px ${BODY}`, "rgba(219,229,238,.75)");
      txt(location.host || "pigskinpantheon.com", W - PAD, H - PAD + 6, `500 24px ${BODY}`, DIM, 500, "right");
      return c;
    }

    function toBlob(c) {
      return new Promise((resolve, reject) => {
        try { c.toBlob((b) => (b ? resolve(b) : reject(new Error("no_image"))), "image/png"); } catch (err) { reject(err); }
      });
    }

    async function shareCard(w) {
      try { await Promise.all(['700 176px "Barlow Condensed"', '700 54px "Barlow Condensed"', '500 26px Inter', '600 28px Inter', '700 28px Inter'].map((f) => document.fonts.load(f))); } catch (err) { /* system fonts */ }
      if (S.status === "idle" || S.status === "loading") await ensure().catch(() => {});
      const D = await shareData(w);
      let canvas = await drawCard(D, true);
      let blob;
      try { blob = await toBlob(canvas); }
      catch (err) {
        // a picture the canvas wasn't allowed to keep: draw it again without the logos
        canvas = await drawCard(D, false);
        blob = await toBlob(canvas);
      }
      return { blob, canvas };
    }
    // For checking the picture by hand (and the page's own tests).
    const api = { shareCard, reload, openBoard, openClaim };

    async function openShare(w, button) {
      if (button) { button.disabled = true; button.classList.add("is-busy"); }
      try {
        const { blob } = await shareCard(w);
        const name = `${String(model.name || "league").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "league"}-week-${w}.png`;
        const file = new File([blob], name, { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
        const canCopy = Boolean(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
        const sheet = openSheet({
          kicker: esc(model.name),
          title: `Share Week ${w}`,
          cls: "ch-share-sheet",
          body: `<img class="ch-share-img" src="${url}" alt="Week ${w} of ${esc(model.name)}: the week's high and low scores, blowout, closest game and standings." />
            <div class="ch-share-actions">
              ${canShare ? '<button type="button" class="ch-btn primary" data-share="share">Share</button>' : ""}
              <a class="ch-btn${canShare ? "" : " primary"}" href="${url}" download="${esc(name)}">Save image</a>
              ${canCopy ? '<button type="button" class="ch-btn" data-share="copy">Copy image</button>' : ""}
            </div>`,
          onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
        });
        sheet.body.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-share]");
          if (!b) return;
          if (b.dataset.share === "share") {
            try { await navigator.share({ files: [file], title: `${model.name} · Week ${w}` }); } catch (err) { /* dismissed */ }
          } else {
            try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); b.textContent = "Copied"; }
            catch (err) { b.textContent = "Couldn't copy"; }
            setTimeout(() => { b.textContent = "Copy image"; }, 1800);
          }
        });
      } catch (err) {
        console.error(err);
        say("The picture couldn't be made. Try again in a moment.");
      } finally {
        if (button) { button.disabled = false; button.classList.remove("is-busy"); }
      }
    }

    /* ---- the taps ----------------------------------------------------- */
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t.closest) return;
      const share = t.closest("[data-ch-share]");
      if (share) { openShare(Number(share.dataset.chShare), share); return; }
      const inSlot = t.closest(".ch-slot");
      if (!inSlot) return;
      const w = Number(inSlot.dataset.week);
      const p = t.closest("[data-ch-pick]");
      if (p) { setPick(w, p.dataset.chPick, p.dataset.id); return; }
      const l = t.closest("[data-ch-lock]");
      if (l) { setLock(w, l.dataset.chLock); return; }
      const v = t.closest("[data-ch-vote]");
      if (v) { vote(w, v.dataset.chVote, v.dataset.id); return; }
      const act = t.closest("[data-ch-act]");
      if (!act) return;
      if (act.dataset.chAct === "signin") signIn();
      else if (act.dataset.chAct === "retry") reload();
      else if (act.dataset.chAct === "board") openBoard();
      else if (act.dataset.chAct === "claim") openClaim();
    });
    document.addEventListener("change", (e) => {
      const sel = e.target.closest && e.target.closest("[data-ch-other]");
      if (!sel || !sel.value) return;
      const slot = sel.closest(".ch-slot");
      vote(Number(slot.dataset.week), sel.dataset.chOther, sel.value);
    });

    return api;
  }

  window.ClubhouseUI = { mount };
})();
