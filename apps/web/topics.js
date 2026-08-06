"use strict";

/* Muletto - views that appear because the data is there.
 *
 * The sidebar used to be fixed: Timeline, Images, Chats, Map, Highlights,
 * Records, All files. Anything that did not fit one of those became a row in
 * Records, which is a spreadsheet with the provider's column names on it. A
 * person who exported four thousand YouTube comments got a table called
 * "comments" and a horizontal scrollbar; a person with three years of step
 * counts got a table called "com.samsung.shealth.step_daily_trend".
 *
 * So the sidebar is built from what the export turned out to hold. A topic
 * here declares how to recognise itself from the shape of the data, and how to
 * draw itself once found. Nothing is listed that did not match.
 *
 * Recognition is by shape, not by provider - the same rule insights.js
 * follows. "A text column, a date, and something pointing at what was
 * commented on" is a description of a comments table wherever it came from,
 * and a provider we have never seen gets the view for free. Where real
 * knowledge of a provider exists it is used rather than guessed at: the health
 * topic reads MCatalog.HEALTH, which was researched by hand.
 *
 * Nothing here touches the network. It is given a parsed library and returns
 * DOM.
 */

const MTopics = (function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => (n || 0).toLocaleString();
  const plural = (n, one, many) => num(n) + " " + (n === 1 ? one : many);

  /* What the sidebar number should say.
   *
   * A file-reading topic can only count files before it has read them, and for
   * three of them that is the wrong unit: two .ics files hold 63 events, one
   * mbox holds thousands of messages, two My Activity pages hold hundreds of
   * searches. The sidebar said 2, 1 and 2 while the views said 33, 5 and 4.
   *
   * Counting properly up front would mean decompressing and parsing every
   * candidate file on every sidebar redraw, which is exactly what the topic
   * system was built to avoid. So the honest count is published once the view
   * has actually read the files, and the sidebar corrects itself. */
  const REAL = new Map();
  const api = { onCount: null };
  function setCount(key, n) {
    if (REAL.get(key) === n) return;
    REAL.set(key, n);
    if (api.onCount) api.onCount();
  }

  const colIndex = (t, re) => (t.columns || []).findIndex((c) => re.test(String(c)));
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;

  /* Escaped first, then the handles are marked up - never the other way round,
     which would let a comment containing a bracket write markup into the page.
     A mention is somebody's name and reads as one. */
  const mentions = (s) => esc(s).replace(/(^|\s)(@[A-Za-z0-9._-]{2,60})/g,
    (m, pre, h) => pre + '<span class="cmt-mention">' + h + "</span>");

  function asDate(v) {
    if (v == null || v === "") return null;
    const d = new Date(String(v));
    return isNaN(d) ? null : d;
  }
  const shortDate = (d) => d.toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });

  /* ---------- what each provider actually ships ----------
   *
   * Shape detection alone was not enough, and the comments view proved it. "A
   * text column" is true of YouTube's comment field and tells you nothing
   * useful about it: every value is a JSON array of rich-text segments, so the
   * view rendered
   *
   *   {"text":"@someone","mention":{"externalChannelId":"UC..."}},{"text":" nice"}
   *
   * at the reader, which is the raw row with a nicer border round it. Measured
   * over a real export: 200 of 200 comment texts parse as segments, with keys
   * text (391), mention (23) and videoLink (19).
   *
   * So provider knowledge comes first and shape detection is the fallback. It
   * also buys the thing shape detection can never do: knowing what a provider
   * *should* send means being able to say what is missing. An export with no
   * comments file is different from an export whose comments we failed to
   * recognise, and only a manifest can tell them apart.
   */
  const PROVIDERS = {
    google: {
      /* YouTube writes a comment as a sequence of segments rather than a
         string, so that mentions and video links keep their targets. The cell
         holds the segments without the enclosing brackets. */
      commentText(raw) {
        const s = String(raw == null ? "" : raw).trim();
        if (!s || s[0] !== "{") return s;
        let segs;
        try { segs = JSON.parse("[" + s + "]"); } catch (err) { return s; }
        if (!Array.isArray(segs)) return s;
        return segs.map((x) => (x && typeof x.text === "string" ? x.text : "")).join("").trim() || s;
      },
      /* The author is the person who asked for the export, and both halves of
         how YouTube shows them are in it: the title in channel.csv and the
         vanity handle in channel URL configs.csv. */
      identity(lib, slug) {
        let name = "", handle = "";
        for (const t of lib.tables || []) {
          if (slug && t.srcSlug && t.srcSlug !== slug) continue;
          const c = t.columns || [];
          const ti = c.findIndex((x) => /^channel title/i.test(String(x)));
          if (ti >= 0 && (t.rows || []).length && !name) name = String(t.rows[0][ti] || "").trim();
          const vi = c.findIndex((x) => /vanity url/i.test(String(x)));
          if (vi >= 0 && (t.rows || []).length && !handle) handle = String(t.rows[0][vi] || "").trim();
        }
        return (name || handle) ? { name, handle } : null;
      },
    },
  };

  /* The provider travels on the table, not on the library.
   *
   * Every view is handed the merged library - even when only one export is
   * open - so `lib.provider.slug` is always "merged" and keying a reader off
   * it silently matched nothing. That is precisely how the comment view came
   * to render raw JSON while looking like it worked. `mergeSources` already
   * tags each record with `srcSlug`, which is the real answer. */
  const slugOf = (t) => (t && t.srcSlug) || "";
  const readerFor = (t) => PROVIDERS[slugOf(t)] || {};

  /* Says so when we are guessing.
   *
   * A provider with no reader here still gets the view, because something
   * readable beats a blank page. But presenting a best effort as if it were
   * the finished thing is the kind of quiet overclaiming this project does not
   * do - and the person looking at it is the one who can fix it. */
  /* Which providers have a parser written for them.
   *
   * This used to test `PROVIDERS`, the map of extra readers a few pages up -
   * and that map holds one entry, google. So Apple, Samsung, Snapchat and Meta
   * were all told they were unsupported, on top of exports Muletto reads
   * perfectly well, and the notice named the archive file rather than the
   * service. Telling somebody their data is not understood when it is is worse
   * than saying nothing at all: the whole point of the notice was honesty.
   *
   * The right question is whether a parser exists, which is what a slug means. */
  const PARSED = { google: "Google", apple: "Apple", samsung: "Samsung",
                   snapchat: "Snapchat", facebook: "Facebook", instagram: "Instagram" };

  function unsupportedNote(tables) {
    const unknown = [...new Set(tables.filter((t) => !PARSED[slugOf(t)])
      .map((t) => t.srcLabel || "this export"))];
    if (!unknown.length) return "";
    return '<div class="tp-warn">' +
      "<b>" + esc(unknown.join(", ")) +
      (unknown.length === 1 ? " is" : " are") +
      " not read in a tailored way yet.</b>" +
      "<p>Everything is shown, as the export wrote it, and some of it may look raw or arrive " +
      "in the wrong order. Nothing is missing and nothing has been altered - we simply have " +
      "not taught it this format.</p>" +
      '<button type="button" class="btn secondary sm" id="tp-help" data-provider="' +
        esc(unknown.join(", ")) + '">Help us support it</button>' +
      "</div>";
  }

  /* Bound once, on the document, because a topic view is replaced wholesale
     every time the sidebar changes. */
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("#tp-help");
    if (!b) return;
    if (typeof MContribute !== "undefined" && MContribute.openOffer) {
      MContribute.openOffer([], [b.dataset.provider || "export"], "manual");
    }
  });

  /* ---------- comments ---------- */

  /* A comments table is a text column, a time, and usually a parent - which is
     what makes it a conversation rather than a list. The parent column is the
     whole reason this view exists: replies belong under what they replied to,
     and no spreadsheet can show that. */
  const COMMENT_TEXT = /comment text|^comment$|^text$|message text/i;
  const COMMENT_PARENT = /parent comment/i;
  const COMMENT_TIME = /create timestamp|created|timestamp|\bdate\b|\btime\b/i;
  const COMMENT_VIDEO = /video id/i;

  function findComments(lib) {
    const found = [];
    for (const t of lib.tables || []) {
      /* Provider first, shape second, and decided per table - a merged library
         can hold YouTube comments and Instagram comments at once, and they are
         not written the same way. */
      const readText = readerFor(t).commentText ||
        ((v) => String(v == null ? "" : v).trim());
      const ti = colIndex(t, COMMENT_TEXT);
      if (ti < 0 || !(t.rows || []).length) continue;
      const di = colIndex(t, COMMENT_TIME);
      const pi = colIndex(t, COMMENT_PARENT);
      const vi = colIndex(t, COMMENT_VIDEO);
      const idi = (t.columns || []).findIndex((c) => /^comment id$/i.test(String(c)));
      const items = [];
      for (const r of t.rows) {
        const text = readText(r[ti]);
        if (!text) continue;
        items.push({
          id: idi >= 0 ? String(r[idi] || "") : "",
          text,
          at: di >= 0 ? asDate(r[di]) : null,
          parent: pi >= 0 ? String(r[pi] || "").trim() : "",
          video: vi >= 0 ? String(r[vi] || "").trim() : "",
        });
      }
      if (items.length) found.push({ table: t, items, slug: slugOf(t) });
    }
    return found;
  }

  function drawComments(el, match, lib) {
    /* Identity comes from whichever provider these comments belong to, so a
       merged library asks the right one. */
    const slug = (match.find((m) => PROVIDERS[m.slug]) || {}).slug || "";
    const who = (PROVIDERS[slug] && PROVIDERS[slug].identity
      ? PROVIDERS[slug].identity(lib, slug) : null) || {};
    /* No avatar. The export ships a banner *URL* on yt3.ggpht.com and no image
       file at all, and fetching it would put a Google host in connect-src -
       which is the privacy promise, not a detail. So the initial is drawn from
       the name we already have. */
    const initial = (who.name || who.handle || "?").trim().charAt(0).toUpperCase();
    const at = who.handle ? "@" + who.handle.replace(/^@/, "") : "";
    const author = '<div class="cmt-who">' +
      '<span class="cmt-pfp" aria-hidden="true">' + esc(initial) + "</span>" +
      "<b>" + esc(who.name || at || "You") + "</b>" +
      (at && who.name ? '<span class="cmt-at">' + esc(at) + "</span>" : "") +
      "</div>";

    const all = match.reduce((a, m) => a.concat(m.items), []);
    const byId = new Map(all.filter((c) => c.id).map((c) => [c.id, c]));

    /* A reply whose parent is in the same export hangs under it. A reply whose
       parent is not - because the parent was deleted, or belongs to somebody
       else - is shown at the top level rather than dropped, because dropping
       it would quietly lose a comment the reader wrote. */
    const kids = new Map();
    const roots = [];
    for (const c of all) {
      if (c.parent && byId.has(c.parent) && c.parent !== c.id) {
        if (!kids.has(c.parent)) kids.set(c.parent, []);
        kids.get(c.parent).push(c);
      } else {
        roots.push(c);
      }
    }
    const orphans = all.filter((c) => c.parent && !byId.has(c.parent)).length;
    roots.sort((a, b) => (b.at ? +b.at : 0) - (a.at ? +a.at : 0));

    const withVideo = all.filter((c) => YT_ID.test(c.video)).length;
    const videos = new Set(all.filter((c) => YT_ID.test(c.video)).map((c) => c.video)).size;
    const dated = all.filter((c) => c.at);
    const from = dated.length ? new Date(Math.min(...dated.map((c) => +c.at))) : null;
    const to = dated.length ? new Date(Math.max(...dated.map((c) => +c.at))) : null;

    const one = (c, depth) => {
      const reply = kids.get(c.id) || [];
      reply.sort((a, b) => (a.at ? +a.at : 0) - (b.at ? +b.at : 0));
      return '<li class="cmt' + (depth ? " cmt-reply" : "") + '">' +
        author +
        '<div class="cmt-body">' + mentions(c.text) + "</div>" +
        '<div class="cmt-meta">' +
          (c.at ? "<time>" + esc(shortDate(c.at)) + "</time>" : "") +
          (YT_ID.test(c.video)
            ? ' <a href="https://www.youtube.com/watch?v=' + encodeURIComponent(c.video) +
              '" target="_blank" rel="noopener noreferrer nofollow">Watch the video</a>' : "") +
          (reply.length ? " <em>" + plural(reply.length, "reply", "replies") + "</em>" : "") +
        "</div>" +
        (reply.length ? '<ol class="cmt-kids">' + reply.map((k) => one(k, depth + 1)).join("") + "</ol>" : "") +
        "</li>";
    };

    const PAGE = 200;
    const shown = roots.slice(0, PAGE);

    el.innerHTML =
      unsupportedNote(match.map((m) => m.table)) +
      '<div class="tp-stats">' +
        '<div><b>' + num(all.length) + "</b><span>comments</span></div>" +
        (videos ? '<div><b>' + num(videos) + "</b><span>videos commented on</span></div>" : "") +
        (from ? '<div><b>' + esc(shortDate(from)) + " to " + esc(shortDate(to)) +
                "</b><span>from first to last</span></div>" : "") +
      "</div>" +
      (orphans
        ? '<p class="muted small">' +
          (orphans === 1
            ? "1 reply is shown on its own, because the comment it answered is not in this export."
            : num(orphans) + " replies are shown on their own, because the comments they " +
              "answered are not in this export.") +
          " Nothing has been dropped.</p>"
        : "") +
      (withVideo < all.length && withVideo
        ? '<p class="muted small">' + plural(all.length - withVideo, "comment does", "comments do") +
          " not say which video they belong to. The export does not record it.</p>"
        : "") +
      '<ol class="cmt-list">' + shown.map((c) => one(c, 0)).join("") + "</ol>" +
      (roots.length > shown.length
        ? '<p class="muted small">Showing the newest ' + num(shown.length) + " of " +
          num(roots.length) + ". The rest are under Records.</p>"
        : "");
  }

  /* ---------- health ---------- */

  /* Recognised from MCatalog.HEALTH, which is hand-researched rather than
     guessed - seventeen kinds with a matcher and a plain description of what
     each one holds. A table matches on its name or on its column names,
     because Samsung names the file and Apple names the column. */
  /* Health data has to come from somewhere health-shaped.
   *
   * Matching on the kind alone was far too eager: the catalogue entry for
   * challenges is /social|challenge|leaderboard|friends/, and an Apple export
   * has a Game Center friends table in it - so an Apple archive with no health
   * data at all grew a Health tab claiming "123 readings" and then listed the
   * fifteen kinds of *Samsung Health* it was missing. Every part of that was
   * wrong.
   *
   * A table now has to sit somewhere that says health as well as matching a
   * kind. Samsung writes com.samsung.shealth.*, Google writes Takeout/Fit/,
   * Apple writes Health. A friends list in Game Center matches none of them. */
  const HEALTH_CONTEXT = /health|shealth|\bfit\b|fitness|workout|exercise|wellness|activity metrics/i;

  function findHealth(lib) {
    const kinds = (typeof MCatalog !== "undefined" && MCatalog.HEALTH) || [];
    const out = [];
    for (const t of lib.tables || []) {
      if (!(t.rows || []).length) continue;
      const where = String(t.path || "") + " " + String(t.name || "");
      if (!HEALTH_CONTEXT.test(where)) continue;
      const hay = where + " " + (t.columns || []).join(" ");
      const kind = kinds.find((k) => k.match.test(hay));
      if (!kind) continue;
      out.push({ kind, table: t, slug: slugOf(t) });
    }
    return out;
  }

  function drawHealth(el, match) {
    const kinds = (typeof MCatalog !== "undefined" && MCatalog.HEALTH) || [];
    const have = new Map();
    for (const m of match) {
      if (!have.has(m.kind.key)) have.set(m.kind.key, { kind: m.kind, tables: [] });
      have.get(m.kind.key).tables.push(m.table);
    }

    const panel = (entry) => {
      const rows = entry.tables.reduce((n, t) => n + t.rows.length, 0);
      /* The chart comes from insights, which already knows how to find the
         one column in a health table worth plotting and how to degrade when
         there are four readings rather than four hundred thousand. */
      let card = "";
      if (typeof MInsight !== "undefined" && MInsight.cardsFor) {
        try {
          const cards = MInsight.cardsFor(entry.tables[0]) || [];
          const s = cards.find((c) => c.kind === "series");
          if (s) {
            card = '<div class="hl-figure"><b>' + esc(s.stat) +
              (s.unit ? ' <em>' + esc(s.unit) + "</em>" : "") + "</b>" +
              '<span class="muted small">' + esc(s.statLabel || "") + "</span></div>";
          }
        } catch (err) { /* a chart is a bonus, never the reason the panel exists */ }
      }
      return '<article class="hl-card">' +
        "<h3>" + esc(entry.kind.name) + "</h3>" +
        card +
        '<p class="muted small">' + esc(entry.kind.holds || "") + "</p>" +
        '<p class="hl-n">' + plural(rows, "reading", "readings") +
          (entry.tables.length > 1 ? " across " + plural(entry.tables.length, "table", "tables") : "") +
        "</p></article>";
    };

    const missing = kinds.filter((k) => !have.has(k.key));

    el.innerHTML =
      unsupportedNote(match.map((m) => m.table)) +
      '<div class="tp-stats">' +
        '<div><b>' + num(have.size) + "</b><span>kinds of data found</span></div>" +
        '<div><b>' + num(match.reduce((n, m) => n + m.table.rows.length, 0)) +
          "</b><span>readings in total</span></div>" +
      "</div>" +
      '<div class="hl-grid">' + [...have.values()].map(panel).join("") + "</div>" +
      /* The catalogue is Samsung Health's, so only a Samsung export can be
         told what Samsung Health would also have recorded. Saying it over
         Google Fit data was claiming knowledge of the wrong product. */
      (missing.length && match.some((m) => m.slug === "samsung")
        ? '<h3 class="tp-h">Not in this export</h3>' +
          '<p class="muted small">Samsung Health records these too. They are absent here, ' +
          "which usually means no device ever recorded them.</p>" +
          '<ul class="hl-missing">' + missing.map((k) =>
            "<li><b>" + esc(k.name) + "</b>" +
            (k.needs ? '<span class="muted small">' + esc(k.needs) + "</span>" : "") +
            "</li>").join("") + "</ul>"
        : "");
  }

  /* ---------- topics that live in files, not tables ----------
   *
   * Everything above reads `lib.tables`. These four read the archive itself,
   * which is where most of an export actually is: 112 vCards and 809 notes in
   * one Apple export, 319 Siri recordings in another. All of it was reachable
   * only through All files, one click per file, which is a file manager rather
   * than a way to look at your contacts.
   *
   * They need two things the table topics do not - the entry list and the
   * source archives to read them out of - so `find` and `draw` both take a
   * context, and `draw` may be asynchronous because it has to decompress.
   */

  /* vCard and iCalendar both fold long lines: a line beginning with a space or
     a tab is a continuation of the one before it. Unfolding first is what
     makes everything after it a simple line-at-a-time read. */
  function unfold(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  }

  /* Values escape commas, semicolons and newlines. Undoing that is the
     difference between "Oslo\, Norway" and a name with a stray backslash. */
  function unescapeValue(v) {
    let out = "";
    for (let i = 0; i < v.length; i++) {
      if (v[i] === "\\" && i + 1 < v.length) {
        const c = v[++i];
        out += c === "n" || c === "N" ? "\n" : c;
      } else out += v[i];
    }
    return out;
  }

  function propLines(block) {
    const out = [];
    for (const line of unfold(block).split("\n")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      const left = line.slice(0, at);
      const value = line.slice(at + 1);
      const semi = left.indexOf(";");
      const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase().trim();
      const params = semi < 0 ? "" : left.slice(semi + 1);
      out.push({ name, params, value });
    }
    return out;
  }

  function parseVcards(text) {
    const cards = [];
    const blocks = unfold(text).split(/BEGIN:VCARD/i).slice(1);
    for (const b of blocks) {
      const body = b.split(/END:VCARD/i)[0];
      const card = { name: "", org: "", title: "", note: "", born: "",
                     emails: [], phones: [], addresses: [] };
      let structured = "";
      for (const p of propLines(body)) {
        const v = unescapeValue(p.value).trim();
        if (!v) continue;
        if (p.name === "FN") card.name = card.name || v;
        else if (p.name === "N") structured = v;
        else if (p.name === "ORG") card.org = v.split(";").filter(Boolean).join(", ");
        else if (p.name === "TITLE") card.title = v;
        else if (p.name === "NOTE") card.note = v;
        else if (p.name === "BDAY") card.born = v;
        else if (p.name === "EMAIL") card.emails.push(v);
        else if (p.name === "TEL") card.phones.push(v);
        else if (p.name === "ADR") card.addresses.push(v.split(";").filter(Boolean).join(", "));
      }
      // N is family;given;middle;prefix;suffix - only used when there is no FN.
      if (!card.name && structured) {
        const bits = structured.split(";");
        card.name = [bits[3], bits[1], bits[2], bits[0], bits[4]]
          .filter(Boolean).join(" ").trim();
      }
      if (card.name || card.emails.length || card.phones.length) cards.push(card);
    }
    return cards;
  }

  /* 20240301T120000Z, 20240301T120000, or 20240301 for an all-day entry.
     Built field by field rather than handed to Date(), which parses none of
     those three the same way twice. */
  function icsDate(v) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(String(v || "").trim());
    if (!m) return null;
    const allDay = !m[4];
    const d = m[7]
      ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))
      : new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(d) ? null : { at: d, allDay };
  }

  function parseIcs(text) {
    const out = [];
    const body = unfold(text);
    const blocks = body.split(/BEGIN:VEVENT/i).slice(1);
    for (const b of blocks) {
      const ev = { summary: "", where: "", note: "", at: null, allDay: false, repeats: false };
      for (const p of propLines(b.split(/END:VEVENT/i)[0])) {
        const v = unescapeValue(p.value).trim();
        if (p.name === "SUMMARY") ev.summary = v;
        else if (p.name === "LOCATION") ev.where = v;
        else if (p.name === "DESCRIPTION") ev.note = v;
        else if (p.name === "RRULE") ev.repeats = true;
        else if (p.name === "DTSTART") {
          const d = icsDate(v);
          if (d) { ev.at = d.at; ev.allDay = d.allDay || /VALUE=DATE(?!-)/i.test(p.params); }
        }
      }
      if (ev.summary || ev.at) out.push(ev);
    }
    // Reminders come as VTODO and are worth the same treatment.
    for (const b of body.split(/BEGIN:VTODO/i).slice(1)) {
      const ev = { summary: "", where: "", note: "", at: null, allDay: false, todo: true };
      for (const p of propLines(b.split(/END:VTODO/i)[0])) {
        const v = unescapeValue(p.value).trim();
        if (p.name === "SUMMARY") ev.summary = v;
        else if (p.name === "DUE" || p.name === "DTSTART") {
          const d = icsDate(v);
          if (d && !ev.at) ev.at = d.at;
        }
      }
      if (ev.summary) out.push(ev);
    }
    return out;
  }

  /* Entries by extension. Cheap on purpose - this runs on every sidebar
     redraw, so it reads names and never touches the archive. */
  function filesLike(ctx, re, max) {
    const list = [];
    for (const e of (ctx && ctx.entries) || []) {
      if (!re.test(e.name)) continue;
      list.push(e);
      if (max && list.length >= max) break;
    }
    return list;
  }

  const sourceOf = (ctx, e) =>
    ((ctx && ctx.sources) || [])[e && e.src ? e.src : 0];

  async function readEach(ctx, entries, cap, asText) {
    const out = [];
    for (const e of entries.slice(0, cap)) {
      const s = sourceOf(ctx, e);
      if (!s || !s.file) continue;
      try {
        out.push({ entry: e, body: asText
          ? await MZip.extractText(s.file, e)
          : await MZip.extract(s.file, e) });
      } catch (err) { /* one unreadable file is not a reason to show none */ }
    }
    return out;
  }

  /* ---------- contacts ---------- */

  const VCF = /\.vcf$/i;

  function findContacts(lib, ctx) {
    const files = filesLike(ctx, VCF);
    return files.length ? [{ files }] : [];
  }

  async function drawContacts(el, match, lib, ctx) {
    const files = match[0].files;
    const read = await readEach(ctx, files, 600, true);
    const cards = [];
    for (const r of read) cards.push(...parseVcards(r.body));
    if (!el.isConnected) return;

    cards.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const withEmail = cards.filter((c) => c.emails.length).length;
    const withPhone = cards.filter((c) => c.phones.length).length;

    const card = (c) => '<article class="ct">' +
      '<span class="ct-pfp" aria-hidden="true">' +
        esc((c.name || "?").trim().charAt(0).toUpperCase()) + "</span>" +
      "<div><b>" + esc(c.name || "No name") + "</b>" +
      (c.title || c.org
        ? '<div class="muted small">' + esc([c.title, c.org].filter(Boolean).join(", ")) + "</div>"
        : "") +
      (c.phones.length ? '<div class="ct-line">' + c.phones.map(esc).join(" &middot; ") + "</div>" : "") +
      (c.emails.length ? '<div class="ct-line">' + c.emails.map(esc).join(" &middot; ") + "</div>" : "") +
      (c.addresses.length ? '<div class="ct-line muted">' + esc(c.addresses[0]) + "</div>" : "") +
      "</div></article>";

    el.innerHTML =
      unsupportedNote([]) +
      '<div class="tp-stats">' +
        '<div><b>' + num(cards.length) + "</b><span>contacts</span></div>" +
        '<div><b>' + num(withPhone) + "</b><span>with a phone number</span></div>" +
        '<div><b>' + num(withEmail) + "</b><span>with an email address</span></div>" +
      "</div>" +
      (files.length > read.length
        ? '<p class="muted small">' + num(files.length - read.length) +
          " could not be read.</p>" : "") +
      '<div class="ct-grid">' + cards.map(card).join("") + "</div>";
  }

  /* ---------- calendar ---------- */

  const ICS = /\.ics$/i;

  function findCalendar(lib, ctx) {
    const files = filesLike(ctx, ICS);
    return files.length ? [{ files }] : [];
  }

  async function drawCalendar(el, match, lib, ctx) {
    const files = match[0].files;
    const read = await readEach(ctx, files, 60, true);
    const events = [];
    for (const r of read) events.push(...parseIcs(r.body));
    if (!el.isConnected) return;

    setCount("calendar", events.length);
    events.sort((a, b) => (b.at ? +b.at : 0) - (a.at ? +a.at : 0));
    const dated = events.filter((e) => e.at);
    const from = dated.length ? dated[dated.length - 1].at : null;
    const to = dated.length ? dated[0].at : null;
    const repeats = events.filter((e) => e.repeats).length;
    const todos = events.filter((e) => e.todo).length;

    const PAGE = 400;
    const row = (e) => "<li>" +
      '<div class="cal-when">' +
        (e.at ? esc(e.allDay ? shortDate(e.at) : e.at.toLocaleString(undefined,
          { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))
              : "<span class='muted'>no date</span>") +
      "</div>" +
      '<div class="cal-what"><b>' + esc(e.summary || "Untitled") + "</b>" +
        (e.where ? '<span class="muted small">' + esc(e.where) + "</span>" : "") +
        (e.repeats ? '<span class="cal-tag">repeats</span>' : "") +
        (e.todo ? '<span class="cal-tag">reminder</span>' : "") +
      "</div></li>";

    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(events.length - todos) + "</b><span>" +
          (events.length - todos === 1 ? "event" : "events") + "</span></div>" +
        (todos ? '<div><b>' + num(todos) + "</b><span>" +
          (todos === 1 ? "reminder" : "reminders") + "</span></div>" : "") +
        (repeats ? '<div><b>' + num(repeats) + "</b><span>" +
          (repeats === 1 ? "repeats" : "repeat") + "</span></div>" : "") +
        (from ? '<div><b>' + esc(shortDate(from)) + " to " + esc(shortDate(to)) +
                "</b><span>first to last</span></div>" : "") +
      "</div>" +
      '<ol class="cal-list">' + events.slice(0, PAGE).map(row).join("") + "</ol>" +
      (events.length > PAGE
        ? '<p class="muted small">Showing the newest ' + num(PAGE) + " of " +
          num(events.length) + ".</p>" : "");
  }

  /* ---------- notes ---------- */

  /* Only inside a folder that says notes. A `.txt` anywhere in an export is
     usually a readme, and 809 of somebody's notes deserve better than being
     mixed in with them. */
  const NOTE_FILE = /(^|\/)(icloud )?notes?\//i;
  const TXT = /\.txt$/i;

  function findNotes(lib, ctx) {
    const files = ((ctx && ctx.entries) || [])
      .filter((e) => TXT.test(e.name) && NOTE_FILE.test(e.name));
    return files.length ? [{ files }] : [];
  }

  async function drawNotes(el, match, lib, ctx) {
    const files = match[0].files;
    const read = await readEach(ctx, files, 400, true);
    if (!el.isConnected) return;

    const notes = read.map((r) => {
      const body = String(r.body || "").trim();
      const nl = body.indexOf("\n");
      const title = (nl < 0 ? body : body.slice(0, nl)).trim();
      return {
        title: title || r.entry.name.split("/").pop().replace(TXT, ""),
        body,
        words: body ? body.split(/\s+/).length : 0,
      };
    }).filter((n) => n.body);

    const words = notes.reduce((a, n) => a + n.words, 0);
    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(files.length) + "</b><span>notes</span></div>" +
        '<div><b>' + num(words) + "</b><span>words in them</span></div>" +
      "</div>" +
      (files.length > read.length
        ? '<p class="muted small">Showing the first ' + num(read.length) + ". Open " +
          "All files for the rest.</p>" : "") +
      '<div class="nt-grid">' + notes.map((n) =>
        '<article class="nt-note"><h3>' + esc(n.title.slice(0, 90)) + "</h3>" +
        "<p>" + esc(n.body.slice(0, 400)) + (n.body.length > 400 ? "..." : "") + "</p>" +
        '<footer class="muted small">' + plural(n.words, "word", "words") + "</footer>" +
        "</article>").join("") + "</div>";
  }

  /* ---------- audio ---------- */

  /* 319 Siri recordings sat in an Apple export with no way to hear them, which
     is the most surprising thing in it. The player is an <audio> element over
     a blob made here - nothing is fetched. */
  const AUDIO = /\.(m4a|mp3|wav|aac|opus|ogg|flac)$/i;

  /* Drawn rather than typed. An emoji would be a different glyph on every
     machine and the project is plain ASCII anyway. */
  const svg = (d, cls) => '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  const PLAY_ICON = svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>', "au-i au-i-play");
  const PAUSE_ICON = svg('<path d="M9 5.5v13M15 5.5v13" stroke-width="2.6"/>', "au-i au-i-pause");
  /* A circular arrow, and nothing inside it.
   *
   * These carried a "10" drawn as SVG text, which at eighteen pixels was a
   * smudge rather than a numeral - worse than absent, because a smudge looks
   * like a rendering fault. The title and aria-label already say "Back 10
   * seconds", so the number is available to anyone who wants it without being
   * printed at a size nobody can read. */
  /* The arc belongs on the side the arrow is travelling towards, so the gap in
     the circle sits under the arrowhead. Drawn the other way round first, the
     arrowheads pointed correctly and each one hung off the wrong end of its
     own circle. */
  const SKIP_BACK = svg('<path d="M12 6.2A6.9 6.9 0 1 1 5.1 13.1"/>' +
    '<path d="M12 2.6 8.4 6.2 12 9.8"/>', "au-i");
  const SKIP_FWD = svg('<path d="M12 6.2A6.9 6.9 0 1 0 18.9 13.1"/>' +
    '<path d="m12 2.6 3.6 3.6L12 9.8"/>', "au-i");

  function findAudio(lib, ctx) {
    const files = filesLike(ctx, AUDIO);
    return files.length ? [{ files }] : [];
  }

  async function drawAudio(el, match, lib, ctx) {
    const files = match[0].files;
    if (!el.isConnected) return;
    const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
    const folders = new Set(files.map((f) => f.name.split("/").slice(0, -1).join("/")));

    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(files.length) + "</b><span>recordings</span></div>" +
        '<div><b>' + esc(bytesText(bytes)) + "</b><span>of audio</span></div>" +
        '<div><b>' + num(folders.size) + "</b><span>" +
          (folders.size === 1 ? "folder" : "folders") + "</span></div>" +
      "</div>" +
      '<p class="muted small">Played from the archive on this machine. Nothing is ' +
        "downloaded and nothing is sent anywhere.</p>" +
      '<ol class="au-list">' + files.slice(0, 400).map((f, i) =>
        '<li class="au" data-i="' + i + '">' +
          '<div class="au-name">' + esc(f.name.split("/").pop()) + "</div>" +
          '<div class="au-size muted small">' + esc(bytesText(f.size || 0)) + "</div>" +
          /* Icons, no boxes, no text. A row of little bordered buttons reading
             "-10" and "+10" is a form; these are transport controls and should
             look like the ones on every player anybody has used. The arrows
             carry a 10 inside the curl, which is how Apple and the BBC both
             draw skip, so the number is there without being a label. */
          '<div class="au-ctl">' +
            '<button type="button" class="au-b au-back" title="Back 10 seconds"' +
              ' aria-label="Back 10 seconds">' + SKIP_BACK + "</button>" +
            '<button type="button" class="au-b au-toggle" title="Play"' +
              ' aria-label="Play">' + PLAY_ICON + PAUSE_ICON + "</button>" +
            '<button type="button" class="au-b au-fwd" title="Forward 10 seconds"' +
              ' aria-label="Forward 10 seconds">' + SKIP_FWD + "</button>" +
            '<canvas class="au-wave" height="34"></canvas>' +
            '<span class="au-time">0:00</span>' +
          "</div>" +
        "</li>").join("") + "</ol>" +
      (files.length > 400
        ? '<p class="muted small">Showing the first 400 of ' + num(files.length) + ".</p>" : "");

    /* One <audio> for the whole list, not one per row.
     *
     * Three hundred and nineteen audio elements, each holding a blob, would
     * decode the entire export to draw a page. There is a single player, moved
     * to whichever row is playing, and the blob for that row is built at the
     * moment somebody asks for it. */
    const clock = (t) => {
      if (!isFinite(t)) return "0:00";
      const m = Math.floor(t / 60), s2 = Math.floor(t % 60);
      return m + ":" + String(s2).padStart(2, "0");
    };
    const audio = new Audio();
    audio.preload = "none";
    let row = null, url = "";

    /* The shape of the sound, not a progress bar.
     *
     * A bar filling up tells you how far through you are and nothing else. On
     * an hour-long recording the useful question is where the talking is, and
     * a waveform answers it at a glance - which is why every phone draws one.
     *
     * Peaks are computed once per recording and kept on the row: decoding is
     * the expensive part, and it must not happen again on every animation
     * frame. */
    const peaksOf = (buf, want) => {
      const ch = buf.getChannelData(0);
      const per = Math.max(1, Math.floor(ch.length / want));
      const out = new Float32Array(want);
      let top = 0.0001;
      for (let i = 0; i < want; i++) {
        let peak = 0;
        const from = i * per, to = Math.min(ch.length, from + per);
        // Step through rather than read every sample: an hour at 44.1 kHz is
        // 158 million of them and the drawing is 600 pixels wide.
        for (let j = from; j < to; j += Math.max(1, (to - from) >> 7)) {
          const v = ch[j] < 0 ? -ch[j] : ch[j];
          if (v > peak) peak = v;
        }
        out[i] = peak;
        if (peak > top) top = peak;
      }
      for (let i = 0; i < want; i++) out[i] /= top;   // normalised, so a quiet
      return out;                                     // recording is still legible
    };

    const drawWave = () => {
      if (!row) return;
      const c = row.querySelector(".au-wave");
      if (!c) return;
      const w = c.clientWidth || 240, h = c.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      const peaks = row.__peaks;
      const played = audio.duration ? audio.currentTime / audio.duration : 0;
      const cs = getComputedStyle(row);
      const done = cs.getPropertyValue("--wave-on").trim() || "#5b6cff";
      const todo = cs.getPropertyValue("--wave-off").trim() || "#d5d7e0";
      const bars = Math.max(24, Math.floor(w / 3));
      for (let i = 0; i < bars; i++) {
        const at = i / bars;
        const v = peaks ? peaks[Math.floor(at * peaks.length)] || 0 : 0.12;
        const bh = Math.max(2, v * (h - 4));
        g.fillStyle = at <= played ? done : todo;
        g.fillRect(i * 3, (h - bh) / 2, 2, bh);
      }
    };

    const paint = () => {
      if (!row) return;
      const time = row.querySelector(".au-time");
      if (time) {
        time.textContent = clock(audio.currentTime) +
          (isFinite(audio.duration) ? " / " + clock(audio.duration) : "");
      }
      row.classList.toggle("au-playing", !audio.paused);
      drawWave();
    };
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("loadedmetadata", paint);
    audio.addEventListener("play", paint);
    audio.addEventListener("pause", paint);
    audio.addEventListener("ended", () => { if (row) row.classList.remove("au-playing"); });

    async function loadInto(li) {
      const f = files[Number(li.dataset.i)];
      const s = sourceOf(ctx, f);
      if (!f || !s) return false;
      li.classList.add("au-loading");
      try {
        const blob = await MZip.extractBlob(s.file, f, mimeOfAudio(f.name));
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        audio.src = url;
        li.classList.remove("au-loading");
        /* Decoded once and kept. Playback starts immediately either way - the
           waveform arrives when it arrives rather than holding up the sound,
           and a format the browser can play but not decode simply stays flat
           rather than failing. */
        if (!li.__peaks) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            blob.arrayBuffer()
              .then((ab) => new AC().decodeAudioData(ab))
              .then((buf) => { li.__peaks = peaksOf(buf, 900); if (row === li) drawWave(); })
              .catch(() => { /* undecodable: the bars stay flat, the sound still plays */ });
          }
        }
        return true;
      } catch (err) {
        li.classList.remove("au-loading");
        li.classList.add("au-failed");
        const t = li.querySelector(".au-time");
        if (t) t.textContent = "would not play";
        return false;
      }
    }

    el.addEventListener("click", async (ev) => {
      const li = ev.target.closest && ev.target.closest(".au");
      if (!li) return;
      /* The waveform is the scrubber and nothing else.
       *
       * Releasing a drag fires a click on the row, and the row's click means
       * play or pause - so every skim through a recording ended by toggling
       * playback, which is the opposite of what letting go should do. Seeking
       * is handled entirely on pointerdown and pointermove; a click that
       * started here has already done its job. */
      if (ev.target.closest(".au-wave")) return;
      /* Clicking the row keeps the controls up; the buttons themselves act. */
      const back = ev.target.closest(".au-back");
      const fwd = ev.target.closest(".au-fwd");
      const toggle = ev.target.closest(".au-toggle");

      if (row !== li && (toggle || back || fwd || !row)) {
        if (row) { row.classList.remove("au-on", "au-playing"); }
        row = li;
        li.classList.add("au-on");
        audio.pause();
        if (!(await loadInto(li))) return;
      } else if (row !== li) {
        // Selecting a different row without pressing anything: just pin it.
        if (row) row.classList.remove("au-on");
        row = li;
        li.classList.add("au-on");
        if (!(await loadInto(li))) return;
        paint();
        return;
      }

      if (back) audio.currentTime = Math.max(0, audio.currentTime - 10);
      else if (fwd) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      else if (audio.paused) audio.play().catch(() => { /* refused, stays paused */ });
      else audio.pause();
      paint();
    });

    /* Drag, not just click.
     *
     * Pressing jumps the playhead and holding keeps it under the finger, which
     * is how every audio player works and what makes finding a moment in a
     * long recording possible at all. Pointer capture means the drag survives
     * leaving the canvas - without it, moving a few pixels above the waveform
     * silently ends the scrub. */
    let scrubbing = null;
    const seekTo = (canvas, clientX) => {
      if (!isFinite(audio.duration)) return;
      const r = canvas.getBoundingClientRect();
      const at = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      audio.currentTime = at * audio.duration;
      paint();
    };
    el.addEventListener("pointerdown", async (ev) => {
      const canvas = ev.target.closest && ev.target.closest(".au-wave");
      if (!canvas) return;
      const li = canvas.closest(".au");
      ev.preventDefault();
      /* Hovering a row shows its waveform, so pressing on one that is not the
         current recording has to adopt it first - otherwise the waveform of
         every row but one is a picture that ignores you. */
      if (li !== row) {
        if (row) row.classList.remove("au-on", "au-playing");
        row = li;
        li.classList.add("au-on");
        audio.pause();
        if (!(await loadInto(li))) return;
      }
      scrubbing = canvas;
      canvas.classList.add("au-scrub");
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* older engines */ }
      seekTo(canvas, ev.clientX);
    });
    el.addEventListener("pointermove", (ev) => {
      if (!scrubbing) return;
      ev.preventDefault();
      seekTo(scrubbing, ev.clientX);
    });
    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing.classList.remove("au-scrub");
      scrubbing = null;
    };
    el.addEventListener("pointerup", endScrub);
    el.addEventListener("pointercancel", endScrub);

    // Bars are laid out from the element's width, so a resize has to redraw.
    window.addEventListener("resize", drawWave);
  }

  const AUDIO_MIME = { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
                       aac: "audio/aac", opus: "audio/ogg", ogg: "audio/ogg",
                       flac: "audio/flac" };
  const mimeOfAudio = (n) =>
    AUDIO_MIME[(n.split(".").pop() || "").toLowerCase()] || "audio/mpeg";

  const bytesText = (n) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
  };

  /* ---------- My Activity ----------
   *
   * Google keeps search history, watch history, app opens and map lookups in
   * HTML rather than JSON - eleven files in a real Takeout, one per product,
   * the YouTube one 48 MB. None of it was parsed, so the data people are most
   * surprised to see was the data we showed least of.
   *
   * The markup is Google's Material Design Lite: one `outer-cell` per action,
   * a `header-cell` naming the product, then content cells holding what was
   * done, a link to it, and the time. Measured against a real export.
   *
   * Parsed with DOMParser rather than regular expressions, because the values
   * are somebody's search terms and a regex over untrusted HTML is how markup
   * ends up executed. DOMParser builds an inert document - no scripts run, no
   * images load, nothing is fetched.
   */
  const ACTIVITY_FILE = /My Activity\/([^/]+)\/My ?Activity\.html$/i;

  function findActivity(lib, ctx) {
    const files = ((ctx && ctx.entries) || []).filter((e) => ACTIVITY_FILE.test(e.name));
    return files.length ? [{ files }] : [];
  }

  function parseActivity(html, product) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    for (const cell of doc.querySelectorAll(".outer-cell")) {
      const body = cell.querySelector(".content-cell");
      if (!body) continue;
      const link = body.querySelector("a");
      /* The time is the last text node in the block, after the <br>. Taking
         the whole block and stripping the action off the front is more robust
         than trusting a position: some entries carry two links. */
      const text = body.textContent.replace(/\s+/g, " ").trim();
      const when = (text.match(/(\d{1,2} \w+ \d{4},? \d{1,2}:\d{2}(:\d{2})?)/) ||
                    text.match(/(\w+ \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2})/) || [])[1] || "";
      let what = link ? link.textContent.trim() : text;
      /* Google writes "Searched for x", "Watched y", "Used z". Keeping the verb
         is what makes a list of a thousand lines readable at a glance. */
      const verb = (text.match(/^(Searched for|Watched|Visited|Used|Viewed|Listened to|Saved|Opened)\b/) || [])[1] || "";
      if (verb && !link) what = text.slice(verb.length).replace(when, "").trim();
      const at = when ? new Date(when.replace(",", "")) : null;
      if (!what) continue;
      out.push({
        product,
        verb,
        what: what.slice(0, 300),
        href: link && /^https?:/i.test(link.getAttribute("href") || "")
          ? link.getAttribute("href") : "",
        at: at && !isNaN(at) ? at : null,
      });
    }
    return out;
  }

  async function drawActivity(el, match, lib, ctx) {
    const files = match[0].files;
    const items = [];
    /* Biggest last: the YouTube file alone can be 48 MB, and getting the small
       products on screen first is the difference between a page that appears
       and a page that arrives. */
    const ordered = files.slice().sort((a, b) => (a.size || 0) - (b.size || 0));
    const CAP = 20 * 1024 * 1024;
    let skipped = 0;
    for (const f of ordered) {
      if ((f.size || 0) > CAP) { skipped++; continue; }
      const s = sourceOf(ctx, f);
      if (!s || !s.file) continue;
      const product = (ACTIVITY_FILE.exec(f.name) || [])[1] || "Google";
      try {
        items.push(...parseActivity(await MZip.extractText(s.file, f), product));
      } catch (err) { /* one unreadable product is not a reason to show none */ }
    }
    if (!el.isConnected) return;

    setCount("activity", items.length);
    items.sort((a, b) => (b.at ? +b.at : 0) - (a.at ? +a.at : 0));
    const byProduct = new Map();
    for (const i of items) byProduct.set(i.product, (byProduct.get(i.product) || 0) + 1);
    const dated = items.filter((i) => i.at);
    const PAGE = 500;

    const row = (i) => "<li>" +
      '<div class="ac-when">' + (i.at ? esc(shortDate(i.at)) : "") + "</div>" +
      '<div class="ac-what">' +
        (i.verb ? '<span class="ac-verb">' + esc(i.verb) + "</span> " : "") +
        (i.href
          ? '<a href="' + esc(i.href) + '" target="_blank" rel="noopener noreferrer nofollow">' +
            esc(i.what) + "</a>"
          : esc(i.what)) +
        '<span class="ac-prod">' + esc(i.product) + "</span>" +
      "</div></li>";

    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(items.length) + "</b><span>things you did</span></div>" +
        '<div><b>' + num(byProduct.size) + "</b><span>Google services</span></div>" +
        (dated.length
          ? '<div><b>' + esc(shortDate(dated[dated.length - 1].at)) + " to " +
            esc(shortDate(dated[0].at)) + "</b><span>first to last</span></div>" : "") +
      "</div>" +
      (skipped
        ? '<p class="muted small">' + plural(skipped, "product's history was", "products' histories were") +
          " too large to read here - the YouTube one alone can be 48 MB. They are in All files.</p>"
        : "") +
      '<ol class="ac-list">' + items.slice(0, PAGE).map(row).join("") + "</ol>" +
      (items.length > PAGE
        ? '<p class="muted small">Showing the newest ' + num(PAGE) + " of " +
          num(items.length) + ".</p>" : "");
  }

  /* ---------- mail ---------- */

  /* A Takeout ships Gmail as one mbox - 776 MB in a real export - and it was
     listed as a single file. Indexed here rather than parsed in full: headers
     only, streamed, so a large mailbox becomes searchable without ever holding
     a message body. */
  const MBOX = /\.mbox$/i;

  function findMail(lib, ctx) {
    const files = filesLike(ctx, MBOX);
    return files.length ? [{ files }] : [];
  }

  async function drawMail(el, match, lib, ctx) {
    if (typeof MMbox === "undefined") { el.innerHTML = ""; return; }
    const f = match[0].files[0];
    const s = sourceOf(ctx, f);
    if (!s || !s.file) return;

    const res = await MMbox.index(await MZip.streamEntry(s.file, f), {
      limit: 20000,
      onProgress: (read, n) => {
        if (el.isConnected && n % 2000 === 0) {
          el.innerHTML = '<p class="loading">Reading your mail - ' + num(n) +
            " messages so far...</p>";
        }
      },
    });
    if (!el.isConnected) return;
    setCount("mail", res.messages.length);
    const sum = MMbox.summarise(res);
    const dated = res.messages.filter((m) => m.at).sort((a, b) => b.at - a.at);

    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(res.messages.length) + "</b><span>messages read</span></div>" +
        '<div><b>' + num(sum.senders.length) + "</b><span>people and services</span></div>" +
        (dated.length
          ? '<div><b>' + esc(shortDate(dated[dated.length - 1].at)) + " to " +
            esc(shortDate(dated[0].at)) + "</b><span>first to last</span></div>" : "") +
      "</div>" +
      '<p class="muted small">Headers only - who, what and when. The bodies stay in the ' +
        "archive and are never held in memory." +
        (res.skipped ? " " + num(res.skipped) + " could not be read." : "") + "</p>" +
      '<h3 class="tp-h">Who writes to you most</h3>' +
      '<ol class="ml-top">' + sum.senders.slice(0, 20).map((x) =>
        "<li><b>" + esc(x.name || x.address || "Unknown") + "</b>" +
        '<em class="muted">' + plural(x.count, "message", "messages") + "</em></li>").join("") +
      "</ol>" +
      '<h3 class="tp-h">Most recent</h3>' +
      '<ol class="ml-list">' + dated.slice(0, 500).map((m, i) =>
        '<li class="ml-item" data-i="' + i + '">' +
        "<div class='ml-when'>" + esc(shortDate(m.at)) + "</div>" +
        "<div><b>" + esc(m.subject || "(no subject)") + "</b>" +
        '<span class="muted small">' + esc((m.from && m.from.name) || "") + "</span></div>" +
        '<div class="ml-body" hidden></div>' +
        "</li>").join("") +
      "</ol>";

    /* Opened on click, like any inbox: the list shows who and what, and the
       message itself only when asked for. */
    const shown = dated.slice(0, 500);
    el.addEventListener("click", async (ev) => {
      const li = ev.target.closest && ev.target.closest(".ml-item");
      if (!li || ev.target.closest(".ml-body")) return;
      const pane = li.querySelector(".ml-body");
      if (li.classList.contains("open")) {
        li.classList.remove("open");
        pane.hidden = true;
        return;
      }
      li.classList.add("open");
      pane.hidden = false;
      if (li.dataset.done) return;
      li.dataset.done = "1";
      const m = shown[Number(li.dataset.i)];
      if (!m || !m.body) {
        pane.innerHTML = '<p class="muted small">This message was past the amount of ' +
          "mail kept for reading. Its headers are here; the text is still in the archive.</p>";
        return;
      }
      pane.innerHTML = '<p class="muted small">Reading...</p>';
      try {
        pane.innerHTML = renderMessage(await m.body.text());
      } catch (err) {
        pane.innerHTML = '<p class="muted small">That message would not open.</p>';
      }
    });
  }

  /* Showing a message without letting it act.
   *
   * Mail is the one thing in an export written by somebody else, so it is the
   * one place where the content is hostile by default. Three things matter:
   *
   *   Scripts never run. `DOMParser` builds an inert document - nothing in it
   *   executes - and script, style, iframe, object and form are removed
   *   outright, along with every on* attribute and any href that is not http,
   *   https or mailto.
   *
   *   Remote images never load. A tracking pixel exists to tell a sender that
   *   the message was opened, and this app must never be the thing that tells
   *   them. `img-src 'self' data: blob:` in the Content-Security-Policy is what
   *   actually stops it - the browser refuses the request - and the src is
   *   dropped here as well so nothing is even attempted.
   *
   *   Nothing is fetched to render it. Links open in a new tab and carry
   *   noreferrer.
   */
  const STRIP = "script,style,iframe,object,embed,link,meta,form,input,button,svg";

  function renderMessage(raw) {
    const text = String(raw || "");
    const html = /<(html|body|div|table|p|br|a)\b/i.test(text);
    if (!html) {
      // Plain text. Quoted replies are dimmed rather than hidden.
      return '<div class="ml-plain">' + text.split("\n").map((l) =>
        /^\s*>/.test(l) ? '<span class="ml-quote">' + esc(l) + "</span>" : esc(l)
      ).join("\n") + "</div>";
    }
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll(STRIP).forEach((n) => n.remove());
    let blocked = 0;
    doc.querySelectorAll("*").forEach((n) => {
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase();
        if (name.startsWith("on")) n.removeAttribute(a.name);
        else if (name === "srcset") n.removeAttribute(a.name);
        else if (name === "src") {
          if (!/^(data:image\/|cid:)/i.test(a.value)) { n.removeAttribute(a.name); blocked++; }
        } else if (name === "href" && !/^(https?:|mailto:)/i.test(a.value)) {
          n.removeAttribute(a.name);
        }
      }
      if (n.tagName === "A") {
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
    return (blocked
      ? '<p class="ml-blocked">' + plural(blocked, "image was", "images were") +
        " not loaded. They live on the sender's server, and fetching one tells them " +
        "you opened this.</p>"
      : "") +
      '<div class="ml-html">' + doc.body.innerHTML + "</div>";
  }

  /* ---------- logins and devices ----------
   *
   * Every provider ships this and nobody looks at it, which is exactly why it
   * is worth a screen: it is the part of an export that makes somebody say
   * "it knows what?" Recognised by shape, because five providers describe the
   * same thing five ways.
   */
  /* Matching was far too loose the first time: any two of "ip address",
     "device", "city" and a timestamp counted, so a table of App Store
     purchases - which records the address you bought from - was presented as
     sign-in history, and 56,238 rows of it. A purchase is not a login.

     The signal has to be a table that is *about* signing in or about devices,
     or one carrying a user agent, which nothing else does. */
  const LOGIN_TABLE = /login|logon|sign[- ]?in|session|access log|device information|devices?$|security|push notification/i;
  const NOT_LOGIN = /purchase|transaction|billing|payment|order|subscription|refund|store /i;
  const COL_AGENT = /user agent|browser|client name/i;
  const COL_DEVICE = /device name|device type|device model|^model$|platform|os version|hardware/i;
  const COL_IP = /ip address|\bip\b/i;
  const COL_TIME = /time|date|last seen|when|created/i;
  /* An identifier is not a name. Apple writes a device as
     00008110-00090C800A6A401E, which told the reader nothing at all when it
     was printed in bold as though it were "iPhone 13 Pro". */
  const COL_ID = /\bid\b|uuid|guid|udid|serial|token|hash/i;

  function findLogins(lib) {
    const out = [];
    for (const t of lib.tables || []) {
      if (!(t.rows || []).length) continue;
      const name = String(t.name || "");
      if (NOT_LOGIN.test(name)) continue;
      const cols = t.columns || [];
      const has = (re) => cols.some((c) => re.test(String(c)) && !COL_ID.test(String(c)));
      const aboutLogins = LOGIN_TABLE.test(name);
      if (!(has(COL_AGENT) || (aboutLogins && (has(COL_IP) || has(COL_DEVICE))))) continue;
      if (!has(COL_TIME) && !has(COL_IP)) continue;
      out.push({ table: t });
    }
    return out;
  }

  function drawLogins(el, match) {
    const rows = match.reduce((n, m) => n + m.table.rows.length, 0);

    const EMPTY = /^(n\/?a|null|none|unknown|-|)$/i;
    const clean = (v) => { const s = String(v == null ? "" : v).trim(); return EMPTY.test(s) ? "" : s; };

    /* What a user agent is actually saying.
     *
     * Apple writes these for its own services and they are not meant to be
     * read: "com.apple.appstored/1.0 iOS/18.7.1 model/iPhone14,2 hwp/t8110
     * build/22H31 (6; dt:254) AMS/". Every part of that is decodable, and a
     * page of them unparsed is a page nobody can use - which is exactly the
     * complaint this is answering.
     *
     * The marketing name of a model is deliberately NOT guessed. iPhone14,2 is
     * an iPhone; saying which iPhone would mean shipping a lookup table and
     * being confidently wrong about somebody's own device. The identifier is
     * kept beside the family, so the reader can search it if they care. */
    const APPS = [
      [/com\.apple\.appstored|^AppStore\/|com\.apple\.storekitd/i, "App Store"],
      [/itunesstored/i, "iTunes Store"],
      [/com\.apple\.iCloudQuota|icloud/i, "iCloud"],
      [/com\.apple\.Preferences/i, "Settings"],
      [/com\.apple\.mobilesafari|safari/i, "Safari"],
      [/com\.apple\.news/i, "News"],
      [/com\.apple\.podcasts/i, "Podcasts"],
      [/com\.apple\.Music|musicd/i, "Music"],
      [/com\.apple\.tv/i, "TV"],
      [/chrome/i, "Chrome"],
      [/firefox/i, "Firefox"],
      [/edg[e/]/i, "Edge"],
    ];
    const FAMILY = [
      [/iPhone/i, "iPhone"], [/iPad/i, "iPad"], [/iPod/i, "iPod"],
      [/Watch/i, "Apple Watch"], [/Mac|iMac|MacBook/i, "Mac"],
      [/AppleTV/i, "Apple TV"], [/Android/i, "Android"],
      [/Windows/i, "Windows"], [/Linux/i, "Linux"],
    ];

    function readable(raw) {
      const s = String(raw || "");
      if (!s) return "";
      // Already English, and short enough to be somebody's device name.
      if (s.length < 40 && !/\/|;/.test(s)) return s;

      const app = (APPS.find((a) => a[0].test(s)) || [])[1] || "";
      const model = (/model\/([A-Za-z0-9,]+)/.exec(s) || [])[1] || "";
      const os = (/\b(iOS|iPadOS|macOS|watchOS|tvOS|Android)[ /]([0-9._]+)/i.exec(s) || []);
      const family = (FAMILY.find((f) => f[0].test(model || s)) || [])[1] || "";

      const bits = [];
      const where = family ? family + (model ? " (" + model + ")" : "") : model;
      // "App Store on iPhone", not "App Store, on iPhone".
      if (app && where) bits.push(app + " on " + where);
      else if (app) bits.push(app);
      else if (where) bits.push(where);
      if (os.length) bits.push(os[1] + " " + os[2]);
      // Nothing recognised: hand back the original rather than a worse version.
      return bits.length ? bits.join(", ") : s;
    }

    const panel = (m) => {
      const t = m.table;
      const cols = t.columns || [];
      /* Never an identifier column: those are what produced a page of
         00008110-00090C800A6A401E in bold. */
      const idx = (re) => cols.findIndex((c) => re.test(String(c)) && !COL_ID.test(String(c)));
      const wi = idx(COL_TIME);
      const ipi = idx(COL_IP);
      const ai = idx(COL_AGENT);
      const di = idx(COL_DEVICE);
      const li = idx(/city|country|location|region/i);

      const seen = new Set();
      const list = [];
      for (const r of t.rows) {
        const row = {
          when: wi >= 0 ? clean(r[wi]) : "",
          ip: ipi >= 0 ? clean(r[ipi]) : "",
          dev: (ai >= 0 ? clean(r[ai]) : "") || (di >= 0 ? clean(r[di]) : ""),
          where: li >= 0 ? clean(r[li]) : "",
        };
        // A row of N/A in every column is not a sign-in anybody can read.
        if (!row.dev && !row.ip && !row.where) continue;
        const key = row.dev + "|" + row.ip + "|" + row.where;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(row);
        if (list.length >= 200) break;
      }
      if (!list.length) return "";

      // "Apple Account and device information (1).zip: Apple ID Device
      // Information" is the archive talking, not the table.
      const title = String(t.name || "").replace(/^.*?\.zip:\s*/i, "");
      return '<article class="lg-card"><h3>' + esc(title) + "</h3>" +
        '<p class="muted small">' + plural(t.rows.length, "record", "records") +
          (list.length < t.rows.length ? ", " + num(list.length) + " worth showing" : "") +
        "</p>" +
        '<ul class="lg-list">' + list.slice(0, 40).map((x) => {
          const name = readable(x.dev) || x.where;
          /* The same value twice with a dot between it reads as a mistake,
             because it is one - a table with both "City" and "Location" filled
             in identically printed "NORDREFALE - NORDREFALE". */
          const rest = [...new Set([x.dev ? x.where : "", x.ip, x.when].filter(Boolean))];
          return "<li>" +
            (name ? "<b>" + esc(name.slice(0, 110)) + "</b>" : "") +
            '<span class="muted small">' + rest.map(esc).join(" &middot; ") + "</span>" +
            /* The original is one hover away, because a decoded string is an
               interpretation and the export said something exact. */
            (name && x.dev && readable(x.dev) !== x.dev
              ? '<span class="lg-raw" title="' + esc(x.dev) + '">as written</span>' : "") +
          "</li>";
        }).join("") + "</ul>" +
        (list.length > 40
          ? '<p class="muted small">' + num(list.length - 40) + " more under Records.</p>" : "") +
        "</article>";
    };

    el.innerHTML =
      unsupportedNote(match.map((m) => m.table)) +
      '<div class="tp-stats">' +
        '<div><b>' + num(rows) + "</b><span>recorded sign-ins and devices</span></div>" +
        '<div><b>' + num(match.length) + "</b><span>" +
          (match.length === 1 ? "table" : "tables") + "</span></div>" +
      "</div>" +
      '<p class="muted small">Every service keeps this. It is usually the part of an ' +
        "export people have not thought about.</p>" +
      '<div class="lg-grid">' + match.map(panel).join("") + "</div>";
  }

  /* ---------- the registry ---------- */

  /* `only` is the list of providers a topic can possibly apply to. An
     Instagram export cannot contain Samsung Health readings, so there is no
     reason to look - and more to the point, a topic that only ever makes sense
     for one provider is a statement about that provider that belongs written
     down rather than rediscovered from column names every time.
   *
   * A topic with no `only` is offered to everything, which is what keeps a
   * provider nobody has taught us about from getting nothing at all. */
  const TOPICS = [
    { key: "comments", label: "Comments", icon: "chat",
      sub: "Everything you wrote, with replies under what they answered.",
      only: null,
      find: findComments, draw: drawComments,
      count: (m) => m.reduce((n, x) => n + x.items.length, 0) },
    { key: "health", label: "Health", icon: "heart",
      sub: "What your devices recorded, and what they did not.",
      only: ["samsung", "apple", "google"],
      find: findHealth, draw: drawHealth,
      count: (m) => m.reduce((n, x) => n + x.table.rows.length, 0) },

    /* These four read the archive rather than the parsed tables, so they are
       marked `slow` - the view puts up a line saying it is reading before the
       decompression starts, instead of a blank panel for a second. */
    { key: "contacts", label: "Contacts", icon: "person",
      sub: "Everyone in your address book, as the export wrote them.",
      only: null, slow: true,
      find: findContacts, draw: drawContacts,
      count: (m) => m[0].files.length },
    { key: "calendar", label: "Calendar", icon: "calendar",
      sub: "Events and reminders, newest first.",
      only: null, slow: true,
      find: findCalendar, draw: drawCalendar,
      count: (m) => m[0].files.length },
    { key: "notes", label: "Notes", icon: "note",
      sub: "What you wrote down.",
      only: null, slow: true,
      find: findNotes, draw: drawNotes,
      count: (m) => m[0].files.length },
    { key: "activity", label: "Search and watch history", icon: "search",
      sub: "What you searched for, watched and opened, as Google recorded it.",
      only: ["google"], slow: true,
      find: findActivity, draw: drawActivity,
      count: (m) => m[0].files.length },
    { key: "mail", label: "Mail", icon: "mail",
      sub: "Who wrote to you and when. Headers only - the bodies stay in the archive.",
      only: null, slow: true,
      find: findMail, draw: drawMail,
      count: (m) => m[0].files.length },
    { key: "logins", label: "Logins and devices", icon: "shield",
      sub: "Where your account has been used from, and on what.",
      only: null,
      find: findLogins, draw: drawLogins,
      count: (m) => m.reduce((n, x) => n + x.table.rows.length, 0) },
    { key: "audio", label: "Audio", icon: "audio",
      sub: "Recordings in this export, playable here.",
      only: null, slow: true,
      find: findAudio, draw: drawAudio,
      count: (m) => m[0].files.length },
  ];

  /* Ruled out per table, for the same reason readers are chosen per table: the
     library is always the merged one. An Instagram export cannot hold Samsung
     Health readings, so the health finder never runs over its tables - but a
     library holding Instagram *and* Samsung still gets the Health tab. */
  const appliesTo = (topic, lib) => {
    if (!topic.only) return true;
    const slugs = new Set((lib.tables || []).map(slugOf));
    if (!slugs.size || (slugs.size === 1 && slugs.has(""))) return true;
    return topic.only.some((s) => slugs.has(s));
  };

  /* Which topics this library supports, with the matched data carried along so
     nothing has to be found twice. Called on every sidebar redraw, so it must
     stay cheap: the finders read column names and one pass of rows, never a
     decode. */
  /* `ctx` carries the entry list and the source archives, which the
     file-reading topics need and the table ones ignore. Both are already on
     the explorer's state; nothing new is computed for this. */
  function detect(lib, ctx) {
    const out = [];
    for (const t of TOPICS) {
      if (!appliesTo(t, lib)) continue;
      let m = null;
      try { m = t.find(lib, ctx); } catch (err) { m = null; }
      if (!m || !m.length) continue;
      let n = 0;
      try { n = REAL.has(t.key) ? REAL.get(t.key) : t.count(m); } catch (err) { n = 0; }
      if (!n) continue;
      out.push({ key: t.key, label: t.label, icon: t.icon, sub: t.sub, n, match: m, topic: t });
    }
    return out;
  }

  function draw(key, el, lib, ctx) {
    const t = TOPICS.find((x) => x.key === key);
    if (!t) return false;
    let m = null;
    try { m = t.find(lib, ctx); } catch (err) { m = null; }
    if (!m || !m.length) {
      el.innerHTML = '<div class="ex-empty"><h3>Nothing here right now</h3>' +
        '<p class="muted">Your filter hides everything of this kind.</p></div>';
      return true;
    }
    /* Said before the work starts rather than after, because unpacking a few
       hundred files out of an archive takes long enough to look like nothing
       happened. */
    if (t.slow) {
      el.innerHTML = '<p class="loading">Reading your ' + esc(t.label.toLowerCase()) +
        " out of the archive...</p>";
    }
    Promise.resolve()
      .then(() => t.draw(el, m, lib, ctx))
      .catch((err) => {
        // A view that fails says so; it does not sit on "Reading..." forever.
        if (!el.isConnected) return;
        el.innerHTML = '<div class="ex-empty"><h3>That did not read</h3>' +
          '<p class="muted">' + esc(String((err && err.message) || err)) + "</p></div>";
      });
    return true;
  }

  const has = (key) => TOPICS.some((t) => t.key === key);
  const reset = () => REAL.clear();

  /* Counting the file-shaped topics without waiting to be asked.
   *
   * The sidebar said Calendar 2 until you clicked it, and then said 7 - which
   * is a number correcting itself in front of you, and reads as a bug even
   * when it is not. Run once when the library opens instead, in the
   * background, so it is right before anybody looks.
   *
   * Cheap on purpose: these read the files but count without building any DOM,
   * and only the three whose unit is not files need it at all. */
  async function precount(lib, ctx) {
    const jobs = [
      ["calendar", findCalendar, async (m) => {
        const read = await readEach(ctx, m[0].files, 60, true);
        return read.reduce((n, r) => n + parseIcs(r.body).length, 0);
      }],
      ["activity", findActivity, async (m) => {
        let n = 0;
        for (const f of m[0].files) {
          if ((f.size || 0) > 20 * 1024 * 1024) continue;
          const s = sourceOf(ctx, f);
          if (!s || !s.file) continue;
          try {
            const product = (ACTIVITY_FILE.exec(f.name) || [])[1] || "Google";
            n += parseActivity(await MZip.extractText(s.file, f), product).length;
          } catch (err) { /* counted as none */ }
        }
        return n;
      }],
      ["mail", findMail, async (m) => {
        if (typeof MMbox === "undefined") return 0;
        const f = m[0].files[0];
        const s = sourceOf(ctx, f);
        if (!s || !s.file) return 0;
        const res = await MMbox.index(await MZip.streamEntry(s.file, f),
          { limit: 20000, bodyBytes: 0 });   // headers only: this is just a count
        return res.messages.length;
      }],
    ];
    for (const [key, find, count] of jobs) {
      try {
        const m = find(lib, ctx);
        if (m && m.length) setCount(key, await count(m));
      } catch (err) { /* leave the file count standing */ }
    }
  }

  return Object.assign(api, { detect, draw, has, reset, precount, TOPICS });
})();

if (typeof module !== "undefined" && module.exports) module.exports = MTopics;
