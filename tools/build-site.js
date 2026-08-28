#!/usr/bin/env node
"use strict";

/* Muletto site builder.
   Guide content is data (apps/web/guides/*.json). This turns it into real
   static HTML pages so each guide has its own crawlable URL, its own title and
   description, structured data, and internal links to related guides.

   Run: node tools/build-site.js
   Never hand-edit the generated .html files in apps/web/guides/. */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const WEB = path.join(ROOT_DIR, "apps", "web");
const GUIDES = path.join(WEB, "guides");
/* The one canonical host. Every canonical link, og:url and sitemap entry is
   built from this, so it has to be the host that actually answers - not one
   that redirects to it. Telling a crawler the canonical is the apex while the
   apex 308s to www is a contradiction it resolves by guessing.
   Override with MULETTO_SITE if the primary host ever changes. */
const SITE = process.env.MULETTO_SITE || "https://muletto.app";

/* Everything the generator writes is indexable.
 *
 * There used to be a build flag and a per-guide rule keeping pages out of the
 * index. Both were written before the site was live. Pages that should stay
 * out now say so in their own markup - the superseded home page is the only
 * one - so the generator has nothing left to decide. */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/* ---------- shared chrome ---------- */

function nav(depth, active) {
  const up = depth ? "../" : "";
  const on = (k) => (active === k ? ' class="active"' : "");
  return `  <nav class="nav">
    <div class="wrap">
      <div class="nav-left">
        <a class="wordmark" href="${up}index.html">muletto</a>
        <div class="nav-links">
          <a href="${up}guides.html"${on("guides")}>Guides</a>
          <a href="${up}privacy.html">Privacy</a>
        </div>
      </div>
      <div class="nav-right">
        <a class="btn primary" href="${up}app.html">Open an export</a>
      </div>
    </div>
  </nav>`;
}

/* Which commit is running.
 *
 * "Read the source" is only a check if a reader can tell that the source they
 * are reading is the source that is deployed. A hash in the footer, linked to
 * the commit, is what closes that.
 *
 * It is only shown when this tree is the public repository, because a hash
 * from the private one points at a commit nobody can open - which is worse
 * than no hash, since it looks like proof and is not. Build the public tree
 * and it appears; build the private one and it does not.
 */
function buildCommit() {
  /* Vercel sets this and it is authoritative. Reading it also means the stamp
     works on a shallow or detached checkout, where asking git can fail. The
     repository is checked either way, so a build of the private tree still
     produces nothing. */
  const env = process.env.VERCEL_GIT_COMMIT_SHA;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  if (env && repo === "muletto" && owner === "SolusKossi") return env.slice(0, 7);

  try {
    const { execSync } = require("child_process");
    const run = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const remote = run("git config --get remote.origin.url");
    if (!/[:\/]SolusKossi\/muletto(\.git)?$/i.test(remote)) return null;
    const hash = run("git rev-parse --short HEAD");
    return /^[0-9a-f]{7,40}$/.test(hash) ? hash : null;
  } catch (e) {
    return null;   // no git, no history, or a shallow checkout
  }
}
const COMMIT = buildCommit();

/* The stamp carries its own newline and indent, so that a build with no commit
   emits nothing at all rather than a line of eight spaces where the link would
   have gone.

   That stray whitespace is why the staleness check could not be made to pass:
   stripping the stamp from a stamped page removes the whitespace with it,
   while an unstamped page keeps it, so the two could never compare equal no
   matter how good the pattern was. Two hours went into the pattern. */
function commitLink() {
  if (!COMMIT) return "";
  return '\n        <a class="foot-commit" href="https://github.com/SolusKossi/muletto/commit/'
    + COMMIT + '" target="_blank" rel="noopener noreferrer"'
    + ' title="The commit this site was built from">build ' + COMMIT + "</a>";
}

function footer(depth) {
  const up = depth ? "../" : "";
  return `  <footer class="site">
    <div class="wrap">
      <a class="wordmark" href="${up}index.html">muletto</a>
      <div class="foot-links">
        <a href="${up}guides.html">Guides</a>
        <a href="${up}app.html">Open export</a>
        <a href="${up}privacy.html">Privacy</a>
        <a class="foot-src" href="https://github.com/SolusKossi/muletto" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
          Read the source
        </a>${commitLink()}
      </div>
    </div>
  </footer>`;
}

function page({ depth, title, description, canonical, body, jsonld, active, noindex, extraScript }) {
  const up = depth ? "../" : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="Muletto" />
  <meta property="og:image" content="${SITE}/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
${noindex ? '  <meta name="robots" content="noindex,follow" />\n' : ""}  <link rel="icon" href="${up}favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="${up}og.png" />
  <link rel="stylesheet" href="${up}styles.css" />
  <!-- Themes. In the head so a dark theme does not start as a white flash,
       and on every page so the choice follows the reader around. -->
  <script src="${up}theme.js"></script>
${(jsonld || []).map((j) => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
${nav(depth, active)}

  <main>
${body}
  </main>

${footer(depth)}

  <!-- Every disclosure on the site opens and shuts rather than jumping. -->
  <script src="${up}disclose.js"></script>
  <!-- Counts that a guide was read. See privacy.html. -->
  <script src="${up}analytics.js"></script>
  <script src="${up}app.js"></script>
${extraScript ? `  <script src="${up}${extraScript}"></script>\n` : ""}
</body>
</html>
`;
}

/* ---------- guide page ---------- */

const DATA_LABEL = {
  photos: "photos", videos: "videos", messages: "messages", location: "location history",
  contacts: "contacts", email: "email", browsing: "browsing activity", purchases: "purchase history",
  social: "posts and social activity", health: "health data", files: "files", other: "other records",
};

function isDest(g) { return g.slug.startsWith("dest-"); }

/* Screenshots a guide asks for but that are not on disk yet. */
const MISSING_SHOTS = new Set();

/* Image dimensions, read from the file itself: the IHDR chunk for PNG, the
   first frame header for JPEG. Inlining width and height stops the article
   reflowing as figures load. */
function pngSize(b) {
  if (b.length > 24 && b.readUInt32BE(12) === 0x49484452) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  return null;
}

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0/1/2/3/5/6/7/9..11/13..15 all carry the frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const SHOTS = (() => {
  const dir = path.join(GUIDES, "img");
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => /\.(png|jpg)$/.test(f))) {
    const b = fs.readFileSync(path.join(dir, f));
    const size = f.endsWith(".png") ? pngSize(b) : jpegSize(b);
    if (size) out[f] = size;
  }
  return out;
})();

/* A guide is finished only when two separate things have been done by hand:
   the request flow walked and screenshotted, and the resulting export opened
   in Muletto. Documentation is not evidence for either - the Snapchat docs
   never mentioned the Export JSON files toggle, and implied the date range
   needed switching off when it already defaults to off.

   The date matters as much as the fact, because a provider can redesign its
   export page at any time. Past STALE_MONTHS the page says so. */
const STALE_MONTHS = 6;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

function monthsSince(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return Infinity;
  return (Date.now() - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime())
    / (1000 * 60 * 60 * 24 * 30.44);
}

/* One stage: null, or {on, by} with a parseable date. */
function stage(v) {
  const when = v && longDate(v.on);
  return when ? { when, stale: monthsSince(v.on) > STALE_MONTHS, on: v.on } : null;
}

function confirmation(g) {
  const c = g.confirmed || {};
  const flow = stage(c.flow);
  const imp = stage(c.import);
  const noun = isDest(g) ? "this" : "the request flow";

  /* What the reader is told, as against what we track.
   *
   * The tally in GUIDE-STATUS.md and the rule that keeps an unverified guide
   * out of the index both still read this, so nothing about our own standard
   * has been relaxed. What has changed is that a guide no longer editorialises
   * about its own provenance at the person trying to follow it. A guide either
   * states something we know, or does not state it.
   *
   * So an unwalked guide shows no claim at all, rather than a paragraph
   * apologising for itself, and a walked one says what was walked and when. */
  if (!flow) {
    return {
      state: "none", badge: "", cls: "", flow: null, import: null,
      short: "", line: "",
    };
  }
  if (!imp) {
    return {
      state: "partial", badge: "Checked " + flow.when, cls: " medium",
      flow, import: null, short: flow.when,
      line: `Every screenshot below is from ${g.provider}'s own pages on ${flow.when}.`,
    };
  }
  const stale = flow.stale || imp.stale;
  return {
    state: "full", badge: (stale ? "Confirmed " : "Confirmed end to end ") + imp.when,
    cls: stale ? " medium" : " verified", flow, import: imp, short: imp.when,
    line: stale
      ? `${cap(noun)} was walked on ${flow.when} and the export opened in Muletto on ` +
        `${imp.when}. That is more than ${STALE_MONTHS} months ago, so ${g.provider} may ` +
        `have changed the page since. If what you see does not match, trust the ` +
        `screenshots least.`
      : `${cap(noun)} was walked on ${flow.when}, and the real export was opened in ` +
        `Muletto on ${imp.when} to check it does what this guide says. Every screenshot ` +
        `below is from those runs.`,
  };
}

function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

function guideTitle(g) {
  return isDest(g)
    ? `${g.provider}: where to keep your data | Muletto`
    : `${g.provider} GDPR data export: how to request it and open it | Muletto`;
}

/* What happens after the download finishes.
 *
 * Written from the guide's own data rather than from a template with the name
 * swapped in: what Muletto reads from this service, what it does about the
 * thing that service gets wrong, and the one sentence of warning that applies
 * to this export and not to the others. A page of interchangeable filler
 * helps nobody and reads as filler, which is the failure mode this is trying
 * to avoid. */
function openerSection(g) {
  if (isDest(g)) return "";
  const sup = g.muletto_support || {};
  const name = esc(g.provider);

  const lines = [];
  const kinds = (g.data_types || []).map((k) => DATA_LABEL[k] || k);
  const list = kinds.length
    ? kinds.slice(0, 3).join(", ").replace(/, ([^,]*)$/, " and $1")
    : "what is in it";

  if (sup.importable) {
    lines.push(`Muletto reads a ${name} export directly - the zip, without unpacking it ` +
      `first - and finds the ${esc(list)} inside.`);
  } else {
    lines.push(`Muletto opens a ${name} export and lists everything in it. There is no ` +
      `reader written specifically for this service yet, so its tables are shown as ` +
      `${name} wrote them - which is still a great deal more than a folder of files.`);
  }
  lines.push(`It runs in the browser: the archive is never uploaded, there is no account, ` +
    `and nothing is installed. Open several exports at once and they become one ` +
    `library, with the photographs that appear in more than one of them found ` +
    `automatically.`);

  /* The gotcha, from the guide's own notes rather than invented. The first
     note on every guide is the thing that goes wrong, by house rule. */
  const gotcha = (g.notes && g.notes.length) ? g.notes[0] : "";

  return `
          <h2 id="open">Opening your ${name} export</h2>
          ${lines.map((l) => `<p>${l}</p>`).join("\n          ")}
          ${gotcha ? `<div class="note">${esc(gotcha)}</div>` : ""}
          <p><a class="btn primary" href="../app.html">Open your ${name} export
            <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>`;
}

function guideDescription(g) {
  if (isDest(g)) {
    return `Step-by-step guide to moving your cleaned photo and data archive to ${g.provider}. ${g.steps.length} steps, written for people who want to keep their own copy.`;
  }
  const kinds = (g.data_types || []).map((k) => DATA_LABEL[k] || k);
  const list = kinds.length ? kinds.slice(0, 3).join(", ") : "your data";
  return `Request your ${g.provider} GDPR data export - ${list} - then open it and read what is inside. ${g.steps.length} steps, what actually arrives, and how long it takes (${g.wait_time}).`;
}

function guideIntro(g) {
  if (isDest(g)) {
    return `Once you have your data out of the big services and cleaned up, it needs to live somewhere you control. This guide covers moving your archive to ${g.provider}.`;
  }
  const kinds = (g.data_types || []).map((k) => DATA_LABEL[k] || k);
  const list = kinds.length > 1
    ? kinds.slice(0, -1).join(", ") + " and " + kinds[kinds.length - 1]
    : (kinds[0] || "your data");
  return `${g.provider} is required to give you a copy of the data it holds about you, including ${list}. ` +
    `The request itself is free, and arrives as ${g.format || "a downloadable archive"}. ` +
    `Typical wait: ${g.wait_time}.`;
}

/* Screenshots are redacted crops produced by tools/redact-screenshot.py, so
   they carry no account details. Width and height are inlined to stop the
   article reflowing as they load. */
function shot(s) {
  const dim = SHOTS[s.image];
  if (!dim) MISSING_SHOTS.add(s.image);
  return `<figure class="figshot">
                <span class="figshot-frame"><img src="img/${esc(s.image)}" alt="${
    esc(s.alt || "")}" loading="lazy"` +
    (dim ? ` width="${dim.w}" height="${dim.h}"` : "") + `></span>` +
    (s.caption ? `
                <figcaption>${esc(s.caption)}</figcaption>` : "") +
    `
              </figure>`;
}

/* Sidebar links carry the same brand mark the homepage uses. app.js fills
   [data-icon] with the inline SVG, so there is one copy of each logo. */
function sideLink(r) {
  return `<li><a href="${esc(r.slug)}.html">` +
    `<span class="side-ic" data-icon="${esc(r.icon || "box")}"></span>${esc(r.provider)}</a></li>`;
}

function guidePage(g, all, dests) {
  const dest = isDest(g);
  const conf = confirmation(g);
  const canonical = `${SITE}/guides/${g.slug}.html`;

  const related = (dest ? dests : all)
    .filter((x) => x.slug !== g.slug).slice(0, 5);
  const crossLabel = dest ? "Export guides" : "Where to keep your data";
  const cross = (dest ? all : dests).slice(0, 4);

  const howto = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: dest ? `How to move your data to ${g.provider}` : `How to request and open your ${g.provider} GDPR data export`,
    description: guideDescription(g),
    totalTime: undefined,
    dateModified: g.verified && g.verified_on ? g.verified_on : undefined,
    step: g.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.detail || s.title,
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides.html" },
      { "@type": "ListItem", position: 3, name: g.provider, item: canonical },
    ],
  };

  /* FAQPage, when the guide has questions.

     This is the schema that feeds AI Overviews and the answers models give, and
     those are now a bigger share of how anybody finds a page like this than the
     ten blue links are. The questions are the ones people actually type after
     an export has already landed and gone wrong, which is a different and much
     higher-intent moment than "how do I request my data". */
  const faq = (g.faq && g.faq.length) ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: g.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  const body = `    <article class="wrap article">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="../index.html">Home</a>
        <span>/</span>
        <a href="../guides.html">Guides</a>
        <span>/</span>
        <span aria-current="page">${esc(g.provider)}</span>
      </nav>

      <header class="art-head">
        <h1>${dest ? `Move your data to ${esc(g.provider)}` : `How to export your data from ${esc(g.provider)}`}</h1>
        ${dest ? "" : `<p class="art-kicker">Requesting the GDPR export, what arrives, and how to open it.</p>`}
        <div class="art-meta">
          <span class="badge ${esc(g.difficulty)}">${esc(g.difficulty)}</span>
          <span class="muted">${dest ? "Takes" : "Wait:"} ${esc(g.wait_time)}</span>
        </div>
        <p class="art-intro">${esc(guideIntro(g))}</p>
      </header>

      <div class="art-grid">
        <div class="art-main">
          ${g.request ? `<p><a class="btn primary lg" href="${esc(g.request.url)}" target="_blank" rel="noopener noreferrer">${esc(g.request.label)} <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>` : ""}
          ${g.explain ? `<aside class="explain"><h2>${esc(g.explain.title)}</h2><p>${esc(g.explain.body)}</p></aside>` : ""}

          <h2>Step by step</h2>
          ${!dest && conf.line ? `<p class="confirmed-line">${esc(conf.line)}</p>` : ""}
          <ol class="steps-ol">
            ${g.steps.map((s) => `<li>
              <h3>${esc(s.title)}</h3>
              ${s.detail ? `<p>${esc(s.detail)}</p>` : ""}
              ${s.image ? shot(s) : ""}
            </li>`).join("\n            ")}
          </ol>

          ${openerSection(g)}

          ${(g.notes && g.notes.length) ? `<h2>Worth knowing</h2>
          ${g.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("\n          ")}` : ""}

          ${(g.faq && g.faq.length) ? `<h2>Common questions</h2>
          <div class="faq">
            ${g.faq.map((f) => `<details class="faq-q">
              <summary>${esc(f.q)}</summary>
              <p>${esc(f.a)}</p>
            </details>`).join("\n            ")}
          </div>` : ""}

          ${/* The generic version of this used to sit here, at the bottom, saying
                the same four sentences on all thirty pages. openerSection()
                replaced it further up with something specific to the service -
                what is actually read out of this export, and the one thing this
                service gets wrong - and two of them was one too many. */ ""}
        </div>

        <aside class="art-side">
          <div class="side-card">
            <h4>At a glance</h4>
            <dl>
              <dt>Effort</dt><dd>${esc(g.difficulty)}</dd>
              <dt>${dest ? "Time" : "Typical wait"}</dt><dd>${esc(g.wait_time)}</dd>
              ${g.format ? `<dt>Format</dt><dd>${esc(g.format)}</dd>` : ""}
              ${g.delivery ? `<dt>Delivery</dt><dd>${esc(g.delivery.replace(/-/g, " "))}</dd>` : ""}
              ${!dest && conf.flow ? `<dt>Checked</dt><dd>${esc(conf.flow.when)}</dd>` : ""}
            </dl>
          </div>
          ${related.length ? `<div class="side-card">
            <h4>${dest ? "Other destinations" : "Other services"}</h4>
            <ul class="side-links">
              ${related.map((r) => sideLink(r)).join("\n              ")}
            </ul>
          </div>` : ""}
          ${cross.length ? `<div class="side-card">
            <h4>${esc(crossLabel)}</h4>
            <ul class="side-links">
              ${cross.map((r) => sideLink(r)).join("\n              ")}
            </ul>
          </div>` : ""}
        </aside>
      </div>
    </article>`;

  return page({
    depth: 1, active: "guides",
    title: guideTitle(g),
    description: guideDescription(g),
    canonical,
    jsonld: [howto, crumbs].concat(faq ? [faq] : []),
    body,
  });
}

/* ---------- guides index ---------- */

/* One line per service.
 *
 * The old card stacked a logo, a name, a badge and a full wait sentence, and
 * every one of them was a different height - so the index was a ragged column
 * of boxes rather than a list you could run your eye down. The name and the
 * badge are the thing being chosen between; the wait is a number, and it goes
 * on the right where numbers go. */
function card(g, href, kind) {
  const badge = g.difficulty
    ? `<span class="badge ${esc(g.difficulty)}">${esc(g.difficulty)}</span>` : "";
  /* A destination's name is a phrase - "Ente (end-to-end encrypted)", "Any NAS
     (network folder)" - and it takes the whole first line, so its badge goes
     down to share the second row with the wait. A service is one word and
     keeps its badge alongside. Same card, two arrangements, decided by what is
     actually in it rather than by a flag somebody has to remember to set. */
  const dest = kind === "dest";
  return `        <a class="svc${dest ? " svc-wide" : ""}" href="${esc(href)}">
          <span class="svc-ic" data-icon="${esc(g.icon)}"></span>
          <span class="svc-name">${esc(g.provider)}${dest ? "" : badge}</span>
          <span class="svc-meta">${dest ? badge : ""}<span class="svc-time">${
            CLOCK}${esc(shortTime(g.wait_time))}</span></span>
        </a>`;
}

/* The wait, as a phrase rather than a sentence.
 *
 * The guides say things like "up to 7 days (Apple emails you when it is
 * ready)" and "about three days for the account report; chat exports are
 * instant". Both are the right thing to say on the guide itself and both wrap
 * to three lines in a list. The first clause is the answer; the rest is the
 * detail, and the detail is what the page is for. */
function shortTime(raw) {
  let t = String(raw || "").split(/[,;(]/)[0].trim();
  /* Then the trailing clause, whatever joins it on. "an hour of your
     attention" is an hour; "a weekend if you request everything at once" is a
     weekend. The qualification is worth reading - on the guide, which is what
     the guide is for - and is three wrapped lines in a list. */
  const cut = t.replace(/\s+\b(for|depending|if|when|while|but|and|spread|of your)\b.*$/i, "").trim();
  if (cut.length >= 3) t = cut;
  return t || "varies";
}

const CLOCK = '<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></svg>';
const ARROW = '<svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1 6h16"/><path d="M12.5 1.5 17 6l-4.5 4.5"/></svg>';

/* A whole job reads differently from a single guide, so it gets its own card:
   what you end up with matters more than how long the request takes. */
function flowCard(f) {
  const conf = confirmation(f);
  return `        <a class="jobcard" href="guides/${esc(f.slug)}.html">
          <span class="jobcard-ic" data-icon="${esc(f.icon || "route")}"></span>
          <span class="jobcard-body">
            <span class="jobcard-t">${esc(f.title)}</span>
            <span class="jobcard-d">${esc(f.outcome)}</span>
          </span>
          <span class="jobcard-foot">
            <span class="jobcard-time">${CLOCK}${esc(shortTime(f.effort))}</span>
            <span class="jobcard-go">${ARROW}</span>
          </span>
        </a>`;
}

const FAQ = [
  ["Does it cost anything?",
   "No. Everything is free: the guides, and every part of the app. Opening an export, merging several, finding duplicates, repairing dates and writing the library back out all run on your own machine, so there is nothing to charge for. There is no paid tier, no account and nothing to buy."],
  ["Do I need an account?",
   "No. There is no sign-up, no email address and no password, because there is no server holding anything to sign in to."],
  ["Are my files uploaded anywhere?",
   "No. Your archives are read inside your browser, on your own machine. The page is served with a Content-Security-Policy whose connect-src is 'self' and nothing else, so the browser itself refuses to send your files anywhere regardless of what the code asks for. Turn off your wifi before you drop the files in and everything still works."],
  ["How long do the exports take to arrive?",
   "It varies enormously. Meta is often minutes to hours, Google hours to days, Apple up to seven days, and Snapchat up to thirty. The waits run in parallel, so if you want several, request them all on the same day."],
  ["Which services can I open an export from?",
   "Apple, Google, Samsung, Snapchat, Facebook and Instagram each have their own guide, and the app reads the zip archives all of them produce. Several exports can be opened together and become one library."],
  ["What do I get back at the end?",
   "Ordinary folders of ordinary files, with the real dates and locations written into the photographs themselves, duplicates across services removed, and your messages, location history and account records readable. Nothing needs this site afterwards."],
];

function guidesIndex(all, dests, flows, problems) {
  const body = `    <section class="page-head wrap">
      <h1>Guides</h1>
      <p>How to get a complete copy of your data out of any major service, what you will get back, and where to put it afterwards. All free to read, no account.</p>
    </section>

    <section class="wrap gd-wrap">

      <div class="gd-sec">
        <div class="section-head">
          <h2>Whole jobs</h2>
          <p>Start to finish: request it, open it, tidy it up, put it where it is going. Begin here if you know where you want to end up.</p>
        </div>
        <div class="jobgrid">
${(flows || []).map(flowCard).join("\n")}
        </div>
      </div>

      ${(problems || []).length ? `<div class="gd-sec">
        <div class="section-head">
          <h2>When something has gone wrong</h2>
          <p>You already have the export and it will not open, or it opened and the dates are nonsense. The cause, and the fix, including the fix that does not involve us.</p>
        </div>
        <div class="probgrid">
${problems.map((p) => `          <a class="probcard" href="guides/${esc(p.slug)}.html">
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.symptom.length > 150 ? p.symptom.slice(0, 147) + "..." : p.symptom)}</p>
          </a>`).join("\n")}
        </div>
      </div>` : ""}

      <div class="gd-sec">
        <div class="section-head">
          <h2>Getting your data out</h2>
          <p>One service at a time, with what to expect and the parts people get wrong.</p>
        </div>
        <div class="svcgrid">
${all.map((g) => card(g, `guides/${g.slug}.html`, "service")).join("\n")}
        </div>
      </div>

      <div class="gd-sec">
        <div class="section-head">
          <h2>Where to keep it</h2>
          <p>Once your data is cleaned up, put it somewhere you control. These guides cover network drives, external disks, self-hosted servers, and getting a tidied library back into a cloud service.</p>
        </div>
        <div class="svcgrid">
${dests.map((g) => card(g, `guides/${g.slug}.html`, "dest")).join("\n")}
        </div>
      </div>
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>Questions people ask first</h2>
      </div>
      <div class="faq">
${FAQ.map(([q, a]) => `        <details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
      </div>
    </section>`;

  return page({
    depth: 0, active: "guides",
    title: "GDPR export guides: request and open your data | Muletto",
    description: "Free step-by-step guides for requesting a complete copy of your data from Apple, Google, Samsung, Snapchat, Facebook and Instagram, plus how to store it on a NAS or external drive.",
    canonical: `${SITE}/guides.html`,
    jsonld: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Muletto export guides",
      description: "Guides for exporting your personal data from major services.",
      url: `${SITE}/guides.html`,
    }, {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({
        "@type": "Question", name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    }],
    body,
  });
}

/* ---------- workflow guides ---------- */

/* A whole job on one page: request the export, open it, clean it up, put it
   where it is going.

   These exist for two reasons. "How do I move my iCloud photos to my NAS" is a
   higher-intent search than either half of it, because whoever types it has
   already decided to do the work. And the cleanup step - which is what this
   product was originally for - had quietly become a sidebar item nobody would
   find. Here it is step three of something people are already trying to do.

   A flow references the export and destination guides rather than repeating
   them, so a provider that changes its mind is fixed in one place. */
function flowPage(f, all, dests) {
  const from = f.from ? all.find((g) => g.slug === f.from) : null;
  const to = dests.find((g) => g.slug === f.to);
  const canonical = `${SITE}/guides/${f.slug}.html`;
  const conf = confirmation(f);

  const howto = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: f.title,
    description: f.outcome,
    step: [
      from ? { "@type": "HowToStep", position: 1, name: `Request your ${from.provider} export`, text: from.steps[0].detail || "" } : null,
      { "@type": "HowToStep", position: 2, name: "Open it in your browser", text: "Muletto reads the archive on your own machine." },
      { "@type": "HowToStep", position: 3, name: "Clean it up", text: "Remove duplicates and repair the dates." },
      to ? { "@type": "HowToStep", position: 4, name: `Put it on ${to.provider}`, text: to.steps[0].detail || "" } : null,
    ].filter(Boolean),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides.html" },
      { "@type": "ListItem", position: 3, name: f.title, item: canonical },
    ],
  };

  const step = (n, title, body, link) => `
    <section class="flow-step">
      <div class="flow-n">${n}</div>
      <div class="flow-body">
        <h2>${esc(title)}</h2>
        ${body}
        ${link ? `<p><a class="btn secondary" href="${esc(link.href)}">${esc(link.label)} <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>` : ""}
      </div>
    </section>`;

  const body = `    <article class="wrap article flow">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="../index.html">Home</a><span>/</span>
        <a href="../guides.html">Guides</a><span>/</span>
        <span aria-current="page">${esc(f.title)}</span>
      </nav>

      <header class="art-head">
        <h1>${esc(f.title)}</h1>
        <div class="art-meta">
          <span class="muted">Takes ${esc(f.effort)}</span>
        </div>
        <p class="art-intro">${esc(f.outcome)}</p>
      </header>

      <div class="flow-why">
        <h3>Why bother</h3>
        <p>${esc(f.why)}</p>
      </div>

      ${f.watch_out ? `<div class="note flow-warn"><strong>The bit people get wrong.</strong>
        ${esc(f.watch_out)}</div>` : ""}

      ${f.stumbles && f.stumbles.length ? `<section class="flow-stumbles">
        <h3>What actually goes wrong</h3>
        <dl>${f.stumbles.map((s) => `<dt>${esc(s.title)}</dt><dd>${esc(s.detail)}</dd>`).join("")}</dl>
      </section>` : ""}

      ${conf.line ? `<p class="confirmed-line">${esc(conf.line)}</p>` : ""}

      ${step(1,
        from ? `Ask ${from.provider} for your data` : "Ask each service for your data",
        from
          ? `<p>Free, and required by law - but it takes ${esc(from.wait_time)}, so start it now and
             come back. The full guide has the steps and the traps.</p>`
          : `<p>Every service you use, all at once. They run independently and most take days, so
             the sooner they are all requested the sooner you can do the rest in one sitting.</p>`,
        from ? { href: `${from.slug}.html`, label: `The ${from.provider} guide` }
             : { href: "../guides.html", label: "Every export guide" })}

      ${step(2, "Open it in your browser",
        `<p>Drop the archive into Muletto. It is read on your own machine - nothing is uploaded -
         and you get a timeline, your pictures, your conversations and a map of where you have
         been. Open several exports together and they merge into one library.</p>
         <p class="muted small">Large archives are fine. They are read in pieces rather than
         loaded whole, so size is not the limit it usually is in a browser.</p>`,
        { href: "../app.html", label: "Open an export" })}

      ${step(3, "Clean it up before you move it",
        `<p>This is the step worth not skipping, because it is far easier now than once the files
         are spread across a disk.</p>
         <ul class="flow-list">
           <li><strong>Duplicates across services.</strong> The same photo backed up to two places
             is one photo. Muletto finds byte-identical copies and near-copies - a burst, a crop, a
             re-save - and you choose what a tidied library keeps.</li>
           <li><strong>Dates that got lost.</strong> Exports routinely strip the capture date, so
             everything looks like it was taken the day you downloaded it. Muletto reads the real
             date back out and writes it into the file itself.</li>
           <li><strong>Places.</strong> Where the coordinates survived, they are written back in
             too, so whatever you import into can put things on a map.</li>
         </ul>`,
        null)}

      ${step(4, to ? `Put it on ${to.provider}` : "Put it somewhere you control",
        `<p>Muletto writes the tidied library straight out - into dated folders on a drive or a
         network share, or as a single archive. You choose the arrangement, and it writes an index
         of everything it wrote.</p>
         ${to ? `<p>The destination guide covers the part that happens at the other end.</p>` : ""}`,
        to ? { href: `${to.slug}.html`, label: `The ${to.provider} guide` } : null)}

      <div class="flow-end">
        <h3>When it is done</h3>
        <p>${esc(f.outcome)}</p>
        ${f.done ? `<p><strong>Check it worked.</strong> ${esc(f.done)}</p>` : ""}
        <p class="muted small">Keep the work file Muletto offers at the end. Export again next
        year and it recognises everything that carried over, so none of this has to be done
        twice.</p>
      </div>
    </article>`;

  return page({
    depth: 1,
    title: `${f.title} | Muletto`,
    description: f.outcome,
    canonical,
    body,
    jsonld: [howto, crumbs],
    active: "guides",
  });
}

/* A page about one thing going wrong.
 *
 * Not a request flow, so it does not get the numbered-step template. The
 * reader here already has the export and something about it has failed; what
 * they want is the cause and the fix, in that order, and they want to know
 * whether the data is recoverable before they read anything else.
 *
 * The manual fix is a full section on purpose, naming other tools where they
 * are the better answer. A page that solves the problem outright is the one
 * that gets linked to and the one that ranks; a page that only says to use us
 * does neither, and would be worse at the job these pages exist to do. */
function problemPage(p, all) {
  const canonical = `${SITE}/guides/${p.slug}.html`;
  const paras = (v) => (Array.isArray(v) ? v : [v]).map((s) => `<p>${esc(s)}</p>`).join("\n        ");

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.symptom,
    mainEntityOfPage: canonical,
    author: { "@type": "Organization", name: "Muletto", url: SITE + "/" },
    publisher: { "@type": "Organization", name: "Muletto", url: SITE + "/" },
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides.html" },
      { "@type": "ListItem", position: 3, name: p.title, item: canonical },
    ],
  };

  const linkFor = (slug) => {
    const g = all.find((x) => x.slug === slug);
    return g ? { href: slug + ".html", label: `The ${g.provider} guide` } : null;
  };

  const body = `    <article class="wrap article problem">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="../index.html">Home</a><span>/</span>
        <a href="../guides.html">Guides</a><span>/</span>
        <span aria-current="page">${esc(p.title)}</span>
      </nav>

      <header class="art-head">
        <h1>${esc(p.title)}</h1>
        <p class="art-intro">${esc(p.symptom)}</p>
      </header>

      <div class="prob-verdict">
        <h2>Can you get it back?</h2>
        <p>${esc(p.recoverable)}</p>
      </div>

      <section class="prob-cause">
        <h2>What actually happened</h2>
        ${paras(p.cause)}
      </section>

      ${p.gotcha ? `<div class="note prob-gotcha">
        <strong>${esc(p.gotcha_title || "The bit people get wrong")}</strong>
        <p>${esc(p.gotcha)}</p>
      </div>` : ""}

      <section class="prob-fix">
        <h2>How to fix it</h2>
        ${p.manual_intro ? `<p>${esc(p.manual_intro)}</p>` : ""}
        <dl>${(p.manual || []).map((m) =>
          `<dt>${esc(m.title)}</dt><dd>${esc(m.detail)}</dd>`).join("")}</dl>
      </section>

      ${p.muletto ? `<section class="prob-ours">
        <h2>How Muletto does it</h2>
        <p>${esc(p.muletto)}</p>
        <p><a class="btn primary" href="../app.html">Open an export <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>
      </section>` : ""}

      ${p.prevent ? `<section class="prob-prevent">
        <h2>Stopping it happening again</h2>
        <p>${esc(p.prevent)}</p>
      </section>` : ""}

      ${p.evidence ? `<p class="confirmed-line">${esc(p.evidence)}</p>` : ""}

      ${(p.related || []).length ? `<section class="prob-related">
        <h3>Related</h3>
        <ul class="flow-list">${(p.related || []).map((slug) => {
          const g = linkFor(slug);
          if (g) return `<li><a href="${esc(g.href)}">${esc(g.label)}</a></li>`;
          return `<li><a href="${esc(slug)}.html">${esc(slug.replace(/-/g, " "))}</a></li>`;
        }).join("")}</ul>
      </section>` : ""}
    </article>`;

  return page({
    depth: 1,
    title: `${p.title} | Muletto`,
    description: p.symptom.length > 300 ? p.symptom.slice(0, 297) + "..." : p.symptom,
    canonical,
    body,
    jsonld: [article, crumbs],
    active: "guides",
  });
}

/* ---------- status tally ---------- */

/* Generated, never hand-edited: it is derived from the guide files, so it
   cannot drift away from what the site actually claims. Two independent checks
   per guide, plus whatever is still flagged uncertain inside the steps. */
function statusReport(all, dests) {
  const rows = [...all, ...dests];
  const state = (g) => confirmation(g).state;
  const done = rows.filter((g) => state(g) === "full");
  const partial = rows.filter((g) => state(g) === "partial");
  const L = [];

  const table = (list, kind) => {
    if (!list.length) { L.push("_None yet._", ""); return; }
    L.push(`| ${kind} | Request flow walked | Export opened in Muletto | Guide written from evidence |`);
    L.push("| --- | --- | --- | --- |");
    for (const g of list) {
      const c = confirmation(g);
      /* The date, and not who. One person walks these, so a name here only
         put that person's name in a public file. */
      const f = c.flow ? c.flow.on : "no";
      const i = c.import ? c.import.on : "no";
      const w = c.state === "full" ? "yes"
        : c.state === "partial" ? "request steps only" : "no";
      L.push(`| [${g.provider}](apps/web/guides/${g.slug}.json) | ${f} | ${i} | ${w} |`);
    }
    L.push("");
  };

  L.push("# Guide status", "");
  L.push("Generated by `node tools/build-site.js`. Do not hand-edit - change the guide");
  L.push("JSON in `apps/web/guides/` instead.", "");
  L.push("A guide counts as finished only when **both** checks below are done by hand:", "");
  L.push("1. **Request flow walked** - someone went through the provider's export request");
  L.push("   from start to finish and screenshotted every stage.");
  L.push("2. **Export opened in Muletto** - the archive that came back was opened in the");
  L.push("   app, and what the guide promises was checked against what actually turned up.", "");
  L.push("Reading the provider's help pages is not evidence for either. Both of the");
  L.push("Snapchat corrections that mattered - the Export JSON files toggle, and the date");
  L.push("range already defaulting to off - contradicted the documentation.", "");
  L.push(`**${done.length} of ${rows.length} finished.** ${partial.length} part-way.`, "");
  L.push("## Export guides", "");
  table(all, "Provider");
  L.push("## Destination guides", "");
  table(dests, "Destination");

  L.push("## Still to confirm", "");
  const open = [];
  for (const g of rows) {
    g.steps.forEach((st, i) => {
      if (st.uncertain) open.push(`- **${g.provider}**, step ${i + 1} (${st.title}): ${st.uncertain}`);
    });
  }
  L.push(...(open.length ? open : ["_Nothing flagged inline._"]), "");

  return L.join("\n");
}

/* ---------- build ---------- */

function main() {
  const index = readJson(path.join(GUIDES, "index.json"));
  const destIndex = readJson(path.join(GUIDES, "destinations.json"));

  const flowIndex = readJson(path.join(GUIDES, "flows.json"));
  const problemIndex = readJson(path.join(GUIDES, "problems.json"));

  const load = (slug) => readJson(path.join(GUIDES, slug + ".json"));
  const all = index.providers.map((p) => ({ ...p, ...load(p.slug) }));
  const dests = destIndex.destinations.map((d) => ({ ...d, ...load(d.slug) }));
  const flows = flowIndex.flows;
  const problems = problemIndex.problems;

  let n = 0;
  for (const g of [...all, ...dests]) {
    fs.writeFileSync(path.join(GUIDES, g.slug + ".html"), guidePage(g, all, dests), "utf8");
    n++;
  }
  for (const f of flows) {
    fs.writeFileSync(path.join(GUIDES, f.slug + ".html"), flowPage(f, all, dests), "utf8");
    n++;
  }
  for (const p of problems) {
    fs.writeFileSync(path.join(GUIDES, p.slug + ".html"), problemPage(p, all), "utf8");
    n++;
  }
  fs.writeFileSync(path.join(WEB, "guides.html"), guidesIndex(all, dests, flows, problems), "utf8");

  fs.writeFileSync(path.join(__dirname, "..", "GUIDE-STATUS.md"), statusReport(all, dests), "utf8");

  /* The homepage switcher needs the same merged view the static pages were
     built from. Emitting it here keeps the per-guide files the only place
     wait times and difficulty are edited. */
  fs.writeFileSync(path.join(GUIDES, "summary.json"), JSON.stringify({
    providers: all.map((g) => ({
      slug: g.slug, provider: g.provider, icon: g.icon,
      difficulty: g.difficulty, wait_time: g.wait_time,
      typical_size: g.typical_size, contents: g.contents || [],
    })),
  }, null, 2) + "\n", "utf8");

  /* ---------- stamp scripts and stylesheets with their content ----------

     Responses set Cache-Control: public, max-age=3600 on .js and .css, so a
     returning browser keeps whatever it already has for an hour. HTML
     revalidates every time, which is the trap: the page is new and the code
     behind it is not.

     That is not hypothetical. Decryption shipped, the new page loaded, the
     prompt appeared - and the reader typed a password into a version of zip.js
     an hour old that had no idea how to use one. It looked like the feature was
     broken.

     A hash of the file in the query string means the URL changes whenever the
     bytes do, so a stale copy can never be served for a new page. Unchanged
     files keep their URL and stay cached, which is the point of caching. The
     stamp is stripped before it is rewritten, so running the build twice does
     not stack them up. */
  {
    const crypto = require("crypto");
    const stampOf = new Map();
    const stamp = (name) => {
      if (stampOf.has(name)) return stampOf.get(name);
      const f = path.join(WEB, name);
      let v = "";
      if (fs.existsSync(f)) {
        v = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 8);
      }
      stampOf.set(name, v);
      return v;
    };

    const htmlUnder = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) htmlUnder(full, out);
        else if (e.name.endsWith(".html")) out.push(full);
      }
      return out;
    };

    let stamped = 0;
    for (const f of htmlUnder(WEB)) {
      const before = fs.readFileSync(f, "utf8");
      const dir = path.dirname(f);
      const after = before.replace(
        /(<(?:script|link)[^>]*?(?:src|href)=")([^"]+?\.(?:js|css))(\?v=[a-f0-9]+)?(")/g,
        (all, head, url, _old, tail) => {
          if (/^(https?:)?\/\//.test(url)) return all;          // leave anything remote alone
          const target = path.relative(WEB, path.resolve(dir, url)).split(path.sep).join("/");
          const v = stamp(target);
          return v ? head + url + "?v=" + v + tail : head + url + tail;
        });
      if (after !== before) { fs.writeFileSync(f, after, "utf8"); stamped++; }
    }
    console.log("stamped assets in " + stamped + " page" + (stamped === 1 ? "" : "s"));

    /* The sample archives, stamped into app.js rather than into a page.
     *
     * They are the one asset requested from script rather than named in HTML,
     * so the rewrite above never saw them - and they are also the one asset
     * the service worker deliberately keeps, which made them the only thing
     * on the site that could be served stale indefinitely. One stamp over the
     * whole set: they are rebuilt together and there is no benefit to
     * revalidating them apart.
     *
     * This has to run after the loop above, because changing app.js changes
     * app.js's own stamp - and it is rewritten before the pages are stamped
     * on the next pass, which is why the build is run twice in CI. */
    {
      const dir = path.join(WEB, "samples");
      let v = "";
      if (fs.existsSync(dir)) {
        const h = crypto.createHash("sha256");
        for (const f of fs.readdirSync(dir).sort()) {
          h.update(f).update(fs.readFileSync(path.join(dir, f)));
        }
        v = h.digest("hex").slice(0, 8);
      }
      const appJs = path.join(WEB, "app.js");
      const before = fs.readFileSync(appJs, "utf8");
      const after = before.replace(
        /\/\* BUILD:SAMPLES \*\/[\s\S]*?\/\* END:SAMPLES \*\//,
        "/* BUILD:SAMPLES */\nconst SAMPLES_V = " + JSON.stringify(v) + ";\n/* END:SAMPLES */");
      if (after !== before) {
        fs.writeFileSync(appJs, after, "utf8");
        console.log("samples stamped " + v + " (app.js restamped on the next build)");
      } else {
        console.log("samples stamped " + v);
      }
    }
    /* The commit stamp, into the hand-written pages as well.

       The generated guides get it from footer(), but index.html and app.html
       are written by hand and are the two anybody actually visits - so the
       one page where somebody decides whether to trust this with their files
       was the one page not saying which commit it is. Injected next to the
       source link, and any previous one removed first so that running the
       build twice does not stack them up. */
    if (COMMIT) {
      const OLD = new RegExp('\\s*<a class="foot-commit"[\\s\\S]*?</a>', 'g');
      const SRC = new RegExp('(<a class="foot-src"[\\s\\S]*?</a>)');
      const link = '\n        <a class="foot-commit" href="https://github.com/'
        + 'SolusKossi/muletto/commit/' + COMMIT + '" target="_blank" '
        + 'rel="noopener noreferrer" title="The commit this site was built from">'
        + 'build ' + COMMIT + '</a>';
      let stampedPages = 0;
      for (const f of htmlUnder(WEB)) {
        const before = fs.readFileSync(f, 'utf8');
        if (!before.includes('foot-src')) continue;
        const after = before.replace(OLD, '').replace(SRC, '$1' + link);
        if (after !== before) { fs.writeFileSync(f, after, 'utf8'); stampedPages++; }
      }
      console.log('commit stamp ' + COMMIT + ' in ' + stampedPages + ' page'
        + (stampedPages === 1 ? '' : 's'));
    }



    /* ---------- the offline precache list ----------

       Written from the page that was just stamped, so the worker asks for the
       exact URLs the browser will ask for. Deriving it any other way - a
       hand-kept list, a glob - means the day somebody adds a script the cache
       quietly stops covering the app, and nothing says so until a reader is
       offline and it is too late to tell them.

       Only the app shell. The guides are pleasant to have offline and are not
       what the promise is about, and precaching two dozen pages to make a
       point would be rude on a phone. They cache themselves when visited. */
    {
      const appHtml = fs.readFileSync(path.join(WEB, "app.html"), "utf8");
      const assets = [];
      const re = /<(?:script|link)[^>]*?(?:src|href)="([^"]+?\.(?:js|css)(?:\?v=[a-f0-9]+)?)"/g;
      let m;
      while ((m = re.exec(appHtml))) {
        if (!/^(https?:)?\/\//.test(m[1])) assets.push("/" + m[1].replace(/^\.?\//, ""));
      }

      // The fonts are part of the shell: without them an offline page renders
      // in a fallback face and looks broken rather than offline.
      const fontDir = path.join(WEB, "fonts");
      const fonts = fs.existsSync(fontDir)
        ? fs.readdirSync(fontDir).filter((f) => /\.woff2?$/i.test(f)).map((f) => "/fonts/" + f)
        : [];

      const list = ["/app.html"].concat(assets, fonts);
      const unique = [...new Set(list)];

      /* The cache name has to change whenever any cached thing changes, or an
         old worker serves an old shell forever. Hashing the list itself does
         that: every stamp is in it. */
      const version = crypto.createHash("sha256")
        .update(unique.join("\n")).digest("hex").slice(0, 12);

      const swPath = path.join(WEB, "sw.js");
      const sw = fs.readFileSync(swPath, "utf8");
      const block = "/* BUILD:PRECACHE */\n" +
        "const VERSION = " + JSON.stringify(version) + ";\n" +
        "const PRECACHE = " + JSON.stringify(unique, null, 2) + ";\n" +
        "/* END:PRECACHE */";
      const next = sw.replace(/\/\* BUILD:PRECACHE \*\/[\s\S]*?\/\* END:PRECACHE \*\//, block);
      if (next !== sw) fs.writeFileSync(swPath, next, "utf8");
      console.log("precache: " + unique.length + " files, version " + version);
    }
  }

  // sitemap + robots
  /* Only indexable pages go in the sitemap. Listing a page that carries a
     noindex is a contradiction, and Search Console reports it as one - which
     is why the superseded home page is absent from this list. */
  /* When each page last actually changed.
   *
   * The sitemap had a priority on every entry and a date on none, which is
   * the wrong way round: Google has said for years that it ignores priority,
   * and it does use lastmod as a hint about what is worth re-fetching. A
   * sitemap without dates asks a crawler to re-read thirty-five pages to find
   * the two that moved.
   *
   * Asked of git, not of the file.
   *
   * This first used the file's mtime, which was wrong in the way that matters:
   * every generated page is rewritten on every build whether its content
   * changed or not, so all thirty-five dates moved to today each time the
   * build ran. That is the exact claim lastmod exists to avoid making, and a
   * sitemap that says everything changed today, every day, is a sitemap a
   * crawler learns to ignore.
   *
   * The last commit to touch a file is the honest answer and cannot be moved
   * by rebuilding. One `git log` walk, newest first, so the first time a path
   * appears is its most recent change. A page not yet committed has no date
   * and gets no lastmod, which is better than guessing at one. */
  const when = (() => {
    const seen = new Map();
    /* Asked up to three times. One `git log` decides every lastmod in the
       file, so a single transient failure - git busy immediately after a
       push, most likely - takes the dates off all forty-odd URLs at once.
       That is not hypothetical: it is the failure this function already
       carries a warning about, and it was seen again on 2026-08-28, where
       check.js ran the build, got a stripped sitemap, reported it stale, and
       had already written it to disk. The next run rebuilt it correctly and
       the failure vanished, which is the worst way for a bug to behave. */
    for (let attempt = 0; attempt < 3 && !seen.size; attempt++) {
      try {
        const log = require("child_process").execFileSync(
          "git", ["log", "--pretty=format:%cs", "--name-only", "--", "apps/web"],
          { cwd: path.join(__dirname, ".."), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
        let date = null;
        for (const line of log.split("\n")) {
          const s = line.trim();
          if (!s) continue;
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { date = s; continue; }
          if (date && !seen.has(s)) seen.set(s, date);
        }
      } catch (e) { /* handled below, where the silence is made audible */ }
    }

    /* Nothing from git. Rather than write a sitemap with no dates in it, keep
       the ones the sitemap already on disk is carrying.

       This is right in both cases that reach here. In a tree with no history -
       a staging copy, a downloaded archive - the committed sitemap beside it
       holds dates computed by a build that could see the history, and those
       are the correct answers. After a transient git failure they are the
       correct answers too, minus at most the commit being made right now.
       Either way, keeping them beats dropping forty of them. */
    if (!seen.size) {
      let kept = 0;
      try {
        const old = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "sitemap.xml"), "utf8");
        for (const m of old.matchAll(/<loc>([^<]*)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>/g)) {
          const rel = m[1].replace(/^https?:\/\/[^/]+\//, "");
          seen.set("apps/web/" + (rel || "index.html"), m[2]);
          kept++;
        }
      } catch (e) { /* no sitemap to fall back on either */ }
      console.warn("  WARNING: git gave no history for apps/web after three tries, so " +
        "the sitemap dates could not be recomputed. " +
        (kept ? "Kept the " + kept + " already in the sitemap on disk - they are at most " +
                "one commit out of date. "
              : "There was no sitemap to fall back on, so it has no lastmod dates at all. ") +
        "Do not publish from here without checking.");
    }
    return (rel) => seen.get("apps/web/" + rel) || null;
  })();

  const urls = [
    { loc: `${SITE}/`, pri: "1.0", file: "index.html" },
    { loc: `${SITE}/guides.html`, pri: "0.9", file: "guides.html" },
    { loc: `${SITE}/app.html`, pri: "0.9", file: "app.html" },
    { loc: `${SITE}/privacy.html`, pri: "0.7", file: "privacy.html" },
    ...flows.map((f) => ({ loc: `${SITE}/guides/${f.slug}.html`, pri: "0.85",
                           file: "guides/" + f.slug + ".html" })),
    ...problems.map((p) => ({ loc: `${SITE}/guides/${p.slug}.html`, pri: "0.85",
                              file: "guides/" + p.slug + ".html" })),
    ...[...all, ...dests].map((g) => ({ loc: `${SITE}/guides/${g.slug}.html`, pri: "0.8",
                                        file: "guides/" + g.slug + ".html" })),
  ];
  fs.writeFileSync(path.join(WEB, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => {
      const d = when(u.file);
      return `  <url><loc>${u.loc}</loc>` + (d ? `<lastmod>${d}</lastmod>` : "") +
        `<priority>${u.pri}</priority></url>`;
    }).join("\n") +
    `\n</urlset>\n`, "utf8");
  /* Crawling is allowed, and the sitemap is advertised.
   *
   * Worth keeping the reasoning that was here: "Disallow: /" sounds stronger
   * than a noindex and is weaker. A URL nobody may fetch can still be indexed
   * if something links to it, and it turns up with no title and no snippet -
   * and because the page is never fetched, a noindex on it is never seen. To
   * keep a page out, let the crawler have it and answer with a noindex. That
   * is how the superseded home page is handled. */
  fs.writeFileSync(path.join(WEB, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`, "utf8");

  /* vercel.json is generated from _headers rather than written beside it.
   *
   * Cloudflare Pages and Netlify read _headers directly; Vercel ignores it and
   * wants JSON. Two hand-maintained copies of a Content-Security-Policy become
   * a promise that differs by host the moment one is edited and the other is
   * forgotten - and that policy exists precisely so the promise is checkable.
   * So _headers is authored and this is derived. */
  const hdrPath = path.join(WEB, "_headers");
  if (fs.existsSync(hdrPath)) {
    const sections = [];
    let current = null;
    for (const line of fs.readFileSync(hdrPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (line[0] !== " " && line[0] !== "\t") {
        current = { source: trimmed, headers: [] };
        sections.push(current);
        continue;
      }
      const at = trimmed.indexOf(":");
      if (at > 0 && current) {
        current.headers.push({
          key: trimmed.slice(0, at).trim(),
          value: trimmed.slice(at + 1).trim(),
        });
      }
    }
    fs.writeFileSync(path.join(ROOT_DIR, "vercel.json"), JSON.stringify({
      // GENERATED by tools/build-site.js from apps/web/_headers. Do not edit.
      /* The host runs the build rather than serving what was committed, so the
         commit stamp in the footer is written by the deployment that is
         actually live. Without this the pages are whatever was built on
         somebody's laptop, and the stamp - which exists to say which commit is
         running - is silently absent. There are no dependencies to install. */
      buildCommand: "node tools/build-site.js",
      outputDirectory: "apps/web",
      /* Deliberately off. Turning it on makes /guides work, and also makes
         Vercel redirect /guides.html to /guides - which every canonical link,
         og:url and sitemap entry on this site points at. The canonical would
         then name a URL that redirects, which is the one thing a canonical
         must not do. The rewrites below get the same convenience without
         moving the address of anything. */
      cleanUrls: false,
      trailingSlash: false,
      /* Typing the name without .html should find the page.
       *
       * A rewrite rather than a redirect: the file is served under the address
       * that was asked for, the .html URL stays the only one anything points
       * at, and the canonical tag in the page settles which is which for a
       * crawler. /admin is the one that prompted this - it is the address
       * anybody would type, and it was a 404. */
      rewrites: ["admin", "app", "guides", "privacy"].map((n) => ({
        source: "/" + n,
        destination: "/" + n + ".html",
      })),
      headers: sections.map((sec) => ({
        // Netlify and Cloudflare take /* and /*.css; Vercel wants a pattern.
        source: sec.source === "/*" ? "/(.*)"
          : sec.source.startsWith("/*.") ? "/(.*)." + sec.source.slice(3)
          : sec.source,
        /* The noindex lives here rather than in _headers so it cannot be left
           on by accident: it exists only in builds that did not ask to be
           live, and `npm run build:live` removes it by not adding it. Failing
           to rebuild therefore fails safe - the site stays unindexed. */
        headers: sec.headers,
      })),
    }, null, 2) + "\n", "utf8");
  }

  if (MISSING_SHOTS.size) {
    console.log("WARNING: referenced but not in guides/img: " +
      [...MISSING_SHOTS].join(", "));
    console.log("  Put the raw files in screenshots-raw/, then run tools/redact-screenshot.py");
  }
  console.log(`built ${n} guide pages + guides.html + summary.json + sitemap.xml + robots.txt`);
}

main();
