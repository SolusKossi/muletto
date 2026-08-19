"use strict";

/* Muletto - run the real files through the views that claim to read them.
 *
 * Six views in this product have only ever been exercised against fixtures:
 * Mail, Contacts, Calendar, Notes, Audio and My Activity. The real files have
 * been sitting on disk the whole time - a 776 MB mailbox, a hundred-odd
 * vCards, hundreds of notes and Siri recordings. TESTPLAN.md marks all six `S`
 * for that reason, and harness gap 1 is "no assertion layer".
 *
 * This is the start of one. It loads the shipped module rather than
 * reimplementing it, so what is measured is what the product does.
 *
 * NOTHING LEAVES THE MACHINE and the output is counts only - no address, no
 * subject, no name, no filename. Same rule as count-exif.js: the result should
 * be safe to paste anywhere.
 *
 * Usage:
 *   node tools/check-views.js <folder-of-zips>
 *
 * Mail is done here. Contacts, Calendar, Notes and Audio mostly live inside
 * Apple's nested archives, which this does not open yet - it reports how many
 * it can see and how many are out of reach so the gap is visible rather than
 * silently zero. My Activity needs a DOM and cannot run under Node at all.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Readable } = require("stream");
const os = require("os");
const { centralDirectory, dataOffset, readAt, readHead } = require("./count-exif.js");

/* The shipped constant, lifted out of the source rather than retyped.
 *
 * Notes are found by one regular expression and nothing else, so that pattern
 * is the whole of what can be wrong: if Apple's folder is not spelled the way
 * it expects, the view shows nothing at all and says nothing about why. Typing
 * a copy of it here would test the copy. */
function shippedConst(rel, name) {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps", "web", rel), "utf8");
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*(/.*?/[a-z]*);"));
  if (!m) throw new Error("could not find " + name + " in " + rel);
  return new Function("return " + m[1])();
}

function loadModule(rel, name) {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps", "web", rel), "utf8");
  return new Function(src + "; return " + name + ";")();
}

/* A web ReadableStream over one entry, inflating as it goes.
 *
 * The whole point of the mail view is that a 776 MB mailbox is indexed without
 * ever being held, so the harness has to stream it too. Reading it into a
 * buffer first would test something the product never does. */
function entryStream(zipPath, fd, e) {
  const off = dataOffset(fd, e);
  if (off === null) return null;
  const rs = fs.createReadStream(zipPath, { start: off, end: off + e.csize - 1 });
  const out = e.method === 8 ? rs.pipe(zlib.createInflateRaw()) : rs;
  return Readable.toWeb(out);
}

const MB = 1024 * 1024;
const WHOLE_CAP = 64 * MB;
/* Big enough for Apple Features Using iCloud.zip, which is 1.34 GB in a real
   export and holds all 319 Siri recordings. Under the old 512 MB guard it was
   skipped and the audio count read zero, which looked like an absence. */
const NESTED_CAP = 2048 * MB;

/* A whole entry, for the small ones. A vCard file holding a hundred cards with
   base64 photographs in them runs to a few megabytes, which is nothing, but
   the cap is here so a mistake cannot try to hold a video. */
function readWhole(fd, e) {
  const off = dataOffset(fd, e);
  if (off === null || e.usize > WHOLE_CAP) return null;
  const comp = readAt(fd, off, e.csize);
  if (!comp.length) return null;
  if (e.method === 0) return comp;
  if (e.method !== 8) return null;
  try { return zlib.inflateRawSync(comp); } catch (err) { return null; }
}

/* Apple keeps most of Contacts, Calendar, Notes and Audio inside archives that
   are themselves entries. Reading their directory means slicing at arbitrary
   offsets, which a stream cannot do, so the nested archive is written out once
   and opened as a file. Streamed to disk rather than buffered - one of these
   is 1.34 GB in a real export. Deleted again at the end. */
function extractNested(zipPath, fd, e, dest) {
  return new Promise((resolve) => {
    const off = dataOffset(fd, e);
    if (off === null) return resolve(false);
    const rs = fs.createReadStream(zipPath, { start: off, end: off + e.csize - 1 });
    const ws = fs.createWriteStream(dest);
    const src = e.method === 8 ? rs.pipe(zlib.createInflateRaw()) : rs;
    src.pipe(ws);
    ws.on("finish", () => resolve(true));
    ws.on("error", () => resolve(false));
    src.on("error", () => resolve(false));
  });
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node tools/check-views.js <folder-of-zips>");
    process.exit(1);
  }
  const MMbox = loadModule("mbox.js", "MMbox");

  const zips = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter((f) => /\.zip$/i.test(f)).map((f) => path.join(target, f))
    : [target];

  const MTopics = (() => {
    /* topics.js binds one click listener on the document when it loads, so it
       needs a document to exist. It never touches one otherwise from the two
       parsers used here. */
    global.document = global.document || { addEventListener() {} };
    return loadModule("topics.js", "MTopics");
  })();

  const NOTE_FILE = shippedConst("topics.js", "NOTE_FILE");

  const seen = { mbox: [], vcf: 0, ics: 0, m4a: 0, activityHtml: 0,
                 nestedZip: 0, nestedOpened: 0, nestedSkipped: 0,
                 m4aValid: 0, m4aBad: 0,
                 txt: 0, noteTxt: 0, noteOk: 0, noteEmpty: 0,
                 noteNoTitle: 0, noteWords: 0, txtDirs: new Map() };
  const texts = { vcf: [], ics: [] };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muletto-views-"));
  const tmpFiles = [];
  const L = [];

  const harvest = (fd, entries) => {
    for (const e of entries) {
      if (e.name.endsWith("/")) continue;
      const n = e.name.toLowerCase();
      if (n.endsWith(".vcf")) {
        seen.vcf++;
        const b = readWhole(fd, e);
        if (b) texts.vcf.push(b.toString("utf8"));
      } else if (n.endsWith(".ics")) {
        seen.ics++;
        const b = readWhole(fd, e);
        if (b) texts.ics.push(b.toString("utf8"));
      } else if (n.endsWith(".m4a")) {
        /* Playback needs a browser, but getting valid bytes out of the archive
           is the half that can fail here. An MPEG-4 file carries `ftyp` as the
           box type at offset 4. */
        seen.m4a++;
        const b = readHead(fd, e, null);
        if (b && b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") seen.m4aValid++;
        else seen.m4aBad++;
      } else if (n.endsWith(".txt")) {
        seen.txt++;
        /* Where they live, two segments deep only. In a Takeout that is
           "Takeout/Keep" - a product name, structural rather than personal.
           The file name itself is often the note's title, so it is never
           recorded. This exists to answer "zero matched, but should they
           have?" without anybody having to go and look. */
        const seg = e.name.split("/").slice(0, 2).join("/");
        seen.txtDirs.set(seg, (seen.txtDirs.get(seg) || 0) + 1);
        if (!NOTE_FILE.test(e.name)) continue;
        seen.noteTxt++;
        const b = readWhole(fd, e);
        if (!b) continue;
        const body = b.toString("utf8").trim();
        if (!body) { seen.noteEmpty++; continue; }
        seen.noteOk++;
        const nl = body.indexOf("\n");
        if (!(nl < 0 ? body : body.slice(0, nl)).trim()) seen.noteNoTitle++;
        seen.noteWords += body.split(/\s+/).length;
      } else if (/myactivity.*\.html$/.test(n)) seen.activityHtml++;
    }
  };

  for (const zp of zips) {
    let fd;
    try { fd = fs.openSync(zp, "r"); } catch (err) { continue; }
    const entries = centralDirectory(fd, fs.statSync(zp).size);
    if (!entries) { fs.closeSync(fd); continue; }

    for (const e of entries) {
      if (!e.name.endsWith("/") && e.name.toLowerCase().endsWith(".mbox")) {
        seen.mbox.push({ zp, fd, e });
      }
    }
    harvest(fd, entries);

    for (const ne of entries) {
      if (ne.name.endsWith("/") || !/\.zip$/i.test(ne.name)) continue;
      seen.nestedZip++;
      if (ne.usize > NESTED_CAP) { seen.nestedSkipped++; continue; }
      const dest = path.join(tmpDir, "n" + tmpFiles.length + ".zip");
      if (!(await extractNested(zp, fd, ne, dest))) { seen.nestedSkipped++; continue; }
      tmpFiles.push(dest);
      let nfd = null;
      try { nfd = fs.openSync(dest, "r"); } catch (err) { seen.nestedSkipped++; continue; }
      const nEntries = centralDirectory(nfd, fs.statSync(dest).size);
      if (nEntries) { seen.nestedOpened++; harvest(nfd, nEntries); }
      else seen.nestedSkipped++;
      fs.closeSync(nfd);
    }

    if (!seen.mbox.some((m) => m.zp === zp)) fs.closeSync(fd);
  }

  L.push("");
  L.push("Views against real files - counts only, nothing identifying");
  L.push("===========================================================");
  L.push("archives scanned           " + zips.length);
  L.push("");

  L.push("MAIL - the view that has never met the real mailbox");
  if (!seen.mbox.length) {
    L.push("  no .mbox found in these archives");
  }
  for (const { zp, fd, e } of seen.mbox) {
    const sizeMb = (e.usize / MB).toFixed(0);
    L.push("  mailbox found, " + sizeMb + " MB uncompressed"
      + (e.method === 8 ? ", deflated" : ", stored"));
    const stream = entryStream(zp, fd, e);
    if (!stream) { L.push("  could not open the entry"); continue; }
    const started = process.hrtime.bigint();
    let res = null, failed = null;
    try {
      /* Exactly what the product asks for: headers only, no bodies held. */
      res = await MMbox.index(stream, { limit: 200000, bodyBytes: 0 });
    } catch (err) {
      failed = (err && (err.code || err.message) || String(err)).slice(0, 120);
    }
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    if (failed) {
      L.push("  FAILED after " + secs.toFixed(1) + "s: " + failed);
    } else {
      L.push("  indexed " + res.messages.length.toLocaleString() + " messages in "
        + secs.toFixed(1) + "s");
      L.push("  bytes read " + (res.bytesRead / MB).toFixed(0) + " MB"
        + ", skipped " + res.skipped + ", bodies dropped " + res.bodiesDropped);
      /* `at`, not `date`. The header is called Date and the parsed Date object
         is stored as `at`; reading the wrong one reported 0% on a first run
         and looked exactly like a real parser failure. */
      const withDate = res.messages.filter((m) => m.at).length;
      const withFrom = res.messages.filter((m) => m.from && m.from.address).length;
      const withSubj = res.messages.filter((m) => m.subject).length;
      const pc = (n) => (res.messages.length
        ? (n * 100 / res.messages.length).toFixed(1) + "%" : "-");
      L.push("  parsed a date on    " + pc(withDate));
      L.push("  parsed a sender on  " + pc(withFrom));
      L.push("  parsed a subject on " + pc(withSubj));
      try {
        const s = MMbox.summarise(res);          // the result, not the array
        L.push("  summarise() gave " + s.senders.length + " senders, "
          + s.events.length + " timeline events");
      } catch (err) {
        L.push("  summarise() THREW: " + String(err.message).slice(0, 80));
      }
      const heap = process.memoryUsage().heapUsed / MB;
      L.push("  peak heap after indexing " + heap.toFixed(0) + " MB"
        + " - the whole point is that this stays far under the file size");
    }
    fs.closeSync(fd);
  }

  L.push("");
  L.push("CONTACTS - the real vCards, through the shipped parser");
  L.push("  .vcf files found          " + seen.vcf + ", of which read " + texts.vcf.length);
  if (texts.vcf.length) {
    let cards = [], threw = null;
    try {
      for (const t of texts.vcf) cards = cards.concat(MTopics.parseVcards(t));
    } catch (err) { threw = String(err.message).slice(0, 90); }
    if (threw) L.push("  parseVcards THREW: " + threw);
    else {
      const has = (k) => cards.filter((c) => c[k]).length;
      const p = (n) => (cards.length ? (n * 100 / cards.length).toFixed(0) + "%" : "-");
      L.push("  cards parsed              " + cards.length);
      L.push("  with a name               " + has("name") + "   " + p(has("name")));
      L.push("  with an organisation      " + has("org") + "   " + p(has("org")));
      L.push("  with a birthday           " + has("born"));
      L.push("  with a note               " + has("note"));
      const blank = cards.length - has("name");
      if (blank) L.push("  NAMELESS - would render as an empty row: " + blank);
    }
  }

  L.push("");
  L.push("CALENDAR - the real .ics, through the shipped parser");
  L.push("  .ics files found          " + seen.ics + ", of which read " + texts.ics.length);
  if (texts.ics.length) {
    let evs = [], threw = null;
    try {
      for (const t of texts.ics) evs = evs.concat(MTopics.parseIcs(t));
    } catch (err) { threw = String(err.message).slice(0, 90); }
    if (threw) L.push("  parseIcs THREW: " + threw);
    else {
      const dated = evs.filter((e) => e.at).length;
      const p = (n) => (evs.length ? (n * 100 / evs.length).toFixed(0) + "%" : "-");
      L.push("  entries parsed            " + evs.length);
      L.push("  with a usable date        " + dated + "   " + p(dated));
      L.push("  all-day                   " + evs.filter((e) => e.allDay).length);
      L.push("  repeating                 " + evs.filter((e) => e.repeats).length);
      L.push("  with a summary            " + evs.filter((e) => e.summary).length);
      const undated = evs.length - dated;
      if (undated) L.push("  UNDATED - cannot be placed on a timeline: " + undated);
    }
  }

  L.push("");
  L.push("NESTED ARCHIVES");
  L.push("  found                     " + seen.nestedZip);
  L.push("  opened                    " + seen.nestedOpened);
  L.push("  skipped, too big or bad   " + seen.nestedSkipped);
  L.push("");
  L.push("NOTES - does the shipped pattern match the real folder?");
  L.push("  .txt files anywhere       " + seen.txt);
  L.push("  matching NOTE_FILE        " + seen.noteTxt +
         (seen.txt && !seen.noteTxt ? "   <- ZERO. The view would show nothing" : ""));
  L.push("  read with content         " + seen.noteOk);
  L.push("  empty, so dropped         " + seen.noteEmpty);
  L.push("  blank first line, titled from the filename instead: " + seen.noteNoTitle);
  L.push("  words across all of them  " + seen.noteWords.toLocaleString());
  if (seen.txt && seen.noteTxt < seen.txt) {
    L.push("  where the .txt files actually are, two segments deep:");
    for (const [d, n] of [...seen.txtDirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      L.push("    " + d.padEnd(38) + n);
    }
  }

  L.push("");
  L.push("AUDIO - bytes only; playback still needs a browser");
  L.push("  .m4a found                " + seen.m4a);
  L.push("  valid MPEG-4 header       " + seen.m4aValid);
  L.push("  malformed                 " + seen.m4aBad);

  L.push("");
  L.push("STILL NOT COVERED");
  L.push("  My Activity HTML seen     " + seen.activityHtml + "   (needs a DOM, cannot run under Node)");
  L.push("");
  console.log(L.join("\n"));

  for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (err) { /* gone already */ } }
  try { fs.rmdirSync(tmpDir); } catch (err) { /* not empty, leave it */ }
}

if (require.main === module) main();
