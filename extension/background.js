/* League History: Connect ESPN, the background half.

   A private ESPN league answers only its signed-in members, and ESPN keeps
   that sign-in in two cookies (espn_s2 and SWID) that no website can read.
   An extension can, with the "cookies" permission for espn.com. This one
   reads those two cookies, and nothing else, when League History asks
   (content.js passes the request on, and content.js only runs on League
   History's own pages). It keeps nothing: no storage, no logging, no
   network requests except one to ESPN, to list the visitor's leagues.

   Answers { ok: true, s2, swid, leagues } or { ok: false, reason }. */

const ESPN_URL = "https://www.espn.com/";
// Where a signed-out visitor is sent to sign in.
const SIGN_IN_URL = "https://fantasy.espn.com/football/";

async function cookie(name) {
  const found = await chrome.cookies.get({ url: ESPN_URL, name });
  return found && found.value ? found.value : null;
}

async function signIn() {
  const [s2, swid] = await Promise.all([cookie("espn_s2"), cookie("SWID")]);
  return s2 && swid ? { s2, swid } : null;
}

/* The member's fantasy football leagues, from ESPN's fan profile, so the
   site can offer a list instead of asking for a league id. ESPN doesn't
   document this, so it is read loosely: any football entry with a group
   (league) id. Null if ESPN answers anything else; the site then asks for
   the league id instead. */
async function leagues(swid) {
  try {
    const url = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(swid)}` +
      "?displayEvents=false&displayNow=false&displayRecs=false&context=fantasy&source=espncom-fantasy&lang=en&section=espn&region=us";
    const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const found = new Map();
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 10) return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
      const football = node.gameId === 1 || /^FFL/i.test(String(node.abbrev || ""));
      if (football && Array.isArray(node.groups)) {
        node.groups.forEach((g) => {
          const id = g && String(g.groupId != null ? g.groupId : "");
          if (!/^\d{1,12}$/.test(id)) return;
          const season = Number(node.seasonId) || 0;
          const had = found.get(id);
          if (had && had.season >= season) return;
          found.set(id, {
            id,
            name: String(g.groupName || "").slice(0, 120),
            season,
            team: String((node.entryMetadata && node.entryMetadata.teamName) || node.entryNickname || "").slice(0, 120),
          });
        });
      }
      Object.values(node).forEach((v) => { if (v && typeof v === "object") walk(v, depth + 1); });
    };
    walk(await res.json(), 0);
    return [...found.values()].sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
  } catch (err) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only this extension's own content script, on League History's pages.
  if (sender.id !== chrome.runtime.id || !message || message.type !== "lh:espn-connect") return false;
  (async () => {
    const auth = await signIn();
    if (!auth) {
      // Signed out of ESPN in this browser: open ESPN to sign in; the page
      // asks again when the visitor comes back.
      if (message.openLogin) await chrome.tabs.create({ url: SIGN_IN_URL });
      reply({ ok: false, reason: "signed-out" });
      return;
    }
    reply({ ok: true, s2: auth.s2, swid: auth.swid, leagues: await leagues(auth.swid) });
  })();
  return true; // the reply comes later
});
