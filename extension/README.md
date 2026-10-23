# Pigskin Pantheon Connect

The browser extension that connects a private ESPN league to Pigskin
Pantheon on a computer. A private league opens with two cookies ESPN keeps
once you're signed in, `espn_s2` and `SWID`. `espn_s2` is HttpOnly, so the
site's own scripts can't read it, and copying it out of the developer tools
is no way to ask a member to sign in. The extension reads the two cookies
when the member clicks **Connect ESPN** on pigskinpantheon.com and hands
them to that page, which saves them as before (`ESPN.saveAuth`, and to the
account if the member is signed in). See `ESPN_SIGN_IN.md` for the plan.

Chrome, Edge, Brave, Arc and other Chromium browsers (Manifest V3), and
Firefox (desktop and Android). Safari isn't supported: it would need a
Safari Web Extension inside a macOS app.

Plain JavaScript, no build step, no popup, no options page, no remote code.

| File | What it does |
|---|---|
| `manifest.json` | The dev manifest: also runs on `http://localhost:8765` and carries both background keys. `tools/pack-extension.sh` writes each store's |
| `background.js` | Reads the two cookies; opens ESPN's sign-in in a tab when they're missing and answers when ESPN sets `espn_s2` |
| `content.js` | The bridge on the site's pages: marks the page, carries its ask to the background and the answer back |
| `grant.html`, `grant.js` | Asks for access to espn.com and the site from a click, when the browser has held it back (Firefox lets a member switch it off) |
| `icons/` | 16, 32, 48 and 128, from `icons/icon-512.png` (`sips -z`) |
| `test/handshake.test.mjs` | `node extension/test/handshake.test.mjs`: the background and content script against a mocked browser |

## How it works

1. `content.js` runs on `https://pigskinpantheon.com/*` and
   `https://www.pigskinpantheon.com/*` only. It sets
   `document.documentElement.dataset.ppConnect` to its version and fires
   `pp-connect-ready` on `document`. When the extension is added while the
   site is open, `background.js` injects it into the open tabs
   (`runtime.onInstalled` + `scripting.executeScript`), so the Connect
   button appears without a reload.
2. The page asks from a click:
   `window.postMessage({ pp: "espn-connect", id }, location.origin)`.
   `content.js` takes only messages with `event.source === window` and
   `event.origin === location.origin`, and only while the page has a user
   activation (a script can't ask on its own), and sends
   `{ type: "espn-keys", id }` to the background.
3. `background.js` answers only its own content script in the top frame of
   a tab whose URL (and, in Chromium, `sender.origin`) is one of the
   content script's origins. It reads `espn_s2` and `SWID` with
   `cookies.get({ url: "https://www.espn.com/", name })` in the asking
   tab's cookie store (Firefox: its container's `cookieStoreId`; Chromium:
   the store holding the tab, so incognito works).
   - Both there: `{ s2, swid }` at once.
   - No `espn_s2`: ESPN's fantasy page (`https://www.espn.com/fantasy/football/`)
     opens in a tab next to the site's (and in its container), and once it
     has loaded, `launchLogin()` runs in the page (`world: "MAIN"`) to open
     MyDisney's sign-in over it, as ESPN's own Log In does. (The fantasy
     page's OneID is v4; `espn.com/login` is v2, whose sign-in never reached
     ESPN's cookies in the iOS app's web view.) When `cookies.onChanged` sees
     `espn_s2` set on espn.com in that store, the ESPN tab closes, the
     site's tab comes back to the front, and the keys go to it.
   - The member closes the ESPN tab: `{ cancelled: true }`. The page's
     Cancel closes the tab and does the same.
   - Ten minutes pass: `{ timedOut: true }`.
4. `content.js` posts the answer back with the same `id`:
   `{ pp: "espn-connect-answer", id, s2, swid }` (or `cancelled`,
   `timedOut`, `needsAccess`, `error`). Before that: `espn-connect-ack`
   at once, and `espn-connect-waiting` (`on: "login"`) when a tab opened.

The page side is `ESPN.extension` in `espn.js` (`present()`, `onReady()`,
`store()`, `connect()`, `cancel()`).

**What's kept.** Only which tab is waiting on which sign-in tab, in
`storage.session` (memory only, gone when the browser closes). A Chromium
service worker or Firefox event page is shut down after ~30 seconds idle,
which a member typing their password easily outlasts; every listener is
added at the top level and the waiting is read back from `storage.session`
when the cookie change wakes it, so the answer still arrives. The ten-minute
timer can die with the background, so it's also checked on every wake, and
`content.js` keeps its own.

The cookies are never stored, never logged, and never sent anywhere but
the tab that asked, and only while that tab is still on the site (in
Chromium, only to the very page that asked: `documentId`). Nothing but
those two cookies is read.

**What it can't do.** It reads the ESPN account this browser is signed in
to. To add another ESPN account, sign out of ESPN, sign in to the other one,
and Connect again. The trust boundary is the site's origin: any script
running on pigskinpantheon.com's own pages could ask during a click and
read the answer posted to the page. The user-activation check stops a
silent ask in the background, not a script the site itself loads, so keep
third-party scripts (ads, widgets) off the site's pages, or at least off
the front page.

## Load it unpacked

Serve the site: `python3 -m http.server 8765` from the repo root.

- **Chrome / Edge / Brave:** `chrome://extensions` (`edge://extensions`) ▸
  Developer mode ▸ Load unpacked ▸ pick `extension/`. Chrome warns that
  `background.scripts` and `browser_specific_settings` are unknown; that's
  the dev manifest carrying Firefox's keys, and harmless.
- **Firefox:** `about:debugging#/runtime/this-firefox` ▸ Load Temporary
  Add-on ▸ pick `extension/manifest.json`. If Firefox holds back the host
  permissions, the grant page opens; or allow them in about:addons ▸
  Pigskin Pantheon Connect ▸ Permissions.

Open http://localhost:8765 ▸ ESPN ▸ Private league? ▸ Connect ESPN.

`node extension/test/handshake.test.mjs` runs the background and content
script against a mocked browser (allowed and refused senders, the sign-in
tab, closing it, Cancel, the timeout, a background restart mid-sign-in).

## Packing and the stores

`sh tools/pack-extension.sh [out-dir]` writes `chrome/` and `firefox/`
(unpacked) and a zip of each, without localhost, to `out-dir` (default a
folder in `$TMPDIR`, so nothing built lands in the repo, which GitHub Pages
serves). Bump `version` in `manifest.json` for each submission.

Once a listing is live, put its link in `account-config.js`
(`ESPN_EXTENSION_CHROME`, `ESPN_EXTENSION_FIREFOX`) and bump `CACHE_VERSION`
in `sw.js`. The front page then offers "Add Pigskin Pantheon Connect to
Chrome / Firefox", and its "Enter keys by hand" fallback disappears (delete
`#espnKeys` and its script then).

**Chrome Web Store** (also installs on Edge, Brave, Arc; Edge Add-ons is
optional). Developer account ($5 once). Expect a slower review for an
extension with `cookies`; submit early.

- Single purpose: "Connects your ESPN fantasy league to Pigskin Pantheon."
- `cookies`: reads the `espn_s2` and `SWID` cookies on espn.com, which ESPN
  uses to open the member's private fantasy leagues, only when they click
  Connect ESPN on pigskinpantheon.com, and hands them to that page.
- `scripting`: injects the bridge script into pigskinpantheon.com tabs that
  were already open when the extension was installed, so it works without
  a reload.
- `storage`: `storage.session` only, for which tab is waiting on an ESPN
  sign-in tab, so the answer survives the service worker being shut down.
  No cookies are stored.
- Host `https://*.espn.com/*`: the cookies are on espn.com (and the
  sign-in tab opens there).
- Hosts `https://pigskinpantheon.com/*`, `https://www.pigskinpantheon.com/*`:
  the bridge script runs on the site's pages, and answers go only there.
- Remote code: none.
- Privacy practices: handles "Authentication information" (the two ESPN
  cookies), transferred only to pigskinpantheon.com at the member's
  request, for the single purpose; not sold, not used for anything else.
  Privacy policy: https://pigskinpantheon.com/privacy.html#espn-keys.

**Firefox Add-ons (AMO)**, desktop and Android, from the `firefox` zip. The
source is the plain files, so no source upload is needed. The manifest's
`browser_specific_settings.gecko` has the add-on id
(`connect@pigskinpantheon.com`), Firefox 140 or later (142 on Android, the
first to read `data_collection_permissions`), and
`data_collection_permissions.required: ["authenticationInfo"]` (the keys go
to pigskinpantheon.com, the developer's own service). Same permission notes
as above.
