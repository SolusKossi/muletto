"use strict";

/* Muletto - HEIC / HEIF / AVIF decoding.

   Browsers will not render HEIC in an <img> tag, which matters because HEIC is
   the default iPhone camera format and therefore most of an Apple export.

   A HEIC file is an HEVC intra-frame inside an ISOBMFF (HEIF) container; AVIF is
   the same container with AV1. Rather than shipping a decoder - which would mean
   an LGPL dependency and HEVC patent exposure in a paid product - we parse the
   container ourselves and hand the coded frame to WebCodecs, so the decode is
   done by the codec the operating system already licenses.

   The container parsing is validated against a real AVIF. The HEVC path differs
   only in which config box is read (hvcC instead of av1C) and the codec string
   handed to WebCodecs; it still needs checking against a real iPhone file. */

const MHeif = (function () {
  const txt = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  function u(dv, off, size) {
    if (size === 0) return 0;
    if (size === 1) return dv.getUint8(off);
    if (size === 2) return dv.getUint16(off);
    if (size === 4) return dv.getUint32(off);
    if (size === 8) return Number(dv.getBigUint64(off));
    return 0;
  }

  /* Walk the boxes at one level. cb(type, payloadStart, payloadEnd). */
  function boxes(bytes, start, end, cb) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      const type = txt(bytes, off + 4);
      let head = 8;
      if (size === 1) { size = Number(dv.getBigUint64(off + 8)); head = 16; }
      else if (size === 0) size = end - off;
      if (size < head || off + size > end) break;
      cb(type, off + head, off + size);
      off += size;
    }
  }

  /* Parse the metadata needed to decode the primary image. */
  function parse(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    let metaStart = -1, metaEnd = -1, brand = "";

    boxes(bytes, 0, bytes.length, (type, s, e) => {
      if (type === "ftyp") brand = txt(bytes, s);
      if (type === "meta") { metaStart = s + 4; metaEnd = e; }  // FullBox: skip version+flags
    });
    if (metaStart < 0) throw new Error("Not a HEIF image (no meta box)");

    let primary = 0;
    const itemTypes = new Map();      // itemId -> 'hvc1' | 'av01' | 'grid' | 'Exif'
    const locations = new Map();      // itemId -> [{offset, length}]
    const props = [];                 // ipco children, 1-indexed by position
    const assoc = new Map();          // itemId -> [propertyIndex]
    const refs = new Map();           // itemId -> {type: [toIds]}

    boxes(bytes, metaStart, metaEnd, (type, s, e) => {
      if (type === "pitm") {
        const v = dv.getUint8(s);
        primary = v === 0 ? dv.getUint16(s + 4) : dv.getUint32(s + 4);

      } else if (type === "iinf") {
        const v = dv.getUint8(s);
        const listStart = s + 4 + (v === 0 ? 2 : 4);
        boxes(bytes, listStart, e, (t2, s2) => {
          if (t2 !== "infe") return;
          const v2 = dv.getUint8(s2);
          const idSize = v2 >= 3 ? 4 : 2;
          const id = u(dv, s2 + 4, idSize);
          itemTypes.set(id, txt(bytes, s2 + 4 + idSize + 2));
        });

      } else if (type === "iloc") {
        const v = dv.getUint8(s);
        let p = s + 4;
        const offSize = bytes[p] >> 4, lenSize = bytes[p] & 15;
        const baseSize = bytes[p + 1] >> 4, idxSize = bytes[p + 1] & 15;
        p += 2;
        const count = v < 2 ? dv.getUint16(p) : dv.getUint32(p);
        p += v < 2 ? 2 : 4;
        for (let i = 0; i < count; i++) {
          const id = v < 2 ? dv.getUint16(p) : dv.getUint32(p);
          p += v < 2 ? 2 : 4;
          if (v === 1 || v === 2) p += 2;               // construction_method
          p += 2;                                        // data_reference_index
          const base = u(dv, p, baseSize); p += baseSize;
          const extents = dv.getUint16(p); p += 2;
          const list = [];
          for (let x = 0; x < extents; x++) {
            if ((v === 1 || v === 2) && idxSize > 0) p += idxSize;
            const o = u(dv, p, offSize); p += offSize;
            const l = u(dv, p, lenSize); p += lenSize;
            list.push({ offset: base + o, length: l });
          }
          locations.set(id, list);
        }

      } else if (type === "iprp") {
        boxes(bytes, s, e, (t2, s2, e2) => {
          if (t2 === "ipco") {
            boxes(bytes, s2, e2, (t3, s3, e3) => props.push({ type: t3, start: s3, end: e3 }));
          } else if (t2 === "ipma") {
            const v2 = dv.getUint8(s2), flags = dv.getUint32(s2) & 0xffffff;
            let p = s2 + 4;
            const entries = dv.getUint32(p); p += 4;
            for (let i = 0; i < entries; i++) {
              const id = v2 < 1 ? dv.getUint16(p) : dv.getUint32(p);
              p += v2 < 1 ? 2 : 4;
              const n = dv.getUint8(p); p += 1;
              const list = [];
              for (let a = 0; a < n; a++) {
                if (flags & 1) { list.push(dv.getUint16(p) & 0x7fff); p += 2; }
                else { list.push(dv.getUint8(p) & 0x7f); p += 1; }
              }
              assoc.set(id, list);
            }
          }
        });

      } else if (type === "iref") {
        boxes(bytes, s + 4, e, (t2, s2) => {
          const from = dv.getUint16(s2);
          const n = dv.getUint16(s2 + 2);
          const to = [];
          for (let i = 0; i < n; i++) to.push(dv.getUint16(s2 + 4 + i * 2));
          if (!refs.has(from)) refs.set(from, {});
          refs.get(from)[t2] = to;
        });
      }
    });

    const propsFor = (id) => (assoc.get(id) || []).map((i) => props[i - 1]).filter(Boolean);
    const findProp = (id, type) => propsFor(id).find((p) => p && p.type === type);

    function sizeOf(id) {
      const ispe = findProp(id, "ispe");
      if (!ispe) return null;
      return { width: dv.getUint32(ispe.start + 4), height: dv.getUint32(ispe.start + 8) };
    }
    function configOf(id) {
      for (const name of ["hvcC", "av1C", "vvcC"]) {
        const p = findProp(id, name);
        if (p) return { name, bytes: bytes.subarray(p.start, p.end) };
      }
      return null;
    }
    const codecFor = (cfgName) => (cfgName === "hvcC" ? "hvc1.1.6.L93.B0" : "av01.0.04M.08");

    const primaryType = itemTypes.get(primary) || "";

    // iPhone photos are usually stored as a grid of separately coded tiles.
    if (primaryType === "grid") {
      const loc = (locations.get(primary) || [])[0];
      if (!loc) throw new Error("Grid item has no data");
      const g = bytes.subarray(loc.offset, loc.offset + loc.length);
      const gdv = new DataView(g.buffer, g.byteOffset);
      const flags = g[1];
      const rows = g[2] + 1, cols = g[3] + 1;
      const big = flags & 1;
      const outW = big ? gdv.getUint32(4) : gdv.getUint16(4);
      const outH = big ? gdv.getUint32(8) : gdv.getUint16(6);
      const tileIds = ((refs.get(primary) || {}).dimg) || [];
      if (!tileIds.length) throw new Error("Grid image references no tiles");
      const cfg = configOf(tileIds[0]);
      if (!cfg) throw new Error("No decoder configuration for grid tiles");
      const tSize = sizeOf(tileIds[0]) || { width: Math.ceil(outW / cols), height: Math.ceil(outH / rows) };
      return {
        kind: "grid", brand, width: outW, height: outH, rows, cols,
        tileWidth: tSize.width, tileHeight: tSize.height,
        codec: codecFor(cfg.name), description: cfg.bytes,
        tiles: tileIds.map((id) => (locations.get(id) || [])[0]).filter(Boolean),
      };
    }

    const cfg = configOf(primary);
    const size = sizeOf(primary);
    const loc = (locations.get(primary) || [])[0];
    if (!cfg || !loc || !size) throw new Error("Unsupported HEIF layout");
    return {
      kind: "single", brand, width: size.width, height: size.height,
      codec: codecFor(cfg.name), description: cfg.bytes,
      tiles: [loc],
    };
  }

  async function decodeChunk(info, bytes, extent) {
    let frame = null;
    const dec = new VideoDecoder({
      output: (f) => { if (frame) f.close(); else frame = f; },
      error: () => {},
    });
    dec.configure({
      codec: info.codec,
      description: info.description,
      codedWidth: info.kind === "grid" ? info.tileWidth : info.width,
      codedHeight: info.kind === "grid" ? info.tileHeight : info.height,
      hardwareAcceleration: "no-preference",
    });
    dec.decode(new EncodedVideoChunk({
      type: "key", timestamp: 0,
      data: bytes.subarray(extent.offset, extent.offset + extent.length),
    }));
    await dec.flush();
    try { dec.close(); } catch { /* already closed */ }
    if (!frame) throw new Error("decoder produced no frame");
    return frame;
  }

  /* Decode to a canvas. Returns null when the platform has no codec for it. */
  async function decode(bytes) {
    if (typeof VideoDecoder === "undefined") return null;
    const info = parse(bytes);
    const support = await VideoDecoder.isConfigSupported({
      codec: info.codec,
      codedWidth: info.kind === "grid" ? info.tileWidth : info.width,
      codedHeight: info.kind === "grid" ? info.tileHeight : info.height,
    });
    if (!support.supported) return null;

    const canvas = document.createElement("canvas");
    canvas.width = info.width; canvas.height = info.height;
    const ctx = canvas.getContext("2d");

    if (info.kind === "single") {
      const frame = await decodeChunk(info, bytes, info.tiles[0]);
      ctx.drawImage(frame, 0, 0);
      frame.close();
    } else {
      for (let i = 0; i < info.tiles.length; i++) {
        const frame = await decodeChunk(info, bytes, info.tiles[i]);
        const col = i % info.cols, row = Math.floor(i / info.cols);
        ctx.drawImage(frame, col * info.tileWidth, row * info.tileHeight);
        frame.close();
      }
    }
    return canvas;
  }

  /* Decode and re-encode as JPEG, which is what format conversion needs. */
  async function toJpegBlob(bytes, quality = 0.9) {
    const canvas = await decode(bytes);
    if (!canvas) return null;
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  }

  return { parse, decode, toJpegBlob };
})();
