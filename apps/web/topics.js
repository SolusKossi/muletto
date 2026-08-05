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
  function detect(lib) {
    const out = [];
    for (const t of TOPICS) {
      if (!appliesTo(t, lib)) continue;
      let m = null;
      try { m = t.find(lib); } catch (err) { m = null; }
      if (!m || !m.length) continue;
      const n = t.count(m);
      if (!n) continue;
      out.push({ key: t.key, label: t.label, icon: t.icon, sub: t.sub, n, match: m, topic: t });
    }
    return out;
  }

  function draw(key, el, lib) {
    const t = TOPICS.find((x) => x.key === key);
    if (!t) return false;
    const m = t.find(lib);
    if (!m || !m.length) {
      el.innerHTML = '<div class="ex-empty"><h3>Nothing here right now</h3>' +
        '<p class="muted">Your filter hides everything of this kind.</p></div>';
      return true;
    }
    t.draw(el, m, lib);
    return true;
  }

  const has = (key) => TOPICS.some((t) => t.key === key);

  return { detect, draw, has, TOPICS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MTopics;
