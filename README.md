# League History for Sleeper and ESPN

Every season a Sleeper or ESPN fantasy football league has played, on one site:
week-by-week results and box scores, standings as they stood each week, the
playoff picture and brackets, an all-time record book with a history for
every manager, a player card for everyone who has been on a roster, and a 3D
trophy room.

Enter a Sleeper username (or an ESPN league ID) on the front page, pick one
of your leagues, sign in, and the site reads that league and every season
before it straight from Sleeper or ESPN. The site is static files: everything
it shows comes from the platform's API in the visitor's own browser, and the
only server is Supabase, for accounts (see [Accounts, plans and
ads](#accounts-plans-and-ads)) and the relay that opens private ESPN leagues
(see [ESPN leagues](#espn-leagues)).

## Pages

| Page | Address |
| --- | --- |
| Sign in | `index.html` — a Sleeper username lists its leagues; a league ID opens one directly; the ESPN tab takes an ESPN league ID or link |
| A season | `season.html?league=<id>&season=<year>` |
| Record book | `alltime.html?league=<id>` (add `#owner=<user id>` to open a manager) |
| Trophy room | `trophy.html?league=<id>` |
| Front office | `moves.html?league=<id>` (add `#<tab>/<season>`: `#trades/all`, `#lineups/2024`, `#picks/2027`) |

`<id>` is the league's newest Sleeper league ID, or `espn-<ESPN league ID>`
for an ESPN league (`season.html?league=espn-12345678`). Earlier Sleeper
seasons are found by following Sleeper's `previous_league_id` chain; an ESPN
league keeps one ID for life and lists its earlier years itself. Either way
one link covers the whole history, and any of these addresses can be shared
with the rest of the league.

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
  certain. **Playoff scenarios** ("clinches with a win, or with a loss if
  the Dawgs beat MCM22") come from the same test run over every way the
  next week's games could go, shown on the next week's matchups and on the
  Playoffs view while a season is live.

## ESPN leagues

`espn.js` reads an ESPN league from ESPN's fantasy API
(`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl`) and hands `sleeper.js`
the same raw seasons Sleeper's API gives: league, managers, rosters, every
week's matchups with both lineups, and both brackets. Everything from
`buildSeason` on (standings, brackets, box scores, the record book, the
front office, recaps, the trophy room) is shared, so an ESPN league gets
every page a Sleeper league does. `sleeper.js` takes other platforms as
sources (`League._core.addSource`), so another platform would plug in the
same way.

What is read, per season: one call for the settings, teams, members, the
whole schedule with every week's score, the draft and the league's status;
one call per final week for both lineups of every game; and, only when the
front office is opened, one call per week for waivers and pickups plus the
league's activity feed for trades. A finished season is kept in IndexedDB
for a month, like Sleeper's.

How ESPN's data maps onto the site:

- **Managers** are followed across seasons by their ESPN member id (SWID),
  shown by name. Teams keep their own ESPN name and logo each season.
- **Brackets**: ESPN has no bracket list, only tagged playoff games in the
  schedule. The winner's bracket is drawn the standard way for the field
  (byes to the top seeds; 1 meets the 4/5 winner) so it can be projected
  before the playoffs, and ESPN's games are laid onto it as they are played.
  Placement games (third, fifth) and the consolation ladder come from
  ESPN's games. Seasons from before ESPN tagged its games are sorted by
  who is still alive. ESPN's consolation ladder is winners-move-on, never a
  toilet bowl. One- and two-week rounds are both handled.
- **Final places** are ESPN's own (`rankCalculatedFinal`), so the
  champion, last place and the trophy room match what ESPN shows.
- **Players** come from ESPN's own data (name, position, club, eligible
  slots), keyed `e<ESPN id>`; team defences use their club's code, as on
  Sleeper. Photos come from ESPN's image server. Sleeper's players file
  isn't loaded for an ESPN league.
- **Lineup slots** map to Sleeper's (RB/WR is `WRRB_FLEX`, OP is
  `SUPER_FLEX`, ESPN's DT/DE/DL slots read as DL and CB/S/DB as DB), so the
  lineup tools work unchanged.
- **Trades** come from the league's activity feed (2019 on), because ESPN's
  transaction list leaves the players out of other teams' trades. Waivers,
  pickups and FAAB bids come from the transaction list.
- **Draft Picks tab**: hidden for ESPN leagues, which can't trade picks.

### Public and private ESPN leagues

ESPN answers a league that is *viewable to the public* (League ▸ Settings ▸
Basic Settings) to anyone, from the browser, like Sleeper: the league ID is
all a visitor needs.

A private league opens one way: with the visitor's **ESPN keys**, the
`espn_s2` and `SWID` cookies ESPN keeps once they're signed in. The ESPN
tab's "Private league?" panel says where to find them (the browser's
developer tools, on a computer) and has a box for each.

- **Signed in, the keys are saved to the visitor's account**, so every
  device they sign in on opens their private leagues, their phone included,
  without typing the keys again. Keys typed before signing in can be moved
  to the account with "Save to my account". The relay keeps them encrypted
  (AES-GCM with `ESPN_KEYS_SECRET`, bound to the member's user id) in the
  `espn_keys` table, which only the relay can read; they never go back to
  a browser.
- **Signed out (or in preview mode)**, they stay in that browser's
  localStorage only.
- **Forget them** removes them from the browser and the account.

`espn.js` tries a plain request first (public leagues), then the relay
with keys typed in this browser, then the relay with the member's saved
keys, and remembers which worked. The relay
(`supabase/functions/espn-proxy`) adds the keys as cookies to a read-only
request to ESPN's fantasy football league and player addresses and passes
the answer straight back. It never logs the keys, and `ALLOWED_ORIGINS`
limits it to this site. A private league the visitor has no keys for fails
with a note that links back to the panel.

### Known limits

- ESPN keeps lineups for older seasons patchily. A season whose box scores
  ESPN no longer serves (typically before 2018) still has every score,
  standing, bracket and final place, but no lineups. Its lineup and player
  pages are empty for that year.
- Trades before 2019 are only those ESPN's transaction list includes.
- Standings during a season use the site's order (record, then points for,
  division leaders first). A league with ESPN's head-to-head tiebreak can
  differ there until the season ends; final places are always ESPN's.
- Scores are ESPN's own, so any custom scoring is already in them. If an
  ESPN league plays an extra weekly game against the league median, those
  extra wins aren't added to the site's records.
- There is no ESPN username search (ESPN has no public lookup); visitors
  open a league by its ID or link.
- ESPN's fantasy API is unofficial and undocumented. It has been stable for
  years and the community libraries rely on it, but it can change without
  notice.

## The front office

`insights.js` judges what managers did, in hindsight, from the scores
Sleeper already has. Nothing uses projections (Sleeper's API terms rule
them out). "Scored for" always means points in a team's starting lineup.

- **Lineups:** each week's best possible lineup from the players a team
  had (an exact assignment over Sleeper's slots, flex and IDP included,
  using the eligible positions in `data/players.json`), against the one it
  set: efficiency, points left on the bench, the games a lineup cost, and
  the costliest benchings. Taxi-squad players who were never started that
  season are left out. The week's worst benching is also in each week's
  notes on the season page.
- **Trades:** every trade in the league's history with what each side got
  and what it has scored for them since; a traded pick counts once it is
  used, through the player drafted with it. An all-time table of who wins
  their trades.
- **Waivers:** every pickup and what it scored for the team that added
  him that season; FAAB spent and points per dollar where the league bids.
- **Draft picks** (keeper and dynasty leagues): who holds every pick for
  the next three drafts, from Sleeper's traded-picks list.
- **Weekly recap:** every played week has a Recap view on its season
  page, written up from the week's results (see below), and a share sheet
  that turns it into pictures or text for the group chat.

The front office uses the season pages' capsule: its tabs (Lineups, Trades,
Waivers, Draft Picks) across the top and a wheel of seasons under them,
with ALL first where a tab has an all-time view. Each tab keeps its own
season; the traders table follows the season chosen, and Draft Picks
shows one future draft or all of them.

### The week in review

The Recap view (`weekRecap` in `season.html`) tells a week's story from
what Sleeper has already scored:

- **A headline** picked from the week's biggest story: a title won, a
  score for the record books, an upset (by records going in), a streak
  snapped, a manager's milestone win, a bench that cost a game, a team
  clinching or knocked out. The next three stories sit under it.
- **Every game** with its story: margins, winning and losing streaks, the
  all-time series between the two managers (followed across team names
  and seasons), luck (a win with one of the week's lowest scores, a loss
  with one of its highest), the lineup that would have won, and each
  side's top scorer.
- **Power rankings** with each team's move from last week: all-play
  record (every team against every other team's score, every week) 40%,
  actual record 25%, the last three weeks' all-play 20%, points per game
  15%.
- **By the numbers:** the week's high score and average, luckiest win,
  unluckiest loss, toughest draw, the season's luckiest and unluckiest
  teams (actual wins against all-play wins), the best-set lineup and the
  points left on benches.
- **Players of the week** (starters only): the top scorer, the best at
  each position, the best player left on a bench, a waiver pickup who paid
  off, and the dud of the week.
- **Front office:** trades, the bench blunder, waiver activity and the
  biggest bid.
- **The playoff race:** the seeds and the cut line, who clinched or was
  knocked out, and (for the week just played) next week's scenarios.
- **Next up:** the game of the week (the two best-ranked teams playing
  each other) with their all-time series, then every other game.

"League history" means every season up to and including that week, so an
old week reads as it would have that Monday. The share sheet draws it as
two 1080 × 1350 pictures, the week (headline, scores, players) and the
table (power rankings, luck, the bubble, next week's big game), and as
plain text.

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
| Pro | $5/month | Unlimited, add or remove any time | No |

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
- `supabase/functions/espn-proxy/` — the relay for private ESPN leagues,
  and the encrypted store for ESPN keys saved to accounts (see
  [ESPN leagues](#espn-leagues)).

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
4. Stripe: a $5/month recurring price, a Payment Link for it and the
   customer portal. Put both links in `account-config.js`.
5. Deploy the webhook (`supabase functions deploy stripe-webhook
   --no-verify-jwt`), set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
   and point a Stripe webhook at it for `checkout.session.completed` and
   `customer.subscription.*`.
6. For private ESPN leagues, deploy the relay
   (`supabase functions deploy espn-proxy --no-verify-jwt`) and set
   `ALLOWED_ORIGINS` to the site's address (`supabase secrets set
   ALLOWED_ORIGINS=https://your-site.example`). The site finds it at
   `<SUPABASE_URL>/functions/v1/espn-proxy` (or `ESPN_PROXY_URL` in
   `account-config.js`). Public ESPN leagues and Sleeper don't need it.
   To save ESPN keys to accounts (so private leagues open on members'
   phones), also set `ESPN_KEYS_SECRET` (`supabase secrets set
   ESPN_KEYS_SECRET=$(openssl rand -base64 32)`). Keep it: changing it
   makes every saved key unreadable, and members type theirs again.
   Run the other two migrations too: `20261001000000_espn_leagues.sql` lets
   an ESPN league (`espn-<id>`) be synced to an account, and
   `20261002000000_espn_keys.sql` adds the encrypted key store.
7. Bump `CACHE_VERSION` in `sw.js` so returning visitors pick up the new
   config.

The gate is a paywall in the browser: Sleeper's data is public, so it keeps
honest visitors honest rather than locking anything away.

Ad slots are fixed-size boxes reserved in each page, so nothing moves when
an ad loads. Each slot's size is set by the screen it's drawn on:

| Slot | Phone | Tablet / desktop | Wide content |
| --- | --- | --- | --- |
| Top of every page | 320 × 100 | 728 × 90 | 970 × 90 |
| Mid-page (every season view, the record book, the front page) | 300 × 250 | 728 × 90 | 970 × 90 |
| Foot of every page | 300 × 250 | 728 × 90 | 970 × 250 |
| Desktop sidebar | — | 300 × 250 (300 × 600 on screens 980px+ tall) | |
| Manager history drawer (two) | 300 × 250 | 300 × 250 | |

On phones, ads are held to 25% of each page's height (the Better Ads
Standards, which Chrome enforces for every ad network, allow 30%): a slot
that would go over is left out whole, so a short page shows fewer. Ads on a
league page load only once the visitor is let past the sign-in gate.

The trophy room has a bar along the bottom of the screen that is always in
view: 320 × 100 on phones (320 × 50 turned sideways), 728 × 90 on tablets
and desktop, with the 3D room drawn in the space above it. **AdSense doesn't
allow a custom sticky ad on phones, or one wider than 300px on desktop**, so
with `ADS.provider: "adsense"` the bar is left out and the room takes the
full screen; turn on Google's own Anchor ad in AdSense for a phone ad there.
A network that allows sticky mobile units (most Google Ad Manager partners)
can keep the bar. The hall also has a 300 × 250 in the exhibit sheet and one
in its corner on large screens.

With `ADS.provider` unset the slots show labelled placeholders; set it to
`"adsense"` with a publisher id and a unit id per slot name (the `data-ad`
attribute) to serve ads, using fixed-size display units, not responsive
ones. Pro members see none.

## Tools

- `tools/update-players.py` refreshes `data/players.json` from Sleeper (the
  daily Action runs it; standard library only).
- `tools/build-icons.py` rebuilds every icon from `icons/crest-master.png`
  (needs Pillow).
- `tools/check-scripts.mjs` parses every page's inline script without running
  it (needs Node), to catch a syntax error before it ships.

## Sleeper and ESPN

This site is independent: not affiliated with or endorsed by Sleeper or
ESPN, and every page says so (an ESPN league's pages credit ESPN).

ESPN publishes no API or terms for third-party use of its fantasy data; the
site reads only what a league's members can already see, from the visitor's
own browser (or the relay, with that visitor's own sign-in). As with
Sleeper, check with ESPN before running anything commercial (ads, a paid
tier) on top of its data.

For Sleeper: the site uses only Sleeper's documented, read-only public API
(`api.sleeper.app/v1`), which Sleeper offers free for non-commercial use;
anything commercial (ads, a paid tier) needs Sleeper's permission first.
Each visitor's browser makes its own requests, cached as above, well under
Sleeper's limit of 1,000 a minute. Player photos and league and team avatars
come from Sleeper's image server. No NFL or Sleeper logos are used: clubs are
shown as their abbreviations.
