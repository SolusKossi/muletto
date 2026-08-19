"use strict";

/* Muletto - run a real export through the real parser, and count what came out.
 *
 * TESTPLAN harness gap 1 is "no assertion layer: every test is run by hand and
 * read by eye". This is the general version of that. It opens whatever
 * archives it is pointed at with the shipped zip reader and the shipped
 * parser, both unmodified, and prints how many of each thing the library ended
 * up holding.
 *
 * The thing that makes this possible without loading a 2 GB archive into
 * memory is `fs.openAsBlob`, which hands back a Blob backed by the file rather
 * than by a buffer. `MZip` only ever calls `.slice()` and `.stream()` on it,
 * so the browser code runs over a real multi-gigabyte export exactly as it
 * does in a tab - reading the central directory of a 2 GB Snapchat archive
 * takes single-digit milliseconds because it seeks to the end rather than
 * reading forward.
 *
 *   node tools/check-export.js <dir-or-zip> [more...]
 *
 * NOTHING LEAVES THE MACHINE and the output is counts and shapes only - no
 * filename from inside an archive, no message, no name, no place. The one
 * exception is deliberate: notes the parser itself wrote are printed, because
 * those are our own words and they are the thing most worth reading back.
 */

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const WEB = path.join(__dirname, "..", "apps", "web");
const load = (rel) => fs.readFileSync(path.join(WEB, rel), "utf8");

/* One scope, so they find each other by global name as the page gives them.
 *
 * The optional ones matter more than they look. parsers.js guards four
 * modules with `typeof M... === "undefined"` and returns quietly when they are
 * absent, which is right in a browser that failed to load a script and a trap
 * in a harness: leaving exif.js out made a real Snapchat export report zero
 * dates out of 448, which reads exactly like a product bug and was this
 * script. Anything parsers.js will use has to be here. */
const MODULES = [
  "zipcrypt.js", "zip.js", "tar.js",
  "exif.js",        // readPhotoDates returns immediately without it
  "video.js",       // readVideoDates likewise
  "mojibake.js",    // Meta's mangled accents stay mangled without it
  "applehealth.js", // the Health export is skipped without it
  "parsers.js",
];
const { MZip, MParse } = new Function(
  MODULES.map(load).join("\n") +
  "\n; return { MZip: MZip, MParse: MParse };")();

/* detectProvider decides which parser runs, so a harness that guessed the
   provider itself would be testing the wrong half. app.js cannot be loaded
   whole - it is a page, and touches the DOM at the top level - so the four
   declarations that make up detection are lifted out by line range and
   evaluated on their own. The range is checked rather than assumed: if the
   file moves and the extract stops parsing, this throws here instead of
   silently detecting nothing. */
function detection() {
  const src = load("app.js").split(/\r?\n/);
  const from = src.findIndex((l) => l.startsWith("const SIGNATURES = ["));
  let to = src.findIndex((l, i) => i > from && l.startsWith("function detectProvider"));
  if (from < 0 || to < 0) throw new Error("could not find the detection block in app.js");
  while (to < src.length && src[to] !== "}") to++;
  const block = src.slice(from, to + 1).join("\n");
  return new Function(block + "\n; return detectProvider;")();
}
const detectProvider = detection();

/* --password is a flag rather than a file, for the same reason check-aes.js
   takes one: it belongs to somebody's archive and not to this repository. */
const args = [];
let password = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--password") password = process.argv[++i];
  else args.push(process.argv[i]);
}
if (!args.length) {
  console.error("usage: node tools/check-export.js [--password P] <dir-or-zip> [more...]");
  process.exit(2);
}
if (password) MZip.password = password;

function archives(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return [p];
  const out = [];
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    if (fs.statSync(full).isDirectory()) out.push(...archives(full));
    else if (/\.(zip|tgz|tar\.gz)$/i.test(name)) out.push(full);
  }
  return out;
}

/* A File-alike over a file on disk.
 *
 * `fs.openAsBlob` looks like exactly the right tool and is not: it reports the
 * size modulo 2^32. The 13,601,895,987 byte Takeout on this machine came back
 * as 716,994,099, the central directory was therefore looked for in the middle
 * of the file, and the shipped reader said "this does not look like a .zip
 * export" - about a perfectly good zip64 whose EOCD, zip64 locator and zip64
 * end record are all exactly where they should be. Reported as a product bug
 * that would have been catastrophic and was the harness, which is the sixth
 * time on this project.
 *
 * So the five things MZip asks of a File are provided directly. Nothing is
 * read until it is asked for, which is the point: the reader seeks to the end
 * of a 23 GB archive and never touches the rest. */
class DiskFile {
  constructor(p, start, end) {
    this.path = p;
    this.name = path.basename(p);
    this.type = "";
    this._start = start || 0;
    this._end = end === undefined ? fs.statSync(p).size : end;
    this.size = Math.max(0, this._end - this._start);
  }
  slice(from, to) {
    const a = this._start + (from || 0);
    const b = to === undefined ? this._end : this._start + to;
    return new DiskFile(this.path, a, Math.min(b, this._end));
  }
  async arrayBuffer() {
    const buf = Buffer.alloc(this.size);
    if (!this.size) return buf.buffer;
    const fd = fs.openSync(this.path, "r");
    let got = 0;
    try {
      while (got < this.size) {
        const k = fs.readSync(fd, buf, got, this.size - got, this._start + got);
        if (k <= 0) break;
        got += k;
      }
    } finally { fs.closeSync(fd); }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + got);
  }
  stream() {
    if (!this.size) return Readable.toWeb(Readable.from([]));
    return Readable.toWeb(fs.createReadStream(this.path,
      { start: this._start, end: this._end - 1 }));
  }
  async text() { return Buffer.from(await this.arrayBuffer()).toString("utf8"); }
}

const n = (x) => (x || 0).toLocaleString("en-GB");
const mb = (b) => (b / 1048576).toFixed(1) + " MB";

/* Shapes, never contents. A count of how many media files carry a paired
   overlay says everything about whether Snapchat pairing worked and nothing
   about what anybody photographed. */
function report(lib) {
  const media = lib.media || [];
  const withDate = media.filter((m) => m.at).length;
  const withPlace = media.filter((m) => m.gps).length;
  const paired = media.filter((m) => m.overlay).length;
  const kinds = {};
  for (const m of media) kinds[m.kind || "?"] = (kinds[m.kind || "?"] || 0) + 1;

  console.log("  files        " + n((lib.files || []).length));
  console.log("  media        " + n(media.length) +
    (Object.keys(kinds).length ? "  (" + Object.entries(kinds)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + n(v)).join(", ") + ")" : ""));
  if (media.length) {
    console.log("  with a date  " + n(withDate) + " of " + n(media.length) +
      "  (" + Math.round(100 * withDate / media.length) + " percent)");
    console.log("  with a place " + n(withPlace) + " of " + n(media.length));
  }
  if (paired) console.log("  captioned    " + n(paired) + " memories carry a paired overlay");
  console.log("  tables       " + n((lib.tables || []).length) + ", " +
    n((lib.tables || []).reduce((s, t) => s + t.rows.length, 0)) + " rows");
  console.log("  messages     " + n((lib.messages || []).length));
  console.log("  events       " + n((lib.events || []).length));
  console.log("  places       " + n((lib.places || []).length));
  for (const note of lib.notes || []) console.log("  note: " + note);
}

(async function main() {
  const list = args.flatMap(archives);
  if (!list.length) { console.error("nothing to open"); process.exit(2); }

  for (const file of list) {
    const size = fs.statSync(file).size;
    console.log("\n" + path.basename(file) + "   " + mb(size));
    const blob = new DiskFile(file);
    let entries;
    const t0 = Date.now();
    try { entries = await MZip.readDirectory(blob); }
    catch (err) { console.log("  directory unreadable: " + err.message); continue; }
    const det = detectProvider(entries, path.basename(file));
    console.log("  entries      " + n(entries.length) +
      "   detected as " + (det ? det.label : "nothing"));
    /* Said out loud, because a locked archive with no password parses to
       nothing at all and the report for it looks identical to a parser that
       silently failed. */
    const locked = entries.filter((e) => e.encrypted || e.method === 99).length;
    if (locked && !password) {
      console.log("  " + n(locked) + " entries are encrypted and no --password was given, " +
                  "so nothing inside them was read");
    }

    let lib;
    try { lib = await MParse.parse(blob, entries, det); }
    catch (err) {
      console.log("  parse threw: " + (err && err.message));
      continue;
    }
    report(lib);
    console.log("  took         " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  }
})();
