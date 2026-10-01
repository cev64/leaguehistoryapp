/* League History: Connect ESPN, the half that runs on League History's
   own pages (and only there: see "matches" in manifest.json).

   It marks the page so the site knows the extension is installed
   (<html data-lh-espn-connect="1.0.0">), and passes a "Connect ESPN"
   request from the page to background.js and the answer back. A message
   is only taken from the page itself, never from a frame or another
   site, and the answer is only posted to the page's own origin. */
(() => {
  document.documentElement.dataset.lhEspnConnect = chrome.runtime.getManifest().version;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== "league-history" || message.type !== "espn:connect") return;
    const answer = (body) => window.postMessage({ source: "league-history-extension", type: "espn:connected", nonce: message.nonce, ...body }, location.origin);
    try {
      chrome.runtime.sendMessage({ type: "lh:espn-connect", openLogin: Boolean(message.openLogin) }, (reply) => {
        if (chrome.runtime.lastError || !reply) answer({ ok: false, reason: "extension-error" });
        else answer(reply);
      });
    } catch (err) {
      // The extension was updated or removed since the page loaded.
      answer({ ok: false, reason: "extension-error" });
    }
  });
})();
