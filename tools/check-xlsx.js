"use strict";

/* Muletto - do we actually read the spreadsheets Samsung sends?
 *
 * TESTPLAN marked `.xlsx` as implemented but never run against a real file,
 * and in two other places still said we do not read them at all - notes
 * written before the parser existed and never revisited. This settles it
 * against the real export.
 *
 * The point of loading the shipped zip.js, zipcrypt.js and parsers.js rather
 * than reimplementing any of them is that the container is half the risk: the
 * spreadsheet is a zip of XML *inside* an AES-encrypted zip, so what is being
 * tested is a nested open, a decrypt and a parse together. None of that is
 * mocked here. Node has Blob, DecompressionStream and WebCrypto, and zip.js
 * touches no DOM, so the browser code runs unmodified.
 *
 *   node tools/check-xlsx.js <dir-of-zips> [password]
 *
 * Output is shape only - column names, row and cell counts. No cell values,
 * because these are somebody's account records. Safe to paste anywhere.
 */

const fs = require("fs");
const path = require("path");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", "apps", "web", rel), "utf8");
}

/* One scope, because they refer to each other by global name the way the page
   gives them: zip.js calls MZipCrypt, parsers.js calls MZip. */
const { MZip, MParse } = new Function(
  load("zipcrypt.js") + "\n" + load("zip.js") + "\n" + load("parsers.js") +
  "\n; return { MZip: MZip, MParse: MParse };")();

const dir = process.argv[2];
const password = process.argv[3] || null;
if (!dir) {
  console.error("usage: node tools/check-xlsx.js <dir-of-zips> [password]");
  process.exit(2);
}

function zips(root) {
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    if (fs.statSync(full).isDirectory()) out.push(...zips(full));
    else if (/\.zip$/i.test(name)) out.push(full);
  }
  return out;
}

/* A spreadsheet that opens is not a spreadsheet that was read correctly. The
   two ways this parser fails quietly both look like success from a row count:
   a sheet read without the shared-string pool is a grid of small integers,
   and a row with an absent cell placed in order rather than by its r=
   reference is shifted left from that column on. Both are checkable without
   looking at any value. */
function judge(t) {
  const cells = t.rows.reduce((n, r) => n + r.length, 0);
  let filled = 0, numeric = 0, ragged = 0;
  for (const r of t.rows) {
    if (r.length !== t.columns.length) ragged++;
    for (const v of r) {
      if (v === "") continue;
      filled++;
      if (/^\d+$/.test(v)) numeric++;
    }
  }
  const notes = [];
  /* Shared strings unresolved. A real account dump is mostly text; a pool
     index is always a small integer, so a sheet that is nearly all integers
     when it should not be is the signature of the pool having been missed. */
  if (filled > 20 && numeric / filled > 0.9) {
    notes.push("SUSPECT: " + Math.round(100 * numeric / filled) +
               " percent of filled cells are bare integers - shared strings may be unresolved");
  }
  if (ragged) notes.push("ragged: " + ragged + " of " + t.rows.length +
                         " rows differ in width from the header");
  if (!t.columns.some((c) => /^Column \d+$/.test(c))) notes.push("every column is named");
  else notes.push(t.columns.filter((c) => /^Column \d+$/.test(c)).length +
                  " column(s) had no header");
  return { cells, filled, notes };
}

(async function main() {
  const files = zips(dir);
  if (!files.length) { console.error("no .zip under " + dir); process.exit(2); }
  if (password) MZip.password = password;

  let found = 0, read = 0, rows = 0;
  const bad = [];

  for (const file of files) {
    const blob = new Blob([fs.readFileSync(file)]);
    let entries;
    try { entries = await MZip.readDirectory(blob); }
    catch (err) { console.log("  " + path.basename(file) + ": " + err.message); continue; }

    for (const e of entries) {
      if (!/\.xlsx$/i.test(e.name)) continue;
      found++;
      let tables = null, err = null;
      try { tables = await MParse.readXlsx(blob, e); } catch (ex) { err = ex; }
      const label = path.basename(e.name);
      if (!tables || !tables.length) {
        bad.push([label, err ? err.message : "readXlsx returned nothing"]);
        continue;
      }
      read++;
      console.log("\n" + label + "  ->  " +
        (tables.length === 1 ? "one table" : tables.length + " tables"));
      for (const t of tables) {
        rows += t.rows.length;
        const v = judge(t);
        console.log("  " + (t.title || "(untitled)"));
        console.log("    " + t.columns.length + " columns, " + t.rows.length +
                    " rows, " + v.filled + " of " + v.cells + " cells filled");
        for (const n of v.notes) console.log("    " + n);
      }
    }
  }

  console.log("\nspreadsheets     " + found + " found in " + files.length + " archives");
  console.log("read             " + read + " of " + found + ", " + rows + " rows total");
  for (const [name, why] of bad) console.log("  FAIL " + name + ": " + why);
  process.exitCode = (found && read === found) ? 0 : 1;
})();
