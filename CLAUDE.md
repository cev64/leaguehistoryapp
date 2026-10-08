# Pigskin Pantheon

A static website (repo root, served by GitHub Pages at pigskinpantheon.com)
and a native SwiftUI iOS/iPadOS app (`ios/`) that runs the site's own
JavaScript. Supabase (`supabase/`) is the only server. Read `README.md`
and `ios/README.md` before changing anything.

## Commands

- Site locally: `python3 -m http.server 8765`, then http://localhost:8765
- Check every page's inline script parses: `node tools/check-scripts.mjs`
- After changing `season.html`: `python3 ios/tools/sync_engine.py`
- Try a bridge function without the app: `node ios/tools/bridgetest.js demo 'Bridge.season.week(2026, 9)'`
- Build the app: `cd ios && xcodebuild -project PigskinPantheon.xcodeproj -scheme PigskinPantheon -configuration Debug -destination 'generic/platform=iOS Simulator' build`
  (the scheme's default is Release; the `PP_*` launch settings in `ios/README.md` only work in Debug)

## Conventions

- **Show Charlie screenshots** of the app for every iOS change (he's often working remotely).
- **iPad is always landscape.** Rotate the iPad simulator to landscape before testing or taking any screenshot, including App Store screenshots (iPad 13" landscape: 2752 × 2064). iPhone is portrait.
  `simctl` can't rotate a simulator, and an iPad app that supports multitasking can't force its own orientation. Scripting Cmd+← in DeviceHub needs Accessibility permission for the terminal, so if it isn't granted, ask Charlie to rotate the iPad simulator once (it stays rotated while booted).
- Use the demo league (`PP_LEAGUE=demo`) for screenshots meant for anyone else, never a real member's league.
- Bump `CACHE_VERSION` in `sw.js` when a file in its precache list changes.
- Push and deploy (GitHub Pages, Supabase migrations and functions) only when Charlie asks. Never force push.

## App Store rules the app follows

`ios/APP_STORE.md` has the full list. Don't undo these without a plan for review:

- No prices, plans, "Pro", "upgrade" or purchase links in the app. In-app unlocks need In-App Purchase (StoreKit).
- Any league opens without an account (`Supabase.requireAccount` is `false` in the app).
- Ask the League sends nothing before the member allows it (`aiConsent.v1`). Name any new AI provider in `App/Legal.swift` and the privacy policy.
- Account deletion stays in the app (Account ▸ Delete Account).
- New data collected or a new required-reason API goes in `ios/PigskinPantheon/PrivacyInfo.xcprivacy` and `privacy.html`.
- The site's JavaScript is bundled in the app, never loaded from the network.
