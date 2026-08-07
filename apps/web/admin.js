"use strict";

/* The usage page.
 *
 * Everything shown here is a count. There is no visitor to click into, no
 * session to replay and no individual to look at, because none of that was
 * ever recorded - so this is bar charts and lists, and that is the whole of
 * it. If it ever grows a "who" column, something has gone wrong upstream.
 *
 * The token lives in sessionStorage and dies with the tab. That is the one
 * place on this site anything is stored, it is on the operator's own machine,
 * and it holds no password - only a signature the server made over an expiry
 * time.
 */

(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => (n || 0).toLocaleString();

  const KEY = "muletto:usage-token";
  const dash = $("#dash"), gate = $("#gate"), err = $("#err");
  let days = 60;

  function fail(msg) {
    err.hidden = false;
    err.textContent = msg;
  }

  async function load(body) {
    const res = await fetch("/api/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ days }, body)),
    });
    let data = null;
    try { data = await res.json(); } catch { /* below */ }
    if (!res.ok || !data) {
      throw new Error((data && data.error) || ("The server answered " + res.status + "."));
    }
    if (data.token) { try { sessionStorage.setItem(KEY, data.token); } catch { /* fine */ } }
    return data;
  }

  /* A day-by-day bar chart, drawn as bars rather than as a canvas so it needs
     no library and prints. */
  function chart(list) {
    const max = Math.max(1, ...list.map((d) => d.views));
    const recent = list.slice().reverse();
    return '<div class="adm-chart">' + recent.map((d) => {
      const h = Math.round((d.views / max) * 100);
      return '<span class="adm-bar" style="height:' + Math.max(h, d.views ? 2 : 0) + '%" ' +
        'title="' + esc(d.day) + ": " + num(d.views) + ' views"></span>';
    }).join("") + "</div>" +
      '<div class="adm-chart-x"><span>' + esc(recent[0] ? recent[0].day : "") +
      "</span><span>" + esc(recent[recent.length - 1] ? recent[recent.length - 1].day : "") +
      "</span></div>";
  }

  function table(title, rows, note) {
    if (!rows || !rows.length) {
      return '<section class="adm-card"><h2>' + esc(title) + "</h2>" +
        '<p class="muted small">Nothing yet.</p></section>';
    }
    const top = Math.max(1, ...rows.map((r) => r.n));
    return '<section class="adm-card"><h2>' + esc(title) + "</h2>" +
      (note ? '<p class="muted small">' + esc(note) + "</p>" : "") +
      '<ol class="adm-list">' + rows.map((r) =>
        '<li><span class="adm-k">' + esc(r.name) + "</span>" +
        '<span class="adm-track"><span style="width:' +
          Math.round((r.n / top) * 100) + '%"></span></span>' +
        '<span class="adm-n">' + num(r.n) + "</span></li>").join("") +
      "</ol></section>";
  }

  function draw(d) {
    gate.hidden = true;
    dash.hidden = false;

    if (d.configured === false) {
      const found = d.found || [];
      dash.innerHTML = '<div class="adm-note"><strong>Signed in, but nothing is being counted.</strong>' +
        "<p>No counter store is attached to this deployment, so the site is working exactly as it " +
        "always has and recording nothing.</p>" +
        "<p>In Vercel: <strong>Storage</strong>, then <strong>Upstash</strong>, then " +
        "<strong>Redis</strong>. Connect it to this project and redeploy. Upstash is the one that " +
        "speaks over HTTP, which is what a function here can reach without pulling in a client " +
        "library - the plain Redis option cannot be used this way.</p>" +
        "<p>The endpoint accepts either naming: <code>KV_REST_API_URL</code> and " +
        "<code>KV_REST_API_TOKEN</code>, or <code>UPSTASH_REDIS_REST_URL</code> and " +
        "<code>UPSTASH_REDIS_REST_TOKEN</code>. " +
        (found.length
          ? "Found so far: <code>" + found.map(esc).join("</code>, <code>") +
            "</code> - so one of the pair is missing."
          : "Neither pair is set on this deployment yet.") +
        "</p></div>";
      return;
    }

    const list = d.days || [];
    const last7 = list.slice(0, 7).reduce((a, x) => a + x.views, 0);
    const prev7 = list.slice(7, 14).reduce((a, x) => a + x.views, 0);
    const change = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null;

    dash.innerHTML =
      '<div class="adm-range">' +
        [30, 60, 120, 365].map((n) =>
          '<button class="adm-r' + (n === days ? " on" : "") + '" data-d="' + n + '">' +
          n + " days</button>").join("") +
      "</div>" +

      '<div class="tp-stats">' +
        "<div><b>" + num(d.total) + "</b><span>views in " + days + " days</span></div>" +
        "<div><b>" + num(last7) + "</b><span>in the last seven</span></div>" +
        (change === null ? "" :
          "<div><b>" + (change > 0 ? "+" : "") + change + "%</b><span>against the seven before</span></div>") +
      "</div>" +

      '<section class="adm-card"><h2>Views per day</h2>' + chart(list) + "</section>" +

      '<div class="adm-grid">' +
        table("Pages", d.pages) +
        table("Where people came from", d.referrers,
          "The site, never the page - a referring URL can carry a search query.") +
        table("Countries", d.countries,
          "Worked out at the edge from the connection, not stored against anything.") +
        table("Browsers", d.browsers, "A family, not a version string.") +
        table("Screens", d.devices) +
      "</div>" +

      '<div class="adm-note"><strong>What is deliberately not here.</strong>' +
      "<p>There are no visitors, sessions or return visits, because no identifier is " +
      "recorded - not an address, not a hash of one, not a rotating salted hash of one. " +
      "Nothing is recorded from the page where an export is open, so none of this says " +
      "anything about how the app itself is used. Both are choices, and both cost " +
      "information that most sites keep.</p></div>";

    dash.querySelectorAll(".adm-r").forEach((b) => b.addEventListener("click", async () => {
      days = Number(b.dataset.d);
      try {
        draw(await load({ token: sessionStorage.getItem(KEY) }));
      } catch (e) { fail(e.message); }
    }));
  }

  gate.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = $("#go");
    btn.disabled = true;
    btn.textContent = "Checking...";
    try {
      draw(await load({ password: $("#pw").value }));
      $("#pw").value = "";
    } catch (ex) {
      fail(ex.message);
    }
    btn.disabled = false;
    btn.textContent = "Show me";
  });

  /* Already signed in this tab? Then skip straight past the gate. */
  let saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved) {
    load({ token: saved })
      .then(draw)
      .catch(() => { try { sessionStorage.removeItem(KEY); } catch { /* fine */ } });
  }
})();
