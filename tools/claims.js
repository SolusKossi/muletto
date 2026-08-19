"use strict";

/* Things the documents assert about this repository, checked against it.
 *
 * ---- why this file exists ----
 *
 * Over one week these were all found wrong, in six different documents:
 *
 *   README        six files touch the network, beside a grep returning eight
 *   README        thirty guides, against thirty-nine on disk
 *   ARCHITECTURE  adapters "planned", when every parser had shipped
 *   ARCHITECTURE  zip64 "still to do", on a reader opening 23 GB archives
 *   NOTES         a test-data/ folder deleted months earlier
 *   NOTES         "the library lives in memory only", against store.js
 *   CONTRIBUTING  a tests/fixtures/ that never existed
 *   TESTPLAN      Snapchat "not measured", after it had been
 *   PROVIDERS     Facebook "never run on a real export", after it had been
 *   RELEASE       25 sitemap URLs, 20 guides, repo private, Bing pending,
 *                 the donate link unset, and zip64 untested - all six wrong
 *
 * The instinct is to write "keep the docs updated" somewhere. That instruction
 * already existed and every one of these happened anyway, because nobody
 * rereads a paragraph they are not currently editing.
 *
 * What they have in common is more useful than the instinct: **every one is a
 * fact the repository can compute.** A count of files. Whether a path exists.
 * Whether a config value is empty. None of them needed a person to remember
 * anything - they needed something to count.
 *
 * What did not rot, in the same week, is every paragraph explaining *why*
 * something is the way it is. The backslash rule, the reasoning behind the
 * date ordering, why the archive stamp cannot be trusted. Those cannot go
 * stale because they are not claims about the current state of anything.
 *
 * So the rule this file enforces:
 *
 *   **Do not write a fact the repo can compute. If you must, compute it here.**
 *
 * Adding a claim is one line. That is deliberately cheaper than the paragraph
 * you would otherwise write apologising for the last one being wrong.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "apps", "web");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(dir, test, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "vendor", "_local"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

const WORDS = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
  7: "seven", 8: "eight", 9: "nine", 10: "ten", 18: "eighteen", 20: "twenty",
  25: "twenty-five", 38: "thirty-eight", 39: "thirty-nine", 44: "forty-four" };
const spelled = (n) => WORDS[n] || String(n);

/* ---- what the repository currently is ---- */

function facts() {
  const guideDir = path.join(WEB, "guides");
  const pages = fs.readdirSync(guideDir).filter((f) => f.endsWith(".html"));

  /* The same question the README tells a reader to ask of the source. If this
     and the README's grep ever disagree, the README is wrong by construction. */
  const NET = /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/;
  const talkers = walk(WEB, (p) => p.endsWith(".js"))
    .filter((f) => NET.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.basename(f)).sort();

  const sitemap = exists("apps/web/sitemap.xml")
    ? (read("apps/web/sitemap.xml").match(/<url>/g) || []).length : 0;

  /* Config values documents make claims about. A document saying a feature is
     dark, when the value that darkens it has since been filled in, sends
     somebody to do work that is already done. */
  const donateLink = (/const LINK = "([^"]*)"/.exec(read("apps/web/donate.js")) || [])[1] || "";
  const creditsBase = (/base: "([^"]*)"/.exec(read("apps/web/credits.js")) || [])[1] || "";

  return {
    guidePages: pages.length,
    serviceGuides: pages
      .filter((f) => !/^(dest-|flow-|why-|how-)/.test(f))
      .filter((f) => !/-(came-as|missing)-/.test(f)).length,
    talkers,
    sitemapUrls: sitemap,
    samples: fs.readdirSync(path.join(WEB, "samples")).filter((f) => f.endsWith(".zip")).length,
    donateLink,
    creditsBase,
  };
}

/* ---- the claims ----
 *
 * `say`   the document must contain this phrase, built from a live value.
 * `never` the document must not contain this phrase. For prose that cannot be
 *         generated but can be recognised once it has gone stale.
 *
 * Matching is a plain lowercased substring. A regex here would want escaped
 * brackets, and building one in a generator is how this codebase has twice
 * ended up with a literal backspace in its source.
 */
function claims(f) {
  const list = [
    { doc: "README.md", say: "[" + spelled(f.guidePages) + " guides]",
      why: "guide pages on disk" },
    { doc: "README.md", say: "each of " + spelled(f.serviceGuides) + " services",
      why: "guides for requesting an export" },
    { doc: "README.md", say: spelled(f.talkers.length) + " files do",
      why: "files matching the network grep the README prints" },
  ];

  for (const name of f.talkers) {
    list.push({ doc: "README.md", say: "apps/web/" + name,
      why: "the grep finds it, so the list must name it" });
  }

  /* RELEASE.md is the file somebody consults to decide what to work on, which
     makes a stale line there more expensive than anywhere else: it sends a
     person to redo something finished. All six of these were wrong at once. */
  list.push(
    { doc: "RELEASE.md", never: "the repo stays private",
      why: "the mirror is public and make-public.js is what publishes it" },
    { doc: "RELEASE.md", never: "only ever seen sample data",
      why: "every core provider has had a real export opened" },
    { doc: "RELEASE.md", say: "sitemap.xml` lists " + f.sitemapUrls,
      why: "URLs in the generated sitemap" });

  if (f.donateLink) {
    list.push({ doc: "RELEASE.md", never: "one line to finish it",
      why: "donate.js already has a LINK set, so there is no line left to set" });
  }
  if (!f.creditsBase) {
    list.push({ doc: "RELEASE.md", say: "credits.js` has `base: \"\"",
      why: "hosted credits really are still dark" });
  }
  return list;
}

/* ---- paths a document names must exist ----
 *
 * Fully automatic, and it is the half that needs no maintenance. CONTRIBUTING
 * sent contributors to tests/fixtures/ for months and NOTES pointed at a
 * test-data/ folder whose deletion is recorded further down NOTES itself.
 * Both would have failed here the day they went stale.
 */
function deadPaths(docs) {
  /* Backticked things that look like a repo path: they contain a slash or a
     known extension, and no spaces, protocol or glob. Prose in backticks and
     shell snippets are left alone. */
  const LOOKS_LIKE_PATH = /^(?![a-z]+:)(?!.*[ *?<>|])(?=.*[/.])[\w./-]+\/?$/i;
  const SKIP = /^(\.|node_modules|https?|com|www)/i;

  const found = [];
  for (const doc of docs) {
    if (!exists(doc)) continue;
    for (const m of read(doc).matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim();
      if (!LOOKS_LIKE_PATH.test(raw) || SKIP.test(raw)) continue;
      /* A leading slash is a URL on the site, not a path in the repository.
         `/admin` and `/api/interest` are routes; treating them as files
         reported four things missing that were never meant to be here. */
      if (raw.startsWith("/")) continue;
      if (!raw.includes("/")) continue;
      /* Only paths rooted at something this repo actually has at the top
         level. Otherwise every filename mentioned in passing, and every path
         inside somebody's export, would be treated as a promise. */
      if (!exists(raw.split("/")[0])) continue;
      if (!exists(raw.replace(/\/$/, ""))) found.push([doc, raw]);
    }
  }

  /* A gitignored path is absent from a fresh clone on purpose. `apps/web/_local`
     is where the harnesses copy real export files so a served page can fetch
     them; documenting it is right and its absence is not an error. */
  if (!found.length) return found;
  const bare = (r) => r.replace(/\/$/, "");
  /* Both forms are asked about. A .gitignore entry written `apps/web/_local/`
     matches a directory only, so git answers "not ignored" for the same path
     without its trailing slash - which is how the one genuinely gitignored
     path in the docs came back as a failure. */
  const ask = [];
  for (const [, r] of found) { ask.push(bare(r), bare(r) + "/"); }
  let ignored = new Set();
  try {
    const res = require("child_process").spawnSync(
      "git", ["check-ignore", "--stdin"],
      { cwd: ROOT, input: ask.join("\n"), encoding: "utf8" });
    ignored = new Set((res.stdout || "").split("\n").map((s) => bare(s.trim())).filter(Boolean));
  } catch (e) { /* no git here; report everything and let a person judge */ }
  return found.filter(([, r]) => !ignored.has(bare(r)));
}

module.exports = { facts, claims, deadPaths, spelled };
