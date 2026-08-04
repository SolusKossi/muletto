"""Turn a raw screenshot into a publishable guide image.

Guide screenshots are taken from real accounts, so redaction has to be
repeatable and reviewable rather than done by hand in an image editor. Each
image is described in shots.json: what to crop to, and what to paint over.

Cropping is the primary tool. Removing a region entirely is safer than
covering it, because there is nothing left to recover and nothing to get
wrong. Painting is only for details inside the area we want to keep, such as
an email address in the middle of a form.

Usage:
    python tools/redact-screenshot.py                # process everything
    python tools/redact-screenshot.py snapchat-1     # just matching names

Reads:  screenshots-raw/<source>
Writes: apps/web/guides/img/<name>, or apps/web/shots/<name> when the
        recipe sets "out": "site"
"""

import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "screenshots-raw")
OUT = os.path.join(ROOT, "apps", "web", "guides", "img")
OUT_SITE = os.path.join(ROOT, "apps", "web", "shots")
SPEC = os.path.join(ROOT, "tools", "shots.json")

# Guide bodies are about 700px wide, so 1400 covers a 2x display and no more.
MAX_WIDTH = 1400


def box(spec, w, h):
    """Boxes are fractions of the image, so they survive a rescaled screenshot."""
    x0, y0, x1, y1 = spec
    return (round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h))


def process(shot):
    src = os.path.join(RAW, shot["source"])
    if not os.path.exists(src):
        return "missing " + shot["source"]

    im = Image.open(src).convert("RGB")
    w, h = im.size

    if "crop" in shot:
        im = im.crop(box(shot["crop"], w, h))
        w, h = im.size

    if shot.get("cover"):
        d = ImageDraw.Draw(im)
        for c in shot["cover"]:
            x0, y0, x1, y1 = box(c["at"], w, h)
            d.rectangle([x0, y0, x1, y1], fill=c.get("fill", "#e8eaed"))
            label = c.get("label")
            if label:
                # Centre the label without needing font metrics to line up.
                tw = d.textlength(label)
                d.text(((x0 + x1 - tw) / 2, (y0 + y1) / 2 - 6), label, fill="#5f6368")

    if w > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(h * MAX_WIDTH / w)), Image.LANCZOS)

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(OUT_SITE, exist_ok=True)
    dst = os.path.join(OUT_SITE if shot.get("out") == "site" else OUT, shot["name"])
    if shot["name"].endswith(".jpg"):
        # Phone captures and photos are gradients; PNG stores them badly.
        im.save(dst, quality=82, optimize=True, progressive=True)
    else:
        im.save(dst, optimize=True)
    return "%-32s %4dx%-4d  %5.0f KB" % (shot["name"], im.size[0], im.size[1],
                                        os.path.getsize(dst) / 1024)


def main():
    shots = json.load(open(SPEC, encoding="utf-8"))["shots"]
    want = sys.argv[1:]
    if want:
        shots = [s for s in shots if any(a in s["name"] for a in want)]
    if not shots:
        print("Nothing matched.")
        return
    for s in shots:
        print(" ", process(s))


if __name__ == "__main__":
    main()
