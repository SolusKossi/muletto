"use strict";

/* Muletto - writing metadata back into the photo.

   Google and Meta exports keep each photo's real capture date and location in a
   separate metadata file rather than inside the photo. Anything you later import
   the photos into (Photos, Synology, Immich, a NAS) reads the date from inside
   the file, so the library ends up sorted by the day you downloaded it.

   The same argument applies to anything else we work out about a picture. A
   description that lives in this app is worth almost nothing in a tool people
   use once; written into the file it makes the library searchable by content in
   whatever they move it into, for as long as they keep the photo. So captions
   go into the file too.

   Everything here is written in the browser. Only JPEG is handled; other
   formats are reported and left untouched. */

const MExif = (function () {

  const SOI = 0xd8, APP1 = 0xe1, SOS = 0xda;
  const ASCII = 2, LONG = 4, RATIONAL = 5;

  function two(n) { return String(n).padStart(2, "0"); }

  // EXIF wants local wall-clock time as "YYYY:MM:DD HH:MM:SS"
  function exifStamp(d) {
    return `${d.getFullYear()}:${two(d.getMonth() + 1)}:${two(d.getDate())} ` +
           `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }

  function degToDms(v) {
    const abs = Math.abs(v);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60 * 1000);
    return [[deg, 1], [min, 1], [sec, 1000]];
  }

  /* Build the TIFF block that lives inside the APP1 segment. */
  function buildTiff(date, gps, desc) {
    const hasGps = !!(gps && isFinite(gps.lat) && isFinite(gps.lon));
    const stamp = exifStamp(date);
    // ImageDescription is an ASCII tag; anything else is transliterated.
    const text = desc ? String(desc).slice(0, 900).replace(/[^\x20-\x7e]/g, "?") : null;

    const n0 = (hasGps ? 3 : 2) + (text ? 1 : 0);   // IFD0 entries
    const ifd0 = 8;
    const ifd0End = ifd0 + 2 + n0 * 12 + 4;

    const dtOff = ifd0End;                     // DateTime string
    const exifIfd = dtOff + 20;
    const n1 = 2;                              // DateTimeOriginal, DateTimeDigitized
    const exifEnd = exifIfd + 2 + n1 * 12 + 4;
    const dtoOff = exifEnd;
    const dtdOff = dtoOff + 20;

    let gpsIfd = 0, latOff = 0, lonOff = 0, total = dtdOff + 20;
    if (hasGps) {
      gpsIfd = total;
      const n2 = 4;
      const gpsEnd = gpsIfd + 2 + n2 * 12 + 4;
      latOff = gpsEnd;
      lonOff = latOff + 24;
      total = lonOff + 24;
    }
    // The description goes last, so adding one moves nothing else.
    let descOff = 0;
    if (text) { descOff = total; total += text.length + 1; }

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    const LE = true;

    // TIFF header, little-endian
    buf[0] = 0x49; buf[1] = 0x49;
    dv.setUint16(2, 42, LE);
    dv.setUint32(4, 8, LE);

    const ascii = (off, s) => {
      for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
      buf[off + s.length] = 0;
    };
    const entry = (p, tag, type, count, value) => {
      dv.setUint16(p, tag, LE);
      dv.setUint16(p + 2, type, LE);
      dv.setUint32(p + 4, count, LE);
      dv.setUint32(p + 8, value, LE);
    };
    // ASCII values of 4 bytes or fewer are stored inline, not by offset
    const inlineAscii = (p, tag, s) => {
      dv.setUint16(p, tag, LE);
      dv.setUint16(p + 2, ASCII, LE);
      dv.setUint32(p + 4, s.length + 1, LE);
      for (let i = 0; i < s.length; i++) buf[p + 8 + i] = s.charCodeAt(i);
      buf[p + 8 + s.length] = 0;
    };
    const rationals = (off, list) => {
      list.forEach(([num, den], i) => {
        dv.setUint32(off + i * 8, num, LE);
        dv.setUint32(off + i * 8 + 4, den, LE);
      });
    };

    // --- IFD0 ---
    let p = ifd0;
    dv.setUint16(p, n0, LE); p += 2;
    // IFD entries must be in ascending tag order; 0x010E comes before 0x0132.
    if (text) { entry(p, 0x010e, ASCII, text.length + 1, descOff); p += 12; }
    entry(p, 0x0132, ASCII, 20, dtOff); p += 12;        // DateTime
    entry(p, 0x8769, LONG, 1, exifIfd); p += 12;        // Exif IFD pointer
    if (hasGps) { entry(p, 0x8825, LONG, 1, gpsIfd); p += 12; }
    dv.setUint32(p, 0, LE);                             // no IFD1
    ascii(dtOff, stamp);
    if (text) ascii(descOff, text);

    // --- Exif IFD ---
    p = exifIfd;
    dv.setUint16(p, n1, LE); p += 2;
    entry(p, 0x9003, ASCII, 20, dtoOff); p += 12;       // DateTimeOriginal
    entry(p, 0x9004, ASCII, 20, dtdOff); p += 12;       // DateTimeDigitized
    dv.setUint32(p, 0, LE);
    ascii(dtoOff, stamp);
    ascii(dtdOff, stamp);

    // --- GPS IFD ---
    if (hasGps) {
      p = gpsIfd;
      dv.setUint16(p, 4, LE); p += 2;
      inlineAscii(p, 0x0001, gps.lat >= 0 ? "N" : "S"); p += 12;
      entry(p, 0x0002, RATIONAL, 3, latOff); p += 12;
      inlineAscii(p, 0x0003, gps.lon >= 0 ? "E" : "W"); p += 12;
      entry(p, 0x0004, RATIONAL, 3, lonOff); p += 12;
      dv.setUint32(p, 0, LE);
      rationals(latOff, degToDms(gps.lat));
      rationals(lonOff, degToDms(gps.lon));
    }

    return buf;
  }

  /* ---------- XMP ----------

     Descriptions are written as XMP rather than only as an EXIF tag, because
     XMP is what most things actually read: Lightroom, digiKam, Immich, Bridge.
     EXIF ImageDescription is written as well, since some simpler tools read
     only that, and it costs a handful of bytes.

     XMP lives in its own APP1 segment, identified by a namespace URI where the
     EXIF one has "Exif\0\0". A file can carry both, and many do. */
  const XMP_NS = "http://ns.adobe.com/xap/1.0/\u0000";
  const XMP_NS_BYTES = (() => {
    const out = new Uint8Array(XMP_NS.length);
    for (let i = 0; i < XMP_NS.length; i++) out[i] = XMP_NS.charCodeAt(i);
    return out;
  })();

  const xmlEscape = (t) => String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  /* The packet wrapper is not decoration: readers scan for the xpacket
     processing instruction, and the byte-order mark inside it is part of the
     specification. It is written as an escape so this file stays plain ASCII. */
  function xmpPacket(fields) {
    const dc = [];
    if (fields.description) {
      dc.push('    <dc:description><rdf:Alt><rdf:li xml:lang="x-default">' +
        xmlEscape(fields.description) + "</rdf:li></rdf:Alt></dc:description>");
    }
    if (fields.keywords && fields.keywords.length) {
      dc.push("    <dc:subject><rdf:Bag>" +
        fields.keywords.map((k) => "<rdf:li>" + xmlEscape(k) + "</rdf:li>").join("") +
        "</rdf:Bag></dc:subject>");
    }
    return '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Muletto">\n' +
      ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '  <rdf:Description rdf:about=""\n' +
      '    xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      dc.join("\n") + "\n" +
      "  </rdf:Description>\n" +
      " </rdf:RDF>\n" +
      "</x:xmpmeta>\n" +
      '<?xpacket end="w"?>';
  }

  function findSegment(bytes, match) {
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === SOS || marker === 0xd9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if (marker === APP1 && match(bytes, i)) return { start: i, end: i + 2 + len };
      i += 2 + len;
    }
    return null;
  }

  const isExifSeg = (b, i) =>
    b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66;

  const isXmpSeg = (b, i) => {
    for (let k = 0; k < XMP_NS_BYTES.length; k++) {
      if (b[i + 4 + k] !== XMP_NS_BYTES[k]) return false;
    }
    return true;
  };

  /* Splice a segment in just after SOI, dropping any existing one of the same
     kind. Order among APP1 segments does not matter to readers. */
  function spliceSegment(bytes, payload, drop) {
    const segLen = 2 + payload.length;
    if (segLen > 0xffff) throw new Error("segment-too-large");
    const head = new Uint8Array(4);
    head[0] = 0xff; head[1] = APP1;
    head[2] = (segLen >> 8) & 0xff; head[3] = segLen & 0xff;

    const rest = drop
      ? [bytes.subarray(2, drop.start), bytes.subarray(drop.end)]
      : [bytes.subarray(2)];
    const total = 2 + head.length + payload.length + rest.reduce((n, r) => n + r.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    out[o++] = 0xff; out[o++] = SOI;
    out.set(head, o); o += head.length;
    out.set(payload, o); o += payload.length;
    for (const r of rest) { out.set(r, o); o += r.length; }
    return out;
  }

  /* Write a description into the file as XMP.

     Only XMP, and deliberately. Adding an EXIF ImageDescription tag to a photo
     that already has EXIF means inserting an entry into IFD0, which shifts
     every offset after it - including the pointers to the Exif and GPS
     sub-IFDs, and every offset inside those. Getting that subtly wrong
     produces a file that still opens but has lost its date and moved its
     location, which is a far worse outcome than not writing one tag.

     So ImageDescription is written only by writeDate(), which builds the whole
     TIFF block itself and controls every offset in it. When a photo is being
     date-repaired - which is the common case in an export - it gets both. When
     it is not, it gets XMP, which is what Lightroom, digiKam, Immich and
     Bridge read anyway.

     A caption long enough to overflow a single APP1 segment would need the
     ExtendedXMP convention, which almost nothing reads properly. Truncating
     with a clear limit is more honest than writing something unreadable. */
  const MAX_DESCRIPTION = 1800;

  function writeDescription(bytes, text, opts) {
    if (!isJpeg(bytes)) throw new Error("not-jpeg");
    const o = opts || {};
    const desc = String(text || "").slice(0, MAX_DESCRIPTION);

    const packet = xmpPacket({ description: desc, keywords: o.keywords });
    const xml = new TextEncoder().encode(packet);
    const payload = new Uint8Array(XMP_NS_BYTES.length + xml.length);
    payload.set(XMP_NS_BYTES, 0);
    payload.set(xml, XMP_NS_BYTES.length);

    return spliceSegment(bytes, payload, findSegment(bytes, isXmpSeg));
  }

  /* Read a description back, XMP first because that is where the full text is
     (EXIF ImageDescription is ASCII-only and may have been transliterated). */
  function readDescription(bytes) {
    if (!isJpeg(bytes)) return null;
    const seg = findSegment(bytes, isXmpSeg);
    if (seg) {
      const xml = new TextDecoder().decode(
        bytes.subarray(seg.start + 4 + XMP_NS_BYTES.length, seg.end));
      const m = /<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(xml);
      if (m) {
        return m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      }
    }
    return readExifTag(bytes, 0x010e);
  }

  /* One ASCII tag out of IFD0, for reading back what writeDate wrote. */
  function readExifTag(bytes, want) {
    const seg = findSegment(bytes, isExifSeg);
    if (!seg) return null;
    const t = seg.start + 10;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + t);
    const LE = bytes[t] === 0x49;
    const ifd0 = dv.getUint32(4, LE);
    const n = dv.getUint16(ifd0, LE);
    for (let k = 0; k < n; k++) {
      const at = ifd0 + 2 + k * 12;
      if (dv.getUint16(at, LE) !== want) continue;
      const count = dv.getUint32(at + 4, LE);
      const off = count > 4 ? dv.getUint32(at + 8, LE) : at + 8;
      let out = "";
      for (let i = 0; i < count - 1; i++) out += String.fromCharCode(bytes[t + off + i]);
      return out;
    }
    return null;
  }

  function isJpeg(bytes) {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === SOI;
  }

  /* Replace (or insert) the EXIF APP1 segment with our own. */
  function writeDate(bytes, date, gps, description) {
    if (!isJpeg(bytes)) throw new Error("not-jpeg");

    // find an existing Exif APP1 so we can drop it
    let skipStart = -1, skipEnd = -1;
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === SOS || marker === 0xd9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if (marker === APP1 &&
          bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
          bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
        skipStart = i; skipEnd = i + 2 + len;
        break;
      }
      i += 2 + len;
    }

    const tiff = buildTiff(date, gps, description);
    const segLen = 2 + 6 + tiff.length;            // length field + "Exif\0\0" + TIFF
    if (segLen > 0xffff) throw new Error("exif-too-large");

    const head = new Uint8Array(4 + 6);
    head[0] = 0xff; head[1] = APP1;
    head[2] = (segLen >> 8) & 0xff; head[3] = segLen & 0xff;
    head.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);   // "Exif\0\0"

    const rest = skipStart >= 0
      ? [bytes.subarray(2, skipStart), bytes.subarray(skipEnd)]
      : [bytes.subarray(2)];

    const total = 2 + head.length + tiff.length + rest.reduce((s, r) => s + r.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    out[o++] = 0xff; out[o++] = SOI;
    out.set(head, o); o += head.length;
    out.set(tiff, o); o += tiff.length;
    for (const r of rest) { out.set(r, o); o += r.length; }
    return out;
  }

  /* Read DateTimeOriginal back out. Used to verify our own writes. */
  function readDate(bytes) {
    if (!isJpeg(bytes)) return null;
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === SOS || marker === 0xd9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === APP1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78) {
        const t = i + 10;                                  // start of TIFF
        const dv = new DataView(bytes.buffer, bytes.byteOffset + t);
        const LE = bytes[t] === 0x49;
        const ifd0 = dv.getUint32(4, LE);
        const readIfd = (off, want) => {
          const n = dv.getUint16(off, LE);
          for (let k = 0; k < n; k++) {
            const p = off + 2 + k * 12;
            const tag = dv.getUint16(p, LE);
            const val = dv.getUint32(p + 8, LE);
            if (tag === want) return val;
          }
          return 0;
        };
        const exifPtr = readIfd(ifd0, 0x8769);
        if (!exifPtr) return null;
        const strOff = readIfd(exifPtr, 0x9003);
        if (!strOff) return null;
        let s = "";
        for (let k = 0; k < 19; k++) s += String.fromCharCode(bytes[t + strOff + k]);
        return s;
      }
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  }

  /* Where the photo was taken, if the camera recorded it.

     GPS lives in its own IFD, and each coordinate is three rationals -
     degrees, minutes, seconds - with the hemisphere in a separate tag. A
     southern or western reading is stored positive and negated by that tag,
     which is the part that is easy to get wrong. */
  function readGps(bytes) {
    if (!isJpeg(bytes)) return null;
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === SOS || marker === 0xd9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === APP1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78) {
        const t = i + 10;
        if (t + 8 > bytes.length) return null;
        const dv = new DataView(bytes.buffer, bytes.byteOffset + t);
        const LE = bytes[t] === 0x49;
        const entry = (off, want) => {
          const n = dv.getUint16(off, LE);
          for (let k = 0; k < n; k++) {
            const p = off + 2 + k * 12;
            if (dv.getUint16(p, LE) === want) {
              return { type: dv.getUint16(p + 2, LE), count: dv.getUint32(p + 4, LE), value: dv.getUint32(p + 8, LE), at: p + 8 };
            }
          }
          return null;
        };
        const ifd0 = dv.getUint32(4, LE);
        const gpsPtr = entry(ifd0, 0x8825);
        if (!gpsPtr) return null;
        const g = gpsPtr.value;

        const rational = (off) => {
          const num = dv.getUint32(off, LE);
          const den = dv.getUint32(off + 4, LE);
          return den ? num / den : 0;
        };
        const degrees = (tag) => {
          const e = entry(g, tag);
          if (!e || e.count !== 3) return null;
          const off = e.value;                       // three rationals, 24 bytes
          if (off + 24 > dv.byteLength) return null;
          return rational(off) + rational(off + 8) / 60 + rational(off + 16) / 3600;
        };
        const ref = (tag) => {
          const e = entry(g, tag);
          return e ? String.fromCharCode(e.at !== undefined ? bytes[t + e.at] : 0) : "";
        };

        const lat = degrees(2), lon = degrees(4);
        if (lat === null || lon === null) return null;
        const la = ref(1) === "S" ? -lat : lat;
        const lo = ref(3) === "W" ? -lon : lon;
        if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
        if (la === 0 && lo === 0) return null;       // an unset GPS block, not the Atlantic
        return { lat: la, lon: lo };
      }
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  }

  return {
    writeDate, readDate, readGps, isJpeg, exifStamp,
    writeDescription, readDescription, MAX_DESCRIPTION,
  };
})();
