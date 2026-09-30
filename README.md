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
