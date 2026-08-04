"use strict";

/* The standing note that files never leave the device.

   This lives in its own file rather than inline in the page, and that is not a
   style preference. The site is served with script-src 'self', which blocks
   inline scripts outright - so an inline version ran perfectly on the dev
   server, which sends no CSP, and was silently refused in production. The
   notice simply never appeared on the real site, with nothing in the page to
   suggest why.

   The markup starts hidden so that somebody who dismissed it months ago never
   sees it flash on the way in. That means this script failing is not a
   cosmetic loss - it is the difference between the notice existing and not.

   localStorage can be unavailable in a private window or with storage blocked.
   Showing the notice is the right way to fail: the worst case is that someone
   reads it twice. */
(function () {
  var el = document.getElementById("g-vow");
  if (!el) return;

  var KEY = "muletto:vow-dismissed";
  var done = null;
  try { done = localStorage.getItem(KEY); } catch (e) { done = null; }
  if (done) return;

  el.hidden = false;
  var close = document.getElementById("g-vow-x");
  if (!close) return;
  close.addEventListener("click", function () {
    el.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch (e) { /* it will come back */ }
  });
})();
