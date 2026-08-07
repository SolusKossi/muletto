"use strict";

/* One beacon, from the pages that are not the app.
 *
 * This is deliberately the smallest thing that answers "is anybody reading
 * the guides". It sends a path, the site somebody arrived from, and whether
 * the screen is a phone. It reads nothing. It stores nothing - no cookie, no
 * localStorage, no identifier of any kind - which is why there is no consent
 * banner on this site: a banner exists to ask permission to put something on
 * your device, and there is nothing to ask about.
 *
 * It is not loaded on app.html, and that is not an oversight. The page where
 * somebody's export is open makes no requests at all, so "open the Network
 * tab and watch" remains a clean demonstration rather than one with a
 * footnote. The cost of that choice is that we know nothing about how the app
 * is used, which is the correct trade for this product.
 *
 * Honours Do Not Track and Global Privacy Control even though neither is
 * legally required of a site that stores nothing.
 */

(function () {
  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" ||
        navigator.globalPrivacyControl === true) return;

    /* Never from the app, whatever anybody wires up later. */
    const path = location.pathname;
    if (/app\.html$/.test(path) || /admin\.html$/.test(path)) return;

    const body = JSON.stringify({
      p: path,
      /* The site, not the page. The full referring URL can carry a search
         query, and a search query can carry anything. The server reduces this
         to a hostname and throws the rest away, but there is no reason to
         send more than is going to be kept. */
      r: document.referrer ? new URL(document.referrer).origin : "",
      m: window.matchMedia && window.matchMedia("(max-width: 760px)").matches,
    });

    /* sendBeacon survives the page being closed and cannot delay it. The
       fetch is for browsers that lack it; keepalive does the same job. */
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/hit", {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(function () { /* a lost count is not worth a console error */ });
    }
  } catch (e) { /* counting must never be able to break a page */ }
})();
