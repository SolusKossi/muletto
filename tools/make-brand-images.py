"""Square avatars and a wide cover, for places that are not the site.

Donation pages and forum profiles want a PNG, and they crop it their own way.
Everything here is built from apps/web/wordmark.png, which is the source of
truth for the mark, and from the site's own typeface, so nothing can drift
from what muletto.app actually looks like.

The wordmark file is an alpha mask: the colour in it means nothing and the
shape lives in the alpha channel, which is why each image recolours it rather
than pasting it directly.

Writes: brand/avatar-dark.png, brand/avatar-light.png, brand/cover.png
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDMARK = os.path.join(ROOT, "apps", "web", "wordmark.png")
FONT_TTF = os.path.join(ROOT, "brand", "_hostgrotesk.ttf")
OUT = os.path.join(ROOT, "brand")

INK = (12, 12, 12)          # --g-ink
PAPER = (255, 255, 255)
MUTE = (154, 154, 154)      # --g-faint


def wordmark(colour, width):
    """The mark, recoloured and scaled to a given width."""
    src = Image.open(WORDMARK).convert("RGBA")
    solid = Image.new("RGBA", src.size, colour + (255,))
    solid.putalpha(src.split()[3])
    h = max(1, round(src.height * width / src.width))
    return solid.resize((width, h), Image.LANCZOS)


def avatar(size, bg, fg, out):
    """A square, sized so a circular crop cannot clip the mark.

    These are almost always shown as circles. A wordmark that fills the square
    corner to corner loses its first and last letter the moment it is rounded,
    so it sits at 62% of the width, comfortably inside the inscribed circle."""
    mark = wordmark(fg, int(size * 0.62))
    canvas = Image.new("RGB", (size, size), bg)
    canvas.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2), mark)
    canvas.save(out, "PNG", optimize=True)
    return out


def cover(out, bg=INK, fg=PAPER, sub=MUTE, rule=(46, 46, 46)):
    """2400x600, which is the 1600x400 minimum at 1.5x so it stays sharp.

    The composition sits above the middle on purpose: these pages overlay the
    profile picture across the lower part of the cover, and anything centred
    vertically ends up behind it."""
    W, H = 2400, 600
    canvas = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(canvas)

    mark = wordmark(fg, int(W * 0.26))
    x = (W - mark.width) // 2
    y = int(H * 0.30) - mark.height // 2
    canvas.paste(mark, (x, y), mark)

    line = "Your data, out of their cloud and back in your hands."
    try:
        font = ImageFont.truetype(FONT_TTF, 46)
    except OSError:
        font = ImageFont.load_default()
    tw = d.textbbox((0, 0), line, font=font)[2]
    d.text(((W - tw) // 2, y + mark.height + 40), line, font=font, fill=sub)

    # A hairline under it all, the same device the site uses to separate
    # registers. Kept well clear of the edges so a crop cannot bisect it.
    d.line([(int(W * 0.34), int(H * 0.80)), (int(W * 0.66), int(H * 0.80))],
           fill=rule, width=2)

    canvas.save(out, "PNG", optimize=True)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    print(avatar(1000, INK, PAPER, os.path.join(OUT, "avatar-dark.png")))
    print(avatar(1000, PAPER, INK, os.path.join(OUT, "avatar-light.png")))
    print(cover(os.path.join(OUT, "cover.png")))
    # White, to match the top half of the site, which is paper rather than ink.
    print(cover(os.path.join(OUT, "cover-light.png"),
                bg=PAPER, fg=INK, sub=(118, 118, 118), rule=(224, 224, 224)))


if __name__ == "__main__":
    main()
