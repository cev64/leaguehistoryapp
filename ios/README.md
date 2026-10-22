# Pigskin Pantheon for iPhone

The site, as a native iOS 26 app: every season, the record book, the front
office, player cards, the trophy room and Ask the League, drawn in SwiftUI
with Liquid Glass.

Open `ios/PigskinPantheon.xcodeproj` in Xcode 26 or later and run the
`PigskinPantheon` scheme. Set your team under Signing & Capabilities to run
on a device.

## How it's built

The app doesn't reimplement the site's league logic. It runs the site's own
JavaScript and draws what it answers natively.

- **The engine** (`PigskinPantheon/Engine/LeagueEngine.swift`) is a hidden
  `WKWebView` with the site's own address (`pigskinpantheon.com`), one per
  open league, like a browser tab. It loads `sleeper.js`, `espn.js`,
  `demo.js`, `insights.js`, `chat.js` and `clubhouse.js` straight from the repository root,
  unchanged, and `account-config.js` without its plans, prices and payment
  links (a build phase runs `tools/app-account-config.sh`; keep those
  between its "site only" lines). So the app reads Sleeper and ESPN
  exactly as the site does: the same requests, the same IndexedDB cache
  (finished seasons kept a month), the same ESPN relay and league AI, which
  accept it because its origin is the site's.
- **The season page's computations** (records as they stood each week,
  tiebreaks, clinch flags, playoff scenarios, power rankings, the week in
  review, strength of schedule) live inside `season.html`'s own script.
  `tools/sync_engine.py` copies those passages verbatim into
  `Engine/season-engine.js`. **Run it after changing `season.html`:**

      python3 ios/tools/sync_engine.py

- **The bridge** (`Engine/engine-core.js` and one `Engine/bridge-<screen>.js`
  per screen) is what Swift calls: `Bridge.season.week(2026, 8)`,
  `Bridge.records...`, `Bridge.office...`. Each returns plain JSON, which
  Swift decodes (`engine.call(T.self, "Bridge.x.y(a)", ["a": 1])`) and
  draws. Most bridge functions are lifted from the matching page so numbers
  and words match the site.
- **Accounts** are native (Supabase's auth and REST APIs, the session in the
  Keychain). The engine is handed the session through a stand-in for
  `account.js`'s `window.Account`, so `espn.js` can open private ESPN leagues
  with keys saved to the account and the league AI knows who's asking.
  Unlike the site, the app doesn't ask for an account to open a league
  (App Review 5.1.1(v)): signed out, any league opens without being
  synced; an account syncs it, saves ESPN keys and unlocks Ask the League.
- **Private ESPN leagues** connect with "Sign in with ESPN"
  (`Features/Home/EspnSignIn.swift`): ESPN's own sign-in page in a sheet,
  in a web view with a cookie store of its own that lives only as long as
  the sheet. Once ESPN sets `espn_s2` (a visitor who isn't signed in has
  only `SWID`), the app takes those two cookies, closes the sheet and
  saves them as the site does (`Bridge.finder.espnSave`: the engine's
  localStorage, and the account if the member chooses). The page stays on
  espn.com, go.com, disney.com and disneyplus.com; other links open in
  Safari. iOS can clear a web view's storage, so the keys on the device
  are copied to the Keychain too (`EspnKeychain`), and every engine page
  puts back any set it's missing when it starts
  (`Bridge.finder.espnRestore`).

`tools/bridgetest.js` runs the engine and every bridge in Node, for trying a
bridge function without the app:

    node ios/tools/bridgetest.js demo 'Bridge.season.week(2026, 9)'

## Layout: phones, iPads and the iPhone Duo

- **Phone**: a Liquid Glass tab bar (Season, Record Book, Front Office,
  Trophy Room, and Search on its own), glass toolbars, and on the season
  screen the week rail in glass along the bottom with the week's views at
  the top.
- **Wide screens** (an iPad, the unfolded iPhone Duo, which reports a
  regular size class like an iPad): the tabs become a sidebar that opens
  showing, headed by the league like the site's desktop panel and listing
  every season. Cards flow into columns as on the desktop site.
- **Wide but short compact screens** (the folded Duo's outer display, an
  iPhone turned sideways): the tabs become a column of glass down the side
  and the week rail runs down the other side. This follows Apple's
  "vertical bars" guidance for the Duo. Built with the iOS 27.1 SDK, the
  system draws its own bars vertically and the app's rail steps aside
  (`Features/League/SideRail.swift`).
- Folding and unfolding keeps your place: the season you're on carries over
  between the phone's Season tab and the sidebar's seasons.

## Opening a screen directly

For screenshots and checks, launch settings open the app on a screen
(`App/DebugLaunch.swift`, Debug builds only):

    SIMCTL_CHILD_PP_LEAGUE=demo SIMCTL_CHILD_PP_TAB=records \
      xcrun simctl launch booted com.pigskinpantheon.app

`PP_TAB` (season, records, office, trophy, search), `PP_ROUTE`
(`player:<id>`, `team:<year>:<teamId>`, `manager:<ownerId>`,
`box:<year>:<week>:<a>:<b>`), `PP_WEEK`, `PP_VIEW` (a panel id such as
`panel-standings`), `PP_SHEET` (chat, account, leaderboard, claim; or
`espn`, without `PP_LEAGUE`: the home screen's ESPN sign-in sheet) and
`PP_RAIL=1` (force the side rail). `PP_ESPN_FAKE=1` makes the ESPN
sign-in sheet set made-up keys itself once ESPN's page loads, so
capturing, saving and listing can be tried with no ESPN account (ESPN
turns them away, which shows the "ESPN signed you out" row; they're kept
on the device only, never sent to the account). Forget them afterwards:

    SIMCTL_CHILD_PP_SHEET=espn SIMCTL_CHILD_PP_ESPN_FAKE=1 \
      xcrun simctl launch booted com.pigskinpantheon.app For the demo's clubhouse:
`PP_CLUBHOUSE_ME=<owner id>` claims a team (`none` lets it go),
`PP_CLUBHOUSE_PICKS=r3*,r4` makes the pick week's picks (`*` the lock),
`PP_SHARE=1` opens a Recap's "Share the week" (the picture is also
written to the app's tmp folder as `week-share.png`), and `PP_PUSH=1`
turns notifications on at launch (and shows them signed out).

## The clubhouse

League pick'em, the week's awards, "Share the week" and notifications
(`Features/Clubhouse/`). The logic is the site's `clubhouse.js`, loaded
by the engine and read through `Engine/bridge-clubhouse.js`; the boards
come from Supabase's clubhouse functions (`ClubhouseAPI.swift`). The demo
league runs on the device. To try a notification on a simulator, launch
with `PP_PUSH=1` (allow it), then:

    xcrun simctl push booted com.pigskinpantheon.app ios/tools/clubhouse-push.apns

Tapping it opens the league at the week and view in its `link`.

Notifications are opt-in per league and per account (`App/PushCenter.swift`):
a league's switches are the account's `league_members.notify_*` for that
league (off until the member turns one on), and the device's token goes
to an account (`register_push_device`) only once that account has turned
notifications on, on this device; the accounts that have are kept in
UserDefaults (`pp-push-asked-users`). Signing out unregisters the token
with a freshened session; if the server can't be reached the app stops
taking notifications from APNs (`unregisterForRemoteNotifications`) and
the next account to sign in hands the token over and lets it go
(`pp-push-orphan`). Signed out, delivered notifications are cleared and
new ones aren't shown or followed. The token's APNs environment comes
from the embedded provisioning profile's `aps-environment` (development
→ `sandbox`); App Store builds have no profile (`production`); the
simulator is `sandbox`.

The demo's clubhouse is never "over": an open demo week locks, and its
awards close, at the next Thursday 8:15 PM ET from now (as the site's
demo does), so App Review and screenshots always see a live week.

## The app icon

`tools/make-app-icon.swift` builds it from `icons/crest-master.png`:

    swiftc -o /tmp/make-app-icon ios/tools/make-app-icon.swift && /tmp/make-app-icon

## Submitting to the App Store

`APP_STORE.md` has what the app does for App Review, the steps outside
Xcode (legal pages live, the support address, the delete-account
migration), the App Store Connect answers and notes for the reviewer.
