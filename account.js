/* Accounts: signing in and out, the profile menu and account panel, the
   league gate, and the ad slots.

   Settings live in account-config.js. With Supabase keys there, accounts
   are Supabase accounts and the league limits are enforced by the database
   (supabase/migrations). Without them the same screens run in PREVIEW mode
   against a stand-in kept in this browser, so the whole flow can be tried
   before anything is set up.

   The plans, while PRICING is on in account-config.js (it is off for now:
   every signed-in member gets everything Pro gives, no plans or prices are
   shown, and the ads are off too, with ADS.enabled):
     Free   one league, with ads; the league can be swapped once a month
     Pro    $10 a month: unlimited leagues, the league AI chat (chat.js), no ads
     League Pass  $20 per member a year: one member buys Pro for their
            whole league and shares an invite link; everyone who joins
            through it is on Pro while the pass is paid (see "League Pass"
            below, and supabase/migrations/20261004000000_league_pass.sql)

   What pages see (window.Account):
     Account.ready            resolves once the session is known
     Account.admit(model)     resolves when the visitor may see this league;
                              until then a gate over the page says why not
                              (sleeper.js calls it at the end of League.load)
     Account.on(fn)           hears every change of user, plan or leagues
     Account.accessToken()    the signed-in session's token (Supabase only),
                              for the ESPN relay's saved keys
     Account.openSignIn(), openPanel(), upgrade(), signOut()
     Account.openLeaguePass() the League Pass checkout, for the league on screen

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
  const LEAGUE = Object.assign({ name: "League Pass", perMember: 20, price: "$20 per member a year", minSeats: 2, maxSeats: 60 }, PLANS.league || {});
  const PASS_URL = CFG.LEAGUE_PASS_URL ||
    (CFG.SUPABASE_URL ? `${String(CFG.SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/league-pass` : "");
  const money = (n) => `$${Number(n).toLocaleString("en-US")}`;
  // PRICING off: no plans on the site. Every signed-in member gets what Pro
  // gives, and nothing offers an upgrade (the database's
  // app_settings.free_for_everyone does the same on the server).
  const PRICING = CFG.PRICING === true;
  // Ads off: every slot stays in the pages, hidden, until ADS.enabled.
  const ADS_ON = Boolean(CFG.ADS && CFG.ADS.enabled);
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
  document.documentElement.classList.toggle("lh-no-ads", !ADS_ON || Boolean(hint && hint.plan === "pro"));
  // AdSense allows no custom sticky ads on phones and none wider than 300px
  // on desktop, so pages that would otherwise pin one (the trophy hall's ad
  // bar) leave it out under AdSense.
  document.documentElement.classList.toggle("lh-ads-adsense", Boolean(CFG.ADS && CFG.ADS.provider === "adsense"));

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
    if (code === "bad_league") return "That isn't a Sleeper or ESPN league.";
    if (code === "invite_unknown") return "That invite link isn't valid anymore. Ask for a new one.";
    if (code === "pass_inactive") return "That League Pass isn't active right now.";
    if (code === "invite_removed") return "The league's organizer took this seat back. Ask them to restore it.";
    if (code === "pass_full") return "Every seat on that League Pass is taken. Ask the organizer to add one.";
    if (code === "not_owner") return "Only the person who bought the League Pass can do that.";
    if (code === "seats_in_use" || code === "bad_seats") return raw.slice(raw.indexOf(":") + 1).trim() || "That number of seats won't work.";
    if (code === "pass_not_set_up") return "League Pass payments aren't set up yet.";
    if (/invalid login credentials/i.test(raw)) return "That email and password don't match an account.";
    if (/already registered|already been registered|user_already_exists/i.test(raw)) return "There's already an account with that email. Sign in instead.";
    if (/password should be at least|weak_password/i.test(raw)) return "Use a password of at least 8 characters.";
    if (/email not confirmed/i.test(raw)) return "Confirm your email first: the link is in your inbox.";
    if (/rate limit|too many/i.test(raw)) return "Too many tries. Wait a minute and try again.";
    if (/failed to fetch|network/i.test(raw)) return "Couldn't reach the server. Check your connection.";
    // a server's own sentence, after its code
    const said = raw.match(/^[a-z_]+:(.+)$/);
    if (said) return said[1].trim().charAt(0).toUpperCase() + said[1].trim().slice(1);
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
      // The signed-in session's token, for the ESPN relay (espn.js) to
      // know whose saved ESPN keys to use.
      async accessToken() {
        const { data } = await client.auth.getSession();
        return (data.session && data.session.access_token) || null;
      },

      // League Pass: the database functions, and the league-pass function
      // for anything that involves Stripe.
      async passes() {
        return check(await client.rpc("my_league_passes")) || { owned: [], member_of: [] };
      },
      async invite(code) {
        return check(await client.rpc("league_pass_invite", { p_code: code }));
      },
      async joinPass(code) {
        return check(await client.rpc("join_league_pass", { p_code: code }));
      },
      async setPassMember(passId, userId, active) {
        check(await client.rpc("set_league_pass_member", { p_pass_id: passId, p_user_id: userId, p_active: active }));
      },
      async resetPassLink(passId) {
        return check(await client.rpc("reset_league_pass_link", { p_pass_id: passId }));
      },
      async buyPass({ league, seats, returnUrl }) {
        return passCall("checkout", {
          league_id: league.id, league_ids: league.ids, league_name: league.name, league_avatar: league.avatar,
          seats, return_url: returnUrl,
        });
      },
      async setPassSeats(passId, seats) {
        return passCall("seats", { pass_id: passId, seats });
      },
    };

    async function passCall(action, body) {
      if (!PASS_URL) throw new Error("pass_not_set_up");
      const { data } = await client.auth.getSession();
      const token = data.session && data.session.access_token;
      if (!token) throw new Error("not_signed_in");
      const res = await fetch(`${PASS_URL}?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.code === "not_set_up" ? "pass_not_set_up" : `${answer.code || "error"}:${answer.error || `The server answered ${res.status}`}`);
      return answer;
    }
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
    // A member's plan, as refresh_plan() works it out on the live site: their
    // own Pro, or a seat on a League Pass.
    const onPass = (db, userId) => (db.passes || []).some((p) => p.status === "active" &&
      p.members.some((m) => m.user_id === userId && !m.removed_at));
    const planOf = (db, u) => (u.plan === "pro" || onPass(db, u.id) ? "pro" : "free");
    const nameOf = (db, id) => { const x = db.users[id]; return x ? (x.name || x.email.split("@")[0]) : "Someone"; };
    const passView = (db, p) => ({
      id: p.id, league_id: p.league_id, league_name: p.league_name, league_avatar: p.league_avatar,
      seats: p.seats, status: p.status, live: p.status === "active", current_period_end: p.current_period_end,
      invite_code: p.invite_code, created_at: p.created_at,
      members: p.members.map((m) => ({ ...m, name: nameOf(db, m.user_id), email: (db.users[m.user_id] || {}).email || "" })),
    });
    const code = () => uid().replace(/-/g, "").slice(0, 24);

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
          plan: planOf(load(), u), current_period_end: u.plan === "pro" ? Date.now() + 30 * DAY : null,
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
        if (PRICING && planOf(db, u) !== "pro" && u.leagues.length >= PLANS.free.leagues) throw new Error("free_limit");
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
        if (PRICING && planOf(db, u) !== "pro" && unlocks > Date.now()) throw new Error(`swap_locked:${new Date(unlocks).toISOString()}`);
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

      // League Pass, with the database functions' rules. Buying one needs no
      // payment here: the pass is active at once.
      async passes() {
        const db = load();
        const u = current(db);
        if (!u) return { owned: [], member_of: [] };
        const all = db.passes || [];
        return {
          owned: all.filter((p) => p.owner_id === u.id).map((p) => passView(db, p)),
          member_of: all.filter((p) => p.owner_id !== u.id && p.members.some((m) => m.user_id === u.id && !m.removed_at))
            .map((p) => ({ id: p.id, league_id: p.league_id, league_name: p.league_name, live: p.status === "active",
              current_period_end: p.current_period_end, owner_name: nameOf(db, p.owner_id) })),
        };
      },
      async invite(inviteCode) {
        const db = load();
        const p = (db.passes || []).find((x) => x.invite_code === inviteCode);
        if (!p) throw new Error("invite_unknown");
        const u = current(db);
        const mine = u && p.members.find((m) => m.user_id === u.id);
        return {
          league_id: p.league_id, league_name: p.league_name, league_avatar: p.league_avatar,
          owner_name: nameOf(db, p.owner_id), is_owner: Boolean(u && p.owner_id === u.id),
          seats: p.seats, used: p.members.filter((m) => !m.removed_at).length, live: p.status === "active",
          joined: Boolean(mine && !mine.removed_at), removed: Boolean(mine && mine.removed_at),
        };
      },
      async joinPass(inviteCode) {
        const db = load();
        const u = current(db);
        if (!u) throw new Error("not_signed_in");
        const p = (db.passes || []).find((x) => x.invite_code === inviteCode);
        if (!p) throw new Error("invite_unknown");
        if (p.status !== "active") throw new Error("pass_inactive");
        const mine = p.members.find((m) => m.user_id === u.id);
        if (mine && mine.removed_at) throw new Error("invite_removed");
        if (!mine) {
          if (p.members.filter((m) => !m.removed_at).length >= p.seats) throw new Error("pass_full");
          p.members.push({ user_id: u.id, role: "member", joined_at: new Date().toISOString(), removed_at: null });
        }
        u.leagues = u.leagues || [];
        if (!u.leagues.some((l) => l.league_ids.includes(p.league_id))) {
          u.leagues.push({ league_id: p.league_id, league_ids: p.league_ids, name: p.league_name, avatar: p.league_avatar, synced_at: Date.now() });
        }
        save(db);
        return { pass_id: p.id, league_id: p.league_id, league_name: p.league_name };
      },
      async setPassMember(passId, userId, active) {
        const db = load();
        const u = current(db);
        const p = (db.passes || []).find((x) => x.id === passId);
        if (!u || !p || p.owner_id !== u.id) throw new Error("not_owner");
        const m = p.members.find((x) => x.user_id === userId);
        if (!m || m.role === "owner") return;
        if (active && !m.removed_at) return;
        if (active && p.members.filter((x) => !x.removed_at).length >= p.seats) throw new Error("pass_full");
        m.removed_at = active ? null : new Date().toISOString();
        save(db);
      },
      async resetPassLink(passId) {
        const db = load();
        const u = current(db);
        const p = (db.passes || []).find((x) => x.id === passId);
        if (!u || !p || p.owner_id !== u.id) throw new Error("not_owner");
        p.invite_code = code();
        save(db);
        return p.invite_code;
      },
      async buyPass({ league, seats }) {
        const db = load();
        const u = current(db);
        if (!u) throw new Error("not_signed_in");
        const p = {
          id: uid(), owner_id: u.id, league_id: league.id, league_ids: league.ids, league_name: league.name,
          league_avatar: league.avatar, seats, status: "active", invite_code: code(),
          current_period_end: new Date(Date.now() + 365 * DAY).toISOString(), created_at: new Date().toISOString(),
          members: [{ user_id: u.id, role: "owner", joined_at: new Date().toISOString(), removed_at: null }],
        };
        db.passes = [...(db.passes || []), p];
        save(db);
        return { pass_id: p.id, url: null };
      },
      async setPassSeats(passId, seats) {
        const db = load();
        const u = current(db);
        const p = (db.passes || []).find((x) => x.id === passId);
        if (!u || !p || p.owner_id !== u.id) throw new Error("not_owner");
        const used = p.members.filter((m) => !m.removed_at).length;
        if (seats < used) throw new Error(`seats_in_use:${used} members have joined: remove some before going below that`);
        p.seats = seats;
        save(db);
        return { seats };
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
  const state = { mode: MODE, ready: false, user: null, profile: null, leagues: [], passes: { owned: [], member_of: [] }, recovering: false };
  const listeners = new Set();

  const plan = () => (state.profile && state.profile.plan === "pro" ? "pro" : "free");
  const isPro = () => (PRICING ? plan() === "pro" : Boolean(state.user));
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
        const [profile, leagues, passes] = await Promise.all([
          backend.profile(state.user), backend.leagues(),
          backend.passes().catch(() => ({ owned: [], member_of: [] })),
        ]);
        state.profile = profile;
        state.leagues = leagues || [];
        state.passes = passes || { owned: [], member_of: [] };
      } catch (err) {
        console.warn("Account:", err);
        state.profile = state.profile || { plan: "free" };
      }
    } else {
      state.profile = null;
      state.leagues = [];
      state.passes = { owned: [], member_of: [] };
    }
    emit();
  }

  function emit() {
    if (state.user) store.set(CACHE_KEY, { plan: plan(), email: state.user.email });
    else store.del(CACHE_KEY);
    document.documentElement.classList.toggle("lh-no-ads", !ADS_ON || (Boolean(state.user) && isPro()));
    document.documentElement.classList.toggle("lh-signed-in", Boolean(state.user));
    drawButtons();
    drawPanel();
    drawSyncedCard();
    if (document.body) { placeFeeds(); budgetAds(); }
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
  // The league this page is about, once loaded, for the League Pass checkout.
  let seenLeague = null;
  const relock = () => { if (admitted && REQUIRE) location.reload(); };
  // A league page under the gate: its ads wait until the page is let in, so
  // none is ever served behind the sign-in screen.
  const GATED_PAGE = REQUIRE && /[?&]league=/.test(location.search);

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

  /* Taking a league off the account: with none left, or with the league on
     screen gone, the next thing to do is find a league, so that's where the
     member goes (reloading the league they just removed would only ask to
     add it back, and on Pro would quietly do so). */
  async function unsync(leagueId) {
    const row = state.leagues.find((l) => l.league_id === leagueId);
    await backend.unsync(leagueId);
    await refresh();
    const wasOpen = row && admitted && (row.league_ids || [row.league_id]).some((id) => admitted.ids.includes(id));
    if (wasOpen || !state.leagues.length) findLeague();
  }

  // The front page's league finder: scrolled to there, or gone to.
  function findLeague() {
    const finder = document.getElementById("signinForm");
    if (!finder) { location.href = "index.html"; return; }
    closePanel();
    const card = finder.closest(".card") || finder;
    card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    const field = [...card.querySelectorAll("input")].find((el) => el.offsetParent);
    if (field) setTimeout(() => field.focus({ preventScroll: true }), 350);
  }

  /* Checkout. Stripe's Payment Link, told who is paying so the webhook can
     find the account; in preview, the account panel's plan switch. */
  function upgrade() {
    closeMenu();
    // No plans for now: the only step up is an account.
    if (!PRICING) {
      if (!state.user) openAuth("signup", { reason: "It's free: create an account and everything opens, the league AI included." });
      return;
    }
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
    const ids = [...new Set([model.leagueId, ...model.seasons.map((s) => s.leagueId)].filter(Boolean).map(String))];
    const newest = model.current || model.seasons[model.seasons.length - 1];
    const league = { id: String(model.leagueId), ids, name: model.name, avatar: model.avatar,
      teams: newest ? Object.keys(newest.teams || {}).length : 0 };
    seenLeague = league;
    await ready;
    if (!REQUIRE) return;
    for (;;) {
      const verdict = judge(league);
      if (verdict.kind === "ok") {
        if (verdict.refresh) backend.sync(league).then(refresh).catch(() => {});
        admitted = league;
        closeGate();
        budgetAds();
        fillAds();
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
    const proLine = `<b>Pro</b> · ${esc(PLANS.pro.price)}: unlimited leagues, the league AI, no ads. Or get it for your whole league: only ${money(LEAGUE.perMember)} per member for a year.`;
    let title = "", copy = "", actions = "", foot = "";

    if (verdict.kind === "signed-out") {
      title = `Sign in to open ${name}`;
      copy = PRICING
        ? `Pigskin Pantheon is free with an account: one league of your choice, every season it has played. ${proLine}`
        : "Pigskin Pantheon is free with an account: every season your league has played, the trophy room and the league AI.";
      actions = `<button class="acct-btn acct-btn-primary" data-act="signup">Create free account</button>
        <button class="acct-btn" data-act="signin">Sign in</button>`;
    } else if (verdict.kind === "free-first") {
      title = `Add ${name} to your account`;
      copy = `Your free plan includes one league. Once it's added you can swap it for another once every ${SWAP_DAYS} days.`;
      actions = `<button class="acct-btn acct-btn-primary" data-act="sync">Add this league</button>
        <button class="acct-btn" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>
        <button class="acct-btn" data-act="pass">Whole league · ${money(LEAGUE.perMember)}/member a year</button>`;
    } else if (verdict.kind === "free-full" || verdict.kind === "over-limit") {
      const cur = verdict.current;
      const curName = esc((cur && cur.name) || "your league");
      title = `Your free league is ${curName}`;
      if (cur && canSwap(cur)) {
        copy = `Free accounts hold one league. You can swap ${curName} for ${name} now; after that, the next swap opens ${fmtDate(Date.now() + SWAP_DAYS * DAY)}.`;
        actions = `<button class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>
          <button class="acct-btn" data-act="pass">Whole league · ${money(LEAGUE.perMember)}/member a year</button>
          <button class="acct-btn" data-act="swap">Swap to this league</button>`;
      } else {
        copy = `Free accounts hold one league and can swap it once every ${SWAP_DAYS} days. Your next swap opens ${cur ? fmtDate(unlocksAt(cur)) : "soon"}. ${proLine}`;
        actions = `<button class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>
          <button class="acct-btn" data-act="pass">Whole league · ${money(LEAGUE.perMember)}/member a year</button>`;
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
      if (act === "pass") return openLeaguePass(league);
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
    const limit = !PRICING ? "Your leagues" : pro ? "Unlimited leagues" : `${Math.min(leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues} league`;
    menuEl.innerHTML = `
      <div class="acct-menu-head">
        <span class="acct-avatar${pro ? " is-pro" : ""}">${esc(initials())}</span>
        <div class="acct-menu-who">
          <strong>${esc(displayName())}</strong>
          <span>${esc(state.user.email || "")}</span>
        </div>
        ${PRICING ? `<span class="acct-plan-badge${pro ? " is-pro" : ""}">${esc(PLANS[plan()].name)}</span>` : ""}
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
      ${ownedPasses().length ? `<button role="menuitem" class="acct-menu-item" data-act="passes">${esc(LEAGUE.name)} · invite link</button>` : ""}
      ${!PRICING ? ""
        : pro
        ? (seatOn() ? "" : '<button role="menuitem" class="acct-menu-item" data-act="manage">Manage subscription</button>')
        : `<button role="menuitem" class="acct-menu-item acct-menu-upgrade" data-act="upgrade"><span>Go Pro</span><span>${esc(PLANS.pro.price)} · AI chat · no ads</span></button>
           <button role="menuitem" class="acct-menu-item acct-menu-upgrade" data-act="pass"><span>Whole league</span><span>${money(LEAGUE.perMember)}/member a year</span></button>`}
      <div class="acct-menu-sep"></div>
      <button role="menuitem" class="acct-menu-item" data-act="signout">Sign out</button>`;
    menuEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      closeMenu();
      if (act === "panel") openPanel();
      else if (act === "passes") openPanel("pass");
      else if (act === "pass") openLeaguePass();
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
        <p class="acct-reason">${esc(reason || (PRICING
          ? `Free: one league with ads. Pro (${PLANS.pro.price}): unlimited leagues, the league AI, no ads. Or ${money(LEAGUE.perMember)} per member a year for your whole league.`
          : "It's free: every league you add, every season it played, and the league AI."))}</p>
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
    const passSeat = seatOn();
    const onPass = Boolean(passSeat) || ownedPasses().some((x) => x.live);

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
          <h3>Your leagues <span>${!PRICING ? "" : pro ? "Unlimited" : `${Math.min(state.leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues}`}</span></h3>
          ${state.leagues.length ? `<ul class="acct-leagues">${leagueRows}</ul>` : '<p class="acct-muted">No leagues yet. Open one from the front page and add it to your account.</p>'}
          <p class="acct-muted">${!PRICING
            ? "Add as many leagues as you like, and remove them any time."
            : pro
            ? "Pro opens every league you add, with no limits on adding or removing them."
            : `Free accounts hold one league and can swap it once every ${SWAP_DAYS} days. A league's renewal each season stays the same league.`}</p>
          <a class="acct-btn acct-btn-small" href="index.html">Find a league</a>
        </section>

        ${passSection()}

        ${PRICING ? `<section data-section="plan">
          <h3>Plan</h3>
          <div class="acct-plans">
            <div class="acct-plan${pro ? "" : " is-current"}">
              <div class="acct-plan-name">${esc(PLANS.free.name)}${pro ? "" : "<em>Current</em>"}</div>
              <div class="acct-plan-price">${esc(PLANS.free.price)}</div>
              <ul><li>1 league</li><li>Swap once a month</li><li>No AI chat</li><li>Ads</li></ul>
            </div>
            <div class="acct-plan acct-plan-pro${pro && !onPass ? " is-current" : ""}">
              <div class="acct-plan-name">${esc(PLANS.pro.name)}${pro && !onPass ? "<em>Current</em>" : ""}</div>
              <div class="acct-plan-price">${esc(PLANS.pro.price)}</div>
              <ul><li>Ask the League AI</li><li>Unlimited leagues</li><li>Add or remove any time</li><li>No ads</li></ul>
            </div>
            <div class="acct-plan acct-plan-league${onPass ? " is-current" : ""}">
              <div class="acct-plan-name">${esc(LEAGUE.name)}${onPass ? "<em>Current</em>" : "<em>Best value</em>"}</div>
              <div class="acct-plan-price">${money(LEAGUE.perMember)} <small>per member a year</small></div>
              <ul><li>Pro for everyone in your league</li><li>One invite link to share</li><li>${money(LEAGUE.perMember * 10)} a year for a 10-team league, billed annually</li></ul>
            </div>
          </div>
          ${passSeat ? `<p class="acct-muted">You're on Pro through <strong>${esc(passSeat.league_name || "your league")}</strong>'s ${esc(LEAGUE.name)}, from ${esc(passSeat.owner_name || "a league-mate")}.</p>` : ""}
          ${pro && !passSeat
            ? `<p class="acct-muted">${renews ? `Renews ${renews}.` : ""} Cancel or change your card in the billing portal.</p>
               <button type="button" class="acct-btn acct-btn-small" data-act="manage">Manage subscription</button>`
            : pro ? ""
            : `<button type="button" class="acct-btn acct-btn-primary" data-act="upgrade">Go Pro · ${esc(PLANS.pro.price)}</button>`}
          <button type="button" class="acct-btn acct-pass-cta" data-act="pass">${ownedPasses().length ? `Get a ${esc(LEAGUE.name)} for another league` : `Get it for your whole league · ${money(LEAGUE.perMember)}/member a year`}</button>
          ${MODE === "preview" ? `<div class="acct-preview-tools">
              <span>Preview tools</span>
              <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-act="preview-plan">Switch to ${pro ? "Free" : "Pro"}</button>
              <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-act="preview-unlock">Skip the ${SWAP_DAYS}-day lock</button>
            </div>` : ""}
        </section>` : ""}

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
      else if (act === "pass") { closePanel(); openLeaguePass(); }
      else if (act === "manage") manage();
      else if (act === "signout") { closePanel(); signOut(); }
      else if (act === "preview-plan") { backend.setPlan(pro ? "free" : "pro"); await refresh(); toast(`Preview: now on ${pro ? "Free" : "Pro"}.`); }
      else if (act === "preview-unlock") { backend.unlockSwaps(); await refresh(); toast("Preview: swap lock lifted."); }
    }));
    wirePassSection(panelEl);
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

  /* ------------------------------------------------------------ League Pass */

  /* One member (the pass's owner) buys Pro for the whole league, at
     LEAGUE.perMember dollars a member a year, the owner's own seat
     included. They get an invite link (the site's front page with
     ?invite=<code>, on whatever address the site is served from) to send
     the league; whoever signs in through it takes a seat and is on Pro while
     the pass is paid. The owner's panel shows the seats, who has joined
     (remove or restore anyone), a new link, and more or fewer seats. */
  const inviteUrl = (inviteCode) => new URL(`index.html?invite=${encodeURIComponent(inviteCode)}`, location.href).href;
  const yearly = (seats) => money(seats * LEAGUE.perMember);
  const clampSeats = (n) => Math.max(LEAGUE.minSeats, Math.min(LEAGUE.maxSeats, Math.round(Number(n) || 0)));
  const ownedPasses = () => (state.passes && state.passes.owned) || [];
  const seatOn = () => ((state.passes && state.passes.member_of) || []).find((p) => p.live) || null;
  const ICON_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';

  /* The checkout: which league, how many members, what it comes to. */
  function openLeaguePass(context = null) {
    closeMenu();
    if (!state.user) {
      openAuth("signup", { reason: `Create a free account first, then get the ${LEAGUE.name} for your league.` });
      return;
    }
    const choices = [];
    const add = (l) => { if (l && l.id && !choices.some((c) => c.ids.some((id) => l.ids.includes(id)))) choices.push(l); };
    add(context);
    add(seenLeague);
    state.leagues.forEach((row) => add({ id: row.league_id, ids: row.league_ids || [row.league_id], name: row.name, avatar: row.avatar, teams: 0 }));
    const el = document.createElement("div");
    el.className = "acct-modal acct-pass-buy open";
    const first = choices[0];
    let seats = clampSeats((first && first.teams) || 10);
    el.innerHTML = `<div class="acct-modal-backdrop" data-close></div>
      <div class="acct-modal-card" role="dialog" aria-modal="true" aria-labelledby="acctPassTitle">
        <button type="button" class="acct-close" data-close aria-label="Close">&times;</button>
        <span class="acct-pass-kicker">${esc(LEAGUE.name)}</span>
        <h2 id="acctPassTitle">Pro for your whole league</h2>
        <p class="acct-reason">Everyone in your league gets Pro: the league AI, every season, unlimited leagues and no ads. <strong>Only ${money(LEAGUE.perMember)} per member for a whole year</strong>, billed annually.</p>
        ${choices.length ? `
        <form class="acct-form acct-pass-form">
          <label class="acct-field"><span>League</span>
            <select name="league">${choices.map((c, i) => `<option value="${i}">${esc(c.name || c.id)}</option>`).join("")}</select>
          </label>
          <div class="acct-field"><span>Members, you included</span>
            <div class="acct-stepper">
              <button type="button" data-step="-1" aria-label="One fewer">&minus;</button>
              <input name="seats" type="number" inputmode="numeric" min="${LEAGUE.minSeats}" max="${LEAGUE.maxSeats}" value="${seats}" aria-label="Members">
              <button type="button" data-step="1" aria-label="One more">+</button>
            </div>
          </div>
          <div class="acct-pass-total" aria-live="polite"><strong data-total>${yearly(seats)}</strong><span data-math>a year · ${money(LEAGUE.perMember)} × ${seats} members</span></div>
          <p class="acct-error" role="alert" hidden></p>
          <button type="submit" class="acct-btn acct-btn-primary acct-btn-wide" data-go>Continue to payment · ${yearly(seats)}</button>
          <p class="acct-muted">After paying you get an invite link to send your league. You can remove people, invite others and add seats any time.</p>
        </form>`
        : `<p class="acct-muted">Add your league to your account first: open it from the front page.</p>
           <a class="acct-btn acct-btn-primary acct-btn-wide" href="index.html">Find your league</a>`}
        ${MODE === "preview" ? '<p class="acct-preview-note">Preview mode: no payment is taken; the pass starts at once.</p>' : ""}
      </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("lh-modal-open");
    const close = () => { el.remove(); document.documentElement.classList.remove("lh-modal-open"); };
    el.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    const form = el.querySelector(".acct-pass-form");
    if (!form) return;
    const input = form.querySelector('input[name="seats"]');
    const select = form.querySelector('select[name="league"]');
    const draw = () => {
      el.querySelector("[data-total]").textContent = yearly(seats);
      el.querySelector("[data-math]").textContent = `a year · ${money(LEAGUE.perMember)} × ${seats} members`;
      el.querySelector("[data-go]").textContent = `Continue to payment · ${yearly(seats)}`;
    };
    form.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      seats = clampSeats(seats + Number(b.dataset.step));
      input.value = seats;
      draw();
    }));
    input.addEventListener("input", () => { if (input.value) { seats = clampSeats(input.value); draw(); } });
    input.addEventListener("change", () => { input.value = seats; });
    select.addEventListener("change", () => {
      const c = choices[Number(select.value)];
      if (c && c.teams) { seats = clampSeats(c.teams); input.value = seats; draw(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const go = form.querySelector("[data-go]");
      const err = form.querySelector(".acct-error");
      go.disabled = true;
      go.classList.add("is-busy");
      err.hidden = true;
      try {
        const back = new URL(location.href);
        ["pass", "paid", "invite"].forEach((k) => back.searchParams.delete(k));
        const league = choices[Number(select.value)];
        const res = await backend.buyPass({ league, seats, returnUrl: back.href });
        if (res && res.url) { location.href = res.url; return; }
        close();
        await refresh();
        openPanel("pass");
        toast(`${LEAGUE.name} on. Send your league the invite link.`);
      } catch (error) {
        err.textContent = explain(error);
        err.hidden = false;
        go.disabled = false;
        go.classList.remove("is-busy");
      }
    });
    setTimeout(() => (input || el.querySelector(".acct-close")).focus(), 50);
  }

  /* The owner's passes, in the account panel. */
  function passSection() {
    const passes = ownedPasses();
    if (!passes.length) return "";
    return `<section data-section="pass">
      <h3>${esc(LEAGUE.name)} <span>${passes.length > 1 ? `${passes.length} leagues` : ""}</span></h3>
      ${passes.map((p) => {
        const here = p.members.filter((m) => !m.removed_at);
        const open = Math.max(0, p.seats - here.length);
        const status = p.live ? (p.status === "past_due" ? "Payment due" : "Active") : p.status === "canceled" ? "Ended" : "Not active";
        const when = p.current_period_end ? `${p.live && p.status !== "canceled" ? "Renews" : "Ended"} ${fmtDate(p.current_period_end)}` : "";
        return `<div class="acct-pass" data-pass="${esc(p.id)}">
          <div class="acct-pass-head">
            ${p.league_avatar ? `<img src="${esc(p.league_avatar)}" alt="" width="36" height="36">` : '<span class="acct-league-mark">🏈</span>'}
            <div class="acct-league-copy"><strong>${esc(p.league_name || "Your league")}</strong><span>${here.length} of ${p.seats} seats taken${when ? ` · ${when}` : ""}</span></div>
            <span class="acct-pass-status${p.live ? "" : " is-off"}">${status}</span>
          </div>
          <div class="acct-pass-meter" role="img" aria-label="${here.length} of ${p.seats} seats taken"><span style="width:${Math.min(100, (here.length / p.seats) * 100)}%"></span></div>
          ${p.live ? `
          <div class="acct-pass-invite">
            <span class="acct-pass-invite-label">${ICON_LINK}Invite link${open ? ` · ${open} seat${open === 1 ? "" : "s"} open` : " · every seat taken"}</span>
            <div class="acct-copy"><input readonly value="${esc(inviteUrl(p.invite_code))}" aria-label="Invite link"><button type="button" class="acct-btn acct-btn-small acct-btn-primary" data-pass-act="copy">Copy</button></div>
            <div class="acct-pass-row">
              ${navigator.share ? '<button type="button" class="acct-btn acct-btn-small" data-pass-act="share">Share…</button>' : ""}
              <button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-pass-act="relink" title="The old link stops working">New link</button>
            </div>
          </div>` : `<p class="acct-muted">This pass isn't active, so nobody on it has Pro through it. ${p.status === "past_due" || p.status === "unpaid" ? "Update the card in the billing portal to turn it back on." : ""}</p>`}
          <ul class="acct-members">
            ${p.members.map((m) => `<li class="acct-member${m.removed_at ? " is-removed" : ""}">
              <span class="acct-avatar">${esc(String(m.name || "?").charAt(0).toUpperCase())}</span>
              <div class="acct-league-copy"><strong>${esc(m.name || "Member")}${m.role === "owner" ? " <em>You</em>" : ""}</strong>
                <span>${esc(m.email || "")}${m.role === "owner" ? "" : m.removed_at ? ` · removed ${fmtDate(m.removed_at)}` : ` · joined ${fmtDate(m.joined_at)}`}</span></div>
              ${m.role === "owner" ? "" : m.removed_at
                ? `<button type="button" class="acct-btn acct-btn-small" data-member="${esc(m.user_id)}" data-active="1">Restore</button>`
                : `<button type="button" class="acct-btn acct-btn-small acct-btn-quiet" data-member="${esc(m.user_id)}" data-active="0">Remove</button>`}
            </li>`).join("")}
            ${open && p.live ? `<li class="acct-member is-open"><span class="acct-avatar acct-avatar-empty">+</span><div class="acct-league-copy"><strong>${open} open seat${open === 1 ? "" : "s"}</strong><span>Anyone with the link can take one.</span></div></li>` : ""}
          </ul>
          ${p.live ? `<div class="acct-pass-seats">
            <span>Seats</span>
            <div class="acct-stepper acct-stepper-small">
              <button type="button" data-seat-step="-1" aria-label="One fewer seat">&minus;</button>
              <output data-seats>${p.seats}</output>
              <button type="button" data-seat-step="1" aria-label="One more seat">+</button>
            </div>
            <button type="button" class="acct-btn acct-btn-small" data-pass-act="seats" hidden></button>
          </div>` : ""}
        </div>`;
      }).join("")}
      <p class="acct-muted">Removing someone frees their seat and ends their Pro; the link still won't let them back in unless you restore them. Seat changes are charged (or credited) for the rest of the year.</p>
      ${MODE === "supabase" && CFG.STRIPE_PORTAL_LINK ? '<button type="button" class="acct-btn acct-btn-small" data-act="manage">Billing and receipts</button>' : ""}
    </section>`;
  }

  function wirePassSection(root) {
    root.querySelectorAll("[data-pass]").forEach((card) => {
      const pass = ownedPasses().find((p) => p.id === card.dataset.pass);
      if (!pass) return;
      const link = card.querySelector(".acct-copy input");
      card.querySelectorAll("[data-pass-act]").forEach((b) => b.addEventListener("click", async () => {
        const act = b.dataset.passAct;
        if (act === "copy") {
          try { await navigator.clipboard.writeText(link.value); toast("Invite link copied."); }
          catch (err) { link.select(); toast("Select the link and copy it."); }
        } else if (act === "share") {
          try {
            await navigator.share({ title: `Join ${pass.league_name || "our league"} on Pigskin Pantheon`,
              text: `I got us the ${LEAGUE.name}: Pro on Pigskin Pantheon for everyone in ${pass.league_name || "the league"}. Join here:`, url: link.value });
          } catch (err) { /* closed */ }
        } else if (act === "relink") {
          const sure = await confirmBox({ title: "Make a new link?", body: "The current link stops working. People who already joined keep their seats.", yes: "New link" });
          if (!sure) return;
          try { await backend.resetPassLink(pass.id); await refresh(); toast("New invite link ready."); } catch (err) { toast(explain(err)); }
        } else if (act === "seats") {
          const seats = Number(card.querySelector("[data-seats]").textContent);
          b.disabled = true;
          try { await backend.setPassSeats(pass.id, seats); await refresh(); toast(`${LEAGUE.name} now covers ${seats} members.`); }
          catch (err) { toast(explain(err)); b.disabled = false; }
        }
      }));
      card.querySelectorAll("[data-seat-step]").forEach((b) => b.addEventListener("click", () => {
        const out = card.querySelector("[data-seats]");
        const used = pass.members.filter((m) => !m.removed_at).length;
        const next = Math.max(Math.max(LEAGUE.minSeats, used), Math.min(LEAGUE.maxSeats, Number(out.textContent) + Number(b.dataset.seatStep)));
        out.textContent = next;
        const save = card.querySelector('[data-pass-act="seats"]');
        const diff = next - pass.seats;
        save.hidden = diff === 0;
        save.textContent = diff > 0
          ? `Add ${diff} · ${money(diff * LEAGUE.perMember)}/yr`
          : `Remove ${-diff} · ${money(-diff * LEAGUE.perMember)}/yr less`;
      }));
      card.querySelectorAll("[data-member]").forEach((b) => b.addEventListener("click", async () => {
        const active = b.dataset.active === "1";
        const who = pass.members.find((m) => m.user_id === b.dataset.member);
        if (!active) {
          const sure = await confirmBox({ title: `Remove ${esc((who && who.name) || "them")}?`,
            body: "Their seat opens for someone else and their Pro ends. You can restore them later if there's a seat.", yes: "Remove" });
          if (!sure) return;
        }
        b.disabled = true;
        try { await backend.setPassMember(pass.id, b.dataset.member, active); await refresh(); toast(active ? "Restored." : "Removed."); }
        catch (err) { toast(explain(err)); b.disabled = false; }
      }));
    });
  }

  /* ------------------------------------------------------------ invitations */

  /* A friend arriving through an invite link (?invite=<code>): who invited
     them to which league, and the way in. The code is kept in this browser
     until it's used, so signing up (and confirming the email) doesn't lose
     it. */
  const INVITE_KEY = "lh-invite";
  let inviteEl = null;
  let inviteCode = null;
  let inviteInfo = null;
  let inviteJoined = null;

  async function showInvite(code) {
    inviteCode = code;
    try { inviteInfo = await backend.invite(code); }
    catch (err) { inviteInfo = { error: explain(err) }; }
    drawInvite();
  }
  function closeInvite(forget) {
    if (inviteEl) { inviteEl.remove(); inviteEl = null; document.documentElement.classList.remove("lh-modal-open"); }
    if (forget) { store.del(INVITE_KEY); inviteCode = null; }
  }
  function drawInvite() {
    if (!inviteCode || !inviteInfo) return;
    if (!inviteEl) {
      inviteEl = document.createElement("div");
      inviteEl.className = "acct-modal acct-invite open";
      document.body.appendChild(inviteEl);
      document.documentElement.classList.add("lh-modal-open");
      inviteEl.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInvite(false); });
    }
    const i = inviteInfo;
    const league = esc(i.league_name || "your league");
    const owner = esc(i.owner_name || "A league-mate");
    const leagueLink = i.league_id ? `season.html?league=${encodeURIComponent(i.league_id)}` : "index.html";
    let title, copy, actions, done = false;
    if (i.error) {
      title = "This invite won't open";
      copy = esc(i.error);
      actions = '<button type="button" class="acct-btn acct-btn-primary" data-inv="forget">OK</button>';
      done = true;
    } else if (inviteJoined || i.joined) {
      title = `You're in ${league}`;
      copy = `You have a seat on ${owner}'s ${esc(LEAGUE.name)}: Pro is on, and ${league} is on your account.`;
      actions = `<a class="acct-btn acct-btn-primary" href="${esc(leagueLink)}" data-inv="go">Open ${league}</a>`;
      done = true;
    } else if (i.is_owner) {
      title = "This is your invite link";
      copy = `Send it to the rest of ${league}: each person who signs in through it takes one of your ${i.seats} seats.`;
      actions = '<button type="button" class="acct-btn acct-btn-primary" data-inv="forget">Got it</button>';
      done = true;
    } else if (i.removed) {
      title = "Your seat was taken back";
      copy = `${owner} removed you from ${league}'s ${esc(LEAGUE.name)}. Ask them to restore your seat.`;
      actions = '<button type="button" class="acct-btn acct-btn-primary" data-inv="forget">OK</button>';
      done = true;
    } else if (!i.live) {
      title = "This pass isn't active";
      copy = `${owner}'s ${esc(LEAGUE.name)} for ${league} isn't paid up right now. Let them know.`;
      actions = '<button type="button" class="acct-btn acct-btn-primary" data-inv="forget">OK</button>';
      done = true;
    } else if (i.used >= i.seats) {
      title = "Every seat is taken";
      copy = `All ${i.seats} seats on ${league}'s ${esc(LEAGUE.name)} are taken. Ask ${owner} to add one.`;
      actions = '<button type="button" class="acct-btn acct-btn-primary" data-inv="forget">OK</button>';
      done = true;
    } else {
      title = `Join ${league}`;
      copy = `<strong>${owner}</strong> invited you to ${league} on Pigskin Pantheon, and your seat comes with <strong>Pro, on them</strong>: every season of your league, the league AI, unlimited leagues and no ads.`;
      actions = state.user
        ? `<button type="button" class="acct-btn acct-btn-primary" data-inv="join">Join ${league}</button>`
        : `<button type="button" class="acct-btn acct-btn-primary" data-inv="signup">Create free account</button>
           <button type="button" class="acct-btn" data-inv="signin">I have an account</button>`;
    }
    inviteEl.innerHTML = `<div class="acct-modal-backdrop" data-inv="close"></div>
      <div class="acct-modal-card acct-invite-card" role="dialog" aria-modal="true" aria-labelledby="acctInviteTitle">
        <button type="button" class="acct-close" data-inv="close" aria-label="Close">&times;</button>
        <div class="acct-gate-league">${i.league_avatar ? `<img src="${esc(i.league_avatar)}" alt="" width="56" height="56">` : "<span>🏈</span>"}</div>
        <span class="acct-pass-kicker">${done ? esc(LEAGUE.name) : "You're invited"}</span>
        <h2 id="acctInviteTitle">${title}</h2>
        <p class="acct-reason">${copy}</p>
        ${!done && !i.error ? `<p class="acct-muted">${i.seats - i.used} of ${i.seats} seats left.${state.user ? ` Signed in as ${esc(state.user.email || "")}.` : ""}</p>` : ""}
        <p class="acct-error" role="alert" hidden></p>
        <div class="acct-gate-actions">${actions}</div>
      </div>`;
    if (done && !inviteJoined) store.del(INVITE_KEY);
    inviteEl.querySelectorAll("[data-inv]").forEach((b) => b.addEventListener("click", async (e) => {
      const act = b.dataset.inv;
      if (act === "close") { closeInvite(done); return; }
      if (act === "forget") { closeInvite(true); return; }
      if (act === "go") { store.del(INVITE_KEY); return; }
      if (act === "signup") { openAuth("signup", { reason: `Create your account to join ${i.league_name || "the league"}. It's free: ${i.owner_name || "your league-mate"} has your seat covered.` }); return; }
      if (act === "signin") { openAuth("signin", { reason: `Sign in to join ${i.league_name || "the league"}.` }); return; }
      if (act === "join") {
        e.preventDefault();
        b.disabled = true;
        b.classList.add("is-busy");
        try {
          inviteJoined = await backend.joinPass(inviteCode);
          store.del(INVITE_KEY);
          await refresh();
          toast(`Welcome to ${i.league_name || "the league"}: Pro is on.`);
          drawInvite();
        } catch (err) {
          const el = inviteEl.querySelector(".acct-error");
          el.textContent = explain(err);
          el.hidden = false;
          b.disabled = false;
          b.classList.remove("is-busy");
        }
      }
    }));
    // Signing in from the invite: the sign-in dialog opens over this card.
    const first = inviteEl.querySelector(".acct-btn-primary");
    if (first && !document.querySelector(".acct-modal.open:not(.acct-invite)")) first.focus({ preventScroll: true });
  }
  // Signing in or out redraws the card (from "create account" to "join").
  listeners.add(() => { if (inviteEl && inviteCode && !inviteJoined) showInvite(inviteCode); });

  /* Back from Stripe's checkout (?pass=<id>&paid=1): the webhook turns the
     pass on a moment later, so the panel waits for it, then shows the
     link. */
  async function afterCheckout(passId) {
    await ready;
    openPanel("pass");
    toast("Payment received. Setting up your League Pass…");
    for (let i = 0; i < 20; i++) {
      await refresh();
      if (ownedPasses().some((p) => p.id === passId && p.live)) {
        openPanel("pass");
        toast("Your League Pass is on. Copy the invite link and send it to your league.");
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    toast("Your payment went through; the pass is still being set up. Check back in a minute.");
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
    if (meta) meta.textContent = !PRICING ? `${state.leagues.length} league${state.leagues.length === 1 ? "" : "s"}`
      : isPro() ? "Pro · unlimited" : `${Math.min(state.leagues.length, PLANS.free.leagues)} of ${PLANS.free.leagues} · Free`;
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
    const on = ADS_ON && !(state.user && isPro());
    if (!on || (GATED_PAGE && !admitted)) return;
    const ads = CFG.ADS || {};
    document.querySelectorAll(".ad-slot:not([data-filled])").forEach((slot) => {
      // Only a slot that is on screen: one in a view not being shown, or
      // held back by the density budget, is filled when it is shown.
      if (!slot.getClientRects().length) return;
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

  /* Ad density on phones. The Better Ads Standards, which Chrome enforces
     for every ad network by filtering a site's ads altogether, allow ads to
     take at most 30% of a mobile page's height. Each page (and the team
     history drawer, which scrolls on its own) is held to 25%: its content is
     measured with every slot out, then slots go back in — top banner, then
     the mid-page one, then the one at the foot — while they fit. A short
     page simply shows fewer. Runs with the other slot work, before paint, so
     a slot is never seen to vanish; a slot is only ever in or out, never
     resized. Desktops have no density rule.

     A slot already scrolled past is never switched in or out: everything
     on screen would move by its height (Safari doesn't anchor the scroll).
     It keeps its state until the content around it is redrawn. And the
     page's height is its content's, not the screen's, so the browser's bar
     sliding away mid-scroll changes nothing. */
  const PHONE = matchMedia("(max-width: 767px)");
  const DENSITY = 0.25;
  const rank = (el) => (el.classList.contains("ad-top") ? 0 : el.classList.contains("ad-bottom") ? 2 : 1);
  // the bottom of the page's content, without <main>'s held height (UI.holdHeight)
  function contentHeight() {
    let h = 0;
    for (const el of document.body.children) {
      if (!el.getClientRects().length) continue;
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "absolute" || pos === "sticky") continue;
      h = Math.max(h, el.getBoundingClientRect().bottom + window.scrollY);
    }
    return h - (window.UI && UI.heldSpace ? UI.heldSpace() : 0);
  }
  // has the reader scrolled past it? (an "off" slot has no box: ask its neighbour)
  function passed(el, top) {
    for (let n = el; n; n = n.nextElementSibling) {
      if (n.getClientRects().length) return n.getBoundingClientRect().top <= top;
    }
    const host = el.parentElement;
    return !!host && host.getClientRects().length > 0 && host.getBoundingClientRect().bottom <= top;
  }
  function budgetAds() {
    const scopes = [[null, [...document.querySelectorAll("main .ad-wrap")]],
      ...[...document.querySelectorAll(".drawer-body")].map((el) => [el, [...el.querySelectorAll(".ad-wrap")]])];
    for (const [root, slots] of scopes) {
      if (!slots.length) continue;
      if (!PHONE.matches) { slots.forEach((el) => el.classList.remove("ad-off")); continue; }
      const top = root ? root.getBoundingClientRect().top : 0;
      const scrolled = root ? root.scrollTop > 0 : window.scrollY > 0;
      const fixed = new Set(scrolled ? slots.filter((el) => el.dataset.budget && passed(el, top)) : []);
      const free = slots.filter((el) => !fixed.has(el));
      // Measured with every slot in and the ads' own space taken off: the
      // page only ever grows while it's measured. (Taking the slots out to
      // measure would shrink it for a moment, and a shorter page pulls the
      // scroll up with it even though nothing is painted in between.)
      free.forEach((el) => el.classList.remove("ad-off"));
      const box = (el) => {
        if (!el.getClientRects().length) return 0; // in a view not on screen
        const cs = getComputedStyle(el);
        return el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      };
      const content = (root ? root.scrollHeight : contentHeight()) - slots.reduce((sum, el) => sum + box(el), 0);
      let room = content * DENSITY / (1 - DENSITY);
      fixed.forEach((el) => { if (el.getClientRects().length) room -= el.getBoundingClientRect().height; });
      free.sort((a, b) => rank(a) - rank(b)).forEach((el) => {
        if (!el.getClientRects().length) return;
        el.dataset.budget = "1";
        const height = el.getBoundingClientRect().height;
        if (height <= room) room -= height;
        else el.classList.add("ad-off");
      });
    }
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

  /* A mid-page slot in each [data-ad-feed] panel, between the blocks of
     whatever it is showing: the matchups and the week's notes, the tables and
     their legend, the two brackets. A panel whose content is one wrapper
     (.panel-stack) is split inside it; a panel that is one card or one
     message is left whole, since there is nothing to go between. Panels
     redraw by replacing their contents, which takes the slot with it, so this
     runs again on every redraw, before the browser paints: the slot is there
     in the first frame the new content is, never pushed in after it. */
  const blocksOf = (el) => [...el.children].filter((c) => !c.classList.contains("ad-wrap") && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName));
  function placeFeeds() {
    if (!ADS_ON || (state.user && isPro())) return;
    document.querySelectorAll("[data-ad-feed]").forEach((panel) => {
      if (panel.querySelector(".ad-feed")) return;
      let host = panel;
      for (let depth = 0; depth < 2; depth++) {
        const only = blocksOf(host);
        if (only.length !== 1 || !only[0].matches(".panel-stack, [data-ad-feed-into]")) break;
        host = only[0];
      }
      const blocks = blocksOf(host);
      if (blocks.length < 2) return;
      const slot = document.createElement("div");
      slot.className = "ad-wrap ad-mid ad-feed";
      slot.dataset.ad = panel.dataset.adFeed;
      slot.innerHTML = '<div class="ad-slot"></div>';
      host.insertBefore(slot, blocks[Math.max(1, Math.floor(blocks.length / 2))]);
    });
  }

  function start() {
    drawButtons();
    placeFeeds();
    budgetAds();
    fillAds();
    drawSyncedCard();
    // Anything a page writes later (a redrawn season view, the team history
    // drawer) gets its slots as it appears. A MutationObserver's callback
    // runs before the next paint, so nothing is seen to move.
    new MutationObserver(() => {
      placeFeeds();
      budgetAds();
      if (document.querySelector(".ad-slot:not([data-filled])")) fillAds();
    }).observe(document.body, { childList: true, subtree: true });
    // The budget follows the page's height, which also changes without any
    // new content: a phone turned on its side, fonts and images settling, a
    // table re-sorting. Rechecked on the next frame whenever the page resizes.
    // Settling the budget can resize it again, but only once: a second pass
    // measures the same content and changes nothing.
    let queued = false;
    const rebudget = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; budgetAds(); fillAds(); });
    };
    // a phone's browser bar sliding in and out changes only the height
    let lastWidth = innerWidth;
    addEventListener("resize", () => { if (innerWidth !== lastWidth) { lastWidth = innerWidth; rebudget(); } });
    if (window.ResizeObserver) new ResizeObserver(rebudget).observe(document.body);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  /* An invite link (?invite=), or the way back from paying for a League Pass
     (?pass=&paid=1): both come off the address once read. */
  (function arrivals() {
    const params = new URLSearchParams(location.search);
    const invite = params.get("invite");
    const passId = params.get("paid") === "1" ? params.get("pass") : null;
    if (invite || passId) {
      const clean = new URL(location.href);
      ["invite", "pass", "paid"].forEach((k) => clean.searchParams.delete(k));
      history.replaceState(history.state, "", clean.href);
    }
    if (invite && /^[A-Za-z0-9_-]{6,64}$/.test(invite)) store.set(INVITE_KEY, invite);
    const pending = store.get(INVITE_KEY);
    const go = () => {
      if (passId) afterCheckout(passId);
      else if (typeof pending === "string" && pending) ready.then(() => showInvite(pending));
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
    else go();
  })();

  const api = {
    mode: MODE,
    ready,
    get user() { return state.user; },
    get profile() { return state.profile; },
    get leagues() { return state.leagues.slice(); },
    get plan() { return plan(); },
    get isPro() { return isPro(); },
    pricing: PRICING,
    admit,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    accessToken: () => (state.user && backend.accessToken ? backend.accessToken() : Promise.resolve(null)),
    openSignIn: (opts) => openAuth("signin", opts),
    openSignUp: (opts) => openAuth("signup", opts),
    openPanel,
    upgrade,
    signOut,
    openLeaguePass: (league) => openLeaguePass(league || null),
    get passes() { return state.passes; },
    leaguePass: LEAGUE,
  };
  window.Account = api;
})();
