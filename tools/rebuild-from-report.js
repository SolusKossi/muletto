/* Build a fake export that has the same shape as somebody's real one.
 *
 * A tester cannot send their export and should never be asked to. What they
 * can send is the structure report the app writes: folder layout, file types,
 * column headers, JSON key shapes, row counts. No values, and file names
 * reduced to their shape.
 *
 * This turns that report back into an archive. Same folders, same file names,
 * same columns in the same order, the same number of rows - every value
 * invented. Open it in Muletto and you are exercising their export's shape
 * against code you can debug, without ever having held their data.
 *
 * It is a shape test, not a content test. It will catch a column that is not
 * read, a folder that is skipped, a file type nothing handles, a table that
 * produces no card, a count that comes out wrong, and anything that falls over
 * at their scale. It will not catch a date in a format the generator did not
 * think to produce - so where a report says a column is a date, several
 * formats are used on purpose.
 *
 *   node tools/rebuild-from-report.js report.json out/
 *
 * Writes one folder per archive in the report, ready to be zipped or opened
 * with the folder picker.
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* Deterministic randomness: the same report always rebuilds the same export,
   so a fix can be checked against the exact bytes that failed before. */
function rng(seed) {
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

const WORDS = ("alder brygge fjord kaia lofoten nordly rorbu saga tromso viken " +
  "amber basalt cedar delta ember flint garnet harbour indigo juniper").split(" ");

/* Dates matter more than anything else here, because getting one wrong is the
   single most common way an export defeats a reader. Every shape that has
   turned up in a real export gets produced. */
const DATE_SHAPES = [
  (d) => d.toISOString().slice(0, 19).replace("T", " "),
  (d) => d.toISOString(),
  (d) => String(Math.floor(d.getTime() / 1000)),
  (d) => String(d.getTime()),
  (d) => d.toISOString().slice(0, 10),
  (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
  (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
];

function makeValue(column, rand, rowIndex, dateShape) {
  const c = String(column || "").toLowerCase();
  const day = new Date(Date.UTC(2016, 0, 1) + rowIndex * 86400000 * 3);
  if (/time|date|created|updated|stamp|when|birth/.test(c)) return dateShape(day);
  if (/lat/.test(c)) return (59 + rand() * 2).toFixed(6);
  if (/lon|lng/.test(c)) return (10 + rand() * 2).toFixed(6);
  if (/mail/.test(c)) return "someone" + rowIndex + "@example.invalid";
  if (/url|link|http/.test(c)) return "https://example.invalid/" + WORDS[rowIndex % WORDS.length];
  if (/amount|price|paid|cost|charge|fee|tax/.test(c)) return (rand() * 90 + 1).toFixed(2);
  if (/count|number|qty|steps|calorie/.test(c)) return String(Math.floor(rand() * 5000));
  if (/rate|bpm|heart/.test(c)) return String(60 + Math.floor(rand() * 60));
  if (/weight/.test(c)) return (60 + rand() * 20).toFixed(1);
  if (/uuid|guid|id$|^id/.test(c)) return "id-" + Math.floor(rand() * 1e9).toString(16);
  if (/bool|flag|is_|has_/.test(c)) return rand() > 0.5 ? "Y" : "N";
  if (/name|title|label/.test(c)) {
    return WORDS[Math.floor(rand() * WORDS.length)] + " " + WORDS[Math.floor(rand() * WORDS.length)];
  }
  return WORDS[Math.floor(rand() * WORDS.length)] + "-" + rowIndex;
}

/* The report describes JSON as a shape: keys mapped to type names, arrays as
   {_array: n, of: <shape>}. This walks that back into a document. */
function fromShape(shape, rand, depth) {
  if (depth > 6) return null;
  if (shape === null || shape === undefined) return null;
  if (typeof shape === "string") {
    if (shape === "string") return WORDS[Math.floor(rand() * WORDS.length)];
    if (shape === "number") return Math.floor(rand() * 100000);
    if (shape === "boolean") return rand() > 0.5;
    if (shape === "null") return null;
    if (shape === "object") return { note: "shape was not recorded at this depth" };
    const m = shape.match(/^array\((\d+)\)$/);
    if (m) return Array.from({ length: Math.min(+m[1], 50) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    return shape;
  }
  if (shape && typeof shape === "object" && shape._array !== undefined) {
    // Big arrays are the point of a scale test, so the length is honoured.
    const n = Math.min(shape._array, 200000);
    return Array.from({ length: n }, () => fromShape(shape.of, rand, depth + 1));
  }
  const out = {};
  for (const k of Object.keys(shape)) {
    const v = fromShape(shape[k], rand, depth + 1);
    /* A key whose name says what it holds gets something that looks like it -
       numbers as well as strings. Left to the type alone, geoData.latitude
       came out as 82678, which is not a latitude, and a reader that quietly
       drops out-of-range coordinates would have passed the test by doing
       nothing. */
    if (typeof v === "string" || typeof v === "number") {
      const made = makeValue(k, rand, Math.floor(rand() * 50), DATE_SHAPES[0]);
      out[k] = typeof v === "number" && /^-?\d+(\.\d+)?$/.test(made) ? Number(made) : String(made);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The smallest valid file of each kind, so media counts and types are real.
const STUBS = {
  jpg: Buffer.from("ffd8ffe000104a46494600010100000100010000ffdb0043000302020202020302" +
    "020203030303040604040404040806060506080a0e0a080809080a0f0a0a0b0c0c0c0c0" +
    "70d0f0e0c0e0b0c0c0cffc0000b080001000101011100ffc40014000100000000000000" +
    "00000000000000000009ffc40014100100000000000000000000000000000000ffda000" +
    "8010100003f0037ffd9".replace(/\s/g, ""), "hex"),
  png: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890" +
    "000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082".replace(/\s/g, ""), "hex"),
};
STUBS.jpeg = STUBS.jpg;

function main(reportPath, outDir) {
  const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const reports = Array.isArray(raw) ? raw : [raw];
  let files = 0, rows = 0;

  reports.forEach((rep, ri) => {
    if (!rep || rep.report !== "muletto-structure") {
      console.error("  skipped entry " + ri + ": not a Muletto structure report");
      return;
    }
    const label = (rep.sourceName || (rep.archive && rep.archive.detectedAs) || ("export-" + ri))
      .replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\.zip$/i, "");
    const base = path.join(outDir, label);
    const rand = rng(label);

    /* The structured files carry their real schema, so they are rebuilt
       faithfully. Everything else is known only as "this folder held 40 jpgs",
       and gets that many stub files so counts and types come out right. */
    const written = new Set();
    for (const f of rep.structuredFiles || []) {
      if (f.kind === "unreadable") continue;
      const dest = path.join(base, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (f.kind === "csv") {
        const cols = f.columns || [];
        const shape = DATE_SHAPES[Math.floor(rand() * DATE_SHAPES.length)];
        const lines = [cols.map(csvCell).join(",")];
        for (let i = 0; i < (f.rows || 0); i++) {
          lines.push(cols.map((c) => csvCell(makeValue(c, rand, i, shape))).join(","));
        }
        fs.writeFileSync(dest, lines.join("\n") + "\n");
        rows += f.rows || 0;
      } else {
        fs.writeFileSync(dest, JSON.stringify(fromShape(f.shape, rand, 0), null, 1));
      }
      written.add(f.path);
      files++;
    }

    /* Google pairs IMG_4471.JPG with IMG_4471.JPG.json, and matching the two
       up is one of the things most worth testing. Naming the stub photographs
       file0001.jpg would have left every sidecar orphaned and the test would
       have proved nothing. */
    const wanted = new Map();
    for (const f of rep.structuredFiles || []) {
      const m = /^(.*\.(?:jpe?g|png|heic|mp4|mov|gif|webp))\.json$/i.exec(f.path);
      if (!m) continue;
      const dir = path.dirname(m[1]);
      if (!wanted.has(dir)) wanted.set(dir, []);
      wanted.get(dir).push(path.basename(m[1]));
    }

    for (const [folder, info] of Object.entries(rep.folders || {})) {
      const dir = folder === "(root)" ? base : path.join(base, folder);
      const pairs = (wanted.get(folder) || []).slice();
      for (const [ext, n] of Object.entries(info.extensions || {})) {
        const clean = String(ext).replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
        if (clean === "csv" || clean === "json") continue;   // already rebuilt above
        for (let i = 0; i < n; i++) {
          const paired = pairs.length && pairs[0].toLowerCase().endsWith("." + clean)
            ? pairs.shift() : null;
          const name = paired || ("file" + String(i + 1).padStart(4, "0") + "." + clean);
          const dest = path.join(dir, name);
          if (written.has(dest)) continue;
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, STUBS[clean] || Buffer.from("stub " + name));
          files++;
        }
      }
    }

    const skipped = rep.inspected && rep.inspected.skipped;
    console.log("  " + label + ": " + files + " files" +
      (skipped ? "  (report skipped " + skipped + " shapes - rebuild is incomplete)" : ""));
  });

  console.log("\n" + files + " files, " + rows + " rows written to " + outDir);
  console.log("Open the folder in Muletto, or zip each subfolder first to test the archive path.");
}

if (require.main === module) {
  const [report, out] = process.argv.slice(2);
  if (!report) {
    console.error("usage: node tools/rebuild-from-report.js <report.json> [outdir]");
    process.exit(1);
  }
  main(report, out || "rebuilt");
}

module.exports = { makeValue, fromShape, rng };
