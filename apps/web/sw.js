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
const VERSION = "78b613ee2500";
const PRECACHE = [
  "/app.html",
  "/styles.css?v=3bc8d730",
  "/theme.js?v=4f9137e0",
  "/i18n.js?v=8afe7f05",
  "/notify.js?v=ccb12e06",
  "/tips.js?v=81b58909",
  "/jobs.js?v=3f996b9f",
  "/store.js?v=b6b017cd",
  "/derived.js?v=d453f887",
  "/donate.js?v=8630cb34",
  "/zipcrypt.js?v=b750388c",
  "/zip.js?v=916f9640",
  "/tar.js?v=535cfda4",
  "/zipout.js?v=5c9c3222",
  "/overlay.js?v=aaede613",
  "/exif.js?v=7b45a4ab",
  "/heif.js?v=d0ffffd5",
  "/video.js?v=a66813af",
  "/applehealth.js?v=abef83f7",
  "/mbox.js?v=ee10197f",
  "/diagnose.js?v=09c9e7d9",
  "/contribute.js?v=b6b1f9d8",
  "/mojibake.js?v=38849a41",
  "/parsers.js?v=b581820f",
  "/catalog.js?v=fff59e8e",
  "/insights.js?v=512309af",
  "/basemap.js?v=cbb6dfca",
  "/rail.js?v=cc8b780d",
  "/charts.js?v=7fb297cd",
  "/topics.js?v=81227c70",
  "/views.js?v=6c726b19",
  "/export.js?v=e243a521",
  "/explorer.js?v=c6d32b37",
  "/disclose.js?v=b24e640b",
  "/app.js?v=53e90f96",
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
