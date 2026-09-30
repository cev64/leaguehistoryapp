#!/usr/bin/env python3
"""Regenerates every app icon from icons/crest-master.png.

    pip install Pillow && python3 tools/build-icons.py

The master is the league crest as supplied: a diamond on a transparent field,
with a white outline that keeps it legible against dark and light alike. Three
shapes come out of it.

  crest.png          the mark the page header shows, transparent, square
  icon / favicon     transparent too, so the crest keeps its diamond silhouette
                     rather than sitting in a box
  maskable / apple   opaque, because both are composited onto a background the
                     platform chooses and a transparent one goes muddy. The
                     maskable pair inset the crest to 76% so nothing important
                     falls outside the circle Android crops to; apple-touch
                     needs less room, since iOS only rounds the corners.

Rerun after replacing the master; the names never change, so nothing else has
to. Bump CACHE_VERSION in sw.js afterwards or returning visitors keep the old
artwork out of the service worker cache.
"""
from PIL import Image, ImageFile
import pathlib

ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
NAVY = (7, 24, 39, 255)          # matches theme_color / background_color

master = Image.open(ICONS / "crest-master.png")
master.load()
master = master.convert("RGBA")


def render(size, scale=1.0, background=None):
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    inner = max(1, round(size * scale))
    art = master.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(art, (off, off))
    # The crest is flat colour over a shaded ground, so a 256-entry palette
    # holds it with nothing visible lost and cuts the 512 from 177KB to 34.
    # Straight RGBA would ship more bytes of icon than of page.
    return canvas.quantize(colors=256, method=Image.FASTOCTREE)


JOBS = [
    ("crest.png",              256, 1.00, None),
    ("icon-192.png",           192, 1.00, None),
    ("icon-512.png",           512, 1.00, None),
    ("favicon-32.png",          32, 1.00, None),
    ("apple-touch-icon.png",   180, 0.88, NAVY),
    ("icon-maskable-192.png",  192, 0.76, NAVY),
    ("icon-maskable-512.png",  512, 0.76, NAVY),
]

for name, size, scale, bg in JOBS:
    out = render(size, scale, bg)
    out.save(ICONS / name, optimize=True)
    print(f"  {name:<24} {size}x{size}  crest at {int(scale * 100)}%  "
          f"{'on navy' if bg else 'transparent'}")
