/* Pigskin Pantheon Connect: the bridge on pigskinpantheon.com.

   Runs only on the site's own pages (the manifest's content_scripts). It
   tells the page the extension is here, and carries the page's one
   question, "the ESPN keys, please", to the background and the answer
   back:

     here     document.documentElement.dataset.ppConnect = <version>, and a
              pp-connect-ready event on document (the page may have loaded
              already, so it can check the attribute too)
     page     window.postMessage({ pp: "espn-connect", id }, location.origin)
              from a click; { pp: "espn-connect-cancel", id } to stop
     back     { pp: "espn-connect-ack", id } at once, then
              { pp: "espn-connect-waiting", id, on: "login" | "grant" } if
              a tab opened for the member, and last
              { pp: "espn-connect-answer", id, s2, swid } or with cancelled,
              timedOut, needsAccess or error instead

   Only messages from this very window and origin are taken, and only an
   ask made from a click (a script on the page can't ask on its own). */
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const alive = () => { try { return Boolean(api && api.runtime && api.runtime.id); } catch (err) { return false; } };

  // Injected again after an install or update (background.js): a copy from
  // before the update can't reach the extension any more, so the newest
  // one takes over; a live copy already here keeps the job.
  const prior = globalThis.__ppConnect;
  if (prior && prior.alive()) return;
  if (prior) prior.stop();

  const ID = /^[\w-]{1,64}$/;
  const WAIT_MS = 10 * 60 * 1000 + 30 * 1000; // the background gives up at 10 minutes
  const open = new Map(); // the page's id -> its give-up timer

  const toPage = (type, id, extra) => window.postMessage({ pp: type, id, ...extra }, location.origin);
  // The answer, once, with only the fields the page needs.
  function answer(id, a) {
    if (!open.has(id)) return;
    clearTimeout(open.get(id));
    open.delete(id);
    const out = {};
    if (a && typeof a.s2 === "string" && typeof a.swid === "string") { out.s2 = a.s2; out.swid = a.swid; }
    else {
      ["cancelled", "timedOut", "needsAccess"].forEach((k) => { if (a && a[k]) out[k] = true; });
      if (!out.cancelled && !out.timedOut) out.error = String((a && a.error) || "Pigskin Pantheon Connect didn't answer. Reload the page and try again.");
    }
    toPage("espn-connect-answer", id, out);
  }
  function send(message) {
    try { return Promise.resolve(api.runtime.sendMessage(message)); } catch (err) { return Promise.reject(err); }
  }

  function ask(id) {
    if (open.has(id)) return;
    const activation = navigator.userActivation;
    if (activation && !activation.isActive) {
      toPage("espn-connect-answer", id, { error: "Click Connect ESPN to connect." });
      return;
    }
    open.set(id, setTimeout(() => { answer(id, { timedOut: true }); send({ type: "espn-cancel", id }).catch(() => {}); }, WAIT_MS));
    toPage("espn-connect-ack", id);
    send({ type: "espn-keys", id }).then((reply) => {
      if (reply && reply.waiting) toPage("espn-connect-waiting", id, { on: reply.waiting === "grant" ? "grant" : "login" });
      else answer(id, reply);
    }, () => answer(id, { error: "Pigskin Pantheon Connect didn't answer. Reload the page and try again." }));
  }
  function cancel(id) {
    if (!open.has(id)) return;
    send({ type: "espn-cancel", id }).catch(() => {});
    answer(id, { cancelled: true });
  }

  function onPage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !ID.test(d.id)) return;
    if (d.pp !== "espn-connect" && d.pp !== "espn-connect-cancel") return;
    if (!alive()) {
      // The extension was updated or removed since this page loaded.
      stop();
      toPage("espn-connect-answer", d.id, { error: "Pigskin Pantheon Connect was updated. Reload the page and try again." });
      return;
    }
    if (d.pp === "espn-connect") ask(d.id); else cancel(d.id);
  }
  // From the background only: a tab opened for the member, or the answer.
  function onBackground(msg, sender) {
    if (!sender || sender.id !== api.runtime.id || sender.tab) return;
    if (!msg || typeof msg.id !== "string" || !open.has(msg.id)) return;
    if (msg.type === "espn-waiting") toPage("espn-connect-waiting", msg.id, { on: msg.on === "grant" ? "grant" : "login" });
    else if (msg.type === "espn-answer") answer(msg.id, msg.answer);
  }

  function stop() {
    window.removeEventListener("message", onPage);
    try { api.runtime.onMessage.removeListener(onBackground); } catch (err) { /* gone */ }
    open.forEach((timer) => clearTimeout(timer));
    open.clear();
    delete document.documentElement.dataset.ppConnect;
  }

  window.addEventListener("message", onPage);
  api.runtime.onMessage.addListener(onBackground);
  globalThis.__ppConnect = { alive, stop };
  document.documentElement.dataset.ppConnect = api.runtime.getManifest().version;
  document.dispatchEvent(new Event("pp-connect-ready"));
})();
