"use strict";

/* Muletto - does Google Takeout actually strip the date out of the file?
 *
 * Every tool page and blog post says it does. None of them shows a count, and
 * several are selling a converter. GUIDES-RESEARCH.md holds the sources. This
 * settles it against a real Takeout instead of repeating it.
 *
 * It answers three separate questions that the internet runs together:
 *
 *   1. Does the JPEG carry EXIF DateTimeOriginal, tag 0x9003?
 *   2. Is there a sidecar JSON next to it, under any of the six naming forms?
 *   3. When both exist, do they agree?
 *
 * The reader is `apps/web/exif.js`, the one the product ships, loaded rather
 * than reimplemented - the question is what Muletto sees, not what some other
 * library would see.
 *
 * NOTHING IS SENT ANYWHERE, and the output is counts only. No file name, no
 * date, no coordinate and no folder name is printed, so the result can be
 * pasted into a chat or an issue without leaking anything about the person
 * whose export it is. That is deliberate: the whole point is to publish a
 * number, and a number is all this produces.
 *
 * Reads by range. A 22 GB archive is never loaded, and only the head of each
 * photograph is inflated - enough for the EXIF segment, which sits near the
 * front of a JPEG.
 *
 * Usage:
 *   node tools/count-exif.js <folder-of-zips-or-a-single-zip>
 *
 * Zip64 is handled, because a real Takeout part is well over 4 GB.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* The shipped EXIF reader, evaluated as-is. It is an IIFE assigned to a const,
   so returning that const out of a wrapper hands back the real object. */
function loadExif() {
  const p = path.join(__dirname, "..", "apps", "web", "exif.js");
  const src = fs.readFileSync(p, "utf8");
  return new Function(src + "; return MExif;")();
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CEN = 0x02014b50;

const IMAGE_RE = /\.(jpe?g|heic|heif|png|gif|webp|avif|tiff?|dng|mp4|mov|m4v|avi|3gp)$/i;
const JPEG_RE = /\.jpe?g$/i;

function readAt(fd, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buf, got, length - got, offset + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/* Walk back from the end for the end-of-central-directory record. The comment
   field can be 64 KB, so that is how far back it can hide. */
function findEocd(fd, size) {
  const span = Math.min(size, 65557);
  const buf = readAt(fd, size - span, span);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return { buf, at: i, base: size - span };
  }
  return null;
}

function centralDirectory(fd, size) {
  const eocd = findEocd(fd, size);
  if (!eocd) return null;
  const b = eocd.buf, i = eocd.at;
  let count = b.readUInt16LE(i + 10);
  let cdSize = b.readUInt32LE(i + 12);
  let cdOff = b.readUInt32LE(i + 16);

  /* Zip64 if any field is saturated. The locator sits directly before the
     EOCD and points at the real record. */
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const locAt = i - 20;
    if (locAt >= 0 && b.readUInt32LE(locAt) === SIG_LOC64) {
      const rec64 = Number(b.readBigUInt64LE(locAt + 8));
      const h = readAt(fd, rec64, 56);
      if (h.length === 56 && h.readUInt32LE(0) === SIG_EOCD64) {
        count = Number(h.readBigUInt64LE(32));
        cdSize = Number(h.readBigUInt64LE(40));
        cdOff = Number(h.readBigUInt64LE(48));
      }
    }
  }
  if (!cdSize || cdOff + cdSize > size) return null;

  const cd = readAt(fd, cdOff, cdSize);
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && out.length < count + 8) {
    if (cd.readUInt32LE(p) !== SIG_CEN) break;
    const method = cd.readUInt16LE(p + 10);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const cmtLen = cd.readUInt16LE(p + 32);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    let local = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);

    /* The zip64 extra field replaces whatever was saturated, in a fixed order,
       and only the saturated ones are present. */
    if (usize === 0xffffffff || csize === 0xffffffff || local === 0xffffffff) {
      const exStart = p + 46 + nameLen;
      let q = exStart;
      while (q + 4 <= exStart + extraLen) {
        const id = cd.readUInt16LE(q);
        const sz = cd.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (local === 0xffffffff) { local = Number(cd.readBigUInt64LE(r)); r += 8; }
          break;
        }
        q += 4 + sz;
      }
    }
    out.push({ name, method, csize, usize, local });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* The central directory's extra field and the local one can differ in length,
   so the data offset has to come from the local header. */
function dataOffset(fd, e) {
  const h = readAt(fd, e.local, 30);
  if (h.length < 30 || h.readUInt32LE(0) !== 0x04034b50) return null;
  return e.local + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}

const HEAD_WANT = 256 * 1024;

/* Enough of the front of an entry to hold the EXIF segment.
 *
 * Z_SYNC_FLUSH is what makes a partial inflate legal: without it, feeding a
 * deflate stream a fraction of its input is a truncation error rather than a
 * short read.
 *
 * There is no maxOutputLength here, and that is the whole point. The first
 * version set it to the head size, which does not truncate - Node throws
 * ERR_BUFFER_TOO_LARGE the moment output passes the cap. Since the input slice
 * was four times the cap, almost every photograph threw and was counted as
 * unreadable: 2,186 of 2,344 in the first real run, which made the headline
 * figure a measurement of this bug rather than of Takeout. Bound the input
 * instead and slice the output, so a large head is short rather than absent.
 *
 * `why` collects the reason when a head cannot be read, because a silent count
 * of failures is what let the first run look like an answer. */
function readHead(fd, e, why) {
  const note = (k) => { if (why) why[k] = (why[k] || 0) + 1; return null; };
  const off = dataOffset(fd, e);
  if (off === null) return note("bad local header");
  if (e.method === 0) {
    const b = readAt(fd, off, Math.min(e.csize, HEAD_WANT));
    return b.length ? b : note("stored, empty read");
  }
  if (e.method !== 8) return note("method " + e.method);
  const comp = readAt(fd, off, Math.min(e.csize, 384 * 1024));
  if (!comp.length) return note("deflated, empty read");
  try {
    const out = zlib.inflateRawSync(comp, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    if (!out.length) return note("inflated to nothing");
    return out.length > HEAD_WANT ? out.subarray(0, HEAD_WANT) : out;
  } catch (err) {
    return note("inflate threw " + (err.code || err.message).slice(0, 24));
  }
}

/* Which sidecar belongs to which photograph.
 *
 * Six forms were seen in one real export, so this matches by prefix and never
 * by a fixed suffix - the suffix is truncated at an arbitrary point once the
 * whole name runs long. See GUIDES-RESEARCH.md. */
function sidecarFor(name, jsonByDir) {
  const dir = name.lastIndexOf("/") >= 0 ? name.slice(0, name.lastIndexOf("/")) : "";
  const base = name.slice(dir ? dir.length + 1 : 0);
  const pool = jsonByDir.get(dir);
  if (!pool) return null;

  if (pool.has(base + ".json")) return { form: "exact", name: base + ".json" };

  const stem = base.replace(/\.[^.]+$/, "");
  if (pool.has(stem + ".json")) return { form: "basename", name: stem + ".json" };

  /* IMG_1234.JPG(1).json - the duplicate counter moved out of the name. */
  const dup = base.match(/^(.*)(\(\d+\))(\.[^.]+)$/);
  if (dup && pool.has(dup[1] + dup[3] + dup[2] + ".json")) {
    return { form: "counter-moved", name: dup[1] + dup[3] + dup[2] + ".json" };
  }

  /* Any truncation of .supplemental-metadata, including the full form. */
  for (const cand of pool) {
    if (cand.length > base.length && cand.startsWith(base + ".") && cand.endsWith(".json")) {
      return { form: "supplemental", name: cand, suffix: cand.slice(base.length) };
    }
  }
  return null;
}

/* What a sidecar actually carries. One parse, both answers.
 *
 * `geoData` all zeros means Google has no location for this photograph, not
 * that it was taken in the Gulf of Guinea. Counting those as a location is the
 * single easiest way to produce a map covered in wrong pins, so they are
 * counted separately rather than believed. */
function sidecarFacts(buf) {
  try {
    const j = JSON.parse(buf.toString("utf8"));
    const ts = (j.photoTakenTime && j.photoTakenTime.timestamp) ||
               (j.creationTime && j.creationTime.timestamp);
    const n = ts === undefined ? NaN : Number(ts);
    const taken = isFinite(n) && n > 0 ? n : null;

    const g = j.geoData || j.geoDataExif || null;
    let geo = null, zeroGeo = false;
    if (g) {
      const la = Number(g.latitude), lo = Number(g.longitude);
      if (isFinite(la) && isFinite(lo)) {
        if (la === 0 && lo === 0) zeroGeo = true; else geo = { la, lo };
      }
    }
    return { taken, geo, zeroGeo };
  } catch (err) { return null; }
}

/* "2024:03:17 09:14:02" - EXIF's own punctuation, local time, no zone. */
function exifToEpoch(s) {
  const m = String(s).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isFinite(d) ? Math.floor(d / 1000) : null;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node tools/count-exif.js <folder-of-zips-or-a-single-zip>");
    process.exit(1);
  }
  const MExif = loadExif();

  const stat = fs.statSync(target);
  const zips = stat.isDirectory()
    ? fs.readdirSync(target).filter((f) => /\.zip$/i.test(f)).map((f) => path.join(target, f))
    : [target];
  if (!zips.length) { console.error("no .zip files there"); process.exit(1); }

  const t = {
    archives: 0, entries: 0, media: 0, jpeg: 0, nonJpeg: 0,
    jpegWithExifDate: 0, jpegNoExifDate: 0, jpegUnreadable: 0,
    withSidecar: 0, noSidecar: 0,
    sidecarForm: { exact: 0, supplemental: 0, basename: 0, "counter-moved": 0 },
    bothPresent: 0, agreeWithinDay: 0, disagree: 0,
    sidecarNoTakenTime: 0,
    byExt: new Map(),
    why: {},
    method: {},
    suffix: new Map(),
    /* The cross-tabulation is the only part that says what is actually
       recoverable. A photograph with neither an embedded date nor a sidecar
       has no date anywhere, and no tool can invent one. */
    cross: { "both": 0, "file only": 0, "sidecar only": 0, "neither": 0 },
    gps: { "both": 0, "file only": 0, "sidecar only": 0, "neither": 0 },
    jpegWithGps: 0, jpegNoGps: 0, sidecarGeoZero: 0,
  };

  for (const zp of zips) {
    let fd;
    try { fd = fs.openSync(zp, "r"); } catch (err) { continue; }
    const size = fs.statSync(zp).size;
    const entries = centralDirectory(fd, size);
    if (!entries) { fs.closeSync(fd); console.error("  could not read a central directory in one archive"); continue; }
    t.archives++;
    t.entries += entries.length;

    const jsonByDir = new Map();
    for (const e of entries) {
      if (!/\.json$/i.test(e.name)) continue;
      const cut = e.name.lastIndexOf("/");
      const dir = cut >= 0 ? e.name.slice(0, cut) : "";
      const base = cut >= 0 ? e.name.slice(cut + 1) : e.name;
      if (!jsonByDir.has(dir)) jsonByDir.set(dir, new Set());
      jsonByDir.get(dir).add(base);
    }
    const byName = new Map(entries.map((e) => [e.name, e]));

    for (const e of entries) {
      if (e.name.endsWith("/") || !IMAGE_RE.test(e.name)) continue;
      t.media++;
      const ext = (e.name.match(/\.([^.]+)$/) || [0, "?"])[1].toLowerCase();
      t.byExt.set(ext, (t.byExt.get(ext) || 0) + 1);

      const sc = sidecarFor(e.name, jsonByDir);
      if (sc) {
        t.withSidecar++;
        t.sidecarForm[sc.form]++;
        const key = sc.suffix || "." + sc.form;
        t.suffix.set(key, (t.suffix.get(key) || 0) + 1);
      } else t.noSidecar++;

      if (!JPEG_RE.test(e.name)) { t.nonJpeg++; continue; }
      t.jpeg++;
      const mk = e.method === 0 ? "stored" : e.method === 8 ? "deflated" : "method " + e.method;
      t.method[mk] = (t.method[mk] || 0) + 1;

      const head = readHead(fd, e, t.why);
      if (!head || !head.length) { t.jpegUnreadable++; continue; }
      const bytes = new Uint8Array(head);
      let stamp = null, gps = null;
      try { stamp = MExif.readDate(bytes); } catch (err) { stamp = null; }
      try { gps = MExif.readGps(bytes); } catch (err) { gps = null; }
      if (gps && gps.lat === 0 && gps.lon === 0) gps = null;

      /* The sidecar is read for every photograph now, not only for those that
         already had an embedded date. The old shape used "a sidecar exists" as
         a stand-in for "the sidecar has a date", which happened to be true
         here and would quietly have been wrong in an export where it was not. */
      let facts = null;
      if (sc) {
        const cut = e.name.lastIndexOf("/");
        const dir = cut >= 0 ? e.name.slice(0, cut) : "";
        const scEntry = byName.get(dir ? dir + "/" + sc.name : sc.name);
        if (scEntry) {
          const scBuf = readHead(fd, scEntry, null);
          if (scBuf) facts = sidecarFacts(scBuf);
        }
      }
      if (facts && facts.zeroGeo) t.sidecarGeoZero++;
      if (sc && !(facts && facts.taken)) t.sidecarNoTakenTime++;

      const sideDate = !!(facts && facts.taken);
      const sideGeo = !!(facts && facts.geo);
      if (stamp) t.jpegWithExifDate++; else t.jpegNoExifDate++;
      if (gps) t.jpegWithGps++; else t.jpegNoGps++;

      const where = (a, b) => (a && b ? "both" : a ? "file only" : b ? "sidecar only" : "neither");
      t.cross[where(!!stamp, sideDate)]++;
      t.gps[where(!!gps, sideGeo)]++;

      if (stamp && sideDate) {
        const fromExif = exifToEpoch(stamp);
        if (fromExif !== null) {
          t.bothPresent++;
          if (Math.abs(fromExif - facts.taken) <= 86400) t.agreeWithinDay++; else t.disagree++;
        }
      }
    }
    fs.closeSync(fd);
  }

  const pct = (n, d) => (d ? (n * 100 / d).toFixed(1) + "%" : "-");
  const L = [];
  L.push("");
  L.push("Takeout EXIF survey - counts only, nothing identifying");
  L.push("=====================================================");
  L.push("archives read              " + t.archives);
  L.push("entries in them            " + t.entries);
  L.push("media files                " + t.media);
  L.push("");
  L.push("THE QUESTION: does the file itself still carry the date?");
  L.push("  JPEGs                    " + t.jpeg);
  L.push("  with DateTimeOriginal    " + t.jpegWithExifDate + "   " + pct(t.jpegWithExifDate, t.jpeg));
  L.push("  without it               " + t.jpegNoExifDate + "   " + pct(t.jpegNoExifDate, t.jpeg));
  L.push("  head unreadable          " + t.jpegUnreadable + "   " + pct(t.jpegUnreadable, t.jpeg));
  L.push("  non-JPEG media skipped   " + t.nonJpeg);
  const examined = t.jpegWithExifDate + t.jpegNoExifDate;
  L.push("");
  L.push("  OF THE ONES ACTUALLY READ (" + examined + ")");
  L.push("    carry the date         " + t.jpegWithExifDate + "   " + pct(t.jpegWithExifDate, examined));
  L.push("    do not                 " + t.jpegNoExifDate + "   " + pct(t.jpegNoExifDate, examined));
  if (t.jpegUnreadable) {
    L.push("");
    L.push("  WHY A HEAD COULD NOT BE READ - if this is not near zero, the");
    L.push("  percentages above are measuring this tool and not the export");
    for (const [k, n] of Object.entries(t.why).sort((a, b) => b[1] - a[1])) {
      L.push("    " + k.padEnd(22) + n);
    }
  }
  L.push("");
  L.push("  HOW THE JPEGS ARE STORED");
  for (const [k, n] of Object.entries(t.method).sort((a, b) => b[1] - a[1])) {
    L.push("    " + k.padEnd(22) + n);
  }
  L.push("");
  L.push("SIDECARS");
  L.push("  media with a sidecar     " + t.withSidecar + "   " + pct(t.withSidecar, t.media));
  L.push("  media without one        " + t.noSidecar + "   " + pct(t.noSidecar, t.media));
  L.push("  named <file>.json        " + t.sidecarForm.exact);
  L.push("  supplemental-* form      " + t.sidecarForm.supplemental);
  L.push("  basename form            " + t.sidecarForm.basename);
  L.push("  counter moved            " + t.sidecarForm["counter-moved"]);
  L.push("");
  L.push("  EVERY DISTINCT SIDECAR ENDING, AND HOW OFTEN");
  const sfx = [...t.suffix.entries()].sort((a, b) => b[1] - a[1]);
  for (const [s, n] of sfx) L.push("    " + s.padEnd(34) + n);
  L.push("");
  L.push("WHERE THE DATE SURVIVES, PER JPEG - the recoverability picture");
  const cw = t.cross["both"] + t.cross["file only"] + t.cross["sidecar only"] + t.cross["neither"];
  L.push("  in the file and the sidecar   " + t.cross["both"] + "   " + pct(t.cross["both"], cw));
  L.push("  in the file only              " + t.cross["file only"] + "   " + pct(t.cross["file only"], cw));
  L.push("  in the sidecar only           " + t.cross["sidecar only"] + "   " + pct(t.cross["sidecar only"], cw));
  L.push("  NOWHERE - unrecoverable       " + t.cross["neither"] + "   " + pct(t.cross["neither"], cw));
  L.push("");
  L.push("AND THE SAME QUESTION FOR LOCATION");
  const gw = t.gps["both"] + t.gps["file only"] + t.gps["sidecar only"] + t.gps["neither"];
  L.push("  in the file and the sidecar   " + t.gps["both"] + "   " + pct(t.gps["both"], gw));
  L.push("  in the file only              " + t.gps["file only"] + "   " + pct(t.gps["file only"], gw));
  L.push("  in the sidecar only           " + t.gps["sidecar only"] + "   " + pct(t.gps["sidecar only"], gw));
  L.push("  no location anywhere          " + t.gps["neither"] + "   " + pct(t.gps["neither"], gw));
  L.push("  sidecars with zeroed geoData  " + t.sidecarGeoZero +
         "   (absent, not a point off Africa)");
  L.push("");
  L.push("WHEN BOTH EXIST, DO THEY AGREE?");
  L.push("  comparable pairs         " + t.bothPresent);
  L.push("  agree within a day       " + t.agreeWithinDay + "   " + pct(t.agreeWithinDay, t.bothPresent));
  L.push("  disagree                 " + t.disagree + "   " + pct(t.disagree, t.bothPresent));
  L.push("  sidecar had no timestamp " + t.sidecarNoTakenTime);
  L.push("");
  L.push("BY EXTENSION");
  const exts = [...t.byExt.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ext, n] of exts) L.push("  " + ext.padEnd(8) + n);
  L.push("");
  console.log(L.join("\n"));
}

/* The zip reading is the reusable half of this file and `check-views.js` wants
   it. Left here rather than moved to tools/lib for now, because two consumers
   is not yet a library; move it the moment there is a third. */
module.exports = { centralDirectory, dataOffset, readAt, readHead, loadExif };

if (require.main === module) main();
