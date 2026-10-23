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
| Front page | `index.html` — what the site is (see [The front page](#the-front-page)), then the league finder at `#find`: a Sleeper username lists its leagues; a league ID opens one directly; the ESPN tab takes an ESPN league ID or link |
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

## The front page

`index.html` is the landing page and the way in, in one: a hero with the
pitch and two ways forward (open your league, or explore the demo), the
headline features with screenshots of the demo league, how it works,
the league finder (`#find`, the same cards and
script as before) and a few questions and answers. A signed-in member's
leagues show in the hero as one-tap links. `landing.css` styles it; the
screenshots are WebP files in `img/landing/` (`og.jpg` is the picture a
shared link shows). A link to `index.html?espn=…` or `?invite=…` lands on
the finder.

The screenshots come from the demo league, so retake them if the demo or
the pages change much.

## The demo league

`?league=demo` on any league page opens **Sunday Scaries**, a made-up
ten-team dynasty league: five seasons (2022 to 2025 finished, 2026 paused
after week 8) with a startup draft, rookie drafts, FAAB waivers, trades,
traded picks, playoffs and a toilet bowl. Anyone can open it, signed in or
not; it is never synced to an account.

`demo.js` simulates the league in the browser from a fixed seed, so it
comes out the same every time, and answers in Sleeper's own shapes:
`sleeper.js` asks for `/league/demo-2024/matchups/7` exactly as it would
ask Sleeper, and the demo answers instead of the network. So every page,
box score, player card, front-office table and the trophy room reads the
demo through the same code as a real league. It is fetched only when a
page opens the demo, and is never kept in the browser's league store.

The managers, teams and scores are invented; the players are real (their
names come from `data/players.json` by Sleeper id) with made-up points.
Each player's points a game for each season are in `demo.js`'s pool; the
seed (`SEED`) was picked for its storylines (worst to first, a 1.01 trade,
a team that never beats its rival). Changing the seed, the pool or the
simulation changes every result, so retake the front page's screenshots
after: its AI example and floating cards quote the demo's numbers.

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
for a month, like Sleeper's, from a few days after its last game, once
ESPN's stat corrections for the last week are in.

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
- **Two-week matchups**: a regular-season matchup period two weeks long is
  one game, as ESPN counts it, decided by both weeks' points and counted in
  the week it ends. Each week keeps its own box scores; the two-week totals
  stay out of one-week records (highest week, blowouts).
- **Final places** are ESPN's own (`rankCalculatedFinal`), so the
  champion, last place and the trophy room match what ESPN shows.
- **Players** come from ESPN's own data (name, position, club, eligible
  slots), keyed `e<ESPN id>`; team defences use their club's code, as on
  Sleeper. Photos come from ESPN's image server. Sleeper's players file
  isn't loaded for an ESPN league.
- **Lineup slots** map to Sleeper's (RB/WR is `WRRB_FLEX`, OP is
  `SUPER_FLEX`, ESPN's DT/DE/DL slots read as DL and CB/S/DB as DB), so the
  lineup tools work unchanged. ESPN's team quarterback (TQB) and edge
  rusher (ER) slots, which Sleeper doesn't have, keep their names and take
  the players ESPN lets into them.
- **Trades** come from the league's activity feed (2019 on), because ESPN's
  transaction list leaves the players out of other teams' trades. Waivers,
  pickups and FAAB bids come from the transaction list.
- **Draft Picks tab**: hidden for ESPN leagues, which can't trade picks.

### Public and private ESPN leagues

ESPN answers a league that is *viewable to the public* (League ▸ Settings ▸
Basic Settings) to anyone, from the browser, like Sleeper: the league ID is
all a visitor needs.

A private league opens one way: with the visitor's **ESPN keys**, the
`espn_s2` and `SWID` cookies ESPN keeps once they're signed in. Nobody
copies them out of developer tools; the ESPN tab's "Private league?" panel
connects them in one of two ways (`ESPN_SIGN_IN.md` is the build notes and
checklist):

- **iPhone and iPad app: Sign in with ESPN.** ESPN's own sign-in page opens
  in a sheet with an in-memory cookie store, wiped when the sheet closes.
  Once ESPN sets `espn_s2` the app takes it and `SWID`, discards the rest,
  closes the sheet and lists the member's leagues
  (`Bridge.finder.espnSave`, which calls `ESPN.saveAuth`). The keys are
  mirrored into the Keychain (`com.pigskinpantheon.espn`) and put back into
  the engine at launch (`Bridge.finder.espnRestore`), because iOS can clear
  the engine's web storage. See `ios/README.md`.
- **Computer: the Pigskin Pantheon Connect extension** (Chrome, Edge,
  Firefox; `extension/`). On a click of **Connect ESPN** the extension
  reads the two cookies (opening ESPN's sign-in in a tab first if the
  browser isn't signed in) and hands them to the page, which calls
  `ESPN.saveAuth`. It reads only those two cookies, only on a click, only
  answers pigskinpantheon.com's pages and stores nothing. How it works,
  loading it unpacked and the store notes are in `extension/README.md`;
  `sh tools/pack-extension.sh` zips it for the Chrome and Firefox stores.
- **Phone or tablet browser:** neither works there, so the panel says to
  connect once in the app or on a computer, signed in to an account, and
  private leagues open in the browser too (the account carries the keys).
  `APP_STORE_URL` in `account-config.js` links the app; empty, the note
  names it without a link. Safari on a Mac isn't supported yet and says so.

Either way the keys then go through the same machinery as below: kept by
`ESPN.saveAuth`, sent by the relay, and saved to the account in `espn_keys`.

**Until the extension is published**, a computer's panel says it's coming
soon and shows a small "Enter keys by hand" link with the old fields (the
developer-tools steps and a box for each cookie). They are shown while
`ESPN_EXTENSION_CHROME` and `ESPN_EXTENSION_FIREFOX` in `account-config.js`
are both empty. Setting a store link switches the panel to "Add Pigskin
Pantheon Connect" and hides the link; then delete `#espnKeys` and its
script from `index.html`. Keys entered by hand before keep working.

**Several ESPN accounts.** A member who plays on more than one ESPN account
adds a set of keys for each ("+ Add another ESPN account"), up to ten. The
panel lists them by their leagues; the front page lists every account's
leagues together; and a league opens with whichever set ESPN accepts, the
one that opened it before (or listed it) tried first.

- **Signed in, the keys are saved to the visitor's account** as well
  (unless they untick "Also save them to my account"), so every device they
  sign in on opens their private leagues, their phone included, without
  connecting again. Keys connected before signing in can be moved to the
  account with "Save to my account". The relay keeps them encrypted
  (AES-GCM with `ESPN_KEYS_SECRET`, bound to the member's user id) in the
  `espn_keys` table, which only the relay can read; they never go back to
  a browser.
- **Signed out (or in preview mode)**, they stay in that browser's
  localStorage only (and, in the app, the Keychain).
- **Forget** on an account's row removes that ESPN account's keys from the
  browser (and the app's Keychain) and the account.

**Without Supabase**, connected keys work too, kept in each visitor's browser:
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
with keys connected in this browser, then the relay with the member's saved
keys, and remembers which worked. The relay
(`supabase/functions/espn-proxy`) adds the keys as cookies to a read-only
request to ESPN's fantasy football league and player addresses and passes
the answer straight back. It never logs the keys, and `ALLOWED_ORIGINS`
limits it to this site. A private league the visitor has no keys for fails
with a note that links back to the panel ("Connect ESPN").

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

**Nothing is sent before the member allows it.** The first question (typed
or a suggestion) waits on a card in the chat saying what goes out (the
question and chat so far, a summary of the league's history, the details
the AI looks up) and to whom, with a link to the privacy policy and
**Allow** / **Not now**. Allow sends the waiting question; Not now puts it
back in the box. The choice is kept per browser in localStorage
(`lh-ai-consent.v1`), as the app keeps `aiConsent.v1`. Keep the card's
list in step with what `digestOf` and the tools send.

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
API key, asks Claude Haiku 5.5 (`claude-haiku-5-5`, the only model it
uses; thinking off, medium effort) on Anthropic's API and streams the
answer back as it is written. When the model asks for a tool,
the stream ends with the request, `chat.js` runs it and sends the result
back, up to eight look-ups per question. The league text goes first in the
conversation and is the same on every turn, so it is cached (a cache
read is a tenth of the price). It goes in as the league's data, never in the instructions: the
instructions tell the model that nothing inside it (or in a look-up's
result) is an instruction, so a team called "ignore your rules" stays a
team name.

**It is billed per request.** Each question is one request to Claude, plus
one per round of look-ups. A rate limit or an overloaded API is tried again
twice; past that, members are told to try again in a minute.

What protects the bill:

- **Signed-in members only, checked on the server.** With Supabase, the
  function checks the member's session and asks `has_pro()`, which is true
  for everyone while `app_settings.free_for_everyone` is on, and only for
  Pro members once it's off (`402 pro_required` then, whatever the browser
  says).
- **A daily allowance.** `AI_DAILY_QUESTIONS` new questions per member per
  day (25 unless set), counted in `chat_usage` by `count_chat_question()`
  (`supabase/migrations/20261003000000_league_chat.sql`), which only the
  function can call. Tool look-ups don't count as questions (eight per
  question is the ceiling), but every request does, look-ups included:
  `AI_DAILY_REQUESTS` a day (nine per question unless set), counted by
  `count_chat_request()` (`20261015000000_hardening.sql`). A round of
  look-ups only rides on its question when it answers the calls the
  function itself asked for: each call carries a stamp tied to the member,
  the day and the question, and a round without good stamps counts as a
  new question.
- **Bounded requests.** Questions up to 2,000 characters, conversations up
  to 80 turns (the window asks for a new chat before then) and 400,000
  characters besides the league text, each look-up's result cut at 40,000
  characters (the browser and the app cut theirs there too), a size limit
  on the league text, and `ALLOWED_ORIGINS` limiting it to the site.
- **A cap for the whole site.** `CLAUDE_DAILY_REQUESTS` (2,000 unless set;
  look-up rounds included; `0` turns the chat off for the day) caps
  everyone's requests together, counted by `count_chat_claude()`.
- **Stopping stops the work.** The stop button, or closing the tab, cancels
  the request to Claude.

The conversation stays in the browser tab (sessionStorage), so it follows
the member from page to page and is gone when the tab is closed. Nothing is
stored on the server but the day's question and request counts.

Settings, as function secrets: `ANTHROPIC_API_KEY` (required, from
platform.claude.com), `ALLOWED_ORIGINS`, `AI_DAILY_QUESTIONS` (default 25),
`AI_DAILY_REQUESTS` (default nine times the questions) and
`CLAUDE_DAILY_REQUESTS` (default 2,000). The model is fixed in the
function; the old Gemini settings (`GEMINI_API_KEY`, `AI_MODEL`,
`AI_FALLBACK_MODEL`, `AI_THINKING`, `CLAUDE_FALLBACK_MODEL`) are no longer
read. In `account-config.js`, `AI_CHAT_URL` points the site at the function if it
isn't at `<SUPABASE_URL>/functions/v1/league-chat`.

**Trying it without Supabase.** In preview mode the button and window work
(with `PRICING` on, "Switch to Pro" on the account panel unlocks the chat); until the
function is reachable, the window says it isn't connected. To see real
answers on your computer:

```bash
ANTHROPIC_API_KEY=sk-ant-… CHAT_OPEN=1 deno run --allow-net --allow-env \
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

**Visitor counts.** GitHub Pages and the domain registrar don't count
visits. Set `ANALYTICS.cloudflareToken` in `account-config.js` to a
Cloudflare Web Analytics token (Cloudflare ▸ Analytics & Logs ▸ Web
Analytics ▸ Add a site, JavaScript snippet) and every page loads its
beacon: page views, visitors, referrers, countries and devices, with no
cookies. Nothing loads while it's empty, or on localhost.

The site is also an installable app (`manifest.webmanifest`, `sw.js`). Bump
`CACHE_VERSION` in `sw.js` whenever a file in its precache list changes, or
returning visitors keep the old copy.

## Accounts, plans and ads

Visitors sign in to open a league (on the website; the iOS app opens
leagues without an account, see `ios/README.md`).

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
  Pro (everyone, for now). `20261016000000_league_limit.sql` makes the one
  league hold: a per-member lock (no racing two syncs), a free row never
  gains new league ids (a renewal still matches by the ids it has), and a
  trigger on `synced_leagues` that holds both for any writer. The gate
  itself runs in the browser over Sleeper's public data, so the limit
  keeps honest accounts to one league; it can't hide a league's history
  from someone who edits the page's script.
- `supabase/functions/stripe-webhook/` — keeps Pro subscriptions and
  League Passes in step with Stripe's events, then works out the plans.
  Nothing else can write a plan.
- `supabase/functions/league-pass/` — starts a League Pass checkout and
  changes a pass's seats.
- `supabase/functions/espn-proxy/` — the relay for private ESPN leagues,
  and the encrypted store for ESPN keys saved to accounts (see
  [ESPN leagues](#espn-leagues)).
- `supabase/functions/league-chat/` — the AI behind Ask the League: checks
  the member may use it, asks Claude Haiku 5.5, streams the answer (see
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
   makes every saved key unreadable, and members connect ESPN again.
   Run the other two migrations too: `20261001000000_espn_leagues.sql` lets
   an ESPN league (`espn-<id>`) be synced to an account, and
   `20261002000000_espn_keys.sql` adds the encrypted key store.
7. For Ask the League, run `20261003000000_league_chat.sql`,
   `20261005000000_free_for_everyone.sql` and, once every migration before
   it has run, `20261015000000_hardening.sql`, then deploy the function
   (`supabase functions deploy league-chat --no-verify-jwt`) and set its
   secrets: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` (from
   platform.claude.com) and `ALLOWED_ORIGINS` as for the relay. Optional:
   `AI_DAILY_QUESTIONS`, `AI_DAILY_REQUESTS` and `CLAUDE_DAILY_REQUESTS`.
8. Bump `CACHE_VERSION` in `sw.js` so returning visitors pick up the new
   config.

**Sign-up and password emails.** `supabase/email-templates/` holds the
branded confirmation and password-reset emails: paste each into Supabase ▸
Authentication ▸ Emails (the subject line is in a comment at the top of
each file). Supabase's built-in mail only reaches members of the project's
team, two emails an hour, so real members need custom SMTP: Supabase ▸
Authentication ▸ Emails ▸ SMTP Settings, with a sender such as Resend
(`smtp.resend.com`, port 465, user `resend`, an API key as the password)
and a sender on the site's own domain, verified with the DNS records the
sender gives you.

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

## The clubhouse (pick'em, awards, notifications)

What a league's members do together week to week, on the site and in the
app: **league pick'em** (pick the winners of the coming week's games, one
Lock of the Week worth 2, all locked at the week's first NFL kickoff), the
**week's awards** (Manager, Choke and Robbery of the Week, voted from the
week's kickoff until the next week's, tallies hidden until then), and
**notifications** ("Week 9 is final" on Tuesday, "Picks lock at 8:15 PM ET"
on Thursday, "Week 9's awards are in"). The shared logic (grading, nominees,
the demo league's made-up league-mates) is `clubhouse.js`; the demo league
never touches the server.

The database is `supabase/migrations/20261021000000_league_clubhouse.sql`.
A league is named by its `league_key` (a Sleeper league's first season's
id, or `espn-<id>`), the same every season. Row-level security is on with
no policies, so everything goes through its functions:

- `league_members`: which account is which manager (one each way), the
  member's notification choices (all off until they turn them on), and
  what their page last saw of the league (`seen_*`: its newest id, season
  and name). `league_claims`, `claim_manager`, `release_manager`,
  `my_clubhouses`, `set_league_notifications` (the only thing that turns a
  notification on; the site's and the app's "Turn on" call it).
- `pickem_picks`: `save_picks` replaces a member's picks for a week, until
  it locks; `pickem_board` shows a member their own picks, everyone's once a
  week has locked, and who has picked an open week.
- `award_votes`: `cast_vote` (a null nominee takes it back); `award_board`
  shows running counts while voting is open and the tallies once it closes.
- `push_devices`: `register_push_device` / `unregister_push_device` (a Web
  Push subscription on one of the browsers' push services, FCM, Mozilla's,
  Apple's or WNS, or an APNs token; 10 a member). `push_sends` records
  each notification sent so none goes twice. `clubhouse_leagues` is the
  sender's own: each Sleeper league's id this season, once it has checked
  it on Sleeper.
- `nfl_weeks` and `pick_deadline(season, week)`: the week's first kickoff,
  which everything locks and closes on (a Thursday 8:15 PM ET formula for a
  week not in the table).

**A claim is taken on trust.** Sleeper and ESPN have no sign-in to check
"I'm Lamb Chops' manager" against, so it's first come, first served and
shown to the league; the member can let it go, and a wrong one is fixed by
deleting its row in the table editor. **Nothing a page sends reaches
anyone else's notifications**: what a member's page saw of the league stays
on their own row; the sender uses a Sleeper league id only once Sleeper
says it's this season's and its `previous_league_id` chain leads back to
the league's key, takes the league's and teams' names from Sleeper, and
sends nothing for a claim on someone who isn't one of the league's
managers. An ESPN league (private, so the sender can't read it) gets plain
lines under the name the member's own page saw. **Picks are graded on the
device**, from the league's results that every member's page already has; what the
server guarantees is that nobody's picks change after the lock and nobody
sees anyone else's before it.

The notifications come from `supabase/functions/clubhouse-push`, called
every hour by pg_cron: each run works out what's due from the weeks'
kickoffs (the recap from Tuesday 9 AM ET, the reminder about four hours
before the lock to members who haven't picked, the awards in the 12 hours
after voting closes, week 18's included), writes the member's line (for a
Sleeper league, their game and record: "You beat Lamb Chops 132.4–118.1 and
you're 6–3"; an ESPN league gets a plain one), records it and sends it,
eight members at a time, five seconds a device, following no redirect. A
device that's gone (or whose keys can't be used) is forgotten at once, one
that fails five sends in a row too, and an APNs token the other
environment takes is kept as that one's. The reminder goes only for a week
with games to pick: a Sleeper week with matchups, and an ESPN week up to
14, or later once someone in the league has picked it (the sender can't
see an ESPN league's two-week matchups; `run.ts`'s header says more). Its
header says what a notification carries (`url` for the site, `link` for
the app) and the test switches (`?dry=1`, `?only=`, `?now=`, `?league=`);
a real run answers only how many (the hourly run's answer is kept in
`net._http_response`), a dry run what each would say.

To turn it on:

1. Paste `20261021000000_league_clubhouse.sql`, then
   `20261021000100_nfl_weeks_2026.sql`, into Supabase ▸ SQL editor.
2. Make the Web Push (VAPID) key pair: `npx web-push generate-vapid-keys`.
   Put the **public** key in `account-config.js` as `VAPID_PUBLIC_KEY`
   (until then the site offers no notifications).
3. Make an APNs key: Apple Developer ▸ Certificates, Identifiers & Profiles
   ▸ Keys ▸ +, tick Apple Push Notifications service (APNs), download the
   `.p8` (once only) and note its Key ID and your Team ID.
4. Set the function's secrets (`CLUBHOUSE_PUSH_SECRET` is any long random
   string, e.g. `openssl rand -hex 32`):

       supabase secrets set CLUBHOUSE_PUSH_SECRET=… \
         VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com \
         APNS_KEY_ID=… APNS_TEAM_ID=… APNS_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)" \
         APNS_TOPIC=com.pigskinpantheon.app
       supabase functions deploy clubhouse-push --no-verify-jwt

   Try it: `curl -X POST -H "x-clubhouse-secret: …"
   "https://<project-ref>.supabase.co/functions/v1/clubhouse-push?dry=1"`
   answers what it would send now (add `&now=2026-11-10T14:05:00Z` to try
   a Tuesday morning).
5. Store the function's address and secret in Vault and run
   `20261021000200_clubhouse_push_schedule.sql` (its header has the two
   `vault.create_secret` lines, how to watch it run, and
   `select cron.unschedule('clubhouse-push')` to stop it).
6. Each May, when the NFL's schedule comes out:
   `node tools/nfl-weeks.mjs 2027 > supabase/migrations/2027MMDD000000_nfl_weeks_2027.sql`
   and paste it in; run it again in early January, once week 18's times are
   set (until then week 18 stands in at Saturday 1 PM ET).

The tests run the migration in an in-process Postgres and the sender
against a pretend Sleeper and push services (each file's header says how
to install PGlite and web-push for them, outside the repository):
`PGLITE_DIR=<that folder> node supabase/tests/clubhouse.test.mjs`, and the
same for `clubhouse-push.test.mjs`.

**Privacy.** The clubhouse keeps, per member: which manager they claimed
in each league (and the league id, season and name their page last saw),
their picks and award votes, their notification choices,
and each device's push address (a browser's Web Push endpoint and keys, or
the app's APNs device token), plus which notifications were sent. Deleting
the account deletes all of it (every table cascades from `auth.users`). The
privacy policy (`privacy.html`) and the app's privacy manifest
(`PrivacyInfo.xcprivacy`) need to say so.

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
