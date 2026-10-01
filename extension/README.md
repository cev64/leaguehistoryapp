# League History: Connect ESPN

A small browser extension (Chrome, Edge, Brave, Opera, Firefox) that opens a
**private ESPN fantasy football league** on League History in one click, with
nothing to type.

Private ESPN leagues only show their data to signed-in members, and ESPN keeps
that sign-in in two cookies (`espn_s2` and `SWID`) that no website can read.
An extension running in your own browser can. This is that extension, and
this file is exactly what it does.

## What it reads, and where it goes

- **Two cookies from espn.com, `espn_s2` and `SWID`. Nothing else.** No
  browsing history, no page content, no other sites.
- **Only when you press Connect ESPN on League History.** It runs on League
  History's own pages and nowhere else (`content_scripts.matches` in
  `manifest.json`), and only answers a request from the page itself.
- **Handed to that League History page, in this browser.** The page keeps
  them in this browser's storage and uses them only to read your leagues
  from ESPN, through the site's read-only relay. The extension itself stores
  nothing, logs nothing, and sends nothing anywhere.
- **Your league list.** After reading the cookies, it asks ESPN (and only
  ESPN) which fantasy football leagues you are in, so League History can list
  them instead of asking for a league ID.
- **Signed out of ESPN?** It opens ESPN in a new tab to sign in, and League
  History connects when you come back to it.
- No analytics, no remote code, no third parties.

## Permissions

| Permission | Why |
| --- | --- |
| `cookies` + `https://*.espn.com/*` | Read `espn_s2` and `SWID`, and ask ESPN for your league list. |
| Content script on League History's pages | Answer the site's Connect ESPN button. |

## Files

- `manifest.json`: Manifest V3, for Chrome and Firefox alike.
- `content.js`: runs on League History's pages. Marks the page
  (`<html data-lh-espn-connect>`) so the site knows the extension is
  installed, and passes Connect requests and answers between the page
  and the extension.
- `background.js`: reads the two cookies and the league list.
- `popup.html`, `popup.js`: the toolbar popup, which shows whether this
  browser is signed in to ESPN. Read-only.

## Building and publishing

The extension has to know the site's address. Package it with:

```bash
python tools/build-extension.py --site https://your-site.example
```

That writes `dist/connect-espn/` (load it unpacked from `chrome://extensions`
with Developer mode on, to try it) and `dist/connect-espn-<version>.zip`.
Upload the zip to the Chrome Web Store (a one-time $5 developer account;
review usually takes a few days) and, for Firefox, to addons.mozilla.org.
Then put both store addresses in `account-config.js` (`ESPN_EXTENSION_URL`,
`ESPN_EXTENSION_FIREFOX_URL`) so the front page links to them.

`extension/manifest.json` as committed answers only `localhost`, for
development. `--dev` adds localhost to a packaged build.
