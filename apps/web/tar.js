"use strict";

/* Muletto - gzipped tar, because Google offers it and we refused it.
 *
 * Takeout puts .zip and .tgz on the same screen with a dropdown between them.
 * Anyone who picked tgz got "this does not look like a .zip export" and no way
 * forward - the only gap in the product that refused outright rather than
 * degrading. It is also the cheapest to close: gunzip is a browser primitive
 * we already use, and tar is a 512-byte header followed by the file, rounded
 * up to 512, repeated.
 *
 * The awkward part is that gzip is not seekable. A zip is read lazily - the
 * directory is at the end, and any entry can be fetched by offset without
 * touching the rest. A tgz has to be decompressed from the front to reach
 * anything, so laziness is not available.
 *
 * What we do instead: one streaming pass, cutting each member out into its own
 * Blob as it goes by. The browser pages blob storage to disk, so peak memory
 * is one member rather than the archive - and per-member blobs give the random
 * access the rest of the app expects, for free.
 *
 * Deliberately not one big Blob of the decompressed archive. Measured in
 * Chrome, a single Blob fails at 2048 MB while 1500 MB succeeds, so that would
 * have put a ceiling on the whole export rather than on any one file in it.
 * Total blob storage is quota-bound instead - 5.5 GB on the machine this was
 * written on - and when that runs out it is reported rather than hidden.
 */

const MTar = (function () {
  const BLOCK = 512;
  const dec = new TextDecoder();

  const isTgz = (name) => /\.(tgz|tar\.gz)$/i.test(String(name || ""));

  /* Tar stores numbers as octal in ASCII, NUL or space padded. GNU writes
     sizes over 8 GB as base-256 with the high bit of the first byte set,
     which is rare in an export but costs three lines to accept. */
  function readOctal(bytes) {
    if (bytes.length && (bytes[0] & 0x80)) {
      let n = bytes[0] & 0x7f;
      for (let i = 1; i < bytes.length; i++) n = n * 256 + bytes[i];
      return n;
    }
    const s = dec.decode(bytes).replace(/\0.*$/, "").trim();
    if (!s) return 0;
    const n = parseInt(s, 8);
    return isFinite(n) ? n : 0;
  }

  const str = (bytes) => dec.decode(bytes).replace(/\0.*$/, "");

  /* Reads exactly what is asked for out of a stream, buffering the remainder.
     A gzip stream hands back chunks of whatever size it likes and tar needs
     precise 512-byte boundaries, so something has to reconcile the two. */
  function blockReader(stream) {
    const rd = stream.getReader();
    let buf = new Uint8Array(0);
    let done = false;

    async function fill(n) {
      while (buf.length < n && !done) {
        const r = await rd.read();
        if (r.done) { done = true; break; }
        const next = new Uint8Array(buf.length + r.value.length);
        next.set(buf, 0);
        next.set(r.value, buf.length);
        buf = next;
      }
    }
    return {
      async take(n) {
        await fill(n);
        const out = buf.subarray(0, Math.min(n, buf.length));
        buf = buf.subarray(out.length);
        return out;
      },
      async skip(n) {
        let left = n;
        while (left > 0) {
          const got = await this.take(Math.min(left, 1 << 20));
          if (!got.length) break;
          left -= got.length;
        }
      },
      cancel() { try { rd.cancel(); } catch (e) { /* already closed */ } },
    };
  }

  /* Every member, each as its own Blob.
   *
   * Returns entries shaped like the zip reader's, so nothing downstream has to
   * know which kind of archive it came from: `blob` holds the member's bytes
   * and `raw` says read them whole rather than looking for a local header. */
  async function read(file, onProgress) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot open .tgz files. Ask Google for the .zip " +
        "version of your Takeout instead - it is the other option on the same screen.");
    }
    const gz = file.stream().pipeThrough(new DecompressionStream("gzip"));
    const r = blockReader(gz);
    const entries = [];
    let bytes = 0;
    /* A long name is written as its own member of type L, and the name it
       carries belongs to the member after it. */
    let pendingName = "";

    try {
      for (;;) {
        const head = await r.take(BLOCK);
        if (head.length < BLOCK) break;
        // Two zero blocks end the archive; one is enough to stop on.
        let empty = true;
        for (let i = 0; i < BLOCK; i++) if (head[i] !== 0) { empty = false; break; }
        if (empty) break;

        let name = str(head.subarray(0, 100));
        const size = readOctal(head.subarray(124, 136));
        const type = String.fromCharCode(head[156] || 0);
        const prefix = str(head.subarray(345, 500));
        if (prefix) name = prefix + "/" + name;
        if (pendingName) { name = pendingName; pendingName = ""; }

        const padded = Math.ceil(size / BLOCK) * BLOCK;

        if (type === "L") {                       // GNU long name
          const nm = await r.take(size);
          pendingName = str(nm);
          await r.skip(padded - size);
          continue;
        }
        // 0 and NUL are ordinary files; everything else is a directory, a
        // link or metadata, and carries nothing we can show.
        if (type !== "0" && type !== "\0") { await r.skip(padded); continue; }
        if (name.endsWith("/") || !size) { await r.skip(padded); continue; }

        const parts = [];
        let left = size;
        while (left > 0) {
          const got = await r.take(Math.min(left, 1 << 22));
          if (!got.length) break;
          parts.push(got.slice());
          left -= got.length;
        }
        await r.skip(padded - size);

        let blob;
        try {
          blob = new Blob(parts);
        } catch (err) {
          throw new Error("This browser ran out of room while unpacking the archive. " +
            (bytes ? Math.round(bytes / 1048576) + " MB was read first. " : "") +
            "Ask Google for the .zip version instead, which is read without unpacking it.");
        }
        bytes += size;

        entries.push({
          name, size, compSize: size, crc: 0, method: 0, localOff: 0,
          encrypted: false, descriptor: false, modTime: 0,
          blob, raw: true,
        });
        if (onProgress && entries.length % 200 === 0) onProgress(entries.length, bytes);
      }
    } finally {
      r.cancel();
    }
    return entries;
  }

  return { isTgz, read };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MTar;
