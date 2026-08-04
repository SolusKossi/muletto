#!/usr/bin/env node
"use strict";

/* The checks that keep being run by hand.
 *
 *   node tools/check.js
 *
 * Four things, each of which has actually caught something:
 *
 * 1. Non-ASCII and control characters. The project rule is plain ASCII, and
 *    this has caught more than curly quotes: a patch script once collapsed a
 *    regex into two literal backspace bytes, which left the out-of-credits
 *    check silently unable to match a bare 402.
 *
 * 2. Every JS file parses. Cheap, and a syntax error in a script tag is
 *    invisible until the page is opened.
 *
 * 3. The committed generated HTML matches the guide JSON. The generated pages
 *    are committed so a host needs no build step, which means they can go
 *    stale against their source with nothing to notice.
 *
 * 4. No broken internal links or missing images.
 *
 * Exits non-zero on any failure, so it works as a pre-push or CI step. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "apps", "web");

let failed = 0;
const fail = (msg) => { console.log("  FAIL " + msg); failed++; };
const ok = (msg) => console.log("  ok   " + msg);

function walk(dir, test, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "vendor") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

/* ---------- 1. plain ASCII ---------- */

console.log("\nASCII and control characters");
{
  const exts = /\.(js|css|html|md|json|svg|txt|xml|py)$/;
  const files = walk(ROOT, (p) => exts.test(p));
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 126 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) {
        const line = text.slice(0, i).split("\n").length;
        bad.push(rel(f) + ":" + line + " 0x" + c.toString(16));
        break;
      }
    }
  }
  if (bad.length) bad.forEach(fail);
  else ok(files.length + " files are plain ASCII");
}

/* ---------- 2. every script parses ---------- */

console.log("\nSyntax");
{
  const js = walk(ROOT, (p) => p.endsWith(".js"));
  let n = 0;
  for (const f of js) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); n++; }
    catch (e) { fail(rel(f) + " does not parse"); }
  }
  if (n === js.length) ok(n + " JS files parse");
}

/* ---------- 3. generated output matches its source ---------- */

console.log("\nGenerated pages match the guide JSON");
{
  const before = new Map();
  const gen = walk(path.join(WEB, "guides"), (p) => p.endsWith(".html"))
    .concat([path.join(WEB, "guides.html"), path.join(WEB, "sitemap.xml")]);
  for (const f of gen) if (fs.existsSync(f)) before.set(f, fs.readFileSync(f, "utf8"));

  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "build-site.js")], { stdio: "pipe" });
  } catch (e) {
    fail("build-site.js threw: " + String(e.message).split("\n")[0]);
  }

  const stale = [];
  for (const [f, was] of before) {
    if (fs.readFileSync(f, "utf8") !== was) stale.push(rel(f));
  }
  if (stale.length) {
    stale.forEach((f) => fail(f + " is stale - run the build and commit the result"));
  } else {
    ok(before.size + " generated files are up to date");
  }
}

/* ---------- 4. links and images resolve ---------- */

console.log("\nInternal links and images");
{
  const pages = walk(WEB, (p) => p.endsWith(".html"));
  const missing = [];
  for (const f of pages) {
    const s = fs.readFileSync(f, "utf8");
    const dir = path.dirname(f);
    const refs = [];
    const attr = /(?:href|src)="([^"]+)"/g;
    let m;
    while ((m = attr.exec(s))) refs.push(m[1]);
    for (const r of refs) {
      if (/^(https?:|mailto:|data:|#|\/\/)/.test(r)) continue;
      const target = path.join(dir, r.split("#")[0].split("?")[0]);
      if (!fs.existsSync(target)) missing.push(rel(f) + " -> " + r);
    }
  }
  if (missing.length) missing.forEach(fail);
  else ok(pages.length + " pages have no broken local references");
}

/* ---------- inline scripts the CSP will refuse ----------

   The site is served with script-src 'self', so an inline <script> is blocked
   outright. The dev server sends no CSP, which is what makes this so easy to
   get wrong: the code runs perfectly while being written and is silently
   refused the moment it is deployed, with nothing in the page to say why.

   That is exactly how the standing privacy notice shipped broken. Its reveal
   logic was inline, so on the live site the notice stayed hidden and no error
   was visible without opening the console.

   JSON-LD is exempt: it is data the browser never executes. */
console.log("\nInline scripts (the CSP refuses these in production)");
{
  const offenders = [];
  const pages = walk(WEB, (p) => p.endsWith(".html"));
  for (const f of pages) {
    const s = fs.readFileSync(f, "utf8");
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(s))) {
      const attrs = m[1] || "";
      if (/\ssrc=/i.test(attrs)) continue;
      if (/application\/ld\+json/i.test(attrs)) continue;
      if (m[2].trim()) offenders.push(rel(f));
    }
  }
  if (offenders.length) {
    [...new Set(offenders)].forEach((f) =>
      fail(f + " has an inline <script>; move it to its own file"));
  } else {
    ok(pages.length + " pages have no inline scripts");
  }
}

console.log("");
if (failed) {
  console.log(failed + " problem" + (failed === 1 ? "" : "s") + " found.\n");
  process.exit(1);
}
console.log("All checks passed.\n");
