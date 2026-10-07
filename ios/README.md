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
  open league, like a browser tab. It loads `account-config.js`,
  `sleeper.js`, `espn.js`, `demo.js`, `insights.js` and `chat.js` straight
  from the repository root, unchanged, so the app reads Sleeper and ESPN
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
(`App/DebugLaunch.swift`):

    SIMCTL_CHILD_PP_LEAGUE=demo SIMCTL_CHILD_PP_TAB=records \
      xcrun simctl launch booted com.pigskinpantheon.app

`PP_TAB` (season, records, office, trophy, search), `PP_ROUTE`
(`player:<id>`, `team:<year>:<teamId>`, `manager:<ownerId>`,
`box:<year>:<week>:<a>:<b>`), `PP_WEEK`, `PP_VIEW` (a panel id such as
`panel-standings`), `PP_SHEET` (chat, account) and `PP_RAIL=1` (force the
side rail).

## The app icon

`tools/make-app-icon.swift` builds it from `icons/crest-master.png`:

    swiftc -o /tmp/make-app-icon ios/tools/make-app-icon.swift && /tmp/make-app-icon
