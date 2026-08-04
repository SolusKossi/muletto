"use strict";

/* Muletto - video metadata and poster frames.

   Two things are worth having from a video without ever re-encoding it:

   1. The real recording date. MP4 and MOV keep it in the `mvhd` box as a fixed
      width field, so we can find it by walking the top-level boxes - reading
      16 bytes per box rather than the file - and it can later be written back
      the same way. Timestamps count seconds from 1904, not 1970.

   2. A poster frame, so the library looks like a library instead of a file list.

   Re-encoding is deliberately out of scope: hours of CPU and a quality loss for
   very little gain. */

const MVideo = (function () {
  const EPOCH_OFFSET = 2082844800;   // seconds between 1904-01-01 and 1970-01-01

  const type4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  async function readAt(blob, start, length) {
    const end = Math.min(blob.size, start + length);
    if (start >= blob.size || end <= start) return new Uint8Array(0);
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  /* Walk top-level boxes by header only, so finding `moov` costs a few reads
     even when it sits at the end of a multi-gigabyte file (which is where
     iPhone recordings put it). */
  async function findBox(blob, wanted) {
    let off = 0;
    for (let guard = 0; guard < 512 && off + 8 <= blob.size; guard++) {
      const head = await readAt(blob, off, 16);
      if (head.length < 8) break;
      const dv = new DataView(head.buffer);
      let size = dv.getUint32(0);
      const t = type4(head, 4);
      let headLen = 8;
      if (size === 1) { size = Number(dv.getBigUint64(8)); headLen = 16; }
      else if (size === 0) size = blob.size - off;
      if (size < headLen) break;
      if (t === wanted) return { start: off + headLen, end: off + size };
      off += size;
    }
    return null;
  }

  /* Recording date from mvhd, or null when the file does not carry one. */
  async function readCreationDate(blob) {
    const moov = await findBox(blob, "moov");
    if (!moov) return null;
    // mvhd is the first child of moov, so a small read covers it.
    const chunk = await readAt(blob, moov.start, 128);
    if (chunk.length < 20) return null;
    const dv = new DataView(chunk.buffer);
    let off = 0;
    while (off + 8 <= chunk.length) {
      const size = dv.getUint32(off);
      const t = type4(chunk, off + 4);
      if (t !== "mvhd") { if (size < 8) break; off += size; continue; }
      const version = chunk[off + 8];
      let seconds;
      if (version === 1) seconds = Number(dv.getBigUint64(off + 12));
      else seconds = dv.getUint32(off + 12);
      if (!seconds) return null;
      const d = new Date((seconds - EPOCH_OFFSET) * 1000);
      // Guard against files whose header is zeroed or nonsensical.
      const year = d.getUTCFullYear();
      return year >= 1990 && year <= 2100 ? d : null;
    }
    return null;
  }

  /* Grab a frame for use as a thumbnail. Returns null if the platform has no
     codec for this file, which is common for HEVC .mov outside Safari. */
  function posterFrame(blob, { seekTo = 1.0, maxEdge = 480 } = {}) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement("video");
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        v.removeAttribute("src");
        resolve(result);
      };
      v.muted = true; v.playsInline = true; v.preload = "metadata";
      v.onerror = () => done(null);
      v.onloadedmetadata = () => {
        // A very short clip may be shorter than the requested seek point.
        v.currentTime = Math.min(seekTo, Math.max(0, (v.duration || 0) / 2));
      };
      v.onseeked = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(v.videoWidth * scale));
          c.height = Math.max(1, Math.round(v.videoHeight * scale));
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          c.toBlob((b) => done(b), "image/jpeg", 0.8);
        } catch { done(null); }
      };
      setTimeout(() => done(null), 8000);   // never hang the gallery on one file
      v.src = url;
    });
  }

  return { readCreationDate, posterFrame, findBox };
})();
