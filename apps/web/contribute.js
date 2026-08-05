/* Offer to report an export that was read badly.
 *
 * The reconciliation already knows when a lot of an archive produced nothing.
 * That is exactly the moment a report is worth having and exactly the moment
 * somebody has the evidence in front of them, so it is the moment to ask.
 *
 * Three rules, and they are the whole design:
 *
 *   Ask rarely. A tenth of an archive going unread is normal - exports carry
 *   index pages, thumbnails and field documentation. The threshold is set well
 *   above what a healthy export looks like, so being asked means something.
 *
 *   Ask once. Declining is remembered per library. Nobody is asked twice about
 *   the same files, and nobody is asked again after they have said no.
 *
 *   Ask for nothing. The report is structure only, it opens on screen first,
 *   and the reader decides whether to send it after reading it. If they close
 *   the box, that is the end of it.
 *
 * Nothing here uploads anything. It fills in a GitHub issue form and opens it
 * in a new tab, which is a link, not a transmission - the reader still has to
 * paste the report and press submit themselves.
 */

const MContribute = (function () {
  const REPO = "https://github.com/SolusKossi/muletto";
  const SEEN_KEY = "muletto:contribute-asked";

  /* This file had no escaper, because until now nothing outside it reached the
     markup. The provider name does, and it comes from a file name. */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* A quarter of an archive producing nothing is well past anything a healthy
     export does, and 40 files stops it firing on a tiny one where a couple of
     unread PDFs are a large fraction of very little. */
  const SHARE = 0.25;
  const FLOOR = 40;

  const asked = () => {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); }
    catch (e) { return []; }
  };
  const remember = (key) => {
    try {
      const all = asked();
      if (all.indexOf(key) < 0) all.push(key);
      localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-40)));
    } catch (e) { /* private browsing - then it asks again next time */ }
  };

  /* What is worth mentioning, phrased as a person would say it rather than as
     a dump of counters. */
  function summarise(reports) {
    const worst = [];
    let total = 0, unread = 0, nested = 0, orphans = 0;
    for (const r of reports || []) {
      const rec = r && r.reconciled;
      if (!rec) continue;
      total += rec.total || 0;
      unread += rec.unread || 0;
      nested += rec.nested || 0;
      orphans += rec.orphanSidecars || 0;
      for (const [area, n] of (rec.byArea || []).slice(0, 3)) worst.push([area, n]);
    }
    worst.sort((a, b) => b[1] - a[1]);
    return { total, unread, nested, orphans, worst: worst.slice(0, 5) };
  }

  function shouldAsk(reports, libraryKey) {
    if (!reports || !reports.length) return false;
    if (asked().indexOf(libraryKey) >= 0) return false;
    const s = summarise(reports);
    if (s.unread < FLOOR) return false;
    return s.unread / Math.max(1, s.total) >= SHARE;
  }

  /* The issue body, written for somebody who has never opened this repository.
     The report goes in a fenced block they paste into, rather than being
     attached for them, because a file they have not looked at is not a file
     they have agreed to share. */
  function issueBody(s, providers) {
    const L = [];
    L.push("## What happened");
    L.push("");
    L.push("Muletto read " + (s.total - s.unread).toLocaleString() + " of " +
      s.total.toLocaleString() + " files in this export. " +
      s.unread.toLocaleString() + " produced nothing.");
    L.push("");
    if (providers.length) L.push("Service: " + providers.join(", "));
    if (s.worst.length) {
      L.push("");
      L.push("Most of what was not read:");
      L.push("");
      for (const [area, n] of s.worst) L.push("- " + area + ": " + n);
    }
    if (s.nested) {
      L.push("");
      L.push(s.nested + " archive(s) nested inside this one were not opened.");
    }
    if (s.orphans) {
      L.push("");
      L.push(s.orphans + " metadata file(s) named a photo that is not in the library.");
    }
    L.push("");
    L.push("## What I expected");
    L.push("");
    L.push("<!-- Was something missing that you know is in there? -->");
    L.push("");
    L.push("## Structure report");
    L.push("");
    L.push("<!-- Folder names, file types, column headers and row counts. No values.");
    L.push("     Download it from What is in here, read it, then paste it below. -->");
    L.push("");
    L.push("```json");
    L.push("");
    L.push("```");
    L.push("");
    L.push("## Browser");
    L.push("");
    L.push(navigator.userAgent);
    return L.join("\n");
  }

  function open(reports, providers, libraryKey, opts) {
    const s = summarise(reports);
    remember(libraryKey);
    /* The same dialog is reached two ways and they are not the same message.
       Opened by the reconciliation, it reports a count. Opened by somebody
       clicking "help us support this", there is no count to report - and
       saying "0 of 0 files produced nothing" at them was nonsense. */
    const manual = !!(opts && opts.manual);
    const who = providers[0] || "this service";

    const title = manual
      ? "[" + who + "] Please support this export"
      : "[" + (providers[0] || "export") + "] " +
        s.unread.toLocaleString() + " of " + s.total.toLocaleString() + " files not read";
    const url = REPO + "/issues/new?labels=export&title=" +
      encodeURIComponent(title) + "&body=" + encodeURIComponent(issueBody(s, providers));

    const el = document.createElement("div");
    el.id = "cbx";
    el.innerHTML =
      '<div class="xw-scrim"></div>' +
      '<div class="xw" role="dialog" aria-modal="true" aria-labelledby="cb-t">' +
        '<header class="xw-head"><div>' +
          '<h2 id="cb-t">' + (manual
            ? "Help us read this export properly"
            : "Some of this export was not read") + "</h2>" +
          '<p class="muted small">' + (manual
            ? "Muletto has no reader written for " + esc(who) + " yet, so it is showing " +
              "the contents as the export wrote them. Telling us what this format looks " +
              "like is what turns that into proper support."
            : s.unread.toLocaleString() + " of " +
              s.total.toLocaleString() + " files produced nothing. That is not always " +
              "wrong, but it is more than usual, and it probably means Muletto does not " +
              "understand part of what " + who + " sent you.") +
          "</p></div></header>" +
        '<div class="xw-body">' +
          "<p>If you want to help, the fastest thing is to open an issue. It takes a " +
            "minute and you do not have to send your data:</p>" +
          '<ul class="cb-list">' +
            "<li>The button below opens a pre-filled issue on GitHub.</li>" +
            "<li>Paste in the structure report, which lists folder names, file types and " +
              "column headers with <strong>no values</strong> in it.</li>" +
            "<li>Read it first. If there is anything in it you would rather not share, " +
              "describe the problem in words instead.</li>" +
          "</ul>" +
          '<p class="muted small">Nothing is sent from this page. The button opens a ' +
            "form, and you decide what goes in it.</p>" +
        "</div>" +
        '<footer class="xw-foot">' +
          '<button class="btn ghost" id="cb-no">No thanks</button>' +
          '<div class="xw-footl">' +
            '<button class="btn secondary" id="cb-report">Get the report</button>' +
            '<a class="btn primary" id="cb-go" href="' + url + '" target="_blank" ' +
              'rel="noopener noreferrer">Open an issue</a>' +
          "</div>" +
        "</footer>" +
      "</div>";
    document.body.appendChild(el);

    const close = () => el.remove();
    el.querySelector("#cb-no").addEventListener("click", close);
    el.querySelector(".xw-scrim").addEventListener("click", close);
    el.querySelector("#cb-go").addEventListener("click", () => setTimeout(close, 100));
    el.querySelector("#cb-report").addEventListener("click", () => {
      close();
      if (typeof MExplorer !== "undefined") MExplorer.showView("report");
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  }

  /* Called once, after the reconciliation has finished. Silent unless the
     numbers say otherwise. */
  function maybeOffer(reports, providers, libraryKey) {
    if (!shouldAsk(reports, libraryKey)) return false;
    open(reports, providers, libraryKey);
    return true;
  }

  /* The same dialog, opened because somebody asked for it rather than because
     the numbers tripped a threshold. A view that admits it is guessing has to
     offer a way to fix that in the same breath, or it is just an apology. */
  function openOffer(reports, providers, libraryKey) {
    open(reports || [], providers || [], libraryKey || "manual", { manual: true });
  }

  return { maybeOffer, openOffer, shouldAsk, summarise, issueBody };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MContribute;
