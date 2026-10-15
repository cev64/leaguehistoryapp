#!/bin/sh
# The app's copy of the site's account-config.js, written into the app by
# the target's "Bundle account-config.js" build phase:
#
#     sh ios/tools/app-account-config.sh account-config.js <out>
#
# The app bundles the site's settings, but App Review wants no prices, plans
# or ways to pay outside In-App Purchase in it, even ones nothing shows. So
# the copy leaves out the lines between "--- site only" and "--- end site
# only" (the plans, their prices and the payment links) and every comment,
# then checks that nothing of them is left. The website keeps serving the
# whole file. tools/check-scripts.mjs checks the copy still parses, and
# ios/tools/bridgetest.js runs the bridges on it.
set -eu

src="$1"
out="$2"

sed -e '/^\/\*/,/\*\//d' \
    -e '/^[[:space:]]*\/\/ --- site only/,/^[[:space:]]*\/\/ --- end site only/d' \
    -e '/^[[:space:]]*\/\//d' \
    "$src" > "$out"

if grep -nE '\$[0-9]|PLANS|STRIPE|LEAGUE_PASS|[Pp]rice|[Uu]pgrade|[Cc]heckout' "$out" >&2 || grep -nw 'Pro' "$out" >&2; then
  echo "error: the app's account-config.js still names a plan, a price or a payment link (above). Put them between the \"--- site only\" lines of account-config.js." >&2
  rm -f "$out"
  exit 1
fi
if ! grep -q 'SUPABASE_URL' "$out"; then
  echo "error: the app's account-config.js lost SUPABASE_URL. Check the \"--- site only\" lines of account-config.js." >&2
  rm -f "$out"
  exit 1
fi
