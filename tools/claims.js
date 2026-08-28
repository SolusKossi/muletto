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
  7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
  13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen",
  18: "eighteen", 19: "nineteen", 20: "twenty",
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

  /* Providers the app has a reader for, taken from the guides themselves.
     PROVIDERS.md is the page a person reads to decide whether requesting an
     export is worth an afternoon, so a service gaining a reader without
     gaining a section there is the expensive kind of silence: the reader
     exists and nobody is told. The guide-only services are deliberately not
     required here - they are what the "Anything else" section is about. */
  const readable = [];
  for (const f of fs.readdirSync(guideDir).filter((n) => n.endsWith(".json"))) {
    let g;
    try { g = JSON.parse(fs.readFileSync(path.join(guideDir, f), "utf8")); }
    catch (e) { continue; }
    const sup = g.muletto_support || {};
    if (sup.importable && g.provider) readable.push(g.provider);
  }

  const sitemap = exists("apps/web/sitemap.xml")
    ? (read("apps/web/sitemap.xml").match(/<url>/g) || []).length : 0;

  /* Config values documents make claims about. A document saying a feature is
     dark, when the value that darkens it has since been filled in, sends
     somebody to do work that is already done. */
  const donateLink = (/const LINK = "([^"]*)"/.exec(read("apps/web/donate.js")) || [])[1] || "";

  /* The hosts the page is permitted to contact. This is the privacy claim in
     its enforceable form, so it is worth failing the build over: if a host is
     ever added back, the documents that describe the promise have to be
     updated in the same commit or this check says so. */
  /* Read from the policy line itself, not from the prose above it - the
     comments in that file discuss connect-src at length and a loose match
     picks up a sentence instead of the setting. */
  const policy = read("apps/web/_headers").split(String.fromCharCode(10))
    .find((l) => l.trim().startsWith("Content-Security-Policy:")) || "";
  const connectSrc = ((/connect-src ([^;]*)/.exec(policy) || [])[1] || "").trim();

  /* How much of PROVIDERS is claimed from a real export and how much from
     documentation. This is the distinction the whole project turns on, and it
     is the one most likely to be quietly overstated in a summary written
     somewhere else - so it is counted from the sections themselves rather
     than remembered. A section that has met a real export does not carry the
     words "Not measured"; every other one does, by house rule. */
  const provSections = read("PROVIDERS.md").split(/^## /m).slice(1)
    .filter((sec) => sec.split(String.fromCharCode(10))[0].trim() !== "Anything else");
  const notMeasured = provSections.filter((sec) => /\*\*Not measured/.test(sec)).length;

  return {
    guidePages: pages.length,
    serviceGuides: pages
      .filter((f) => !/^(dest-|flow-|why-|how-)/.test(f))
      .filter((f) => !/-(came-as|missing)-/.test(f)).length,
    talkers,
    sitemapUrls: sitemap,
    readable: readable.sort(),
    providerSections: provSections.length,
    notMeasured,
    measured: provSections.length - notMeasured,
    samples: fs.readdirSync(path.join(WEB, "samples")).filter((f) => f.endsWith(".zip")).length,
    donateLink,
    connectSrc,
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

  /* The two counts a visitor actually sees on the page they use. The sample
     button says how many samples it opens and the opener says how many
     services have a reader; both were written by hand and both are countable. */
  list.push(
    { doc: "apps/web/app.html", say: "Open " + spelled(f.samples) + " sample exports",
      why: "sample archives in apps/web/samples" },
    { doc: "apps/web/app.html", say: spelled(f.readable.length) + " services have a reader",
      why: "guides whose muletto_support says a reader exists" });

  /* The home page names the unverified readers one by one, which is the most
     visible place this claim appears and the only one a visitor reads. A name
     added to that list without a reader behind it, or a reader that quietly
     graduates to measured and stays on the list, is the failure to catch. */
  const provText = read("PROVIDERS.md").split(/^## /m).slice(1);
  for (const sec of provText) {
    const name = sec.split(String.fromCharCode(10))[0].trim();
    if (name === "Anything else" || !/\*\*Not measured/.test(sec)) continue;
    /* The home page uses the short name, the way a sentence would. */
    const short = name.replace(/ \(.*\)$/, "").replace(/ and Google Health$/, "");
    list.push({ doc: "apps/web/index.html", say: short,
      why: "PROVIDERS says this reader has never met a real export" });
  }

  /* RELEASE is the file somebody opens to decide what to do next, so a
     rounded number there sends real work at the wrong thing. Both halves
     again, and the heading carries one of them. */
  list.push(
    { doc: "RELEASE.md", say: spelled(f.notMeasured) + " readers that have never met a real export",
      why: "PROVIDERS sections carrying the words Not measured" },
    { doc: "RELEASE.md", say: "only " + spelled(f.measured) + " have been checked",
      why: "PROVIDERS sections that do not" },
    { doc: "RELEASE.md", never: "every core provider has now had a real export opened",
      why: "true of six of eighteen, which is not what that sentence says any more" });

  /* TODO says the same count in prose, and it is the number that decides
     what somebody does next - so it is checked in both places rather than
     kept in step by hand. */
  list.push({ doc: "TODO.md",
    say: spelled(f.notMeasured) + " of the " + spelled(f.readable.length) + " readers",
    why: "readers with no real export behind them" });

  /* The split between what has met a real export and what has not. Six and
     eleven today. It is the claim a summary is most likely to round in the
     flattering direction, so both halves are counted from PROVIDERS itself. */
  list.push(
    { doc: "README.md", say: spelled(f.readable.length) + " services have a reader",
      why: "guides whose muletto_support says a reader exists" },
    { doc: "README.md", say: spelled(f.measured) + " measured against a real export, " +
        spelled(f.notMeasured) + " not",
      why: "PROVIDERS sections carrying the words Not measured" },
    { doc: "README.md", say: spelled(f.notMeasured) + " of the",
      why: "the testing paragraph states the same count a second time" });

  for (const name of f.readable) {
    list.push({ doc: "PROVIDERS.md", say: name,
      why: "a guide says Muletto reads this service, so PROVIDERS must cover it" });
  }

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
  /* Nothing off this origin, and every document that says so stays true. */
  if (f.connectSrc === "'self'") {
    list.push({ doc: "README.md", never: "api.openai.com",
      why: "connect-src is 'self' alone, so no document may name an outside host" });
    list.push({ doc: "PROVIDERS.md", never: "your own key",
      why: "the AI feature is withdrawn; nothing takes a key any more" });
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

  /* NOTES.md is exempt, and the reason matters. It is an append-only log: it
     describes what was true when each entry was written, so an entry naming a
     file that has since been deleted is correct history rather than a dead
     link. Making the check pass by editing the log would be rewriting the
     record to satisfy a linter, which is the wrong way round. */
  const found = [];
  for (const doc of docs) {
    if (doc === "NOTES.md") continue;
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

  /* `git check-ignore --stdin` exits 0 when it matched something and 1 when it
     matched nothing, and both of those are answers. Anything else - 128 for a
     busy index, a spawn failure, no git at all - is not an answer, and the
     original code could not tell the two apart: it caught the throw, left the
     ignored set empty, and reported every gitignored path as a missing one.

     That turns an unrelated git hiccup into a failed build with wrong
     findings, which is worse than not checking. It was seen once, immediately
     after a push, and has not reproduced in twenty idle runs - which is
     exactly the shape of a race worth removing rather than chasing.

     So: ask up to three times, and if git never answers, skip the filter and
     say the answer is unverified rather than asserting a list of failures
     nobody can trust. */
  let ignored = null;
  for (let attempt = 0; attempt < 3 && ignored === null; attempt++) {
    let res = null;
    try {
      res = require("child_process").spawnSync(
        "git", ["check-ignore", "--stdin"],
        { cwd: ROOT, input: ask.join("\n"), encoding: "utf8" });
    } catch (e) { res = null; }
    if (!res || res.error || (res.status !== 0 && res.status !== 1)) continue;
    ignored = new Set((res.stdout || "").split("\n").map((s) => bare(s.trim())).filter(Boolean));
  }
  if (ignored === null) {
    /* An array, because the caller iterates it. Empty, because reporting
       a list git could not vet is the failure this exists to prevent; the
       flag is how check.js says the answer is missing rather than clean. */
    const none = [];
    none.unverified = true;
    return none;
  }
  return found.filter(([, r]) => !ignored.has(bare(r)));
}

module.exports = { facts, claims, deadPaths, spelled };
