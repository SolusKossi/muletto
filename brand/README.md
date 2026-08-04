# Brand assets

Images for places that are not the site itself - donation pages, forum
avatars, anywhere that wants a square PNG.

- `avatar-dark.png` - the wordmark in white on the site's near-black
  (`--g-ink`, #0c0c0c). Use this one by default: most places that ask for an
  avatar have a white interface, and a dark tile stands out where a white one
  dissolves into the page.
- `avatar-light.png` - the same, inverted, for a dark interface.
- `cover.png` - 2400x600 banner on near-black. Buy Me a Coffee asks for at
  least 1600x400 and complains about anything smaller, so this is that minimum
  at 1.5x.
- `cover-light.png` - the same on white, matching the top half of the site.
  Pair it with `avatar-dark.png`, which then reads as the one dark element
  rather than disappearing into the banner.

Both are 1000x1000. The wordmark sits at 62% of the width rather than filling
the square, because these are usually cropped to a circle and a mark that fits
corner to corner loses its first and last letter once rounded. Checked: no ink
falls outside the inscribed circle.

The cover's composition sits above the middle deliberately: these pages overlay
the profile picture across the lower part of the banner, and anything centred
vertically ends up behind it.

Regenerate everything with `python tools/make-brand-images.py`. The mark comes
from `apps/web/wordmark.png` and the type from the site's own Host Grotesk, so
neither can drift from what muletto.app actually looks like.

`_hostgrotesk.ttf` is a build artefact: the site ships woff2, which Pillow
cannot read, so it is converted once with fonttools. Delete it freely, the
script needs it regenerating only if the typeface changes.
