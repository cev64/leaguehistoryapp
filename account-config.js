/* Accounts, plans and ads: the settings you fill in. (For now PRICING and
   ADS.enabled are off: the site is free for everyone with an account.)

   Until SUPABASE_URL and SUPABASE_ANON_KEY are set, the site runs its
   account system in PREVIEW mode: sign-up, sign-in, the profile menu, the
   league limits and the ad slots all work, but accounts live only in this
   browser (localStorage) and the plan can be switched by hand on the
   account page. Nothing leaves the browser. Fill both in (Supabase ▸ Project
   Settings ▸ API) and the same screens talk to Supabase instead.

   Plain script, loaded before account.js on every page. */
window.ACCOUNT_CONFIG = {
  // Supabase ▸ Project Settings ▸ API. The anon (publishable) key is meant
  // to be public: row-level security in supabase/migrations decides what it
  // can read and write.
  SUPABASE_URL: "https://vnmzjfnfqqxedbmirakb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZubXpqZm5mcXF4ZWRibWlyYWtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDIxOTYsImV4cCI6MjEwNjUxODE5Nn0.YQUMzJU2aNfg0_T_2FsVNPRDmOERsT-DPsrlcd5smv8",

  // The relay that opens PRIVATE ESPN leagues (supabase/functions/espn-proxy).
  // Left empty, it is <SUPABASE_URL>/functions/v1/espn-proxy once
  // SUPABASE_URL is set. It doesn't need Supabase: run the same file on its
  // own (on your computer: "http://localhost:8000"; or on Deno Deploy:
  // "https://<project>.deno.dev") and put its address here, and private
  // leagues open with keys kept in each visitor's browser. Public ESPN
  // leagues and every Sleeper league never use it.
  ESPN_PROXY_URL: "",

  // Ask the League, the AI chat on every league page (chat.js), for
  // signed-in members (Pro only once PRICING is on). It talks to
  // supabase/functions/league-chat, which holds the Gemini API key (Google AI
  // Studio) and checks the member. Left empty, it is
  // <SUPABASE_URL>/functions/v1/league-chat once SUPABASE_URL is set; to try
  // it without Supabase, run the function on your computer with CHAT_OPEN=1
  // and put "http://localhost:8000" here.
  AI_CHAT_URL: "",

  // Sign-in methods shown on the sign-in screen. Email + password is always
  // on; Google needs the Google provider switched on in Supabase ▸
  // Authentication ▸ Providers first.
  GOOGLE_SIGN_IN: false,

  // Visitors must be signed in, and have the league synced to their
  // account, to open a league's pages. False opens every league to everyone
  // (the site as it was), while keeping the account menu and ads.
  REQUIRE_ACCOUNT: true,

  // The plans and prices (Free, Pro, League Pass). Off for now: every
  // signed-in member gets everything, and nothing on the site mentions a
  // price. Turn it back on together with the database's switch,
  // app_settings.free_for_everyone = false (Supabase ▸ Table editor), which
  // brings back the limits on the server.
  PRICING: false,

  PLANS: {
    free: { name: "Free", price: "$0", leagues: 1, ads: true },
    pro: { name: "Pro", price: "$10/month", leagues: Infinity, ads: false },
    // One member buys Pro for the whole league: perMember dollars a year
    // for each member, the buyer included. The Stripe price itself lives in
    // the league-pass function (STRIPE_LEAGUE_PRICE_ID).
    league: { name: "League Pass", perMember: 20, price: "$20 per member a year", minSeats: 2, maxSeats: 60 }
  },

  // The League Pass function (supabase/functions/league-pass), which starts
  // its checkout. Left empty, it is <SUPABASE_URL>/functions/v1/league-pass.
  LEAGUE_PASS_URL: "",

  // How long a free account's synced league is locked in before it can be
  // swapped for another: one change a month.
  SWAP_DAYS: 30,

  // Stripe. A Payment Link for the $10/month Pro price (Stripe ▸ Payment
  // Links), and the customer portal link (Stripe ▸ Settings ▸ Billing ▸
  // Customer portal) for managing or cancelling. The account page adds
  // client_reference_id=<user id> and the email to the payment link, which
  // is what the stripe-webhook function uses to find the account.
  STRIPE_PAYMENT_LINK: "",
  STRIPE_PORTAL_LINK: "",

  // Visitor counts: Cloudflare Web Analytics, free and cookie-free (so no
  // cookie banner). Cloudflare ▸ Analytics & Logs ▸ Web Analytics ▸ Add a
  // site ▸ pigskinpantheon.com, pick the JavaScript snippet, and paste the
  // token from it (the "token" value) here. Empty: nothing is loaded.
  ANALYTICS: {
    cloudflareToken: "30f2264b39864e13b2e4f71d7652c5d8"
  },

  // Ads. Every slot on the site is a fixed-size box; with no provider set
  // it shows a labelled placeholder. For Google AdSense, set the publisher
  // id ("ca-pub-…") and, per slot name, the ad unit id from AdSense.
  // enabled: false hides every slot for everyone; the slots stay in the
  // pages, ready for when ads go live. Pro members never see them.
  ADS: {
    enabled: false,
    provider: null,          // null (placeholders) or "adsense"
    adsenseClient: "",
    units: {
      // slot name: ad unit id, e.g. "season-top": "1234567890"
    }
  }
};
