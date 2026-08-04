/* Makes the small copies, off the main thread.

   Decoding a 4000px JPEG is about 50ms and encoding the shrunken result is
   about 3ms. Fifty milliseconds is not much until it is three thousand of
   them: on the main thread that is two and a half minutes during which the
   page cannot draw, scroll or answer a click. Here it is two and a half
   minutes of a few background threads, and the page stays alive throughout.

   It is handed bytes and hands back a small JPEG. It does no reading, no
   storing and no network - it cannot, there is nothing here to do it with.

   Each message is independent, so a picture that fails to decode returns an
   error for itself and the rest carry on. A library of thousands always has a
   few files in it that nothing can open. */
"use strict";

const MAX = 320;          // longest edge of the stored copy
const QUALITY = 0.72;

async function shrink(bytes, type) {
  const blob = new Blob([bytes], { type: type || "image/jpeg" });

  /* Resizing during the decode is not reliably faster - measured at 62ms
     against 50ms for a full decode of a 4032x3024 JPEG - so the plain decode
     is used and the scaling happens on the canvas, which is a few
     milliseconds. The reason to do any of this is the size of what is kept,
     not the speed of getting there. */
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
  return { blob: out, w, h };
}

self.onmessage = async (e) => {
  const { id, bytes, type } = e.data || {};
  try {
    const r = await shrink(bytes, type);
    self.postMessage({ id, ok: true, blob: r.blob, w: r.w, h: r.h });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
