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

  function asDate(v) {
    if (v == null || v === "") return null;
    const d = new Date(String(v));
    return isNaN(d) ? null : d;
  }
  const shortDate = (d) => d.toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });

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
      const ti = colIndex(t, COMMENT_TEXT);
      if (ti < 0 || !(t.rows || []).length) continue;
      const di = colIndex(t, COMMENT_TIME);
      const pi = colIndex(t, COMMENT_PARENT);
      const vi = colIndex(t, COMMENT_VIDEO);
      const idi = (t.columns || []).findIndex((c) => /^comment id$/i.test(String(c)));
      const items = [];
      for (const r of t.rows) {
        const text = String(r[ti] == null ? "" : r[ti]).trim();
        if (!text) continue;
        items.push({
          id: idi >= 0 ? String(r[idi] || "") : "",
          text,
          at: di >= 0 ? asDate(r[di]) : null,
          parent: pi >= 0 ? String(r[pi] || "").trim() : "",
          video: vi >= 0 ? String(r[vi] || "").trim() : "",
        });
      }
      if (items.length) found.push({ table: t, items });
    }
    return found;
  }

  function drawComments(el, match) {
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
        '<div class="cmt-body">' + esc(c.text) + "</div>" +
        '<div class="cmt-meta">' +
          (c.at ? "<time>" + esc(shortDate(c.at)) + "</time>" : "") +
          (YT_ID.test(c.video)
            ? ' <a href="https://www.youtube.com/watch?v=' + encodeURIComponent(c.video) +
              '" target="_blank" rel="noopener noreferrer nofollow">the video</a>' : "") +
          (reply.length ? " <em>" + plural(reply.length, "reply", "replies") + "</em>" : "") +
        "</div>" +
        (reply.length ? '<ol class="cmt-kids">' + reply.map((k) => one(k, depth + 1)).join("") + "</ol>" : "") +
        "</li>";
    };

    const PAGE = 200;
    const shown = roots.slice(0, PAGE);

    el.innerHTML =
      '<div class="tp-stats">' +
        '<div><b>' + num(all.length) + "</b><span>comments</span></div>" +
        (videos ? '<div><b>' + num(videos) + "</b><span>videos commented on</span></div>" : "") +
        (from ? '<div><b>' + esc(shortDate(from)) + " to " + esc(shortDate(to)) +
                "</b><span>from first to last</span></div>" : "") +
      "</div>" +
      (orphans
        ? '<p class="muted small">' + plural(orphans, "reply is", "replies are") +
          " shown on its own because the comment it answered is not in this export." +
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

  const TOPICS = [
    { key: "comments", label: "Comments", icon: "chat",
      sub: "Everything you wrote, with replies under what they answered.",
      find: findComments, draw: drawComments,
      count: (m) => m.reduce((n, x) => n + x.items.length, 0) },
    { key: "health", label: "Health", icon: "chart",
      sub: "What your devices recorded, and what they did not.",
      find: findHealth, draw: drawHealth,
      count: (m) => m.reduce((n, x) => n + x.table.rows.length, 0) },
  ];

  /* Which topics this library supports, with the matched data carried along so
     nothing has to be found twice. Called on every sidebar redraw, so it must
     stay cheap: the finders read column names and one pass of rows, never a
     decode. */
  function detect(lib) {
    const out = [];
    for (const t of TOPICS) {
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
    t.draw(el, m);
    return true;
  }

  const has = (key) => TOPICS.some((t) => t.key === key);

  return { detect, draw, has, TOPICS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MTopics;
