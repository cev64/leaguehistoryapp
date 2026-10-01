/* The toolbar popup: whether this browser is signed in to ESPN, and a way
   to League History. Read-only: it never shows or sends the cookies. */
(async () => {
  const manifest = chrome.runtime.getManifest();
  const matches = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
  const live = matches.find((m) => m.startsWith("https://")) || matches[0];
  if (live) {
    const site = document.getElementById("site");
    site.href = `${live.replace(/\*$/, "")}index.html`;
    site.hidden = false;
  }

  const [s2, swid] = await Promise.all([
    chrome.cookies.get({ url: "https://www.espn.com/", name: "espn_s2" }),
    chrome.cookies.get({ url: "https://www.espn.com/", name: "SWID" }),
  ]);
  const status = document.getElementById("status");
  if (s2 && swid) {
    status.textContent = "✓ Signed in to ESPN in this browser";
    status.className = "status ok";
  } else {
    status.textContent = "Not signed in to ESPN in this browser";
    status.className = "status no";
    document.getElementById("signin").hidden = false;
  }

  // Firefox grants host access on request: ask for League History's pages
  // (the content script) and espn.com (the cookies) if they aren't granted.
  const origins = [...new Set([...matches, ...(manifest.host_permissions || [])])];
  if (chrome.permissions && !(await chrome.permissions.contains({ origins }))) {
    const allow = document.getElementById("allow");
    allow.hidden = false;
    allow.addEventListener("click", async () => {
      if (await chrome.permissions.request({ origins })) allow.hidden = true;
    });
  }
})();
