# Pigskin Pantheon: a hall of fame for your Sleeper or ESPN league

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
ads](#accounts-plans-and-ads)), the relay that opens private ESPN leagues
(see [ESPN leagues](#espn-leagues)) and the AI behind Ask the League (see
[Ask the League](#ask-the-league-the-ai-chat)).

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
developer tools, on a computer) and has a box for each. On a phone or
tablet, which has no developer tools, the panel says to connect from a
computer once, signed in, after which the account carries the keys over.

**Several ESPN accounts.** A member who plays on more than one ESPN account
adds a set of keys for each ("+ Add another ESPN account"), up to ten. The
panel lists them by their leagues; the front page lists every account's
leagues together; and a league opens with whichever set ESPN accepts, the
one that opened it before (or listed it) tried first.

- **Signed in, the keys are saved to the visitor's account** as well
  (unless they untick "Also save them to my account"), so every device they
  sign in on opens their private leagues, their phone included, without
  typing the keys again. Keys typed before signing in can be moved to the
  account with "Save to my account". The relay keeps them encrypted
  (AES-GCM with `ESPN_KEYS_SECRET`, bound to the member's user id) in the
  `espn_keys` table, which only the relay can read; they never go back to
  a browser.
- **Signed out (or in preview mode)**, they stay in that browser's
  localStorage only.
- **Forget** on an account's row removes that ESPN account's keys from the
  browser and the account.

**Without Supabase**, typed keys work too, kept in each visitor's browser:
the relay is a plain Deno program that runs anywhere, and with no Supabase
settings it leaves account saving off.

- On your computer, with the site served locally: `deno run --allow-net
  --allow-env supabase/functions/espn-proxy/index.ts` (it listens on
  `http://localhost:8000`; `PORT` changes that), and set `ESPN_PROXY_URL:
  "http://localhost:8000"` in `account-config.js`.
- For the live site: a free Deno Deploy project (dash.deno.com) from the
  same file, with `ALLOWED_ORIGINS` set to the site's address, and its
  `https://<project>.deno.dev` address as `ESPN_PROXY_URL`.

When Supabase is set up later, leave `ESPN_PROXY_URL` empty (the site then
uses the Supabase relay) and account saving switches on.

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
- There is no ESPN username search (ESPN has no public lookup). With ESPN
  keys saved (in the browser or to the account), the front page lists the
  member's own ESPN football leagues, from the teams on their ESPN profile
  (the relay's `?action=leagues`), in the same list as their Sleeper
  leagues; without keys, a league opens by its ID or link.
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

## Ask the League (the AI chat)

Every league page (season, record book, front office, trophy room) has an
**Ask the League** button in its corner. It opens a chat with the League
Historian, an AI that answers questions about that league: champions,
rivalries, records, streaks, trades, drafts, waiver pickups, lineup
mistakes, a player's history with the league, this season so far. It's free
for every signed-in member for now; once plans are back on (`PRICING`, see
[Accounts](#accounts-plans-and-ads)) it is part of **Pro**, and on the free
plan the same button opens a preview of it with the way to upgrade.

It answers short (a punchy line, then the two or three league numbers that
prove it) and talks some smack when the numbers hand it to it: playoff
chokes, lopsided head-to-heads, trades that aged badly. The roasting stays
on fantasy results.

`chat.js` / `chat.css` are the button, the window and the browser's half;
`supabase/functions/league-chat` is the server's half.

How it knows the league, without a database of its own:

- **The league as text.** When the chat opens, `chat.js` writes the league
  out from the data the page already loaded: every season's format,
  standings, champion and last place, every game's score, every playoff
  game, the week ahead, and all-time tables worked out in the browser
  (each manager's career record, titles, playoff record and finishes;
  head-to-head for every pair; the highest and lowest scores, blowouts,
  closest games, best and worst seasons; streaks; each manager's
  most-started players). The AI is given these totals rather than left to
  add up hundreds of games itself. A ten-team league with a few seasons is
  around 7,000 tokens.
- **Tools for the detail.** Anything finer is a tool the AI can call, and
  the tool runs **in the browser**, on data the site already reads:
  `box_score` (every lineup of a week), `player_history` (a player's weeks
  with each manager, his best starts, how he was drafted, traded or
  claimed), `team_season`, `top_performances` (best single-week starts and
  bench weeks, by season, position or manager), `trades` (graded in
  hindsight, from the front office), `waiver_pickups`, `draft` and
  `lineup_efficiency`. The server never reads Sleeper or ESPN.

Each question goes to the function with the league text and the
conversation so far. The function adds the instructions, the tools and the
API key, asks Google's Gemini (`gemini-3.8-flash`, low thinking) and
streams the answer back as it is written. When the model asks for a tool,
the stream ends with the request, `chat.js` runs it and sends the result
back, up to eight look-ups per question. The league text goes first and is
the same on every turn, so Gemini's implicit cache can reuse it.

**It runs on Gemini's free tier.** A key from Google AI Studio on a Google
Cloud project with no billing account is free; the catch is limits per
project, shared by every member (requests a minute, tokens a minute,
requests a day; AI Studio ▸ Usage shows yours), and that Google may use
free-tier prompts to improve its products. Each question is one request,
plus one per round of look-ups. Past a limit, members are told to try again
in a minute, or tomorrow when the day's allowance is gone. Turning billing
on moves the project to the paid tier (higher limits, prompts not used for
training, and a bill).

What protects the quota:

- **Signed-in members only, checked on the server.** With Supabase, the
  function checks the member's session and asks `has_pro()`, which is true
  for everyone while `app_settings.free_for_everyone` is on, and only for
  Pro members once it's off (`402 pro_required` then, whatever the browser
  says).
- **A daily allowance.** `AI_DAILY_QUESTIONS` new questions per member per
  day (25 unless set), counted in `chat_usage` by `count_chat_question()`
  (`supabase/migrations/20261003000000_league_chat.sql`), which only the
  function can call. Tool look-ups don't count as questions; eight per
  question is the ceiling.
- **Bounded requests.** Questions up to 2,000 characters, conversations up
  to 80 turns (the window asks for a new chat before then), a size limit on
  the league text, and `ALLOWED_ORIGINS` limiting it to the site.
- **Stopping stops the work.** The stop button, or closing the tab, cancels
  the request to Gemini.

The conversation stays in the browser tab (sessionStorage), so it follows
the member from page to page and is gone when the tab is closed. Nothing is
stored on the server but the day's question count.

Settings, as function secrets: `GEMINI_API_KEY` (required, from
aistudio.google.com ▸ Get API key), `ALLOWED_ORIGINS`, `AI_MODEL` (default
`gemini-3.8-flash`; any Gemini model id), `AI_THINKING` (`low`, `medium` or
`high`, default `low`; more thinking is slower and uses more of the
tokens-a-minute limit) and `AI_DAILY_QUESTIONS` (default 25). In
`account-config.js`, `AI_CHAT_URL` points the site at the function if it
isn't at `<SUPABASE_URL>/functions/v1/league-chat`.

**Trying it without Supabase.** In preview mode the button and window work
(with `PRICING` on, "Switch to Pro" on the account panel unlocks the chat); until the
function is reachable, the window says it isn't connected. To see real
answers on your computer:

```bash
GEMINI_API_KEY=AIza… CHAT_OPEN=1 deno run --allow-net --allow-env \
  supabase/functions/league-chat/index.ts
```

and set `AI_CHAT_URL: "http://localhost:8000"` in `account-config.js`.
`CHAT_OPEN=1` skips the account check (there are no accounts to check) and
keeps only a per-address daily allowance in memory, so anyone who can reach
it is using your API key: use it locally, never on a public address.

## Hosting

Serve the folder from any static host (GitHub Pages, Netlify, Cloudflare
Pages, S3). There is nothing to build. Locally:

```bash
python -m http.server 8765
```

and open <http://localhost:8765>.

**Custom domain (GitHub Pages).** Point the domain's DNS at GitHub first
(four `A` records for `@`: 185.199.108.153, 185.199.109.153,
185.199.110.153, 185.199.111.153, and a `CNAME` for `www` to
`<user>.github.io`), then set the domain under Settings ▸ Pages, which adds
a `CNAME` file to the branch, and tick Enforce HTTPS once the certificate
is issued. Then add the new address to Supabase ▸ Authentication ▸ URL
configuration (site URL and redirect URLs) and to the functions'
`ALLOWED_ORIGINS`, or sign-in emails and the chat and ESPN relay stop
working there. Every link the site builds is relative to its own address,
so nothing else changes.

The site is also an installable app (`manifest.webmanifest`, `sw.js`). Bump
`CACHE_VERSION` in `sw.js` whenever a file in its precache list changes, or
returning visitors keep the old copy.

## Accounts, plans and ads

Visitors sign in to open a league.

**For now it's all free.** With `PRICING: false` in `account-config.js` and
`free_for_everyone` on in the database's `app_settings` table
(`supabase/migrations/20261005000000_free_for_everyone.sql`), every signed-in
member gets what Pro gives: unlimited leagues, no swap lock, the league AI.
No plan, price or upgrade button shows anywhere. With `ADS.enabled: false`
every ad slot stays in the pages but is hidden for everyone. Stripe, League
Pass and `profiles.plan` are untouched, so turning plans back on is the two
switches (both together: the site's to show the plans, the database's to
enforce them) and ads is `ADS.enabled: true`.

The plans, once `PRICING` is on:

| Plan | Price | Leagues | Ask the League (AI) | Ads |
| --- | --- | --- | --- | --- |
| Free | $0 | 1, swappable once every 30 days | Preview only | Yes |
| Pro | $10/month | Unlimited, add or remove any time | Yes | No |
| League Pass | $20 per member a year, billed annually | Pro for everyone on it | Yes | No |

A league is synced by its whole history (every season's league id), so the
new league Sleeper creates when a league renews is still the same league and
never costs a swap.

### League Pass

One member (the owner) buys Pro for their whole league: they pick the
league and how many members (2 to 60, themselves included), and pay $20 a
member for the year (8 members $160, 10 members $200). After paying they
get an invite link to send their league. Following it, a league-mate is
asked to create an account or sign in ("Charlie invited you to SLUH22"),
takes a seat, gets Pro and has the league added to their account.

The owner's account panel shows the pass: who has joined, open seats, the
link (copy, share, or make a new one so the old one stops working),
Remove and Restore for each member, and a seat stepper to add or drop
seats (Stripe charges or credits the difference for the rest of the year).
A removed member loses Pro and the link won't let them back in unless the
owner restores them.

A member's plan is worked out in one place, `refresh_plan()`: Pro if their
own subscription is paid, if they hold a seat on a paid-up pass, or if
they're a comp (`plan_status = 'comp'` on their profile, set by hand in the
table editor to give someone Pro for free). Invite links are built from
the site's own address, so they keep working when the site moves to its
own domain.

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
  swap on the server; `has_pro()` and `app_settings` decide who counts as
  Pro (everyone, for now).
- `supabase/functions/stripe-webhook/` — keeps Pro subscriptions and
  League Passes in step with Stripe's events, then works out the plans.
  Nothing else can write a plan.
- `supabase/functions/league-pass/` — starts a League Pass checkout and
  changes a pass's seats.
- `supabase/functions/espn-proxy/` — the relay for private ESPN leagues,
  and the encrypted store for ESPN keys saved to accounts (see
  [ESPN leagues](#espn-leagues)).
- `supabase/functions/league-chat/` — the AI behind Ask the League: checks
  the member may use it, asks Gemini, streams the answer (see
  [Ask the League](#ask-the-league-the-ai-chat)).

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
   customer portal. Put both links in `account-config.js`. For League
   Pass, a product with a recurring **yearly** price of $20 per unit (the
   seats are its quantity): `supabase secrets set
   STRIPE_LEAGUE_PRICE_ID=price_…`.
5. Deploy the webhook (`supabase functions deploy stripe-webhook
   --no-verify-jwt`), set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
   and point a Stripe webhook at it for `checkout.session.completed` and
   `customer.subscription.*`. Deploy `league-pass` the same way and run
   `20261004000000_league_pass.sql`. The site finds it at
   `<SUPABASE_URL>/functions/v1/league-pass` (or `LEAGUE_PASS_URL`).
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
7. For Ask the League, run `20261003000000_league_chat.sql` and
   `20261005000000_free_for_everyone.sql`, deploy the function
   (`supabase functions deploy league-chat --no-verify-jwt`) and set its
   secrets: `supabase secrets set GEMINI_API_KEY=AIza…` (from
   aistudio.google.com) and `ALLOWED_ORIGINS` as for the relay. Optional:
   `AI_DAILY_QUESTIONS`, `AI_MODEL`, `AI_THINKING`.
8. Bump `CACHE_VERSION` in `sw.js` so returning visitors pick up the new
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
ones. Pro members see none, and nobody does while `ADS.enabled` is false.

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
