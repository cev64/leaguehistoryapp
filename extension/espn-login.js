/* Pigskin Pantheon Connect: MyDisney's sign-in, opened over ESPN's page.

   Runs in ESPN's own page (world MAIN, where ESPN keeps OneID at
   window.did), but only in the tab the extension opened for a sign-in,
   which it marks with #pp-connect. It does what ESPN's own Log In does,
   did.launchLogin(), once per tab (a reload after signing in doesn't open
   it again). ESPN makes did before OneID has started, and launchLogin()
   rejects until it has, so it's tried every half second for up to 30
   seconds. background.js runs it again once the page has loaded, in case
   ESPN dropped the mark. Reads nothing and sends nothing. */
(() => {
  if (location.hash !== "#pp-connect" && !window.__ppConnectLaunch) return;
  try {
    if (sessionStorage.getItem("pp-connect-launched")) return;
    sessionStorage.setItem("pp-connect-launched", "1");
  } catch (err) { /* storage blocked: launch anyway */ }
  let tries = 0;
  const retry = () => { if (++tries < 60) setTimeout(go, 500); };
  const go = () => {
    const did = window.did;
    if (!did || typeof did.launchLogin !== "function") return retry();
    Promise.resolve().then(() => did.launchLogin()).catch(retry);
  };
  go();
})();
