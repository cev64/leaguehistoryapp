"""Package the Connect ESPN extension (extension/) for the browser stores.

The extension only answers League History's own pages, so it has to know
the site's address. This writes a copy of extension/ with the site's
address in its manifest, and zips it for the Chrome Web Store (also Edge,
Brave, Opera) and Firefox Add-ons:

    python tools/build-extension.py --site https://your-site.example
    python tools/build-extension.py --site https://your-site.example --dev   # also localhost

Output: dist/connect-espn/ (load it unpacked from chrome://extensions to
try it) and dist/connect-espn-<version>.zip (upload that to the store).
Standard library only.
"""
import argparse
import json
import os
import shutil
import sys
import zipfile
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "extension")
DIST = os.path.join(ROOT, "dist")
LOCAL = ["http://localhost/*", "http://127.0.0.1/*"]


def pattern(site):
    """https://example.com/history -> https://example.com/history/*"""
    url = urlparse(site.strip())
    if url.scheme not in ("https", "http") or not url.hostname:
        sys.exit(f"not a site address: {site!r} (expected e.g. https://your-site.example)")
    if url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1"):
        sys.exit(f"{site}: the site must be served over https")
    path = (url.path or "/").rstrip("/") + "/"
    return f"{url.scheme}://{url.hostname}{path}*"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", action="append", required=True, help="the site's address; repeat for more than one")
    parser.add_argument("--dev", action="store_true", help="also answer http://localhost, for local testing")
    args = parser.parse_args()

    with open(os.path.join(SRC, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    matches = [pattern(s) for s in args.site] + (LOCAL if args.dev else [])
    manifest["content_scripts"][0]["matches"] = list(dict.fromkeys(matches))

    out = os.path.join(DIST, "connect-espn")
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(SRC, out)
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    archive = os.path.join(DIST, f"connect-espn-{manifest['version']}.zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(out):
            for name in sorted(files):
                full = os.path.join(folder, name)
                z.write(full, os.path.relpath(full, out))
    print(f"answers: {', '.join(manifest['content_scripts'][0]['matches'])}")
    print(f"wrote {os.path.relpath(out, ROOT)}/ and {os.path.relpath(archive, ROOT)}")


if __name__ == "__main__":
    main()
