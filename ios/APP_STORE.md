# App Store submission

What the app does for App Review, what still has to happen outside Xcode,
and what to type into App Store Connect. Checked against the App Review
Guidelines of June 8, 2026.

## In the app

| Guideline | What the app does |
| --- | --- |
| 5.1.1(v) account deletion | Account ▸ Delete Account deletes the Supabase user (`delete_my_account()`), which cascades to the profile, synced leagues, saved ESPN keys, chat usage and League Pass rows |
| 5.1.1(v) no needless sign-in | Any league opens without an account. An account only syncs leagues, saves ESPN keys to the account and unlocks Ask the League (`Supabase.requireAccount` is `false` in the app) |
| 5.1.1(i) privacy policy | Privacy Policy, Terms of Service and Support in the Account screen's About section, under the sign-up button, and in the home screen's footer (`App/Legal.swift`) |
| 5.1.2(i) third-party AI | Ask the League asks before the first question goes out, naming Google Gemini and Anthropic Claude and what is sent. The ⋯ menu turns it off again |
| 1.2 / generative AI | Long-press an answer ▸ Report Answer: hides it and writes to support. Answers are labelled AI. The function's prompt and Gemini's safety settings rule out profanity, slurs and real-life insults |
| 3.1.1 purchases | No prices, plans, "Go Pro" or links to buy anything in the app. No In-App Purchase, so none may be added until StoreKit is. The bundled `account-config.js` is written without the site's plans, prices and payment links (`tools/app-account-config.sh`, a build phase) |
| 5.1.1 privacy manifest | `PrivacyInfo.xcprivacy`: no tracking, UserDefaults (CA92.1), the data types below (Product Interaction for the chat's daily counts) |
| 2.5.2 code | The site's JavaScript is bundled in the app and injected from the bundle; only `data/players.json` (data) is fetched |
| Info.plist | `ITSAppUsesNonExemptEncryption = NO`, `NSPhotoLibraryAddUsageDescription` for saving recap pictures |
| 5.2.1 | "Not affiliated with or endorsed by Sleeper, ESPN, the NFL or the NFLPA" in the footer and the About section |
| Debug | `DebugLaunch` and the `PP_HOME` launch settings only work in Debug builds |
| 5.3 / 1.4 the clubhouse | League pick'em and the week's awards are free bragging rights inside a league: no entry fee, no prizes, no stakes, no odds, no betting language. Picks are graded from the league's own results |
| 5.1.1(v) the clubhouse | Looking around never needs an account. Picking, voting and notifications ask the member to sign in and claim their team ("Which team is yours?"); the demo league shows the whole clubhouse without an account (picks and votes kept on the device) |
| 4.5.4 push | Notifications are opt-in per league (Leaderboard ▸ Notify me): every league's are off until the member turns one on there (`set_league_notifications` for that league only), and a device is registered to an account only after that account turned notifications on, on it. iOS is asked for permission only when the member turns one on, never at launch. Signing out takes the device off the account (`unregister_push_device`; offline, the app stops taking notifications and the next account signed in lets the token go) and clears what was delivered; deleting the account deletes its devices |

## Before submitting (outside Xcode)

1. **Put the legal pages live.** `privacy.html`, `terms.html` and `support.html` must be on pigskinpantheon.com (merge to `main`) before review: the app links to them.
2. **Make `support@pigskinpantheon.com` real** (a mailbox or a forward). The app, the privacy policy and the reports from Ask the League all send mail there.
3. **Run the migrations** `supabase/migrations/20261008000000_delete_account.sql` (or Delete Account fails), then `20261015000000_hardening.sql`, then `20261021000000_league_clubhouse.sql` (pick'em, awards, notifications).
4. **Deploy league-chat** (`supabase functions deploy league-chat --no-verify-jwt`) for the safety rules, after `20261015000000_hardening.sql`: the new function counts requests with it and answers "the account store didn't answer" without it.
5. **A review account.** Create an account with a confirmed email for App Review and put it in the notes, plus a Sleeper username with leagues.
6. **Push Notifications.** In the Apple Developer portal (Certificates, Identifiers & Profiles ▸ Identifiers ▸ com.pigskinpantheon.app) turn on Push Notifications, then make an APNs key (Keys ▸ +, Apple Push Notifications service) and give the push sender its key id, team id (8ZU74SXSMG) and the .p8 file. Then put `aps-environment` (development) back in the app's `PigskinPantheon.entitlements`: it's commented out there for now, because a free (personal) developer team can't sign an app that asks for push (Xcode signs App Store and TestFlight builds for production on its own). The app registers its token for the APNs environment its provisioning profile names (`aps-environment` in `embedded.mobileprovision`: development → `sandbox`, so a Release build run from Xcode works too); App Store and TestFlight builds, which carry no profile, register as `production`.
7. **Gemini's free tier** can't serve people in the EEA, UK or Switzerland, and Google may use what it's sent to improve its products. Either move to a paid key or leave those storefronts out under Pricing and Availability.

## App Store Connect

- **Privacy Policy URL**: https://pigskinpantheon.com/privacy.html
- **Support URL**: https://pigskinpantheon.com/support.html
- **Category**: Sports. **Name / subtitle / keywords**: no "Sleeper", "ESPN" or "NFL" (2.3.7, 4.1(c)).
- **App Privacy**: no tracking. Collected, linked to the user, for App Functionality:
  - Contact Info ▸ Email Address, Name
  - Identifiers ▸ User ID
  - User Content ▸ Other User Content (questions for Ask the League, sent to Google and Anthropic; the clubhouse: the team a member claims in a league, their pick'em picks and award votes, shown to the league's other members)
  - Usage Data ▸ Product Interaction (each day's count of Ask the League questions and requests, `chat_usage`, for its daily allowance)
  - Other Data (Sleeper username, league ids, ESPN keys saved to the account, the device's push token once notifications are on)
- **Age rating**: no social media, no unrestricted web access, no gambling, no ads. Answer the chatbot / user-generated content questions honestly (the AI can be asked anything, filtered as above).
- **Encryption**: answered by the Info.plist key (standard HTTPS only).
- **DSA trader status**: declare it, or the EU storefronts drop the app.
- **Screenshots**: iPhone 6.9" (1320 × 2868) and iPad 13" landscape (2752 × 2064), from the demo league. Both sets are in `ios/store/screenshots`.

## Notes for App Review (paste and fill in)

> Pigskin Pantheon shows the history of a fantasy football league from Sleeper or ESPN: every season's results, standings and playoffs, an all-time record book, player cards and a 3D trophy room, all drawn natively in SwiftUI and SceneKit.
>
> No account is needed to look around: tap "Explore the demo league" on the first screen, or enter the Sleeper username ____ to open real leagues. An account is only needed to save leagues and to use Ask the League, the AI chat (league icon ✨ at the top of a league).
>
> Review account: ____ / ____
>
> The demo league also shows the clubhouse: on Week 9's Matchups, pick the winners (league pick'em, free bragging rights, no stakes or prizes); a played week's Recap has the league's weekly awards to vote on and "Share the week". Notifications are off until a member turns them on for one of their own leagues.
>
> Ask the League asks for permission before it shares anything with Google Gemini or Anthropic Claude. Answers can be reported by long-pressing them. Account ▸ Delete Account deletes the account and everything saved to it.
>
> The app is not affiliated with Sleeper, ESPN, the NFL or the NFLPA. It reads Sleeper's public API and ESPN's fantasy API on the user's device. There are no purchases or ads.

## Still a judgement call

- **Pictures.** Player headshots come from Sleeper's and ESPN's CDNs, and team avatars are whatever managers uploaded (some are NFL logos). A reviewer could raise 5.2.1. Initials in place of headshots would take that off the table.
- **ESPN.** The app reads ESPN's unofficial fantasy API. Private leagues need the member's ESPN cookies, copied on a computer. That's allowed, but if a reviewer pushes back, hiding private ESPN for v1 is the fallback.
- **Sleeper's API** is "free to use for non-commercial purposes". Ask Sleeper before turning on plans or ads.
- **Plans later.** In-app unlocks need In-App Purchase (15% on the Small Business Program). On the US storefront only, a link to Stripe checkout is allowed since May 2025 (Epic v. Apple).
