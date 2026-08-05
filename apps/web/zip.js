"use strict";

/* Muletto - zip reading and extraction.

   Everything here runs on the user's machine; nothing is uploaded.

   The archive is NEVER loaded into memory as a whole. Browsers refuse to
   allocate an ArrayBuffer of even 2 GB, and a photo export is routinely tens
   or hundreds of gigabytes, so we read only the byte ranges we actually need
   through File.slice(): the end-of-directory record, the central directory,
   and then one entry at a time. Peak memory is the size of the single largest
   file being read, not the size of the archive. */

const MZip = (function () {
  const EOCD = 0x06054b50;
  const EOCD64_LOC = 0x07064b50;
  const EOCD64 = 0x06064b50;
  const CEN = 0x02014b50;
  const LFH = 0x04034b50;

  // Read a byte range from the file on disk.
  async function readRange(file, start, length) {
    const end = Math.min(file.size, start + length);
    if (start >= file.size || end <= start) return new Uint8Array(0);
    const buf = await file.slice(start, end).arrayBuffer();
    return new Uint8Array(buf);
  }

  /* Read the central directory. Touches only the tail of the archive. */
  async function readDirectory(file) {
    // The end-of-central-directory record sits in the last 22 bytes plus up to
    // 64 KB of trailing comment.
    const tailLen = Math.min(file.size, 22 + 65535);
    const tail = await readRange(file, file.size - tailLen, tailLen);
    const tdv = new DataView(tail.buffer);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tdv.getUint32(i, true) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) {
      throw new Error("This does not look like a .zip export. Make sure you are opening the file the provider gave you.");
    }

    let count = tdv.getUint16(eocd + 10, true);
    let cenSize = tdv.getUint32(eocd + 12, true);
    let cenOff = tdv.getUint32(eocd + 16, true);

    // zip64: real values live in a separate record for large archives
    if (cenOff === 0xffffffff || cenSize === 0xffffffff || count === 0xffff) {
      const locAt = eocd - 20;
      if (locAt >= 0 && tdv.getUint32(locAt, true) === EOCD64_LOC) {
        const recOff = Number(tdv.getBigUint64(locAt + 8, true));
        const rec = await readRange(file, recOff, 56);
        const rdv = new DataView(rec.buffer);
        if (rdv.getUint32(0, true) === EOCD64) {
          count = Number(rdv.getBigUint64(32, true));
          cenSize = Number(rdv.getBigUint64(40, true));
          cenOff = Number(rdv.getBigUint64(48, true));
        }
      }
    }

    // The central directory is small relative to the archive (roughly 50 bytes
    // per file), so reading it whole is safe even for huge exports.
    const cen = await readRange(file, cenOff, cenSize);
    const dv = new DataView(cen.buffer);
    const dec = new TextDecoder();

    const entries = [];
    let off = 0;
    for (let n = 0; n < count; n++) {
      if (off + 46 > cen.length || dv.getUint32(off, true) !== CEN) break;
      /* Bit 0 of the general purpose flags means the entry is encrypted. It
         costs two bytes to read and it is the difference between "this export
         appears to be empty" and "this export is password protected", which is
         the entire explanation a reader needs. Samsung ships exactly this. */
      const flags = dv.getUint16(off + 8, true);
      const encrypted = (flags & 1) === 1;
      /* Bit 3 says the sizes and CRC were not known when the entry was written
         and follow it in a descriptor. It matters for ZipCrypto: the byte that
         says whether a password is right is the top of the CRC normally, and
         the top of the modification time when this bit is set, because there
         was no CRC yet to take it from. */
      const descriptor = (flags & 8) === 8;
      const method = dv.getUint16(off + 10, true);
      const modTime = dv.getUint16(off + 12, true);
      const crc = dv.getUint32(off + 16, true);
      let compSize = dv.getUint32(off + 20, true);
      let size = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      let localOff = dv.getUint32(off + 42, true);
      const name = dec.decode(cen.subarray(off + 46, off + 46 + nameLen));

      if (size === 0xffffffff || compSize === 0xffffffff || localOff === 0xffffffff) {
        let p = off + 46 + nameLen;
        const end = p + extraLen;
        while (p + 4 <= end) {
          const id = dv.getUint16(p, true), len = dv.getUint16(p + 2, true);
          if (id === 0x0001) {
            let q = p + 4;
            if (size === 0xffffffff) { size = Number(dv.getBigUint64(q, true)); q += 8; }
            if (compSize === 0xffffffff) { compSize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (localOff === 0xffffffff) { localOff = Number(dv.getBigUint64(q, true)); }
            break;
          }
          p += 4 + len;
        }
      }

      if (!name.endsWith("/")) entries.push({ name, size, compSize, crc, method, localOff,
        encrypted, descriptor, modTime });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /* One password per archive: every entry in it needs the same one, so it
     lives on the module rather than being threaded through every call. */
  const api = { password: null };

  /* The WinZip AES extra field, 0x9901. It carries the key strength and the
     compression method that would have been in the header if the header were
     not busy saying 99. */
  function readAesExtra(extra) {
    if (!extra) return null;
    const dv = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    for (let o = 0; o + 4 <= extra.length;) {
      const id = dv.getUint16(o, true);
      const size = dv.getUint16(o + 2, true);
      if (id === 0x9901 && size >= 7) {
        return { strength: extra[o + 8], method: dv.getUint16(o + 9, true) };
      }
      o += 4 + size;
    }
    return null;
  }

  /* Extract one entry, reading only that entry's bytes from disk. */
  /* Which blob an entry actually lives in.

     An entry from a nested archive carries offsets into that archive, not into
     the file on disk, so reading it against the outer file returns whatever
     happens to be at those bytes - usually a damaged-entry error, occasionally
     silent nonsense. Entries expanded out of a nested zip carry the inner blob
     with them, and every read here goes through this rather than the file it
     was handed. That way the twenty-seven callers do not have to know nested
     archives exist. */
  const src = (file, entry) => (entry && entry.blob) || file;

  async function extract(file, entry) {
    const f = src(file, entry);
    const head = await readRange(f, entry.localOff, 30);
    const hdv = new DataView(head.buffer);
    if (head.length < 30 || hdv.getUint32(0, true) !== LFH) {
      throw new Error("Damaged entry: " + entry.name);
    }
    const nameLen = hdv.getUint16(26, true);
    const extraLen = hdv.getUint16(28, true);
    const dataStart = entry.localOff + 30 + nameLen + extraLen;
    /* Only read when there is something encrypted to describe. */
    const extra = (entry.encrypted || entry.method === 99) && extraLen
      ? await readRange(f, entry.localOff + 30 + nameLen, extraLen)
      : null;

    /* Refuse early and say why. Without this the deflate stream fails on
       ciphertext with something unhelpful about a corrupt archive, and the
       reader is left believing their export is broken when it is merely
       locked. Method 99 is WinZip AES, where the method field itself is
       replaced, so it is caught here too. */
    /* Encrypted entries are decrypted here, before anything tries to inflate
       them. The real compression method is inside the AES extra field, so it
       is only known after the local header has been read - which is why this
       sits here rather than beside the central directory parse. */
    let method = entry.method;
    let cipherBytes = null;
    if (entry.encrypted || method === 99) {
      const password = api.password;
      if (!password) {
        const err = new Error("Password protected: " + entry.name);
        err.encrypted = true;
        throw err;
      }
      const aes = method === 99 ? readAesExtra(extra) : null;
      if (method === 99 && !aes) throw new Error("Unreadable AES header in " + entry.name);
      const raw = await readRange(f, dataStart, entry.compSize);
      if (aes) {
        cipherBytes = await MZipCrypt.decryptAes(raw, password, aes.strength);
        method = aes.method;
      } else {
        // ZipCrypto. The twelfth decrypted byte has to match the CRC's top
        // byte, which is what tells a wrong password from a right one.
        const checkByte = entry.descriptor
          ? (entry.modTime >>> 8) & 0xff
          : (entry.crc >>> 24) & 0xff;
        cipherBytes = MZipCrypt.decryptZipCrypto(raw, password, checkByte);
        }
    }

    if (method === 0) {
      return cipherBytes || readRange(f, dataStart, entry.size);
    }
    if (method !== 8) {
      throw new Error("Unsupported compression in " + entry.name);
    }
    if (cipherBytes) {
      // Already in memory and already plaintext; inflate it where it stands.
      const stream = new Blob([cipherBytes]).stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot decompress files. Try a recent Chrome, Edge, Firefox or Safari.");
    }
    // Stream the compressed bytes straight from disk through the inflater, so
    // even a very large single file never sits in memory twice.
    const slice = f.slice(dataStart, dataStart + entry.compSize);
    const stream = slice.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* A readable stream of one entry's decompressed bytes.
     Needed for files far too large to hold in memory - a Gmail mailbox can be
     tens of gigabytes - so callers can consume them incrementally. */
  async function streamEntry(file, entry) {
    /* An encrypted entry cannot be streamed: the bytes on disk are ciphertext
       and feeding them to the inflater throws. Decrypting needs the whole
       entry anyway - the check bytes are at the front and the counter runs
       from there - so it is read in full and handed back as a stream over the
       plaintext. Without this, every caller that reads only the head of an
       entry silently found nothing in a locked archive: EXIF dates, and the
       first-bytes check that recognises a picture with no file extension. */
    if (entry.encrypted || entry.method === 99) {
      const bytes = await extract(file, entry);
      return new Blob([bytes]).stream();
    }
    const f = src(file, entry);
    const head = await readRange(f, entry.localOff, 30);
    const hdv = new DataView(head.buffer);
    if (head.length < 30 || hdv.getUint32(0, true) !== LFH) {
      throw new Error("Damaged entry: " + entry.name);
    }
    const dataStart = entry.localOff + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
    const raw = f.slice(dataStart, dataStart + (entry.method === 0 ? entry.size : entry.compSize));
    return entry.method === 0
      ? raw.stream()
      : raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  }

  async function extractText(file, entry) {
    return new TextDecoder("utf-8").decode(await extract(file, entry));
  }

  async function extractJson(file, entry) {
    return JSON.parse(await extractText(file, entry));
  }

  /* Streamed, for the same reason `expandNested` is: `extract` returns one
     contiguous Uint8Array, and that allocation throws above about 2 GB. A
     Google Takeout can hold a 5.3 GB video, so every caller that only wants a
     Blob - a poster frame, a clip to play, a file to write out - would have
     failed on it while the same file streams for 12 MB of heap. */
  async function extractBlob(file, entry, type) {
    const stream = await streamEntry(file, entry);
    const blob = await new Response(stream).blob();
    return type ? new Blob([blob], { type }) : blob;
  }

  /* Just the front of an entry.

     EXIF lives in the first APP1 marker, within the first few tens of
     kilobytes of a JPEG, so decompressing a whole 5 MB photo to read its date
     is pure waste. Reading the stream and cancelling once we have enough
     leaves the rest of the entry untouched. */
  async function readHead(file, entry, max = 128 * 1024) {
    const stream = await streamEntry(file, entry);
    const reader = stream.getReader();
    const parts = [];
    let n = 0;
    try {
      while (n < max) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
      }
    } finally {
      try { await reader.cancel(); } catch (_) { /* already closed */ }
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }


  /* Archives inside archives.
   *
   * Apple answers one request with eighteen zips, seven of which contain more
   * zips. In a real export that hid 394 entries: 57 spreadsheets of purchase
   * history in Apple_Media_Services.zip and 319 Siri recordings in another.
   * They were on screen as nothing at all, and no count anywhere said so.
   *
   * Each one is read out, kept as a blob, and its entries folded into the
   * outer listing under a joined name. They carry the blob with them so every
   * later read goes to the right bytes.
   *
   * Bounded on purpose: an archive that contains itself, or a zip bomb, must
   * not be able to spend the tab. Whatever is refused is reported rather than
   * dropped quietly.
   *
   * Size is not the bound it looks like. The first version of this refused
   * anything over 512 MB, which shut out the 1.34 GB of Siri recordings in
   * Apple's Other Data, on the reasoning that a gigabyte cannot be held in a
   * tab. That was wrong, and measuring said so: the only thing that could not
   * survive a gigabyte was `extract`, which returns one contiguous Uint8Array,
   * and a contiguous allocation is exactly what fails first - 1.5 GB is fine
   * on a desktop and 2 GB throws RangeError on the same machine.
   *
   * Streamed into a Blob instead, 1.5 GB costs 12 MB of JS heap, because the
   * browser pages blob storage to disk. Slices out of it still read. So the
   * archive is never held in memory at all, and the byte budget is about disk
   * and patience rather than about what will fit.
   */
  const NEST = {
    depth: 3,
    archives: 40,
    bytes: 6 * 1024 * 1024 * 1024,   // total inflated, across every nested archive
    /* The one case still bounded by memory. An encrypted entry cannot be
       streamed - the check bytes are at the front and the counter runs from
       there - so it goes through `extract` and does need a contiguous
       allocation. Kept well under what a phone will give us. */
    encryptedBytes: 256 * 1024 * 1024,
  };

  async function expandNested(file, entries, budget, onProgress) {
    const cap = Object.assign({}, NEST, budget || {});
    const out = entries.slice();
    const skipped = [];
    let opened = 0, bytes = 0;

    /* Streamed, not allocated. `extract` would build the whole inflated
       archive as one Uint8Array first, and that single allocation was the
       entire reason a large archive could not be opened. */
    async function blobOf(host, e) {
      const stream = await streamEntry(host, e);
      return await new Response(stream).blob();
    }

    /* Escaped, and written here rather than built in any generator: as an
       unescaped /.zip$/ the dot matched any character, so this claimed every
       name ending in "zip" was an archive - "unzip", "gzip", a folder called
       "Winzip" - and each one was then extracted in full before failing to
       parse. */
    const IS_ZIP = /\.zip$/i;

    async function walk(host, list, prefix, depth) {
      if (depth > cap.depth) return;
      for (const e of list) {
        if (!IS_ZIP.test(e.name) || !e.size) continue;
        const encrypted = e.encrypted || e.method === 99;
        if (encrypted && e.size > cap.encryptedBytes) {
          // The only remaining size refusal, and it is about the contiguous
          // allocation decryption needs, not about the archive being large.
          skipped.push({ name: prefix + e.name, size: e.size, reason: "size" });
          continue;
        }
        if (opened >= cap.archives || bytes + e.size > cap.bytes) {
          skipped.push({ name: prefix + e.name, size: e.size, reason: "budget" });
          continue;
        }
        let inner, blob;
        try {
          if (onProgress) onProgress({ name: prefix + e.name, size: e.size });
          blob = await blobOf(host, e);
          inner = await readDirectory(blob);
        } catch (err) {
          // Damaged, not really an archive, or too large even to stream.
          const why = /allocation|Array buffer|out of memory/i.test(String(err && err.message))
            ? "size" : "unreadable";
          skipped.push({ name: prefix + e.name, size: e.size, reason: why });
          continue;
        }
        opened++;
        bytes += e.size;
        const here = prefix + e.name + "/";
        const tagged = inner.map((x) => Object.assign({}, x, {
          name: here + x.name,
          blob,
          nestedIn: prefix + e.name,
        }));
        out.push(...tagged);
        await walk(blob, inner, here, depth + 1);
      }
    }

    await walk(file, entries, "", 1);
    return { entries: out, opened, skipped };
  }

  /* The password for encrypted entries, set by whoever asked the reader for
     one. Kept here rather than threaded through every call because an archive
     has one password and every entry in it needs the same one. */
  Object.assign(api, { readDirectory, extract, streamEntry, readHead, extractText,
    extractJson, extractBlob, expandNested });
  return api;
})();
