#!/bin/sh
# Zips the Pigskin Pantheon Connect extension (extension/) for the stores.
#
#     sh tools/pack-extension.sh [out-dir]
#
# extension/manifest.json is the dev copy: it also runs on
# http://localhost:8765 (the site served locally) and carries both
# background keys. Each store gets its own manifest without localhost:
#
#   chrome    background.service_worker only, no browser_specific_settings
#             (Chrome Web Store; Edge Add-ons takes the same zip)
#   firefox   background.scripts only (addons.mozilla.org, desktop and
#             Android)
#
# Out: <out-dir>/chrome/ and <out-dir>/firefox/ (unpacked, to load and
# check the store build), and a zip of each. out-dir defaults to a folder
# in $TMPDIR, so nothing built lands in the repo (GitHub Pages serves it).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/extension"
OUT=${1:-"${TMPDIR:-/tmp}/pigskin-pantheon-connect"}
FILES="background.js content.js grant.html grant.js icons"

VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/manifest.json")
rm -rf "$OUT/chrome" "$OUT/firefox"
mkdir -p "$OUT"

for STORE in chrome firefox; do
  DIR="$OUT/$STORE"
  mkdir -p "$DIR"
  for f in $FILES; do cp -R "$SRC/$f" "$DIR/"; done
  python3 - "$SRC/manifest.json" "$DIR/manifest.json" "$STORE" <<'PY'
import json, sys
src, dst, store = sys.argv[1:]
m = json.load(open(src))
dev = lambda p: p.startswith("http://localhost")
m["host_permissions"] = [p for p in m["host_permissions"] if not dev(p)]
for cs in m["content_scripts"]:
    cs["matches"] = [p for p in cs["matches"] if not dev(p)]
if store == "chrome":
    m["background"] = {"service_worker": m["background"]["service_worker"]}
    m.pop("browser_specific_settings", None)
else:
    m["background"] = {"scripts": m["background"]["scripts"]}
left = json.dumps(m)
assert "localhost" not in left, "localhost left in the store manifest"
json.dump(m, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
  ZIP="$OUT/pigskin-pantheon-connect-$VERSION-$STORE.zip"
  rm -f "$ZIP"
  (cd "$DIR" && zip -qrX "$ZIP" . -x '.*' -x '*/.*')
  echo "$ZIP"
done
