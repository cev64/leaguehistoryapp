/* Accounts: signing in and out, the profile menu and account panel, the
   league gate, and the ad slots.

   Settings live in account-config.js. With Supabase keys there, accounts
   are Supabase accounts and the league limits are enforced by the database
   (supabase/migrations). Without them the same screens run in PREVIEW mode
   against a stand-in kept in this browser, so the whole flow can be tried
   before anything is set up.

   The plans:
     Free   one league, with ads; the league can be swapped once a month
     Pro    $10 a month: unlimited leagues, no ads

   What pages see (window.Account):
     Account.ready            resolves once the session is known
     Account.admit(model)     resolves when the visitor may see this league;
                              until then a gate over the page says why not
                              (sleeper.js calls it at the end of League.load)
     Account.on(fn)           hears every change of user, plan or leagues
     Account.openSignIn(), openPanel(), upgrade(), signOut()

   Plain script, loaded in <head> after account-config.js, so the ad slots
   know whether to show before the page first paints. */
(function () {
  "use strict";

  const CFG = window.ACCOUNT_CONFIG || {};
  const CONFIGURED = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const MODE = CONFIGURED ? "supabase" : "preview";
  const REQUIRE = CFG.REQUIRE_ACCOUNT !== false;
  const DAY = 24 * 60 * 60 * 1000;
  const SWAP_DAYS = Number(CFG.SWAP_DAYS) || 30;
  const PLANS = CFG.PLANS || {
    free: { name: "Free", price: "$0", leagues: 1, ads: true },
    pro: { name: "Pro", price: "$10/month", leagues: Infinity, ads: false },
  };
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode */ } },
    del(key) { try { localStorage.removeItem(key); } catch (err) { /* private mode */ } },
  };

  /* ------------------------------------------------------------ first paint */

  /* The last plan this browser saw, so a Pro member's pages never flash ad
     slots while the session is being checked. Only a hint: the real plan
     replaces it a moment later. */
  const CACHE_KEY = "lh-account";
  const hint = store.get(CACHE_KEY);
  document.documentElement.classList.toggle("lh-no-ads", Boolean(hint && hint.plan === "pro"));

  /* ------------------------------------------------------------ errors */

  /* Both backends fail with the same short codes; this turns them into
     sentences. `swap_locked:<iso date>` carries when the lock lifts. */
  function explain(err) {
    const raw = String((err && (err.message || err.error_description || err.msg)) || err || "");
    const code = raw.split(":")[0].trim();
    if (code === "free_limit") return `Your free plan includes ${PLANS.free.leagues} league. Swap it, or go Pro for unlimited leagues.`;
    if (code === "swap_locked") {
      const when = raw.slice(raw.indexOf(":") + 1);
      return `Your league is locked in until ${fmtDate(when)}. Free accounts can swap once every ${SWAP_DAYS} days.`;
    }
    if (code === "not_signed_in") return "Sign in first.";
    if (code === "bad_league") return "That isn't a Sleeper league.";
    if (/invalid login credentials/i.test(raw)) return "That email and password don't match an account.";
    if (/already registered|already been registered|user_already_exists/i.test(raw)) return "There's already an account with that email. Sign in instead.";
    if (/password should be at least|weak_password/i.test(raw)) return "Use a password of at least 8 characters.";
    if (/email not confirmed/i.test(raw)) return "Confirm your email first: the link is in your inbox.";
    if (/rate limit|too many/i.test(raw)) return "Too many tries. Wait a minute and try again.";
    if (/failed to fetch|network/i.test(raw)) return "Couldn't reach the server. Check your connection.";
    return raw || "Something went wrong.";
  }

  /* ------------------------------------------------------------ backends */

  /* Supabase: auth, the profile row, and the two league functions. */
  function supabaseBackend() {
    let client = null;
    const toUser = (u) => u && ({
      id: u.id,
      email: u.email,
      name: (u.user_metadata && (u.user_metadata.display_name || u.user_metadata.full_name)) || "",
    });
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const home = () => new URL("index.html", location.href).href;

    return {
      async init(onAuth) {
        await loadScript(SUPABASE_JS);
        client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        client.auth.onAuthStateChange((event, session) => {
          // Deferred: Supabase asks that nothing awaits inside this callback.
          setTimeout(() => onAuth(event, toUser(session && session.user)), 0);
        });
        const { data } = await client.auth.getSession();
        return toUser(data.session && data.session.user);
      },
      async profile(user) {
        return check(await client.from("profiles").select("*").eq("id", user.id).maybeSingle())
          || { id: user.id, email: user.email, display_name: user.name, plan: "free" };
      },
      async leagues() {
        return check(await client.from("synced_leagues").select("*").order("synced_at", { ascending: true })) || [];
      },
      async signIn(email, password) {
        check(await client.auth.signInWithPassword({ email, password }));
      },
      async signUp(email, password, name) {
        const data = check(await client.auth.signUp({
          email, password,
          options: { data: { display_name: name || null }, emailRedirectTo: home() },
        }));
        // With email confirmation on (Supabase's default) there is no session
        // until the link in the email is followed.
        return { confirm: !data.session };
      },
      async google() {
        check(await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } }));
      },
      async resetPassword(email) {
        check(await client.auth.resetPasswordForEmail(email, { redirectTo: home() }));
      },
      async updatePassword(password) {
        check(await client.auth.updateUser({ password }));
      },
      async signOut() {
        check(await client.auth.signOut());
      },
      async saveProfile(user, fields) {
        check(await client.from("profiles").update(fields).eq("id", user.id));
      },
      async sync(league) {
        return check(await client.rpc("sync_league", {
          p_league_id: league.id, p_league_ids: league.ids, p_name: league.name, p_avatar: league.avatar,
        }));
      },
      async unsync(leagueId) {
        check(await client.rpc("unsync_league", { p_league_id: leagueId }));
      },
    };
  }

  /* Preview: the same behaviour, kept in this browser. It follows the rules
     the database functions enforce, so what you see here is what members
     will see. The password is only hashed, never sent anywhere. */
  function previewBackend() {
    const KEY = "lh-preview-accounts";
    const load = () => store.get(KEY) || { users: {}, session: null };
    const save = (db) => store.set(KEY, db);
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `u${Date.now()}${Math.random().toString(16).slice(2)}`);
    async function hash(text) {
      try {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lh:${text}`));
        return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (err) {
        let h = 0;
        for (const ch of `lh:${text}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
        return `x${h}`;
      }
    }
    const current = (db) => db.session && db.users[db.session];
    const toUser = (u) => u && { id: u.id, email: u.email, name: u.name || "" };
    let notify = () => {};

    return {
      async init(onAuth) {
        notify = onAuth;
        // Another tab signing in or out.
        addEventListener("storage", (e) => { if (e.key === KEY) onAuth("SYNC", toUser(current(load()))); });
        return toUser(current(load()));
      },
      async profile(user) {
        const u = load().users[user.id] || {};
        return {
          id: user.id, email: u.email, display_name: u.name || "", sleeper_username: u.sleeper || "",
          plan: u.plan || "free", current_period_end: u.plan === "pro" ? Date.now() + 30 * DAY : null,
        };
      },
      async leagues() {
        const u = current(load());
        return u ? (u.leagues || []).slice().sort((a, b) => a.synced_at - b.synced_at) : [];
      },
      async signIn(email, password) {
        const db = load();
        const u = Object.values(db.users).find((x) => x.email === email.toLowerCase());
        if (!u || u.pw !== await hash(password)) throw new Error("Invalid login credentials");
        db.session = u.id;
        save(db);
        notify("SIGNED_IN", toUser(u));
      },
      async signUp(email, password, name) {
        const db = load();
        if (Object.values(db.users).some((x) => x.email === email.toLowerCase())) throw new Error("User already registered");
        if (password.length < 8) throw new Error("Password should be at least 8 characters");
        const u = { id: uid(), email: email.toLowerCase(), pw: await hash(password), name, plan: "free", leagues: [], created: Date.now() };
        db.users[u.id] = u;
        db.session = u.id;
        save(db);
        notify("SIGNED_IN", toUser(u));
        return { confirm: false };
      },
      async google() { throw new Error("Google sign-in works once Supabase is connected."); },
      async resetPassword() { /* nothing to send in preview */ },
      async updatePassword(password) {
        const db = load();
        const u = current(db);
        if (!u) throw new Error("not_signed_in");
        u.pw = await hash(password);
        save(db);
      },
      async signOut() {
        const db = load();
        db.session = null;
        save(db);
        notify("SIGNED_OUT", null);
      },
      async saveProfile(user, fields) {
        const db = load();
        const u = db.users[user.id];
        if (!u) throw new Error("not_signed_in");
        if ("display_name" in fields) u.name = fields.display_name || "";
        if ("sleeper_username" in fields) u.sleeper = fields.sleeper_username || "";
        save(db);
      },
      async sync(league) {
        const db = load();
        const u = current(db);
        if (!u) throw new Error("not_signed_in");
        u.leagues = u.leagues || [];
        const ids = [...new Set([league.id, ...(league.ids || [])])];
        const had = u.leagues.find((l) => l.league_ids.some((x) => ids.includes(x)));
        if (had) {
          had.league_ids = [...new Set([...had.league_ids, ...ids])];
          had.name = league.name || had.name;
          had.avatar = league.avatar || had.avatar;
          save(db);
          return had;
        }
        if (u.plan !== "pro" && u.leagues.length >= PLANS.free.leagues) throw new Error("free_limit");
        const row = { league_id: league.id, league_ids: ids, name: league.name, avatar: league.avatar, synced_at: Date.now() };
        u.leagues.push(row);
        save(db);
        return row;
      },
      async unsync(leagueId) {
        const db = load();
        const u = current(db);
        if (!u) throw new Error("not_signed_in");
        const row = (u.leagues || []).find((l) => l.league_id === leagueId || l.league_ids.includes(leagueId));
        if (!row) return;
        const unlocks = new Date(row.synced_at).getTime() + SWAP_DAYS * DAY;
        if (u.plan !== "pro" && unlocks > Date.now()) throw new Error(`swap_locked:${new Date(unlocks).toISOString()}`);
        u.leagues = u.leagues.filter((l) => l !== row);
        save(db);
      },
      // Preview only: stand-ins for what Stripe and the calendar do.
      setPlan(plan) {
        const db = load();
        const u = current(db);
        if (u) { u.plan = plan; save(db); }
      },
      unlockSwaps() {
        const db = load();
        const u = current(db);
        if (u) { (u.leagues || []).forEach((l) => { l.synced_at = Date.now() - SWAP_DAYS * DAY - 1000; }); save(db); }
      },
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------ state */

  const backend = CONFIGURED ? supabaseBackend() : previewBackend();
  const state = { mode: MODE, ready: false, user: null, profile: null, leagues: [], recovering: false };
  const listeners = new Set();

  const plan = () => (state.profile && state.profile.plan === "pro" ? "pro" : "free");
  const isPro = () => plan() === "pro";
  const syncedAt = (row) => new Date(row.synced_at).getTime();
  const unlocksAt = (row) => syncedAt(row) + SWAP_DAYS * DAY;
  const canSwap = (row) => isPro() || unlocksAt(row) <= Date.now();
  // The leagues the plan opens: all of them on Pro; on Free, the first one
  // synced (anything past the limit stays listed, locked, after a downgrade).
  const openLeagues = () => (isPro() ? state.leagues : state.leagues.slice(0, PLANS.free.leagues));
  const displayName = () => (state.profile && state.profile.display_name) || (state.user && (state.user.name || state.user.email.split("@")[0])) || "";

  async function refresh() {
    if (state.user) {
      try {
        const [profile, leagues] = await Promise.all([backend.profile(state.user), backend.leagues()]);
        state.profile = profile;
        state.leagues = leagues || [];
      } catch (err) {
        console.warn("Account:", err);
        state.profile = state.profile || { plan: "free" };
      }
    } else {
      state.profile = null;
      state.leagues = [];
    }
    emit();
  }

  function emit() {
    if (state.user) store.set(CACHE_KEY, { plan: plan(), email: state.user.email });
    else store.del(CACHE_KEY);
    document.documentElement.classList.toggle("lh-no-ads", Boolean(state.user) && isPro());
    document.documentElement.classList.toggle("lh-signed-in", Boolean(state.user));
    drawButtons();
    drawPanel();
    drawSyncedCard();
    fillAds();
    listeners.forEach((fn) => { try { fn(api); } catch (err) { console.error(err); } });
  }

  const ready = (async () => {
    try {
      state.user = await backend.init((event, user) => {
        if (event === "PASSWORD_RECOVERY") { state.recovering = true; openAuth("reset"); }
        const changed = (user && user.id) !== (state.user && state.user.id);
        state.user = user;
        if (changed || event === "USER_UPDATED" || event === "SYNC") refresh();
      });
    } catch (err) {
      console.warn("Account: sign-in is unavailable.", err);
      state.user = null;
    }
    await refresh();
    state.ready = true;
    return api;
  })();

  /* ------------------------------------------------------------ actions */

  /* The league the page on screen was admitted for, if any. Losing access
     to it (signing out, unsyncing it) reloads the page, which puts the gate
     back up. */
  let admitted = null;
  const relock = () => { if (admitted && REQUIRE) location.reload(); };

  async function signOut() {
    closeMenu();
    try { await backend.signOut(); } catch (err) { toast(explain(err)); }
    state.user = null;
    await refresh();
    toast("Signed out.");
    relock();
  }

  async function sync(league) {
    await backend.sync(league);
    await refresh();
  }

  async function unsync(leagueId) {
    const row = state.leagues.find((l) => l.league_id === leagueId);
    await backend.unsync(leagueId);
    await refresh();
    if (row && admitted && (row.league_ids || [row.league_id]).some((id) => admitted.ids.includes(id))) relock();
  }

  /* Checkout. Stripe's Payment Link, told who is paying so the webhook can
     find the account; in preview, the account panel's plan switch. */
  function upgrade() {
    closeMenu();
    if (!state.user) { openAuth("signup", { reason: "Create a free account first, then upgrade to Pro." }); return; }
    if (isPro()) { manage(); return; }
    if (MODE === "preview") {
      openPanel("plan");
      toast("Preview mode: use “Switch to Pro” to try the paid plan.");
      return;
    }
    if (!CFG.STRIPE_PAYMENT_LINK) { toast("Payments aren't set up yet."); return; }
    const url = new URL(CFG.STRIPE_PAYMENT_LINK);
    url.searchParams.set("client_reference_id", state.user.id);
    if (state.user.email) url.searchParams.set("prefilled_email", state.user.email);
    location.href = url.href;
  }

  function manage() {
    if (MODE === "preview") { openPanel("plan"); return; }
    if (!CFG.STRIPE_PORTAL_LINK) { toast("Subscription management isn't set up yet."); return; }
    const url = new URL(CFG.STRIPE_PORTAL_LINK);
    if (state.user && state.user.email) url.searchParams.set("prefilled_email", state.user.email);
    location.href = url.href;
  }

  const leagueHref = (row) => `season.html?league=${encodeURIComponent(row.league_id)}`;

  /* ------------------------------------------------------------ the gate */

  /* Whether this visitor may open the league a page has just loaded, and if
     not, what they can do about it. The league is known by every season's id,
     so next year's renewal of a synced league opens without a new sync. */
  function judge(league) {
    if (!state.user) return { kind: "signed-out" };
    const row = state.leagues.find((l) => (l.league_ids || [l.league_id]).some((id) => league.ids.includes(id)));
    if (row) {
      if (openLeagues().includes(row)) {
        const known = new Set(row.league_ids || []);
        return { kind: "ok", refresh: league.ids.some((id) => !known.has(id)) };
      }
      return { kind: "over-limit", row, current: openLeagues()[0] };
    }
    if (isPro()) return { kind: "pro-add" };
    const current = openLeagues()[0];
    if (!current) return { kind: "free-first" };
    return { kind: "free-full", current };
  }

  let gateEl = null;
  let gateWake = null;
  let gateError = "";
  const nextChange = () => new Promise((resolve) => { gateWake = resolve; });
  listeners.add(() => { if (gateWake) { const w = gateWake; gateWake = null; w(); } });

  async function admit(model) {
    await ready;
    if (!REQUIRE) return;
    const ids = [...new Set([model.leagueId, ...model.seasons.map((s) => s.leagueId)].filter(Boolean).map(String))];
    const league = { id: String(model.leagueId), ids, name: model.name, avatar: model.avatar };
    for (;;) {
      const verdict = judge(league);
      if (verdict.kind === "ok") {
        if (verdict.refresh) backend.sync(league).then(refresh).catch(() => {});
        admitted = league;
        closeGate();
        return;
      }
      if (verdict.kind === "pro-add") {
        try { await sync(league); continue; } catch (err) { verdict.error = explain(err); }
      }
      drawGate(league, verdict);
      await nextChange();
    }
  }

  function drawGate(league, verdict) {
    if (!gateEl) {
      gateEl = document.createElement("div");
      gateEl.className = "acct-gate";
      gateEl.setAttribute("role", "dialog");
      gateEl.setAttribute("aria-modal", "true");
      gateEl.setAttribute("aria-labelledby", "acctGateTitle");
      document.body.appendChild(gateEl);
      document.documentElement.classList.add("lh-gated");
    }
    const avatar = league.avatar
      ? `<img src="${esc(league.avatar)}" alt="" width="56" height="56" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🏈'}))">`
      : "<span>🏈</span>";
    const name = esc(league.name || "This league");
    const proLine = `<b>Pro</b> · ${esc(PLANS.pro.price)}: unlimited leagues, no ads.`;
    let title = "", copy = "", actions = "", foot = "";

    if (verdict.kind === "signed-out") {
      title = `Sign in to open ${name}`;
      copy = `League History is free with an account: one league of your choice, every season it has played. ${proLine}`;
      actions = `<button class="acct-btn acct-btn-primary" data-act="signup">Create free account</button>
        <button class="acct-btn" data-act="signin">Sign in</button>`;
    } else if (verdict.kind === "free-first") {
      title = `Add ${name} to your account`;
      copy = `Your free plan includes one league. Once it's added you can swap it for another once every ${SWAP_DAYS} days.`;
      actions = `<button class="acct-btn acct-btn-primary" data-act="sync">Add this league</button>
        <button class="acct-btn" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>`;
    } else if (verdict.kind === "free-full" || verdict.kind === "over-limit") {
      const cur = verdict.current;
      const curName = esc((cur && cur.name) || "your league");
      title = `Your free league is ${curName}`;
      if (cur && canSwap(cur)) {
        copy = `Free accounts hold one league. You can swap ${curName} for ${name} now; after that, the next swap opens ${fmtDate(Date.now() + SWAP_DAYS * DAY)}.`;
        actions = `<button class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>
          <button class="acct-btn" data-act="swap">Swap to this league</button>`;
      } else {
        copy = `Free accounts hold one league and can swap it once every ${SWAP_DAYS} days. Your next swap opens ${cur ? fmtDate(unlocksAt(cur)) : "soon"}. ${proLine}`;
        actions = `<button class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>`;
      }
      if (cur) foot = `<a class="acct-link" href="${esc(leagueHref(cur))}">Open ${curName} instead</a>`;
    } else if (verdict.kind === "pro-add") {
      title = `Couldn't add ${name}`;
      copy = esc(verdict.error || "Try again in a moment.");
      actions = `<button class="acct-btn acct-btn-primary" data-act="retry">Try again</button>`;
    }

    gateEl.innerHTML = `<div class="acct-gate-card">
      <div class="acct-gate-league">${avatar}</div>
      <h2 id="acctGateTitle">${title}</h2>
      <p>${copy}</p>
      <p class="acct-gate-error" role="alert"${gateError ? "" : " hidden"}>${esc(gateError)}</p>
      <div class="acct-gate-actions">${actions}</div>
      <div class="acct-gate-foot">${foot}<a class="acct-link" href="index.html">Choose another league</a></div>
      ${MODE === "preview" ? '<p class="acct-preview-note">Preview mode · accounts are stored in this browser until Supabase is connected</p>' : ""}
    </div>`;

    gateError = "";
    const busy = (btn, on) => { gateEl.querySelectorAll("button").forEach((b) => { b.disabled = on; }); if (btn) btn.classList.toggle("is-busy", on); };
    gateEl.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "signin") return openAuth("signin");
      if (act === "signup") return openAuth("signup");
      if (act === "upgrade") return upgrade();
      if (act === "retry") return emit();
      busy(btn, true);
      try {
        if (act === "swap") {
          const cur = verdict.current;
          const sure = await confirmBox({
            title: "Swap your league?",
            body: `${esc(cur.name || "Your league")} comes off your account and ${name} goes on. You won't be able to swap again until ${fmtDate(Date.now() + SWAP_DAYS * DAY)}.`,
            yes: "Swap league",
          });
          if (!sure) { busy(btn, false); return; }
          await backend.unsync(cur.league_id);
        }
        await sync(league);
        toast(`${league.name || "League"} is on your account.`);
      } catch (err) {
        // Redrawn by the refresh, with the reason shown.
        gateError = explain(err);
        busy(btn, false);
        await refresh();
      }
    }));
    const first = gateEl.querySelector(".acct-btn-primary");
    if (first && !document.querySelector(".acct-modal.open")) first.focus({ preventScroll: true });
  }

  function closeGate() {
    if (!gateEl) return;
    gateEl.remove();
    gateEl = null;
    document.documentElement.classList.remove("lh-gated");
  }

  /* ------------------------------------------------------------ header button */

  const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20c1-3.6 3.9-5.6 7.5-5.6s6.5 2 7.5 5.6"/></svg>';

  function initials() {
    const n = displayName().trim();
    const parts = n.split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  /* One button per page, in the header: "Sign in" when signed out, the
     member's initials (ringed in gold on Pro) when signed in. */
  function drawButtons() {
    document.querySelectorAll("[data-account-slot], .topbar-inner").forEach((host) => {
      if (host.matches(".topbar-inner") && document.querySelector("[data-account-slot]")) return;
      let btn = host.querySelector(":scope > .acct-button");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "acct-button";
        btn.setAttribute("aria-haspopup", "menu");
        btn.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(btn); });
        host.appendChild(btn);
      }
      if (!state.ready) {
        btn.innerHTML = `<span class="acct-avatar acct-avatar-empty">${ICON_USER}</span>`;
        btn.setAttribute("aria-label", "Account");
      } else if (state.user) {
        btn.classList.toggle("is-pro", isPro());
        btn.innerHTML = `<span class="acct-avatar">${esc(initials())}</span>`;
        btn.setAttribute("aria-label", `Account: ${displayName()}`);
      } else {
        btn.classList.remove("is-pro");
        btn.innerHTML = `<span class="acct-avatar acct-avatar-empty">${ICON_USER}</span><span class="acct-button-label">Sign in</span>`;
        btn.setAttribute("aria-label", "Sign in");
      }
    });
    if (menuEl && menuEl.classList.contains("open")) drawMenu();
  }

  /* ------------------------------------------------------------ profile menu */

  let menuEl = null;
  let menuAnchor = null;

  function toggleMenu(anchor) {
    if (menuEl && menuEl.classList.contains("open") && menuAnchor === anchor) { closeMenu(); return; }
    if (state.ready && !state.user) { openAuth("signin"); return; }
    menuAnchor = anchor;
    if (!menuEl) {
      menuEl = document.createElement("div");
      menuEl.className = "acct-menu";
      menuEl.setAttribute("role", "menu");
      document.body.appendChild(menuEl);
      document.addEventListener("click", (e) => { if (menuEl.classList.contains("open") && !menuEl.contains(e.target)) closeMenu(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
      addEventListener("resize", () => closeMenu());
    }
    drawMenu();
    placeMenu();
    menuEl.classList.add("open");
    anchor.setAttribute("aria-expanded", "true");
    const first = menuEl.querySelector("[role=menuitem]");
    if (first) first.focus({ preventScroll: true });
  }

  function placeMenu() {
    const r = menuAnchor.getBoundingClientRect();
    const width = Math.min(288, innerWidth - 16);
    menuEl.style.width = `${width}px`;
    const left = Math.max(8, Math.min(innerWidth - width - 8, r.right - width));
    // In the desktop sidebar the button sits at the left; open to its right.
    const inSidebar = innerWidth >= 1200 && r.left < 360;
    menuEl.style.left = `${inSidebar ? Math.max(8, Math.min(innerWidth - width - 8, r.left)) : left}px`;
    menuEl.style.top = `${Math.round(r.bottom + 8)}px`;
  }

  function closeMenu() {
    if (!menuEl || !menuEl.classList.contains("open")) return;
    menuEl.classList.remove("open");
    if (menuAnchor) menuAnchor.setAttribute("aria-expanded", "false");
  }

  function drawMenu() {
    if (!menuEl || !state.user) return;
    const pro = isPro();
    const leagues = state.leagues;
    const limit = pro ? "Unlimited leagues" : `${Math.min(leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues} league`;
    menuEl.innerHTML = `
      <div class="acct-menu-head">
        <span class="acct-avatar${pro ? " is-pro" : ""}">${esc(initials())}</span>
        <div class="acct-menu-who">
          <strong>${esc(displayName())}</strong>
          <span>${esc(state.user.email || "")}</span>
        </div>
        <span class="acct-plan-badge${pro ? " is-pro" : ""}">${esc(PLANS[plan()].name)}</span>
      </div>
      <div class="acct-menu-leagues">
        <div class="acct-menu-label">${esc(limit)}</div>
        ${leagues.length ? leagues.map((l, i) => `<a role="menuitem" class="acct-menu-item acct-menu-league${!pro && i >= PLANS.free.leagues ? " is-locked" : ""}" href="${esc(leagueHref(l))}">
            ${l.avatar ? `<img src="${esc(l.avatar)}" alt="" width="22" height="22">` : '<span class="acct-dot">🏈</span>'}
            <span>${esc(l.name || l.league_id)}</span></a>`).join("")
          : '<a role="menuitem" class="acct-menu-item" href="index.html">Find your league →</a>'}
      </div>
      <div class="acct-menu-sep"></div>
      <button role="menuitem" class="acct-menu-item" data-act="panel">Account &amp; leagues</button>
      ${pro
        ? '<button role="menuitem" class="acct-menu-item" data-act="manage">Manage subscription</button>'
        : `<button role="menuitem" class="acct-menu-item acct-menu-upgrade" data-act="upgrade"><span>Go Pro</span><span>${esc(PLANS.pro.price)} · no ads</span></button>`}
      <div class="acct-menu-sep"></div>
      <button role="menuitem" class="acct-menu-item" data-act="signout">Sign out</button>`;
    menuEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      closeMenu();
      if (act === "panel") openPanel();
      else if (act === "manage") manage();
      else if (act === "upgrade") upgrade();
      else if (act === "signout") signOut();
    }));
    menuEl.onkeydown = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...menuEl.querySelectorAll("[role=menuitem]")];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    };
  }

  /* ------------------------------------------------------------ sign-in dialog */

  let modalEl = null;
  let modalReturn = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "acct-modal";
    modalEl.innerHTML = `<div class="acct-modal-backdrop" data-close></div>
      <div class="acct-modal-card" role="dialog" aria-modal="true" aria-labelledby="acctModalTitle"></div>`;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeAuth(); });
    modalEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAuth();
      if (e.key !== "Tab") return;
      // Keep the keyboard inside the dialog.
      const f = [...modalEl.querySelectorAll("button, input, a[href]")].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    return modalEl;
  }

  function openAuth(view = "signin", { reason = "", email = "" } = {}) {
    closeMenu();
    ensureModal();
    if (!modalEl.classList.contains("open")) modalReturn = document.activeElement;
    drawAuth(view, { reason, email });
    modalEl.classList.add("open");
    document.documentElement.classList.add("lh-modal-open");
  }

  function closeAuth() {
    if (!modalEl || !modalEl.classList.contains("open")) return;
    modalEl.classList.remove("open");
    document.documentElement.classList.remove("lh-modal-open");
    if (modalReturn && modalReturn.focus) modalReturn.focus({ preventScroll: true });
  }

  function drawAuth(view, { reason = "", email = "" } = {}) {
    const card = modalEl.querySelector(".acct-modal-card");
    const google = CFG.GOOGLE_SIGN_IN
      ? `<button type="button" class="acct-btn acct-btn-google" data-act="google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z"/></svg>Continue with Google</button>
        <div class="acct-or"><span>or</span></div>` : "";
    const tabs = (view === "signin" || view === "signup") ? `<div class="acct-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${view === "signin"}" data-view="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="${view === "signup"}" data-view="signup">Create account</button>
      </div>` : "";
    const preview = MODE === "preview"
      ? '<p class="acct-preview-note">Preview mode: accounts are kept in this browser until Supabase is connected.</p>' : "";
    const close = '<button type="button" class="acct-close" data-close aria-label="Close">&times;</button>';
    const field = (name, label, type, extra = "") =>
      `<label class="acct-field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;

    let body = "";
    if (view === "signin") {
      body = `<h2 id="acctModalTitle">Welcome back</h2>
        ${reason ? `<p class="acct-reason">${esc(reason)}</p>` : ""}
        ${google}
        <form class="acct-form" novalidate>
          ${field("email", "Email", "email", `autocomplete="email" required value="${esc(email)}"`)}
          ${field("password", "Password", "password", 'autocomplete="current-password" required minlength="8"')}
          <p class="acct-error" role="alert" hidden></p>
          <button type="submit" class="acct-btn acct-btn-primary acct-btn-wide">Sign in</button>
          <button type="button" class="acct-link" data-view="forgot">Forgot your password?</button>
        </form>`;
    } else if (view === "signup") {
      body = `<h2 id="acctModalTitle">Create your account</h2>
        <p class="acct-reason">${esc(reason || `Free: one league with ads. Pro (${PLANS.pro.price}): unlimited leagues, no ads.`)}</p>
        ${google}
        <form class="acct-form" novalidate>
          ${field("name", "Name", "text", 'autocomplete="nickname" maxlength="60" placeholder="What the league calls you"')}
          ${field("email", "Email", "email", `autocomplete="email" required value="${esc(email)}"`)}
          ${field("password", "Password", "password", 'autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"')}
          <p class="acct-error" role="alert" hidden></p>
          <button type="submit" class="acct-btn acct-btn-primary acct-btn-wide">Create free account</button>
        </form>`;
    } else if (view === "forgot") {
      body = `<h2 id="acctModalTitle">Reset your password</h2>
        <p class="acct-reason">We'll email you a link to choose a new one.</p>
        <form class="acct-form" novalidate>
          ${field("email", "Email", "email", `autocomplete="email" required value="${esc(email)}"`)}
          <p class="acct-error" role="alert" hidden></p>
          <button type="submit" class="acct-btn acct-btn-primary acct-btn-wide">Send reset link</button>
          <button type="button" class="acct-link" data-view="signin">Back to sign in</button>
        </form>`;
    } else if (view === "reset") {
      body = `<h2 id="acctModalTitle">Choose a new password</h2>
        <form class="acct-form" novalidate>
          ${field("password", "New password", "password", 'autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"')}
          <p class="acct-error" role="alert" hidden></p>
          <button type="submit" class="acct-btn acct-btn-primary acct-btn-wide">Save password</button>
        </form>`;
    } else if (view === "sent") {
      body = `<h2 id="acctModalTitle">Check your email</h2>
        <p class="acct-reason">${esc(reason)}</p>
        <button type="button" class="acct-btn acct-btn-primary acct-btn-wide" data-close>Done</button>`;
    }
    card.innerHTML = `${close}${tabs}${body}${preview}`;

    card.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      const typed = card.querySelector('input[name="email"]');
      drawAuth(b.dataset.view, { email: typed ? typed.value : email });
    }));
    const g = card.querySelector('[data-act="google"]');
    if (g) g.addEventListener("click", async () => {
      try { await backend.google(); } catch (err) { showError(card, explain(err)); }
    });

    const form = card.querySelector("form");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const mail = String(data.email || "").trim();
      const pw = String(data.password || "");
      if ("email" in data && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return showError(card, "Enter a valid email address.");
      if ("password" in data && pw.length < 8) return showError(card, "Use a password of at least 8 characters.");
      const submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      submit.classList.add("is-busy");
      try {
        if (view === "signin") {
          await backend.signIn(mail, pw);
          closeAuth();
          toast("Signed in.");
        } else if (view === "signup") {
          const { confirm } = await backend.signUp(mail, pw, String(data.name || "").trim());
          if (confirm) drawAuth("sent", { reason: `We sent a confirmation link to ${mail}. Follow it to finish creating your account.` });
          else { closeAuth(); toast("Welcome! Your account is ready."); }
        } else if (view === "forgot") {
          await backend.resetPassword(mail);
          drawAuth("sent", { reason: MODE === "preview"
            ? "Preview mode doesn't send email. Once Supabase is connected, a reset link goes to this address."
            : `If there's an account for ${mail}, a reset link is on its way.` });
        } else if (view === "reset") {
          await backend.updatePassword(pw);
          state.recovering = false;
          closeAuth();
          toast("Password updated.");
        }
      } catch (err) {
        showError(card, explain(err));
      } finally {
        submit.disabled = false;
        submit.classList.remove("is-busy");
      }
    });

    const focus = card.querySelector("input:not([value]), input[value=''], input") || card.querySelector("button");
    setTimeout(() => focus && focus.focus({ preventScroll: true }), 30);
  }

  function showError(card, message) {
    const el = card.querySelector(".acct-error");
    if (!el) { toast(message); return; }
    el.textContent = message;
    el.hidden = false;
  }

  /* ------------------------------------------------------------ account panel */

  let panelEl = null;
  let panelSection = null;

  function openPanel(section = null) {
    closeMenu();
    if (!state.user) { openAuth("signin"); return; }
    if (!panelEl) {
      panelEl = document.createElement("aside");
      panelEl.className = "acct-panel";
      panelEl.setAttribute("role", "dialog");
      panelEl.setAttribute("aria-modal", "true");
      panelEl.setAttribute("aria-label", "Your account");
      document.body.appendChild(panelEl);
      const backdrop = document.createElement("div");
      backdrop.className = "acct-panel-backdrop";
      backdrop.addEventListener("click", closePanel);
      document.body.appendChild(backdrop);
      panelEl.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });
    }
    panelSection = section;
    drawPanel();
    requestAnimationFrame(() => {
      document.documentElement.classList.add("lh-panel-open");
      const target = section && panelEl.querySelector(`[data-section="${section}"]`);
      if (target) target.scrollIntoView({ block: "start" });
      const close = panelEl.querySelector(".acct-close");
      if (close) close.focus({ preventScroll: true });
    });
  }

  function closePanel() {
    document.documentElement.classList.remove("lh-panel-open");
  }

  function drawPanel() {
    if (!panelEl) return;
    if (!state.user) { closePanel(); return; }
    const pro = isPro();
    const p = state.profile || {};
    const open = openLeagues();
    const renews = p.current_period_end ? fmtDate(p.current_period_end) : null;

    const leagueRows = state.leagues.map((l) => {
      const locked = !open.includes(l);
      const lockText = pro ? "" : canSwap(l) ? "Can be swapped now" : `Locked in until ${fmtDate(unlocksAt(l))}`;
      return `<li class="acct-league${locked ? " is-locked" : ""}">
        ${l.avatar ? `<img src="${esc(l.avatar)}" alt="" width="40" height="40">` : '<span class="acct-league-mark">🏈</span>'}
        <div class="acct-league-copy">
          <strong>${esc(l.name || `League ${l.league_id}`)}</strong>
          <span>${locked ? "Needs Pro: your free plan opens one league" : `Synced ${fmtDate(syncedAt(l))}${lockText ? ` · ${lockText}` : ""}`}</span>
        </div>
        <div class="acct-league-actions">
          ${locked ? "" : `<a class="acct-btn acct-btn-small" href="${esc(leagueHref(l))}">Open</a>`}
          <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-unsync="${esc(l.league_id)}"
            ${!pro && !canSwap(l) && !locked ? `disabled title="Locked in until ${fmtDate(unlocksAt(l))}"` : ""}>Unsync</button>
        </div>
      </li>`;
    }).join("");

    panelEl.innerHTML = `
      <div class="acct-panel-head">
        <span class="acct-avatar acct-avatar-lg${pro ? " is-pro" : ""}">${esc(initials())}</span>
        <div class="acct-menu-who">
          <strong>${esc(displayName())}</strong>
          <span>${esc(state.user.email || "")}</span>
        </div>
        <button type="button" class="acct-close" aria-label="Close">&times;</button>
      </div>
      <div class="acct-panel-body">
        ${MODE === "preview" ? '<p class="acct-preview-note">Preview mode: this account lives in this browser. Connect Supabase in account-config.js to go live.</p>' : ""}

        <section data-section="leagues">
          <h3>Your leagues <span>${pro ? "Unlimited" : `${Math.min(state.leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues}`}</span></h3>
          ${state.leagues.length ? `<ul class="acct-leagues">${leagueRows}</ul>` : '<p class="acct-muted">No leagues yet. Open one from the front page and add it to your account.</p>'}
          <p class="acct-muted">${pro
            ? "Pro opens every league you add, with no limits on adding or removing them."
            : `Free accounts hold one league and can swap it once every ${SWAP_DAYS} days. A league's renewal each season stays the same league.`}</p>
          <a class="acct-btn acct-btn-small" href="index.html">Find a league</a>
        </section>

        <section data-section="plan">
          <h3>Plan</h3>
          <div class="acct-plans">
            <div class="acct-plan${pro ? "" : " is-current"}">
              <div class="acct-plan-name">${esc(PLANS.free.name)}${pro ? "" : "<em>Current</em>"}</div>
              <div class="acct-plan-price">${esc(PLANS.free.price)}</div>
              <ul><li>1 league</li><li>Swap once a month</li><li>Ads</li></ul>
            </div>
            <div class="acct-plan acct-plan-pro${pro ? " is-current" : ""}">
              <div class="acct-plan-name">${esc(PLANS.pro.name)}${pro ? "<em>Current</em>" : ""}</div>
              <div class="acct-plan-price">${esc(PLANS.pro.price)}</div>
              <ul><li>Unlimited leagues</li><li>Add or remove any time</li><li>No ads</li></ul>
            </div>
          </div>
          ${pro
            ? `<p class="acct-muted">${renews ? `Renews ${renews}.` : ""} Cancel or change your card in the billing portal.</p>
               <button type="button" class="acct-btn acct-btn-small" data-act="manage">Manage subscription</button>`
            : `<button type="button" class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>`}
          ${MODE === "preview" ? `<div class="acct-preview-tools">
              <span>Preview tools</span>
              <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-act="preview-plan">Switch to ${pro ? "Free" : "Pro"}</button>
              <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-act="preview-unlock">Skip the ${SWAP_DAYS}-day lock</button>
            </div>` : ""}
        </section>

        <section data-section="profile">
          <h3>Profile</h3>
          <form class="acct-form acct-profile-form">
            <label class="acct-field"><span>Name</span><input name="display_name" maxlength="60" value="${esc(p.display_name || "")}" autocomplete="nickname"></label>
            <label class="acct-field"><span>Sleeper username</span><input name="sleeper_username" maxlength="40" value="${esc(p.sleeper_username || "")}" autocapitalize="none" spellcheck="false" placeholder="Fills in the league finder"></label>
            <p class="acct-error" role="alert" hidden></p>
            <button type="submit" class="acct-btn acct-btn-small">Save profile</button>
          </form>
        </section>

        <section>
          <button type="button" class="acct-btn acct-btn-wide acct-btn-quiet" data-act="signout">Sign out</button>
        </section>
      </div>`;

    panelEl.querySelector(".acct-close").addEventListener("click", closePanel);
    panelEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      if (act === "upgrade") upgrade();
      else if (act === "manage") manage();
      else if (act === "signout") { closePanel(); signOut(); }
      else if (act === "preview-plan") { backend.setPlan(pro ? "free" : "pro"); await refresh(); toast(`Preview: now on ${pro ? "Free" : "Pro"}.`); }
      else if (act === "preview-unlock") { backend.unlockSwaps(); await refresh(); toast("Preview: swap lock lifted."); }
    }));
    panelEl.querySelectorAll("[data-unsync]").forEach((b) => b.addEventListener("click", async () => {
      const row = state.leagues.find((l) => l.league_id === b.dataset.unsync);
      const sure = await confirmBox({
        title: "Unsync this league?",
        body: pro
          ? `${esc(row.name || "This league")} comes off your account. You can add it back any time.`
          : `${esc(row.name || "This league")} comes off your account, and your free slot opens for another league.`,
        yes: "Unsync",
      });
      if (!sure) return;
      try { await unsync(row.league_id); toast("League removed."); } catch (err) { toast(explain(err)); }
    }));
    const form = panelEl.querySelector(".acct-profile-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      try {
        await backend.saveProfile(state.user, {
          display_name: String(data.display_name || "").trim() || null,
          sleeper_username: String(data.sleeper_username || "").trim() || null,
        });
        await refresh();
        toast("Profile saved.");
      } catch (err) {
        const el = form.querySelector(".acct-error");
        el.textContent = explain(err);
        el.hidden = false;
      }
    });
  }

  /* ------------------------------------------------------------ front page */

  /* The front page lists the member's leagues above the finder, and fills
     the finder with their Sleeper username. */
  function drawSyncedCard() {
    const card = document.getElementById("syncedCard");
    if (!card) return;
    const list = card.querySelector(".league-list");
    if (!state.user) { card.hidden = true; return; }
    const input = document.getElementById("username");
    if (input && !input.value && state.profile && state.profile.sleeper_username) input.value = state.profile.sleeper_username;
    const open = openLeagues();
    const meta = card.querySelector("[data-synced-meta]");
    if (meta) meta.textContent = isPro() ? "Pro · unlimited" : `${Math.min(state.leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues} · Free`;
    card.hidden = false;
    if (!state.leagues.length) {
      list.innerHTML = `<div class="signin-empty">Find your league below and open it to add it to your account.</div>`;
      return;
    }
    list.innerHTML = state.leagues.map((l) => {
      const locked = !open.includes(l);
      const badge = l.avatar
        ? `<span class="team-badge" style="--team-color:#102b43"><img src="${esc(l.avatar)}" alt=""></span>`
        : `<span class="team-badge" style="--team-color:#304f91">${esc(String(l.name || "?").trim().charAt(0).toUpperCase())}</span>`;
      const note = locked ? "Needs Pro: your free plan opens one league"
        : isPro() ? `Synced ${fmtDate(syncedAt(l))}`
        : canSwap(l) ? "Your free league · can be swapped" : `Your free league · swap opens ${fmtDate(unlocksAt(l))}`;
      return `<a class="league-row${locked ? " is-locked" : ""}" href="${locked ? "#" : esc(leagueHref(l))}"${locked ? ' data-locked="1"' : ""}>
        ${badge}
        <span class="league-name"><strong>${esc(l.name || l.league_id)}</strong><span>${note}</span></span>
        <span class="league-go" aria-hidden="true">›</span>
      </a>`;
    }).join("");
    list.querySelectorAll("[data-locked]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); upgrade(); }));
  }

  /* ------------------------------------------------------------ ads */

  /* Every slot is a fixed-size box written into the page, so nothing moves
     when an ad arrives (or doesn't). Pro members get none: the slots are
     hidden before first paint. With no ad network set, each shows a
     labelled placeholder at its exact size. */
  let adsenseLoaded = false;
  function fillAds() {
    const on = !(state.user && isPro());
    if (!on) return;
    const ads = CFG.ADS || {};
    document.querySelectorAll(".ad-slot:not([data-filled])").forEach((slot) => {
      const wrap = slot.closest("[data-ad]");
      const name = wrap ? wrap.dataset.ad : "";
      const unit = ads.units && ads.units[name];
      slot.dataset.filled = "1";
      if (ads.provider === "adsense" && ads.adsenseClient && unit) {
        if (!adsenseLoaded) {
          adsenseLoaded = true;
          const s = document.createElement("script");
          s.async = true;
          s.crossOrigin = "anonymous";
          s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.adsenseClient)}`;
          document.head.appendChild(s);
        }
        slot.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%;height:100%" data-ad-client="${esc(ads.adsenseClient)}" data-ad-slot="${esc(unit)}"></ins>`;
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } else {
        slot.innerHTML = `<span class="ad-ph"><span class="ad-ph-mark">AD</span><span class="ad-ph-size"></span></span>`;
      }
    });
  }

  /* ------------------------------------------------------------ small parts */

  let toastEl = null;
  let toastTimer = 0;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "acct-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  function confirmBox({ title, body, yes }) {
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "acct-modal acct-confirm open";
      el.innerHTML = `<div class="acct-modal-backdrop" data-no></div>
        <div class="acct-modal-card" role="alertdialog" aria-modal="true" aria-labelledby="acctConfirmTitle">
          <h2 id="acctConfirmTitle">${esc(title)}</h2>
          <p class="acct-reason">${body}</p>
          <div class="acct-confirm-actions">
            <button type="button" class="acct-btn" data-no>Cancel</button>
            <button type="button" class="acct-btn acct-btn-primary" data-yes>${esc(yes)}</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      const done = (v) => { el.remove(); resolve(v); };
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-yes]")) done(true);
        else if (e.target.closest("[data-no]")) done(false);
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Escape") done(false); });
      el.querySelector("[data-yes]").focus();
    });
  }

  /* ------------------------------------------------------------ wiring */

  function start() {
    drawButtons();
    fillAds();
    drawSyncedCard();
    // Slots a page writes later (the team history drawer) are filled as
    // they appear.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (document.querySelector(".ad-slot:not([data-filled])")) fillAds(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  const api = {
    mode: MODE,
    ready,
    get user() { return state.user; },
    get profile() { return state.profile; },
    get leagues() { return state.leagues.slice(); },
    get plan() { return plan(); },
    get isPro() { return isPro(); },
    admit,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    openSignIn: (opts) => openAuth("signin", opts),
    openSignUp: (opts) => openAuth("signup", opts),
    openPanel,
    upgrade,
    signOut,
  };
  window.Account = api;
})();
