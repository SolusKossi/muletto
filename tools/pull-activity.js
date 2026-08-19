"use strict";

/* Muletto - set up the My Activity harness against a real Takeout.
 *
 * My Activity is the last of the six views still running on fixtures only. It
 * parses with `DOMParser`, so unlike Mail, Contacts, Calendar and Notes it
 * cannot be checked under Node at all - it needs a browser, which means the
 * real pages have to sit somewhere a served page can fetch them.
 *
 * This copies them into `apps/web/_local/`, along with the harness that reads
 * them, and then gets out of the way. It does not start a server and it does
 * not open anything.
 *
 * READ THIS BEFORE RUNNING IT. While the dev server is up, everything in
 * `_local` is served, and that is your own search, Maps and YouTube history.
 *
 * It is loopback only, but only because `.claude/launch.json` now passes
 * `--bind 127.0.0.1`. It did not always. `python -m http.server` binds every
 * interface by default, and this machine has an enabled inbound firewall rule
 * allowing Python on the Public profile - the one used for cafe and hotel
 * wifi - so the server really was reachable from the network rather than
 * theoretically so. It did not matter while it served only the public site.
 * It matters entirely now.
 *
 * If you start the server any other way, pass the bind address yourself.
 * Stop it when you are done.
 *
 * Three separate things keep `_local` out of anything published:
 *   - `.gitignore` has the directory, so git cannot see it
 *   - `tools/make-public.js` skips it when copying and refuses outright if it
 *     ever appears in an output tree
 *   - `tools/check.js` does not walk it, so linting never reads it
 * Delete the directory when you are done anyway. It is scratch.
 *
 * Usage:
 *   node tools/pull-activity.js <folder-of-takeout-zips>
 *   then start the muletto-web dev server and open:
 *   http://localhost:5173/_local/harness.html
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { centralDirectory, dataOffset, readAt } = require("./count-exif.js");

/* The shipped pattern, so the harness looks for what the app looks for. Note
   the real file is "My Activity.html" with a space - the optional space in the
   pattern is what makes both spellings work, and a harness that assumed
   "MyActivity.html" found nothing and looked like a parser failure. */
const ACTIVITY_FILE = /My Activity\/([^/]+)\/My ?Activity\.html$/i;

const WEB = path.join(__dirname, "..", "apps", "web");
const OUT = path.join(WEB, "_local");
const DATA = path.join(OUT, "activity");

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: node tools/pull-activity.js <folder-of-takeout-zips>");
    process.exit(1);
  }
  fs.mkdirSync(DATA, { recursive: true });

  const zips = fs.statSync(src).isDirectory()
    ? fs.readdirSync(src).filter((f) => /\.zip$/i.test(f)).map((f) => path.join(src, f))
    : [src];

  const index = [];
  for (const zp of zips) {
    let fd;
    try { fd = fs.openSync(zp, "r"); } catch (err) { continue; }
    const entries = centralDirectory(fd, fs.statSync(zp).size);
    for (const e of entries || []) {
      const m = e.name.match(ACTIVITY_FILE);
      if (!m) continue;
      const off = dataOffset(fd, e);
      if (off === null) continue;
      const comp = readAt(fd, off, e.csize);
      let buf;
      try { buf = e.method === 8 ? zlib.inflateRawSync(comp) : comp; }
      catch (err) { continue; }
      /* Named by position, not by product. The product name is Google's and is
         harmless, but the file name is one less thing to think about. */
      const name = "p" + index.length + ".html";
      fs.writeFileSync(path.join(DATA, name), buf);
      index.push({ file: name, product: m[1], bytes: buf.length });
    }
    fs.closeSync(fd);
  }
  fs.writeFileSync(path.join(DATA, "index.json"), JSON.stringify(index, null, 1));

  /* Copied rather than generated. Writing a file that emits JavaScript is how
     this codebase has broken itself repeatedly - an escape collapses a level
     and the result is a regex that matches nothing. The harness is two real
     files on disk and they are copied verbatim. */
  for (const f of ["harness.html", "harness.js"]) {
    fs.copyFileSync(path.join(__dirname, "activity-harness", f), path.join(OUT, f));
  }

  console.log("");
  console.log("pulled " + index.length + " My Activity pages into apps/web/_local/activity");
  for (const i of index) {
    console.log("  " + i.product.padEnd(22) + (i.bytes / 1024).toFixed(0).padStart(7) + " KB");
  }
  console.log("");
  console.log("Now start the muletto-web dev server and open:");
  console.log("  http://localhost:5173/_local/harness.html");
  console.log("");
  console.log("It prints counts only - no search term, title or URL is shown.");
  console.log("Delete apps/web/_local when you are finished.");
  console.log("");
}

if (require.main === module) main();
