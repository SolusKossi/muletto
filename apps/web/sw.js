/* Muletto offline.
 *
 * The page above the drop zone tells people to turn their internet off and
 * watch the thing still work. That was true right up until they reloaded, at
 * which point the browser had nothing to load and the boldest claim on the
 * site became a broken tab. This makes the dare literally true.
 *
 * Two strategies, and the split matters:
 *
 *   Stamped assets - app.js?v=1a2b3c4d and friends. The build gives every
 *   script and stylesheet a name derived from its own bytes, so a URL that
 *   exists can never be stale. Those are served from the cache first and never
 *   revalidated. That is not a heuristic, it is a consequence of the naming.
 *
 *   Pages - the HTML that references those assets. Served from the network
 *   first, because the HTML is the only thing that knows which stamp is
 *   current. A cached copy is the fallback, so a reload with no connection
 *   still opens.
 *
 * Nothing here uploads, caches, or transmits anything a reader opened. The
 * cache holds the application - the same handful of files anyone downloads by
 * visiting - and never touches an export. Exports live in IndexedDB and on
 * disk, and this file cannot see either.
 *
 * PRECACHE is written by tools/build-site.js. Do not edit it by hand; it is
 * regenerated from the files that actually exist, with the stamps that were
 * actually applied.
 */

/* BUILD:PRECACHE */
const VERSION = "e7c1bd8dd1ca";
const PRECACHE = [
  "/app.html",
  "/styles.css?v=ae53d634",
  "/notify.js?v=f2cf1cf3",
  "/tips.js?v=0bdfdea4",
  "/jobs.js?v=3f996b9f",
  "/store.js?v=a83aa2c4",
  "/derived.js?v=b52d2219",
  "/credits.js?v=54539768",
  "/donate.js?v=e8f71043",
  "/plan.js?v=559498fc",
  "/planui.js?v=d3e286bf",
  "/caption.js?v=5d10cb7e",
  "/captionui.js?v=fc9b3409",
  "/zipcrypt.js?v=8e2f0449",
  "/zip.js?v=08665d7b",
  "/tar.js?v=535cfda4",
  "/zipout.js?v=5c9c3222",
  "/exif.js?v=7b45a4ab",
  "/heif.js?v=d0ffffd5",
  "/video.js?v=a66813af",
  "/mbox.js?v=ee10197f",
  "/diagnose.js?v=d97b3ff8",
  "/contribute.js?v=c3b34297",
  "/mojibake.js?v=38849a41",
  "/parsers.js?v=8cf7ab45",
  "/catalog.js?v=d7b44ec6",
  "/insights.js?v=362a2b0d",
  "/basemap.js?v=cbb6dfca",
  "/rail.js?v=b4bc5944",
  "/topics.js?v=168c5820",
  "/views.js?v=8afcc6f8",
  "/export.js?v=bad236d2",
  "/explorer.js?v=9dcb12aa",
  "/app.js?v=3e692344",
  "/swreg.js?v=266bec3b",
  "/fonts/host-grotesk-var-italic.woff2",
  "/fonts/host-grotesk-var.woff2"
];
/* END:PRECACHE */

const SHELL = "muletto-shell-" + VERSION;

self.addEventListener("install", (e) => {
  /* addAll fails the whole install if any single request fails, which is the
     behaviour we want - a half-populated cache would be worse than none, and
     the old one keeps working until this succeeds. */
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("muletto-shell-") && k !== SHELL)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isStamped = (url) => /[?&]v=[a-f0-9]{8}/.test(url.search);
const isPage = (req) => req.mode === "navigate" ||
  (req.headers.get("accept") || "").includes("text/html");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only our own origin. Anything else is none of this worker's business, and
  // the Content-Security-Policy blocks almost all of it anyway.
  if (url.origin !== self.location.origin) return;

  if (isPage(req)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Keep the newest good copy, so the next offline reload is current.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req)
          .then((hit) => hit || caches.match("/app.html") || Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        /* A stamped URL is safe to keep forever - its name is its content. An
           unstamped one might change under the same name, so it is fetched and
           passed through without being kept.

           The sample archives are the exception. They are nine megabytes,
           which is far too much to push at everyone who visits, so they are
           kept once somebody has actually asked for them - which means the
           demo survives the reader following the instruction on the page and
           pulling their connection. They are dropped along with everything
           else whenever the shell version changes. */
        const keepable = isStamped(url) || /^\/samples\//.test(url.pathname);
        if (res && res.ok && keepable) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
