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
    /* `_local` is the gitignored scratch the harnesses copy real export files
       into so a served page can fetch them. Linting somebody's own data for
       ASCII is meaningless and it fails the build on the first accented
       character, which looks like a real error and is not. */
    if (e.name === "node_modules" || e.name === ".git" || e.name === "vendor"
        || e.name === "_local") continue;
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

  /* Norwegian needs six letters this rule was written to forbid.
   *
   * The rule is not really about ASCII, it is about two things: text that
   * arrived mangled, and the punctuation that makes a page look machine-made
   * - em dashes, curly quotes, arrows, emoji. Norwegian copy written without
   * ae, oe and aa is not compliant, it is wrong: "Aapne" is not a spelling of
   * "Apne" that anybody uses.
   *
   * So the six letters are allowed, and only in the places that hold
   * Norwegian: the translation files and the /no/ tree. Everywhere else, and
   * every other character above 126 everywhere including there, still fails.
   * A curly quote in a Norwegian guide is as unwanted as it ever was.
   */
  /* ae, oe, aa - and e-acute, which Norwegian uses in a handful of ordinary
     words: en with an accent means 'a single one' and is not optional, so
     writing round it changes the sentence. */
  const NORWEGIAN = new Set([0xc6, 0xd8, 0xc5, 0xe6, 0xf8, 0xe5, 0xc9, 0xe9]);
  const mayHold = (f) => /\.nb\.json$/.test(f) ||
    rel(f).split(path.sep).join("/").startsWith("apps/web/no/");

  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const norsk = mayHold(f);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (norsk && NORWEGIAN.has(c)) continue;
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
    .concat(fs.existsSync(path.join(WEB, "no"))
      ? walk(path.join(WEB, "no"), (p) => p.endsWith(".html")) : [])
    .concat([path.join(WEB, "guides.html"), path.join(WEB, "sitemap.xml")]);
  for (const f of gen) if (fs.existsSync(f)) before.set(f, fs.readFileSync(f, "utf8"));

  /* `stdio: "pipe"` so the build's chatter does not drown this report - but a
     warning is not chatter, and swallowing one hid a real failure. build-site
     warns when git will not give it the sitemap dates; that warning went
     nowhere, so the build wrote a sitemap with all forty-three lastmod values
     missing, this check called the file stale without saying why, and the
     damaged file was already on disk by then. Whatever the build warns about
     is repeated here, where somebody is looking. */
  /* spawnSync rather than execFileSync, for the one reason that matters here:
     console.warn writes to stderr, and execFileSync hands back stdout alone
     unless the child fails. The warning this exists to surface would have gone
     missing a second time. */
  {
    const run = require("child_process").spawnSync(
      process.execPath, [path.join(ROOT, "tools", "build-site.js")],
      { cwd: ROOT, encoding: "utf8" });
    if (run.error) fail("build-site.js would not run: " + run.error.message);
    else if (run.status !== 0) {
      fail("build-site.js exited " + run.status + ": " +
        String(run.stderr || "").split("\n").filter(Boolean).slice(-1)[0]);
    }
    /* WARNING means something is damaged and must not ship. NOTE means the
       build chose not to write something and said why - a translation that has
       fallen behind its English, most often. The second is worth seeing and is
       not a failure; conflating the two would make an ordinary edit to an
       English guide impossible to commit until its Norwegian caught up, which
       is how a rule gets deleted rather than obeyed. */
    for (const line of String(run.stderr || "").split("\n")) {
      if (/^\s*NOTE:/.test(line)) console.log("  ..   " + line.trim().replace(/^NOTE:\s*/, ""));
      else if (/warning/i.test(line)) fail("build-site.js warned:" + line.replace(/^\s*WARNING:/i, ""));
    }
  }

  /* The commit stamp is deployment metadata, not content. It is written by
     whichever build produced the deployed pages, so it differs between a
     laptop and the host by design - and comparing it made every generated page
     look stale in the public repository, where the build can see the remote
     and the committed files were copied from a tree that could not. Compare
     what the guide JSON actually produces. */
  /* Written as a literal rather than built from a string. Passing this through
     a shell collapsed the escapes to /s*<a class="foot-commit"[sS]*?<\/a>/,
     which asks for literal letters s and S and therefore matched nothing at
     all - so the check went on reporting every page stale while appearing to
     have been fixed. */
  const STAMP = /\s*<a class="foot-commit"[\s\S]*?<\/a>/g;
  const withoutStamp = (t) => t.replace(STAMP, "");

  /* A file that was there before the build and is gone after it has not gone
     stale - the build removed it on purpose, which is what happens to a
     Norwegian page whose translation has fallen behind. Reading it back threw
     ENOENT and took the whole check down with it, so a translation lagging
     did not report a lag, it reported a crash. */
  const stale = [], dropped = [];
  for (const [f, was] of before) {
    if (!fs.existsSync(f)) { dropped.push(rel(f)); continue; }
    if (withoutStamp(fs.readFileSync(f, "utf8")) !== withoutStamp(was)) stale.push(rel(f));
  }
  for (const f of dropped) {
    console.log("  ..   " + f + " is no longer generated, and the build said why above");
  }
  if (stale.length) {
    stale.forEach((f) => fail(f + " is stale - run the build and commit the result"));
  } else {
    ok((before.size - dropped.length) + " generated files are up to date");
  }
}

/* ---------- 3b. hreflang says the same thing from both ends ---------- */

/* An hreflang pair is a claim that two pages are the same page in two
   languages, and search engines only act on it when both sides say so. A
   one-sided claim is not a half-working pair: it is ignored at best, and at
   worst it points a crawler at a URL that is not there.
 *
 * Both failure modes are silent in a browser - the page looks perfect - so
 * nothing but a check like this one would notice. Three things are verified:
 * every alternate resolves to a file that exists, every page named as an
 * alternate names its partner back, and no page in a language tree is left
 * without a partner at all.
 */
console.log(String.fromCharCode(10) + "hreflang pairs");
{
  const pages = walk(WEB, (p) => p.endsWith(".html"));
  const alts = new Map();
  let paired = 0;
  const problems = [];

  for (const f of pages) {
    const s = fs.readFileSync(f, "utf8");
    const found = [];
    const re = /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g;
    let m;
    while ((m = re.exec(s))) if (m[1] !== "x-default") found.push([m[1], m[2]]);
    if (found.length) alts.set(rel(f), found);
  }

  /* A site URL back to the file that serves it, so an alternate can be
     followed without guessing at the deploy's routing. */
  const SITE = "https://muletto.app";
  const fileFor = (loc) => {
    let p = String(loc).replace(SITE, "").replace(/^\//, "");
    if (!p || p.endsWith("/")) p += "index.html";
    return path.join(WEB, p);
  };

  for (const [page, found] of alts) {
    for (const [lang, loc] of found) {
      const target = fileFor(loc);
      if (!fs.existsSync(target)) {
        problems.push(page + ' claims an ' + lang + ' alternate at ' + loc +
          ", and nothing is there");
        continue;
      }
      const back = alts.get(rel(target));
      if (!back || !back.some(([, l]) => fileFor(l) === path.join(WEB, page.replace("apps/web/", "")))) {
        problems.push(page + " names " + rel(target) + " as its " + lang +
          " alternate, and that page does not name it back");
        continue;
      }
      paired++;
    }
  }

  /* A page inside a language tree with no alternate at all is orphaned: it is
     reachable, indexable, and nothing connects it to the page it translates. */
  const noDir = path.join(WEB, "no");
  if (fs.existsSync(noDir)) {
    for (const f of walk(noDir, (p) => p.endsWith(".html"))) {
      if (!alts.has(rel(f))) problems.push(rel(f) + " is in the /no/ tree and declares no alternate");
    }
  }

  if (problems.length) problems.forEach(fail);
  else ok(paired ? paired + " hreflang alternates resolve and point back"
                 : "no hreflang alternates yet, and none half-declared");
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
      const clean = r.split("#")[0].split("?")[0];
      /* A leading slash is the site root, not the folder this file happens to
         sit in. Joining it to the folder was harmless while every page with
         absolute links sat directly in apps/web - the two answers coincide -
         and started reporting every asset on the /no/ 404 as missing the
         moment a page one level deeper used them. The page was right and the
         check was wrong, which is the more dangerous way round. */
      const target = clean.startsWith("/")
        ? path.join(WEB, clean.slice(1))
        : path.join(dir, clean);
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

/* Claims the documents make about this repository.
 *
 * The registry and the reasoning are in tools/claims.js. Short version: every
 * documentation error found this week was a fact the repo could compute, and
 * every paragraph explaining *why* something works survived untouched. So
 * facts get computed and prose gets written, and this is where the first half
 * is enforced. */
console.log("\nClaims the documents make");
{
  const { facts, claims, deadPaths, spelled } = require("./claims.js");
  const f = facts();
  const cache = new Map();
  const doc = (name) => {
    if (!cache.has(name)) {
      const p = path.join(ROOT, name);
      cache.set(name, fs.existsSync(p) ? fs.readFileSync(p, "utf8").toLowerCase() : null);
    }
    return cache.get(name);
  };

  let bad = 0, skipped = 0;
  for (const c of claims(f)) {
    const text = doc(c.doc);
    /* A document that is not in this tree is not a failure. The public mirror
       carries a subset on purpose, so RELEASE.md and TODO.md are absent there
       and their claims simply have nothing to check against. */
    if (text === null) { skipped++; continue; }
    if (c.say !== undefined && !text.includes(c.say.toLowerCase())) {
      fail(c.doc + ' should say "' + c.say + '" - ' + c.why); bad++;
    }
    if (c.never !== undefined && text.includes(c.never.toLowerCase())) {
      fail(c.doc + ' still says "' + c.never + '" - ' + c.why); bad++;
    }
  }

  const DOCS = fs.readdirSync(ROOT).filter((n) => n.endsWith(".md"))
    .concat(fs.existsSync(path.join(ROOT, "DECISIONS"))
      ? fs.readdirSync(path.join(ROOT, "DECISIONS")).map((n) => "DECISIONS/" + n) : []);
  const dead = deadPaths(DOCS);
  if (dead.unverified) {
    console.log("  ..   could not ask git which of those paths are ignored, so the " +
      "missing-path check did not run this time. Nothing failed; nothing was proved.");
  }
  for (const [d, ref] of dead) { fail(d + " names `" + ref + "`, which does not exist"); bad++; }

  if (!bad) {
    ok((claims(f).length - skipped) + " stated facts match the repository" +
       (skipped ? " (" + skipped + " skipped, their document is not in this tree)" : "") +
       ", and " + DOCS.length + " documents name no path that is missing");
  }
}

console.log("");
if (failed) {
  console.log(failed + " problem" + (failed === 1 ? "" : "s") + " found.\n");
  process.exit(1);
}
console.log("All checks passed.\n");
