"use strict";

/* Muletto - putting a caption back on the memory it was drawn on.
 *
 * Snapchat exports a memory that has a caption, a sticker or a drawing on it
 * as two files: the picture, and the overlay on a transparent background. That
 * is deliberate on their part and ruinous on the reader's: dropped into Photos,
 * every overlay becomes a black square with white text floating on it, sitting
 * next to the memory it was supposed to be part of. Two thousand memories with
 * captions on half of them is a thousand black squares.
 *
 * Merging them is one canvas draw, and the only reasons to get it wrong are
 * the two below.
 *
 * Nothing here uploads anything. It is a canvas, in the page, on bytes that
 * came out of the reader's own archive.
 */

const MOverlay = (function () {
  /* Only what the browser will decode into an <img>. A HEIC memory has to go
     through the HEIF path first, which the caller does. */
  const drawable = (blob) => blob && /^image\//.test(blob.type || "");

  function load(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not decode")); };
      img.src = url;
    });
  }

  /* The two are not always the same size.
   *
   * Snapchat renders the overlay at the screen size of the phone it was
   * written on, and the memory at whatever the camera produced - so a 1080x1920
   * caption belongs on a 1440x2560 picture. Scaling the overlay to the base
   * keeps the caption where it was put; scaling the base to the overlay would
   * quietly shrink the photograph.
   *
   * The aspect ratios are the same in practice, and where they are not, the
   * overlay is fitted rather than stretched: a caption that is slightly off is
   * better than a memory that is the wrong shape. */
  async function merge(baseBlob, overlayBlob, type) {
    if (!drawable(baseBlob) || !drawable(overlayBlob)) return null;
    let base, over;
    try {
      base = await load(baseBlob);
      over = await load(overlayBlob);
    } catch (err) { return null; }

    const w = base.naturalWidth, h = base.naturalHeight;
    if (!w || !h) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.drawImage(base, 0, 0, w, h);

    const ow = over.naturalWidth, oh = over.naturalHeight;
    if (ow && oh) {
      const scale = Math.min(w / ow, h / oh);
      const dw = ow * scale, dh = oh * scale;
      g.drawImage(over, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }

    /* PNG unless the caller asks otherwise. A memory that arrived as a JPEG
       goes back out as a JPEG at high quality, because writing a photograph
       out as PNG multiplies its size for no gain - but an overlay has soft
       edges, so the quality has to be high enough not to fringe them. */
    const out = type === "image/jpeg" ? "image/jpeg" : "image/png";
    return await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), out, out === "image/jpeg" ? 0.95 : undefined);
    });
  }

  /* Whether this memory can actually be merged.
   *
   * A video cannot: burning a caption into an mp4 means re-encoding it, which
   * is a video encoder's job and not something to do to somebody's whole
   * library in a browser tab. Those keep the overlay beside them and the
   * viewer draws it on top, which is honest - the file on disk is unchanged
   * and the caption is still visible. */
  const canMerge = (m) => !!(m && m.overlay && m.kind === "photo" && m.renderable);

  return { merge, canMerge };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MOverlay;
