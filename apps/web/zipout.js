"use strict";

/* Muletto - writing a zip, in the browser, without holding it in memory.

   Saving into a folder is the better option where the browser allows it, but
   Safari and Firefox do not, and plenty of people just want one file to drag
   onto a NAS. That has to work for a 60 GB library, which rules out building
   the archive as a blob and rules out any library that does.

   So entries are streamed: each one is compressed as it is read and handed
   straight to the download, and only the central directory - a few dozen bytes
   per file - is held until the end. Zip64 fields are written whenever a size
   or an offset could exceed 4 GB, because a photo library will.

   Nothing here uploads anything. The stream goes to the user's own disk. */

const MZipOut = (function () {
  const LFH = 0x04034b50, CDH = 0x02014b50, EOCD = 0x06054b50;
  const EOCD64 = 0x06064b50, LOC64 = 0x07064b50;
  const ZIP64_LIMIT = 0xffffffff;

  /* CRC32, table-driven. The zip format demands it per entry, and it is the
     same checksum we already read on the way in. */
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, seed) {
    let c = (seed === undefined ? 0xffffffff : seed) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return c >>> 0;
  }

  function dosTime(d) {
    const t = d || new Date();
    const year = Math.max(1980, t.getFullYear());
    return {
      time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate(),
    };
  }

  const enc = new TextEncoder();

  function u8(len) { return new Uint8Array(len); }

  /* A zip writer that pushes bytes into a WritableStream as they are made. */
  function create(writable) {
    const w = writable.getWriter();
    const central = [];
    let offset = 0;

    async function put(bytes) {
      await w.write(bytes);
      offset += bytes.length;
    }

    /* One entry. `source` is a Uint8Array or a ReadableStream of them.
       Compression is optional because a JPEG does not get smaller and the
       time spent trying is time the user waits. */
    async function add(name, source, opts) {
      const o = opts || {};
      const nameBytes = enc.encode(name);
      const { time, date } = dosTime(o.date);
      const deflate = !!o.deflate && typeof CompressionStream !== "undefined";
      const localOffset = offset;

      // Sizes are unknown until the data is through, so the local header says
      // so and a data descriptor follows the payload.
      const head = u8(30 + nameBytes.length);
      const hv = new DataView(head.buffer);
      hv.setUint32(0, LFH, true);
      hv.setUint16(4, 45, true);              // needs zip64
      hv.setUint16(6, 0x0008, true);          // sizes in a trailing descriptor
      hv.setUint16(8, deflate ? 8 : 0, true);
      hv.setUint16(10, time, true);
      hv.setUint16(12, date, true);
      hv.setUint16(26, nameBytes.length, true);
      head.set(nameBytes, 30);
      await put(head);

      let crc = 0xffffffff, raw = 0, packed = 0;
      const sink = new WritableStream({
        write: async (chunk) => { packed += chunk.length; await put(chunk); },
      });

      let input = source;
      if (input instanceof Uint8Array) {
        const bytes = input;
        input = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
      }
      // Count and checksum the original bytes on the way past.
      const counted = input.pipeThrough(new TransformStream({
        transform(chunk, c) { raw += chunk.length; crc = crc32(chunk, crc); c.enqueue(chunk); },
      }));
      await (deflate ? counted.pipeThrough(new CompressionStream("deflate-raw")) : counted).pipeTo(sink);
      crc = (crc ^ 0xffffffff) >>> 0;

      const desc = u8(24);
      const dv = new DataView(desc.buffer);
      dv.setUint32(0, 0x08074b50, true);
      dv.setUint32(4, crc, true);
      dv.setBigUint64(8, BigInt(packed), true);   // zip64 descriptor
      dv.setBigUint64(16, BigInt(raw), true);
      await put(desc);

      central.push({ nameBytes, crc, packed, raw, time, date, localOffset, deflate });
      return raw;
    }

    async function close() {
      const cdStart = offset;
      for (const e of central) {
        const needs64 = e.raw > ZIP64_LIMIT || e.packed > ZIP64_LIMIT || e.localOffset > ZIP64_LIMIT;
        const extra = needs64 ? 28 : 0;
        const rec = u8(46 + e.nameBytes.length + extra);
        const v = new DataView(rec.buffer);
        v.setUint32(0, CDH, true);
        v.setUint16(4, 45, true);
        v.setUint16(6, 45, true);
        v.setUint16(8, 0x0008, true);
        v.setUint16(10, e.deflate ? 8 : 0, true);
        v.setUint16(12, e.time, true);
        v.setUint16(14, e.date, true);
        v.setUint32(16, e.crc, true);
        v.setUint32(20, needs64 ? ZIP64_LIMIT : e.packed, true);
        v.setUint32(24, needs64 ? ZIP64_LIMIT : e.raw, true);
        v.setUint16(28, e.nameBytes.length, true);
        v.setUint16(30, extra, true);
        v.setUint32(42, needs64 ? ZIP64_LIMIT : e.localOffset, true);
        rec.set(e.nameBytes, 46);
        if (needs64) {
          const x = new DataView(rec.buffer, 46 + e.nameBytes.length);
          x.setUint16(0, 0x0001, true);
          x.setUint16(2, 24, true);
          x.setBigUint64(4, BigInt(e.raw), true);
          x.setBigUint64(12, BigInt(e.packed), true);
          x.setBigUint64(20, BigInt(e.localOffset), true);
        }
        await put(rec);
      }
      const cdSize = offset - cdStart;

      // Always write the zip64 records: they cost 76 bytes and remove any
      // chance of a large library producing an archive nothing can open.
      const z64 = u8(56 + 20);
      const zv = new DataView(z64.buffer);
      zv.setUint32(0, EOCD64, true);
      zv.setBigUint64(4, BigInt(44), true);
      zv.setUint16(12, 45, true);
      zv.setUint16(14, 45, true);
      zv.setBigUint64(24, BigInt(central.length), true);
      zv.setBigUint64(32, BigInt(central.length), true);
      zv.setBigUint64(40, BigInt(cdSize), true);
      zv.setBigUint64(48, BigInt(cdStart), true);
      zv.setUint32(56, LOC64, true);
      zv.setBigUint64(64, BigInt(cdStart + cdSize), true);
      zv.setUint32(72, 1, true);
      await put(z64);

      const end = u8(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, EOCD, true);
      ev.setUint16(8, Math.min(central.length, 0xffff), true);
      ev.setUint16(10, Math.min(central.length, 0xffff), true);
      ev.setUint32(12, cdSize > ZIP64_LIMIT ? ZIP64_LIMIT : cdSize, true);
      ev.setUint32(16, cdStart > ZIP64_LIMIT ? ZIP64_LIMIT : cdStart, true);
      await put(end);

      await w.close();
      return offset;
    }

    return { add, close, get bytesWritten() { return offset; } };
  }

  return { create, crc32 };
})();
