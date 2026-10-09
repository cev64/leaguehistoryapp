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
| 3.1.1 purchases | No prices, plans, "Go Pro" or links to buy anything in the app. No In-App Purchase, so none may be added until StoreKit is |
| 5.1.1 privacy manifest | `PrivacyInfo.xcprivacy`: no tracking, UserDefaults (CA92.1), the data types below |
| 2.5.2 code | The site's JavaScript is bundled in the app and injected from the bundle; only `data/players.json` (data) is fetched |
| Info.plist | `ITSAppUsesNonExemptEncryption = NO`, `NSPhotoLibraryAddUsageDescription` for saving recap pictures |
| 5.2.1 | "Not affiliated with or endorsed by Sleeper, ESPN, the NFL or the NFLPA" in the footer and the About section |
| Debug | `DebugLaunch` and the `PP_HOME` launch settings only work in Debug builds |

## Before submitting (outside Xcode)

1. **Put the legal pages live.** `privacy.html`, `terms.html` and `support.html` must be on pigskinpantheon.com (merge to `main`) before review: the app links to them.
2. **Make `support@pigskinpantheon.com` real** (a mailbox or a forward). The app, the privacy policy and the reports from Ask the League all send mail there.
3. **Run the migration** `supabase/migrations/20261008000000_delete_account.sql`, or Delete Account fails.
4. **Deploy league-chat** (`supabase functions deploy league-chat --no-verify-jwt`) for the safety rules.
5. **A review account.** Create an account with a confirmed email for App Review and put it in the notes, plus a Sleeper username with leagues.
6. **Gemini's free tier** can't serve people in the EEA, UK or Switzerland, and Google may use what it's sent to improve its products. Either move to a paid key or leave those storefronts out under Pricing and Availability.

## App Store Connect

- **Privacy Policy URL**: https://pigskinpantheon.com/privacy.html
- **Support URL**: https://pigskinpantheon.com/support.html
- **Category**: Sports. **Name / subtitle / keywords**: no "Sleeper", "ESPN" or "NFL" (2.3.7, 4.1(c)).
- **App Privacy**: no tracking. Collected, linked to the user, for App Functionality:
  - Contact Info ▸ Email Address, Name
  - Identifiers ▸ User ID
  - User Content ▸ Other User Content (questions for Ask the League, sent to Google and Anthropic)
  - Other Data (Sleeper username, league ids, ESPN keys saved to the account)
- **Age rating**: no social media, no unrestricted web access, no gambling, no ads. Answer the chatbot / user-generated content questions honestly (the AI can be asked anything, filtered as above).
- **Encryption**: answered by the Info.plist key (standard HTTPS only).
- **DSA trader status**: declare it, or the EU storefronts drop the app.
- **Screenshots**: iPhone 6.9" (1320 × 2868) and iPad 13" (2064 × 2752), from the demo league.

## Notes for App Review (paste and fill in)

> Pigskin Pantheon shows the history of a fantasy football league from Sleeper or ESPN: every season's results, standings and playoffs, an all-time record book, player cards and a 3D trophy room, all drawn natively in SwiftUI and SceneKit.
>
> No account is needed to look around: tap "Explore the demo league" on the first screen, or enter the Sleeper username ____ to open real leagues. An account is only needed to save leagues and to use Ask the League, the AI chat (league icon ✨ at the top of a league).
>
> Review account: ____ / ____
>
> Ask the League asks for permission before it shares anything with Google Gemini or Anthropic Claude. Answers can be reported by long-pressing them. Account ▸ Delete Account deletes the account and everything saved to it.
>
> The app is not affiliated with Sleeper, ESPN, the NFL or the NFLPA. It reads Sleeper's public API and ESPN's fantasy API on the user's device. There are no purchases or ads.

## Still a judgement call

- **Pictures.** Player headshots come from Sleeper's and ESPN's CDNs, and team avatars are whatever managers uploaded (some are NFL logos). A reviewer could raise 5.2.1. Initials in place of headshots would take that off the table.
- **ESPN.** The app reads ESPN's unofficial fantasy API. Private leagues need the member's ESPN cookies, copied on a computer. That's allowed, but if a reviewer pushes back, hiding private ESPN for v1 is the fallback.
- **Sleeper's API** is "free to use for non-commercial purposes". Ask Sleeper before turning on plans or ads.
- **Plans later.** In-app unlocks need In-App Purchase (15% on the Small Business Program). On the US storefront only, a link to Stripe checkout is allowed since May 2025 (Epic v. Apple).
