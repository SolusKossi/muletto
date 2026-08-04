/* Register the offline worker.
 *
 * Its own file rather than an inline script, because the Content-Security
 * Policy refuses inline scripts and check.js fails the build on them. That
 * rule exists because a privacy notice was written inline once and never
 * rendered in production, which nobody noticed for a while.
 *
 * Nothing here blocks anything. If registration fails - an old browser, a
 * private window, a host serving the file with the wrong type - the site
 * behaves exactly as it did before, minus the offline reload.
 */

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Deliberately silent. A missing offline cache is not something to put
         in front of a reader, and the console already says why. */
    });
  });
}
