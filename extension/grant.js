/* The grant page's one button: ask the browser for the extension's host
   permissions (from a click, as browsers require), then tell the
   background so whoever was waiting on Connect ESPN carries on. */
const api = globalThis.browser ?? globalThis.chrome;
const note = document.getElementById("note");
document.getElementById("allow").addEventListener("click", () => {
  // Asked before any await: the click has to still count.
  const asked = api.permissions.request({ origins: api.runtime.getManifest().host_permissions || [] });
  Promise.resolve(asked).then((ok) => {
    note.hidden = false;
    if (!ok) { note.textContent = "Not allowed. Connect ESPN can't read your ESPN keys until you allow it."; return; }
    note.textContent = "Done. Taking you back to Pigskin Pantheon…";
    api.runtime.sendMessage({ type: "pp-granted" }).catch(() => {});
  }, (err) => { note.hidden = false; note.textContent = `That didn't work: ${err.message}`; });
});
