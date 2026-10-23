# ESPN sign-in: the plan

## Status

Built, on branch `feat/espn-sign-in`:

- **iOS "Sign in with ESPN"** (Phase 1): ESPN's own page in a sheet with an
  in-memory cookie store, the key-pasting fields gone, keys mirrored to the
  Keychain, `PP_SHEET=espn` and `PP_ESPN_FAKE=1` for the simulator.
- **The Pigskin Pantheon Connect extension** (Phase 2): `extension/`, the
  front page's rebuilt private panel, `espn.js` copy, `tools/pack-extension.sh`.
  A hidden "Enter keys by hand" fallback stays on desktop web until a store
  link is set.
- **Copy and policy** (Phase 3): `support.html`, `privacy.html`,
  `README.md`, the front page's FAQ, `ios/README.md`, `ios/APP_STORE.md`,
  `ios/store/metadata.md`.

**A real sign-in works in the app** (2026-10-22, iPhone simulator, MyDisney
email sign-in): the sheet closed by itself, the keys were saved and the
league was listed. What it took:

- `https://www.espn.com/login` is OneID **v2**. Signing in there in a web
  view never reached ESPN's cookies: no `espn_s2`, and OneID logged
  "Session not established" on the next page. The page also sends you
  to espn.com whether you signed in or closed the box.
- `https://www.espn.com/fantasy/football/` is OneID **v4** (MyDisney),
  which works. A user script calls `window.did.launchLogin()`, retrying
  every half second while it rejects (OneID starts after `did` exists),
  and posts OneID's `login` / `close` to the app.
- The cookie store is read on the observer, after every page load, every
  second, and on OneID's `login`. Keys are taken when two reads in a row
  agree and `SWID` is a real `{GUID}`.

**A real sign-in works through the extension too** (2026-10-22, Chrome,
localhost:8765): Connect ESPN opened MyDisney over ESPN's fantasy page, and
the tab closed and the site connected once signed in. What it took:

- The sign-in tab opens `https://www.espn.com/fantasy/football/#pp-connect`;
  `espn-login.js` (world MAIN, only in a tab with that mark) calls
  `did.launchLogin()` as soon as the page is ready.
- On a computer ESPN writes `espn_s2` and `SWID` from its page's own script
  after MyDisney signs in, and Chrome doesn't report such cookies to
  `cookies.onChanged` (or list them in `getAll`); only `cookies.get` finds
  them. So while a sign-in waits the keys are looked for every 1.5 seconds
  and when the tab loads, and taken when two looks agree.

Left:

1. **Firefox** (desktop, then Android): a real sign-in, and the rest of the
   Testing checklist below. Remove `http://localhost:8765` from the
   Supabase `ALLOWED_ORIGINS` secret when local testing is done.
2. **Publish the extension** (Publishing, below): Chrome Web Store and
   Firefox Add-ons, then set `ESPN_EXTENSION_CHROME` and
   `ESPN_EXTENSION_FIREFOX` (and `APP_STORE_URL`) in `account-config.js`.
3. **Remove the hand-entry fallback** once a store link is live: delete
   `#espnKeys`, `#espnByHandRow` and the "by hand" script in `index.html`.
4. Screenshots of the app's panel before and after connecting, for Charlie.

Today a private ESPN league opens only after the member copies the
`espn_s2` and `SWID` cookies out of a desktop browser's developer tools and
pastes them into the "Private league?" panel. On a phone that's impossible,
so the panel sends people to a computer.

This replaces the pasting with two sign-in methods, and they become the
**only** two ways to connect ESPN:

1. **iOS / iPadOS: "Sign in with ESPN" in the app.** ESPN's own sign-in
   page opens in a sheet; the member signs in as they always do; the app
   picks up the two cookies itself, closes the sheet and lists their
   leagues.
2. **Desktop web: the Pigskin Pantheon Connect browser extension.** One
   click on the site; the extension reads the two cookies from the
   browser (opening ESPN's sign-in first if needed) and hands them to the
   page.

Everything after the cookies are in hand already exists and doesn't change:
`ESPN.saveAuth` / `Bridge.finder.espnSave` keep them, the relay
(`supabase/functions/espn-proxy`) uses them, `espn_keys` holds them
encrypted for signed-in members, and `?action=leagues` lists the member's
leagues. Public leagues still open by ID with nothing to connect. Sleeper is
untouched.

Not in this plan: sharing one member's connection with the whole league,
asking for ESPN passwords (ESPN's reCAPTCHA blocks it, passcode-only
accounts have none, and holding Disney passwords is a liability), a
bookmarklet (`espn_s2` is HttpOnly, so page scripts can't read it), and an
iOS Safari extension.

## Why these two

From research on 2026-10-21. These are mostly community sources, not
ESPN's, so treat them as leads to check:
[espn-api #150](https://github.com/cwendt94/espn-api/discussions/150)
(reCAPTCHA ended password login),
[ffscrapr's ESPN auth notes](https://cran.r-project.org/web/packages/ffscrapr/vignettes/espn_authentication.html),
[Sleeper's import help](https://support.sleeper.com/en/articles/16203584-how-to-import-your-league-to-sleeper)
(desktop Chrome extension only),
[a WKWebView ESPN login](https://github.com/gfarrenkopf/fantasy-football-war-room/pull/97),
[another](https://github.com/alexdiabmusic-stack/StadiaTV-iOS/pull/114),
[Apple on ASWebAuthenticationSession cookies](https://developer.apple.com/forums/thread/774380).

- `espn_s2` and `SWID` are the whole of ESPN's private-league auth: no
  OAuth, no API keys, no partner program. `espn_s2` is a full session
  cookie and is HttpOnly.
- Every competitor that connects ESPN (Sleeper import, FantasyPros,
  Fantasy Footballers, Fantasy Record Book, FantasyHype) uses a **desktop
  browser extension** with the `cookies` permission. None has a mobile
  flow.
- A native app can read HttpOnly cookies from its own `WKWebView`'s
  `WKHTTPCookieStore`. Hobby projects do exactly this for ESPN
  (an embedded `https://www.espn.com/login`, cookie observer, close when
  `espn_s2` appears), the newest updated September 2026. That would make
  ours the only real mobile flow.
- `ASWebAuthenticationSession` and `SFSafariViewController` don't work:
  the app can't read their cookies, and ESPN won't redirect to us.
- Cookie lifetime is unclear (one probe saw ~400 days, another source says
  weeks). Both methods make reconnecting one tap, so either is fine.

## What a member sees

**iPhone / iPad app.** ESPN tab ▸ "Private league?" (or Account ▸ ESPN ▸
Connect ESPN, or the link on a private league's error) ▸ **Sign in with
ESPN** ▸ ESPN's page in a sheet ▸ they sign in (email + password or the
emailed code) ▸ the sheet closes by itself ▸ "✓ ESPN connected" and their
ESPN leagues are listed. No league ID, nothing to copy. Signed in to a
Pigskin Pantheon account, the keys are saved to it too (the existing
toggle, on by default), so the website opens those leagues as well.

**Computer.** ESPN tab ▸ "Private league?" ▸ **Connect ESPN**:

- Extension installed: one click. If they're signed in to ESPN in that
  browser, done instantly. If not, an ESPN sign-in tab opens; when they
  finish, it closes and they're back on the site, connected, leagues
  listed.
- Not installed: "Add Pigskin Pantheon Connect to Chrome" (or Firefox,
  picked from the browser), then the button works on return.

**Phone or tablet browser.** There is no way to connect in a mobile
browser. The panel says: connect once in the Pigskin Pantheon app or on a
computer, signed in to your account, and private leagues open here too.
With an App Store link. Public leagues still work by ID.

**Keys go stale.** When the relay reports a set refused (`list.refused`,
or a private league failing with keys saved), the row says "ESPN signed
you out" with a **Sign in again** button that runs the same flow. The new
set replaces the old one (`saveAuth` already replaces by SWID).

## Phase 0: prove the iOS sign-in (half a day, do first)

The one real unknown is whether a full ESPN sign-in finishes inside a
`WKWebView`. Prove it before building anything else.

- [ ] Throwaway Debug-only view: a `WKWebView` with
      `WKWebsiteDataStore.nonPersistent()`, loading
      `https://www.espn.com/login`, printing every cookie on `.espn.com`
      from a `WKHTTPCookieStoreObserver`.
- [ ] Sign in on the **simulator and a real iPhone**, with:
      - [ ] email + password
      - [ ] the emailed one-time code
      - [ ] a fresh account that gets a reCAPTCHA or "verify it's you"
- [ ] Check: does `/login` show the form, or only ESPN's nav bar (one
      project saw that)? If so, try `https://fantasy.espn.com/football/`
      and the Disney OneID page it opens, and pick the URL that works.
- [ ] Check: does a Safari-style user agent matter? Try with
      `customUserAgent` unset, and with
      `applicationNameForUserAgent = "Version/26.0 Mobile/15E148 Safari/604.1"`.
- [ ] Check: are there "Continue with Google / Apple" buttons? Google
      refuses embedded web views (`disallowed_useragent`); if they're
      there, the sheet needs a line saying to use email.
- [ ] Check: does Password AutoFill offer saved espn.com passwords in the
      sheet? (Nice to have, not a blocker.)
- [ ] Note `espn_s2`'s Expires, HttpOnly and domain as the cookie store
      reports them, and confirm `SWID` exists *before* sign-in (so
      `espn_s2` is the signed-in signal).
- [ ] Feed the captured pair to `Bridge.finder.espnSave` and confirm
      `Bridge.finder.espnLeagues()` lists the leagues.

If the sign-in can't be finished in a web view, stop and rethink before
Phase 1. The extension (Phase 2) doesn't depend on this and can go ahead.

## Phase 1: iOS "Sign in with ESPN"

### New: `Features/Home/EspnSignIn.swift`

A sheet holding a `WKWebView` (`UIViewRepresentable`) and a small model.

- **Data store:** `WKWebsiteDataStore.nonPersistent()`, a new one per
  sheet. Nothing mixes with the engine's `.default()` store, every
  sign-in starts signed out (so "Add another ESPN account" just works),
  and nothing outlives the sheet. Clear it explicitly on close anyway.
- **Start URL:** one constant (`EspnSignIn.start`), whatever Phase 0
  settled on. User agent per Phase 0.
- **Detection:** a `WKHTTPCookieStoreObserver`; on every change,
  `getAllCookies`, keep domain `espn.com` / `.espn.com`, take `espn_s2`
  and `SWID`. Only `espn_s2` present means signed in. Debounce ~0.5s so
  a half-written pair isn't read.
- **Then:** `Bridge.finder.espnSave(s2, swid, toAccount)` (toAccount = the
  member is signed in and the toggle is on), dismiss, `drawPrivate()`,
  `loadEspnLeagues(force: true)`, and the note "✓ ESPN connected. Your
  ESPN leagues are listed below." If the finder has a league ID typed,
  open it as `saveKeys` does now.
- **Navigation:** allow main-frame navigations on `espn.com`, `go.com`,
  `disney.com`, `disneyplus.com` and their subdomains (OneID lives on
  `registerdisney.go.com` / `cdn.registerdisney.go.com`); open anything
  else (help links, ESPN app store links) in Safari. Don't filter
  subresources (reCAPTCHA loads from google.com / gstatic.com). In Debug,
  log every main-frame host so the list is easy to tune.
- **Chrome:** a nav bar with "Sign in to ESPN", a Cancel button, a
  progress bar, and under it one line: "Sign in on ESPN's own page.
  Pigskin Pantheon never sees your password; it keeps only the two keys
  ESPN uses to open your leagues." Full-height sheet on iPhone; on iPad
  (landscape) `.presentationSizing(.form)` or a large form sheet.
- **Failures:** the page fails to load → "ESPN's sign-in page didn't
  load. Try again." with Retry; the member closes without signing in →
  nothing happens.
- `isInspectable` in Debug, as in `LeagueEngine.swift`.

### Keys that survive iOS clearing web storage

Today the keys live only in the engine web view's `localStorage`
(`lh-espn-auth`), which iOS can evict. Mirror them into the Keychain:

- [x] Add a second Keychain service (`com.pigskinpantheon.espn`) next to
      the account's `enum Keychain` in `Features/Account/AccountStore.swift`,
      holding the JSON list of `{s2, swid}`.
- [x] Write it after every successful `espnSave` and `espnForget`.
- [x] New `Bridge.finder.espnRestore(list)` in `Engine/bridge-finder.js`
      (calls `ESPN.saveAuth` for each set not already there), run once
      when the engine starts (`LeagueEngine` after the page loads, next to
      the session hand-off).
- [x] Account deletion and "Forget" clear the Keychain item too.

### Change: `Features/Home/FinderViews.swift` and `FinderModel.swift`

- [x] `PrivatePanel`: remove `keyFields` (the three dev-tools steps, the
      `SecureField("espn_s2")`, the SWID field, Save) and `desktopSteps`
      (the "continue on a computer" steps and ShareLink). In their place:
      a short line ("Sign in to ESPN once and your private leagues open
      here.") and a prominent **Sign in with ESPN** button, plus the
      existing "Also save to my account" toggle when signed in.
- [x] "Add another ESPN account" opens the sheet instead of the fields.
- [x] Refused rows: "ESPN signed you out" + **Sign in again** (opens the
      sheet) in place of "copy them again".
- [x] `FinderModel`: drop `s2`, `swid`, `keysAnyway`, `showDesktop`,
      `showKeyFields`; add `signInOpen` and `didSignIn(s2:swid:)`
      (today's `saveKeys` body, minus the field clearing).
      `toggleSubtitle` loses "A one-time setup on a computer…" →
      "Sign in to ESPN to open private leagues and list all your ESPN
      leagues here."
- [x] Rewrite `fine` without "These keys work like your ESPN
      password… keep them to yourself" (nobody handles them any more):
      what's kept, where, what it's used for, Forget, signing out of ESPN.
- [x] The wrong-ID error's `pp://private` link and the private-league
      error link in the league screens open the panel with the sheet
      ready.

### Change: `Features/Account/AccountScreen.swift`

- [x] `espnSection`: "Connect ESPN" / "Add another ESPN account" open the
      sign-in sheet directly; the no-keys text (line ~212) loses the
      "on a computer" wording.

### Debug and screenshots

- [x] `PP_SHEET=espn` opens the sign-in sheet (`App/DebugLaunch.swift`,
      and the list in `ios/README.md`).
- [ ] Screenshots for Charlie: iPhone portrait and iPad **landscape**, the
      panel before and after connecting, with the demo league
      (`PP_LEAGUE=demo`). Don't put a real ESPN account's leagues in
      anything meant for anyone else.

## Phase 2: the browser extension

### Where it lives

`extension/` at the repo root, plain JavaScript, no build step (like the
site). Note GitHub Pages serves the repo root, so these files are public on
pigskinpantheon.com/extension/; that's harmless, but don't put signing keys
or store credentials there. `tools/pack-extension.sh` zips it per store.

```
extension/
  manifest.json      MV3; Chrome, Edge, Brave, Arc, Firefox
  background.js      reads the cookies; runs the sign-in tab
  content.js         the bridge on pigskinpantheon.com
  icons/             16, 32, 48, 128
  README.md          what it does, how to load it unpacked, store notes
```

### `manifest.json`

- `permissions`: `cookies`, `scripting`.
- `host_permissions`: `https://*.espn.com/*` (cookies),
  `https://pigskinpantheon.com/*`, `https://www.pigskinpantheon.com/*`.
- `content_scripts`: `content.js` on the two pigskinpantheon.com patterns
  only. A dev copy adds `http://localhost:8765/*` (the pack script strips
  it from store builds).
- `background`: `service_worker: "background.js"` for Chromium,
  `scripts: ["background.js"]` for Firefox (one manifest can carry both;
  Firefox ignores the first, Chrome warns about the second; or let the
  pack script write each store's).
- `browser_specific_settings.gecko.id` for Firefox.
- No popup, no options page, no remote code.

### The handshake (page ⇄ content script ⇄ background)

- `content.js` marks the page as having the extension:
  `document.documentElement.dataset.ppConnect = "<version>"`, and fires a
  `pp-connect-ready` event (the page may already be loaded).
- Page asks: `window.postMessage({ pp: "espn-connect", id }, location.origin)`.
- `content.js` only accepts `event.source === window` and
  `event.origin === location.origin`, then
  `chrome.runtime.sendMessage({ type: "espn-keys" })`.
- `background.js`:
  1. `chrome.cookies.get({ url: "https://www.espn.com/", name: "espn_s2" })`
     and the same for `SWID`.
  2. Both there → answer `{ s2, swid }`.
  3. No `espn_s2` → open `https://www.espn.com/login` in a new tab next to
     the site's, watch `chrome.cookies.onChanged` for `espn_s2` being set
     on `espn.com`, then close that tab, focus the site's tab, and answer.
     The member closing the ESPN tab first → answer `{ cancelled: true }`.
     Give up after 10 minutes.
  4. Only ever answer the tab that asked (`sender.tab.id`), and only
     senders whose URL is one of the content-script origins.
- `content.js` posts the answer back with the same `id`.
- `chrome.runtime.onInstalled`: inject `content.js` into already-open
  pigskinpantheon.com tabs with `chrome.scripting.executeScript`, so the
  "I added it" moment works without a reload.

The extension never stores the cookies, never sends them anywhere but the
asking page, and reads nothing but those two cookies.

**Firefox notes:** MV3 host permissions are opt-in on Firefox, so the
first Connect may need `browser.permissions.request` from the click (the
page's click can't grant it; the background can open a one-line
"Allow access to espn.com" extension page on first use). Containers or
first-party isolation can put ESPN's cookies in another store: pass the
asking tab's `cookieStoreId` as `storeId`.

### Change: `index.html` (the ESPN tab's private panel)

- [x] Remove `#espnKeys` (dev-tools steps, `#espnS2`, `#espnSwid`,
      `#espnSave`) and `#espnDesktop` / "Have your keys already?" and their
      script (`keysAnyway`, the save handler, `#espnCopyLink`).
- [x] Add one block with three states, chosen in `drawPrivate`:
      - **extension present** (`dataset.ppConnect`): **Connect ESPN**.
        Click → postMessage → `ESPN.saveAuth(s2, swid)` → `toAccount` if
        signed in and the box is ticked → `drawPrivate()` →
        `loadEspnLeagues({ force: true })` → "✓ ESPN connected…". While
        waiting on an ESPN sign-in tab: "Finish signing in on the ESPN
        tab…" and a Cancel.
      - **desktop, no extension:** "Add Pigskin Pantheon Connect to
        Chrome" (Firefox build on Firefox; Edge uses the Chrome store),
        one line on what it does, and the Connect button appearing by
        itself when `pp-connect-ready` fires. Safari: "Safari isn't
        supported yet: connect once in Chrome, Firefox or the iPhone
        app, signed in to your account, and it opens here too."
      - **touch device:** the "connect in the app or on a computer, signed
        in" note with the App Store link.
- [x] "+ Add another ESPN account": the extension can only read the ESPN
      account the browser is signed in to, so it says "Sign out of ESPN in
      this browser, sign in to the other account, then Connect again."
      (The app's sign-in sheet doesn't have this problem.)
- [x] Refused rows: "ESPN signed you out" + **Connect again**.
- [x] Rewrite `#espnFine` as in the app.
- [x] The `#espnToAccountBox` choice stays.

### Change: `espn.js`

- [x] `privateError` copy: no "copy espn_s2 and SWID again". Desktop: "This
      ESPN league is private. Connect ESPN on the front page to open it."
      Touch: "Connect ESPN once in the Pigskin Pantheon app or on a
      computer, signed in to your account, and it opens here too."
      Stale keys: "ESPN signed you out. Connect ESPN again on the front
      page." `linkText` to match ("Connect ESPN").
- [x] Keep `saveAuth`, `tidyAuth`, `savedAuths`, `accountKeys` as they are:
      they're the sink for both methods, and keys pasted before this
      change keep working.

### Publishing

- [ ] Chrome Web Store: developer account ($5 once), listing, privacy
      practices form, single-purpose statement ("connects your ESPN
      fantasy league to Pigskin Pantheon"), justification for `cookies`
      and each host permission. Expect a slower review for a cookies
      extension; submit early.
- [ ] Firefox Add-ons (AMO): same zip with the Firefox manifest; source is
      plain so no source upload is needed.
- [ ] Edge Add-ons: optional, the Chrome store already installs on Edge.
- [ ] Store links go in `account-config.js` (`ESPN_EXTENSION_CHROME`,
      `ESPN_EXTENSION_FIREFOX`) so the page doesn't hard-code them.
- [ ] Safari on the Mac is later: it needs a Safari Web Extension inside a
      macOS app (Xcode's converter, Mac App Store). Not in this plan.

## Phase 3: copy, policy, and review (ship with whichever lands last)

Don't remove the paste fields on the web until the extension is live in
the stores, or desktop web has no way in at all. The iOS app can drop them
as soon as Phase 1 ships.

- [x] `support.html` (ESPN help, ~lines 123, 143–153): the two methods;
      drop the dev-tools steps.
- [x] `privacy.html` `#espn-keys`: the app's sign-in page (ESPN's page;
      we keep only `espn_s2` and `SWID` and discard the rest, the web
      view's data is wiped when it closes) and the extension (reads only
      those two cookies, only when you click Connect, only for this
      site). Check `PrivacyInfo.xcprivacy` still matches (same data, now
      also in the Keychain).
- [x] `README.md` "Public and private ESPN leagues": the two methods, and
      a pointer to `extension/README.md`.
- [x] `ios/README.md`: `PP_SHEET=espn`.
- [x] `ios/APP_STORE.md` "Still a judgement call ▸ ESPN": private leagues
      now connect through ESPN's own sign-in page in the app; the keys go
      to the account only if the member chooses; Account ▸ Forget and
      Delete Account remove them. Guideline 5.1.1(v) ("credentials or
      tokens to social networks" off the device) arguably doesn't cover
      ESPN, but say plainly in the review notes what's stored. Hiding
      private ESPN stays the fallback.
- [x] `ios/store/metadata.md` lines ~77–78: no "keys ESPN stores in your
      web browser".
- [x] `sw.js`: bump `CACHE_VERSION` (index.html and espn.js are precached;
      support.html and privacy.html are not). Bumped to v120 with the
      extension commit; bump again when a store link goes into
      `account-config.js`.
- [x] `node tools/check-scripts.mjs`.

## Testing checklist

- [ ] App: connect on iPhone (simulator + device) and iPad landscape; the
      leagues list appears; a private league opens; Forget removes it from
      the Keychain, the engine and the account.
- [ ] App: kill the app, clear the engine's web data (or reinstall with the
      Keychain kept), relaunch: private leagues still open.
- [ ] App, signed in: connect on the phone, then open the website on a
      computer signed in to the same account: the private league opens
      with no extension.
- [ ] App: two ESPN accounts via "Add another"; both listed.
- [ ] Extension: Chrome, Edge and Firefox, unpacked against
      `http://localhost:8765`; signed in to ESPN already, and signed out
      (the sign-in tab path); closing the ESPN tab cancels cleanly.
- [ ] Extension: a page on any other origin can't get an answer (try
      postMessage from a different localhost port).
- [ ] Extension installed while the site is open: the Connect button
      appears without a reload.
- [ ] Stale keys: corrupt a saved `espn_s2` and confirm the refused row and
      the private-league error both lead to one-tap reconnect.
- [ ] Phone browser: the panel shows the app/computer note and nothing to
      type.
- [ ] Keys pasted before this change still open their leagues.

## Open questions

- Firefox for Android supports extensions: worth listing the extension for
  it so Android members have a way in? (Small, since the code is the
  same; Chrome on Android has no extensions.)
- Safari on the Mac: wait for demand?
- Extension name and icon: "Pigskin Pantheon Connect" with the crest?
