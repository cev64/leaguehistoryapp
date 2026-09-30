# League History for Sleeper

Every season a Sleeper fantasy football league has played, on one site:
week-by-week results and box scores, standings as they stood each week, the
playoff picture and brackets, an all-time record book with a history for
every manager, a player card for everyone who has been on a roster, and a 3D
trophy room.

Anyone can use it. Enter a Sleeper username on the front page, pick one of
your leagues, and the site reads that league and every season before it
straight from Sleeper. There is no account, no password and no server: the
site is static files, and everything it shows comes from Sleeper's public API
in the visitor's own browser.

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
- **Box scores** come from the weekly matchups, with each player's projection
  priced with the league's own scoring settings and his NFL club that week.
- **Clinch flags** (z, x, e) are only shown once they are mathematically
  certain.

A finished season never changes, so its data is kept in the browser
(IndexedDB) for a month; a season in progress is re-read every few minutes.
Sleeper's player list (about 2.6 MB) is fetched the first time a box score,
a roster or the player search needs a name, and kept for a day.

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

## Tools

- `tools/build-icons.py` rebuilds every icon from `icons/crest-master.png`
  (needs Pillow).
- `tools/check-scripts.mjs` parses every page's inline script without running
  it (needs Node), to catch a syntax error before it ships.

NFL team logos are in `nfl-logos/`; player photos and league and team avatars
come from Sleeper's image server.
