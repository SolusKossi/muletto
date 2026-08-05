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
  function unsupportedNote(tables) {
    const unknown = [...new Set(tables.filter((t) => !PROVIDERS[slugOf(t)])
      .map((t) => t.srcLabel || slugOf(t) || "this export"))];
    if (!unknown.length) return "";
    return '<div class="tp-warn">' +
      "<b>" + esc(unknown.join(", ")) + " is not a provider Muletto reads in a tailored way yet.</b>" +
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
  function findHealth(lib) {
    const kinds = (typeof MCatalog !== "undefined" && MCatalog.HEALTH) || [];
    const out = [];
    for (const t of lib.tables || []) {
      if (!(t.rows || []).length) continue;
      const hay = String(t.name || "") + " " + (t.columns || []).join(" ");
      const kind = kinds.find((k) => k.match.test(hay));
      if (!kind) continue;
      out.push({ kind, table: t });
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
      (missing.length
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
        '<li class="au"><div class="au-name">' + esc(f.name.split("/").pop()) + "</div>" +
        '<div class="muted small">' + esc(bytesText(f.size || 0)) + "</div>" +
        '<button type="button" class="btn ghost sm au-play" data-i="' + i + '">Play</button>' +
        '<span class="au-slot"></span></li>').join("") + "</ol>" +
      (files.length > 400
        ? '<p class="muted small">Showing the first 400 of ' + num(files.length) + ".</p>" : "");

    /* One listener for the list, and the blob is made only when something is
       actually played - decoding 319 files to draw a page would be absurd. */
    el.addEventListener("click", async (ev) => {
      const b = ev.target.closest && ev.target.closest(".au-play");
      if (!b) return;
      const f = files[Number(b.dataset.i)];
      const s = sourceOf(ctx, f);
      if (!f || !s) return;
      b.disabled = true;
      b.textContent = "Loading";
      try {
        const blob = await MZip.extractBlob(s.file, f, mimeOfAudio(f.name));
        const url = URL.createObjectURL(blob);
        const slot = b.parentElement.querySelector(".au-slot");
        slot.innerHTML = '<audio controls preload="none" src="' + url + '"></audio>';
        b.remove();
      } catch (err) {
        b.disabled = false;
        b.textContent = "Would not play";
      }
    });
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
      '<ol class="ml-list">' + dated.slice(0, 300).map((m) =>
        "<li><div class='ml-when'>" + esc(shortDate(m.at)) + "</div>" +
        "<div><b>" + esc(m.subject || "(no subject)") + "</b>" +
        '<span class="muted small">' + esc((m.from && m.from.name) || "") + "</span></div></li>").join("") +
      "</ol>";
  }

  /* ---------- logins and devices ----------
   *
   * Every provider ships this and nobody looks at it, which is exactly why it
   * is worth a screen: it is the part of an export that makes somebody say
   * "it knows what?" Recognised by shape, because five providers describe the
   * same thing five ways.
   */
  const LOGIN_TABLE = /login|sign[- ]?in|session|device|access log|security|ip address/i;
  const LOGIN_COLUMN = /ip address|user agent|device|browser|platform|login time|sign[- ]?in|last seen|city|country|os version/i;

  function findLogins(lib) {
    const out = [];
    for (const t of lib.tables || []) {
      if (!(t.rows || []).length) continue;
      const cols = (t.columns || []).join(" ");
      const hits = (t.columns || []).filter((c) => LOGIN_COLUMN.test(String(c))).length;
      // Two matching columns, or a name that says it outright plus one.
      if (hits >= 2 || (LOGIN_TABLE.test(String(t.name || "")) && hits >= 1)) {
        out.push({ table: t, cols });
      }
    }
    return out;
  }

  function drawLogins(el, match) {
    const rows = match.reduce((n, m) => n + m.table.rows.length, 0);

    const panel = (m) => {
      const t = m.table;
      const idx = (re) => (t.columns || []).findIndex((c) => re.test(String(c)));
      const wi = idx(/login time|sign[- ]?in|last seen|date|time/i);
      const ipi = idx(/ip address/i);
      const di = idx(/device|user agent|browser|platform|model/i);
      const li = idx(/city|country|location|region/i);
      const seen = new Set();
      const list = [];
      for (const r of t.rows) {
        const key = [r[ipi], r[di], r[li]].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ when: wi >= 0 ? String(r[wi] || "") : "",
                    ip: ipi >= 0 ? String(r[ipi] || "") : "",
                    dev: di >= 0 ? String(r[di] || "") : "",
                    where: li >= 0 ? String(r[li] || "") : "" });
        if (list.length >= 200) break;
      }
      return '<article class="lg-card"><h3>' + esc(t.name) + "</h3>" +
        '<p class="muted small">' + plural(t.rows.length, "record", "records") +
          (list.length < t.rows.length ? ", " + num(list.length) + " distinct" : "") +
        (t.srcLabel ? " &middot; " + esc(t.srcLabel) : "") + "</p>" +
        '<ul class="lg-list">' + list.slice(0, 40).map((x) =>
          "<li>" +
          (x.dev ? "<b>" + esc(x.dev.slice(0, 80)) + "</b>" : "") +
          '<span class="muted small">' +
            [x.where, x.ip, x.when].filter(Boolean).map(esc).join(" &middot; ") +
          "</span></li>").join("") + "</ul>" +
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
    { key: "health", label: "Health", icon: "chart",
      sub: "What your devices recorded, and what they did not.",
      only: ["samsung", "apple", "google"],
      find: findHealth, draw: drawHealth,
      count: (m) => m.reduce((n, x) => n + x.table.rows.length, 0) },

    /* These four read the archive rather than the parsed tables, so they are
       marked `slow` - the view puts up a line saying it is reading before the
       decompression starts, instead of a blank panel for a second. */
    { key: "contacts", label: "Contacts", icon: "chat",
      sub: "Everyone in your address book, as the export wrote them.",
      only: null, slow: true,
      find: findContacts, draw: drawContacts,
      count: (m) => m[0].files.length },
    { key: "calendar", label: "Calendar", icon: "clock",
      sub: "Events and reminders, newest first.",
      only: null, slow: true,
      find: findCalendar, draw: drawCalendar,
      count: (m) => m[0].files.length },
    { key: "notes", label: "Notes", icon: "table",
      sub: "What you wrote down.",
      only: null, slow: true,
      find: findNotes, draw: drawNotes,
      count: (m) => m[0].files.length },
    { key: "activity", label: "Search and watch history", icon: "clock",
      sub: "What you searched for, watched and opened, as Google recorded it.",
      only: ["google"], slow: true,
      find: findActivity, draw: drawActivity,
      count: (m) => m[0].files.length },
    { key: "mail", label: "Mail", icon: "chat",
      sub: "Who wrote to you and when. Headers only - the bodies stay in the archive.",
      only: null, slow: true,
      find: findMail, draw: drawMail,
      count: (m) => m[0].files.length },
    { key: "logins", label: "Logins and devices", icon: "pin",
      sub: "Where your account has been used from, and on what.",
      only: null,
      find: findLogins, draw: drawLogins,
      count: (m) => m.reduce((n, x) => n + x.table.rows.length, 0) },
    { key: "audio", label: "Audio", icon: "chat",
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
      try { n = t.count(m); } catch (err) { n = 0; }
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

  return { detect, draw, has, TOPICS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MTopics;
