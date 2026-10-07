/* Bridge.finder: the front page's league finder (index.html), for the app's
   Home screen and account screen. Runs in the finder engine (no league),
   though nothing here needs one, so any engine can answer it.

   Sleeper: a username's leagues (League.user, League.leaguesFor), the
   username remembered as the site remembers it (League.saveUser).
   ESPN: the private-league keys (espn.js's window.ESPN: kept in this
   page's localStorage, the site's origin, so every league engine sees
   them), the keys saved to the member's account (the relay), and the
   member's own ESPN leagues (the relay's ?action=leagues).
   Plain data only. */
(function () {
  "use strict";

  const B = window.Bridge;
  if (!B) return;

  const ESPN = () => window.ESPN;
  const keys = () => window.ESPN.accountKeys;

  /* ------------------------------------------------------------ Sleeper */

  async function user(name) {
    const u = await League.user(name);
    League.saveUser({ username: u.username || name, name: u.name });
    return u;
  }

  async function leagues(userId) {
    return League.leaguesFor(userId);
  }

  function savedUser() {
    return League.savedUser() || null;
  }

  /* ------------------------------------------------------------ ESPN */

  /* Where the keys stand: the relay, the sets in this browser (only their
     SWIDs: the keys never leave the page), and whether the member's account
     can hold them. */
  function espnState() {
    const E = ESPN();
    const relay = Boolean(E.proxyAvailable);
    return {
      relay,
      local: relay ? E.savedAuths().map((a) => a.swid) : [],
      available: Boolean(keys().available()),
      signedIn: Boolean(keys().signedIn()),
    };
  }

  /* The ESPN accounts with keys saved to the member's account:
     [{ swid, saved_at }]. Empty when signed out or on failure, as the site
     treats it. */
  async function espnAccountSets() {
    if (!ESPN().proxyAvailable || !keys().signedIn()) return [];
    try { return (await keys().status()).accounts || []; } catch (err) { return []; }
  }

  /* Both at once, as drawPrivate reads them. */
  async function espnAccounts() {
    const state = espnState();
    const account = await espnAccountSets();
    return { ...state, account: account.map((a) => a.swid) };
  }

  /* Saving a typed set: in this browser, and to the account if asked and
     signed in. Answers what happened, in the site's words when it fails. */
  async function espnSave(s2, swid, toAccount) {
    const E = ESPN();
    if (!E.saveAuth(s2, swid)) {
      return { ok: false, error: "Those don't look like ESPN's keys: espn_s2 is a long string of letters and numbers, and SWID looks like {1A2B3C4D-…}." };
    }
    const added = E.tidyAuth(s2, swid);
    let accountError = null;
    if (toAccount && keys().signedIn()) {
      try { await keys().save(added && added.swid); }
      catch (err) { accountError = `Your keys are saved in this browser, but your account couldn't save them: ${err.message}`; }
    }
    return { ok: true, swid: added ? added.swid : null, accountError };
  }

  async function espnToAccount(swid) {
    if (!keys().signedIn()) return { ok: false };
    try { await keys().save(swid); return { ok: true }; }
    catch (err) { return { ok: false, error: `Your keys are saved in this browser, but your account couldn't save them: ${err.message}` }; }
  }

  /* Forget: off this browser, and off the account if they're there. */
  async function espnForget(swid, onAccount) {
    ESPN().clearAuth(swid);
    if (onAccount && keys().signedIn()) {
      try { await keys().forget(swid); }
      catch (err) { return { ok: true, error: `Removed from this browser, but your account couldn't forget them: ${err.message}` }; }
    }
    return { ok: true };
  }

  /* The member's own ESPN leagues (null: no keys to ask with). The list's
     `refused` (ESPN accounts whose keys were turned away) comes along. */
  async function espnLeagues() {
    const list = await ESPN().myLeagues();
    if (list === null) return null;
    return {
      leagues: list.map((l) => ({
        id: ESPN().leagueId(l.id),
        name: String(l.name || "League"),
        season: l.season || null,
        size: l.size || null,
        team: l.team || null,
        logo: l.logo || null,
        swid: l.swid || null,
      })),
      refused: list.refused || [],
    };
  }

  function espnParse(input) {
    const n = ESPN().parseLeague(input);
    return n ? ESPN().leagueId(n) : null;
  }

  B.finder = {
    user, leagues, savedUser,
    espnState, espnAccounts, espnSave, espnToAccount, espnForget, espnLeagues, espnParse,
  };
})();
