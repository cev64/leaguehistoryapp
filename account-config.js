/* Accounts, plans and ads: the settings you fill in.

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
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // The relay that opens PRIVATE ESPN leagues (supabase/functions/espn-proxy).
  // Left empty, it is <SUPABASE_URL>/functions/v1/espn-proxy once
  // SUPABASE_URL is set; set it to use a relay hosted elsewhere. Public ESPN
  // leagues and every Sleeper league never use it.
  ESPN_PROXY_URL: "",

  // The Connect ESPN browser extension (extension/, packaged with
  // tools/build-extension.py), once it is published: its Chrome Web Store
  // page and its Firefox Add-ons page. Empty, the front page doesn't offer
  // it; a visitor who has it installed can still use it.
  ESPN_EXTENSION_URL: "",
  ESPN_EXTENSION_FIREFOX_URL: "",

  // Sign-in methods shown on the sign-in screen. Email + password is always
  // on; Google needs the Google provider switched on in Supabase ▸
  // Authentication ▸ Providers first.
  GOOGLE_SIGN_IN: false,

  // Visitors must be signed in, and have the league synced to their
  // account, to open a league's pages. False opens every league to everyone
  // (the site as it was), while keeping the account menu and ads.
  REQUIRE_ACCOUNT: true,

  PLANS: {
    free: { name: "Free", price: "$0", leagues: 1, ads: true },
    pro: { name: "Pro", price: "$5/month", leagues: Infinity, ads: false }
  },

  // How long a free account's synced league is locked in before it can be
  // swapped for another: one change a month.
  SWAP_DAYS: 30,

  // Stripe. A Payment Link for the $5/month Pro price (Stripe ▸ Payment
  // Links), and the customer portal link (Stripe ▸ Settings ▸ Billing ▸
  // Customer portal) for managing or cancelling. The account page adds
  // client_reference_id=<user id> and the email to the payment link, which
  // is what the stripe-webhook function uses to find the account.
  STRIPE_PAYMENT_LINK: "",
  STRIPE_PORTAL_LINK: "",

  // Ads. Every slot on the site is a fixed-size box; with no provider set
  // it shows a labelled placeholder. For Google AdSense, set the publisher
  // id ("ca-pub-…") and, per slot name, the ad unit id from AdSense.
  ADS: {
    provider: null,          // null (placeholders) or "adsense"
    adsenseClient: "",
    units: {
      // slot name: ad unit id, e.g. "season-top": "1234567890"
    }
  }
};
