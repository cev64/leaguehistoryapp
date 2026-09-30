# League History for Sleeper

Every season a Sleeper fantasy football league has played, on one site:
week-by-week results and box scores, standings as they stood each week, the
playoff picture and brackets, an all-time record book with a history for
every manager, a player card for everyone who has been on a roster, and a 3D
trophy room.

Enter a Sleeper username on the front page, pick one of your leagues, sign
in, and the site reads that league and every season before it straight from
Sleeper. The site is static files: everything it shows comes from Sleeper's
public API in the visitor's own browser, and the only server is Supabase,
for accounts (see [Accounts, plans and ads](#accounts-plans-and-ads)).

## Pages

| Page | Address |
| --- | --- |
| Sign in | `index.html` — a Sleeper username lists its leagues; a league ID opens one directly |
| A season | `season.html?league=<id>&season=<year>` |
| Record book | `alltime.html?league=<id>` (add `#owner=<user id>` to open a manager) |
| Trophy room | `trophy.html?league=<id>` |

`<id>` is the league's newest Sleeper league ID. Earlier seasons are found by
following Sleeper's `previous_league_id` chain, so one link covers the whole
history. Any of these addresses can be shared with the rest of the league.

## How it works

`sleeper.js` does all of the talking to Sleeper and hands each page a model
of the league: its managers, and for each season the teams, the schedule,
every score, both playoff brackets and the final places. The pages draw from
that model.

- **Standings** follow Sleeper's order: record (a tie counts half, the weekly
  median game counts where the league plays one), then points for. With
  divisions, each division's leader is seeded first.
- **Brackets** are drawn from Sleeper's own winners and losers brackets, of
  any size: byes, reseeding, two-week rounds. Before the playoffs they are
  projected from the standings of the week being viewed.
- **Losers brackets** come in two kinds (`settings.playoff_type`): a toilet
  bowl (Sleeper's default, where the team that *loses* moves on and the last
  one standing finishes last) or a consolation bracket. Sleeper records the
  team that moved on as the "winner" of each game, so the site reads the two
  differently; final places, last place and the trophy room's cellar all come
  from that.
- **Box scores** come from the weekly matchups: every starter and bench
  player with his points, and his NFL club as a coloured chip.
- **Clinch flags** (z, x, e) are only shown once they are mathematically
  certain.

A finished season never changes, so its data is kept in the browser
(IndexedDB) for a month; a season in progress is re-read every few minutes.
Player names come from `data/players.json`, the site's own slim copy of
Sleeper's players file (about 430 KB, 130 KB compressed). Sleeper asks that
that file be fetched at most once a day and kept on your side, so visitors
never ask Sleeper for it: a GitHub Action (`.github/workflows/update-players.yml`)
refreshes it every morning at 12:00 UTC and commits it when anything changed.
Scheduled Actions only run on the repository's default branch; "Run workflow"
on the Actions tab runs it by hand.

## Hosting

Serve the folder from any static host (GitHub Pages, Netlify, Cloudflare
Pages, S3). There is nothing to build. Locally:

```bash
python -m http.server 8765
```

and open <http://localhost:8765>.

The site is also an installable app (`manifest.webmanifest`, `sw.js`). Bump
`CACHE_VERSION` in `sw.js` whenever a file in its precache list changes, or
returning visitors keep the old copy.

## Accounts, plans and ads

Visitors sign in to open a league. Two plans:

| Plan | Price | Leagues | Ads |
| --- | --- | --- | --- |
| Free | $0 | 1, swappable once every 30 days | Yes |
| Pro | $10/month | Unlimited, add or remove any time | No |

A league is synced by its whole history (every season's league id), so the
new league Sleeper creates when a league renews is still the same league and
never costs a swap.

- `account-config.js` — the settings: Supabase keys, plan names and
  prices, the swap window, Stripe links and the ad network.
- `account.js` / `account.css` — the header's account button and profile
  menu, the sign-in dialog (email and password, password reset, optional
  Google), the account panel (leagues, plan, profile), the league gate and
  the ad slots. `League.load` waits on `Account.admit(model)`, so every
  league page is gated in one place.
- `supabase/migrations/` — the `profiles`, `synced_leagues` and
  `league_changes` tables with row-level security, and `sync_league()` /
  `unsync_league()`, which enforce the free plan's one league and 30-day
  swap on the server.
- `supabase/functions/stripe-webhook/` — sets a profile's plan from Stripe's
  subscription events. Nothing else can write a plan.

Until `SUPABASE_URL` and `SUPABASE_ANON_KEY` are filled in, accounts run in
**preview mode**: everything works, but accounts are kept in the browser
and the account panel has switches to try Pro and skip the swap lock.
Setting `REQUIRE_ACCOUNT: false` turns the gate off and opens every league.

Going live:

1. Create a Supabase project and run the migration (`supabase db push`, or
   paste it into the SQL editor).
2. Supabase ▸ Authentication ▸ URL configuration: set the site URL and add
   the site's `index.html` to the redirect URLs (confirmation and password
   reset emails land there). Turn on Google under Providers if wanted, and
   set `GOOGLE_SIGN_IN: true`.
3. Put the project URL and anon key in `account-config.js`.
4. Stripe: a $10/month recurring price, a Payment Link for it and the
   customer portal. Put both links in `account-config.js`.
5. Deploy the webhook (`supabase functions deploy stripe-webhook
   --no-verify-jwt`), set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
   and point a Stripe webhook at it for `checkout.session.completed` and
   `customer.subscription.*`.
6. Bump `CACHE_VERSION` in `sw.js` so returning visitors pick up the new
   config.

The gate is a paywall in the browser: Sleeper's data is public, so it keeps
honest visitors honest rather than locking anything away.

Ad slots are fixed-size boxes reserved in each page, so nothing moves when
an ad loads. Each slot's size is set by the screen it's drawn on:

| Slot | Phone | Tablet / desktop | Wide content |
| --- | --- | --- | --- |
| Top of every page | 320 × 100 | 728 × 90 | 970 × 90 |
| Mid-page (every season view, the record book, the front page) | 300 × 250 | 728 × 90 | 970 × 90 |
| Foot of every page | 300 × 600 | 728 × 90 | 970 × 250 |
| Desktop sidebar | — | 300 × 250 (300 × 600 on screens 980px+ tall) | |
| Manager history drawer (two) | 300 × 250 | 300 × 250 | |

The trophy room has a bar along the bottom of the screen that is always in
view, in the hall and in the lockers: 320 × 100 on phones (320 × 50 turned
sideways), 728 × 90 on tablets and desktop. The 3D room is drawn in the space
above it, so it never covers an exhibit or a control. There is also a
300 × 250 in the loading screen, one in the exhibit sheet, and one in the
hall's corner on large screens.

With `ADS.provider` unset the slots show labelled placeholders; set it to
`"adsense"` with a publisher id and a unit id per slot name (the `data-ad`
attribute) to serve ads. Pro members see none.

## Tools

- `tools/update-players.py` refreshes `data/players.json` from Sleeper (the
  daily Action runs it; standard library only).
- `tools/build-icons.py` rebuilds every icon from `icons/crest-master.png`
  (needs Pillow).
- `tools/check-scripts.mjs` parses every page's inline script without running
  it (needs Node), to catch a syntax error before it ships.

## Sleeper

This site is independent: not affiliated with or endorsed by Sleeper, and
every page says so. It uses only Sleeper's documented, read-only public API
(`api.sleeper.app/v1`), which Sleeper offers free for non-commercial use;
anything commercial (ads, a paid tier) needs Sleeper's permission first.
Each visitor's browser makes its own requests, cached as above, well under
Sleeper's limit of 1,000 a minute. Player photos and league and team avatars
come from Sleeper's image server. No NFL or Sleeper logos are used: clubs are
shown as their abbreviations.
