"use strict";

/* Muletto - making every disclosure open and shut rather than blink.
 *
 * A native <details> has no in-between state: it is shut, and then it is a
 * different page height. On a list of sixty questions that reads as the page
 * jumping under your hand, and on the guides - where the answer you opened is
 * often below the fold - it is genuinely disorienting, because nothing tells
 * your eye that the thing that moved is the thing you clicked.
 *
 * This animates the height of the <details> itself. That is the whole reason
 * it is done this way rather than by wrapping the contents in a scratch div,
 * which is the usual recipe: the stylesheet is full of rules like
 * `.faq-q > p` and `.src-co > ul`, and a wrapper would quietly break every one
 * of them. Nothing here changes the markup, so a page with this script off
 * behaves exactly as it did before - it just moves instantly.
 *
 * Applies to every <details> on the page, including the ones the app builds
 * while it is running: the listener is on the document, so nothing has to be
 * wired up when an element appears.
 */

(function () {
  const MS = 260;
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

  /* Somebody who has asked their machine to stop moving things has asked for
     this too. Checked at click time, not at load, so switching it does not
     need a reload. */
  const stillness = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const running = new WeakMap();

  /* Whatever an earlier click left in mid-air, taken back down to nothing.
   *
   * This has to happen before anything is measured, and that is not obvious:
   * a running animation on `height` overrides the computed height, so asking
   * a half-open panel how tall it is returns how tall it is *right now*
   * rather than how tall it wants to be. Measuring first meant a second click
   * during the first animation read a frozen number and animated from it to
   * itself - nothing moved at all. Found by clicking twice quickly. */
  function settle(d) {
    const prev = running.get(d);
    if (prev) { running.delete(d); prev.cancel(); }
    d.style.height = "";
    d.style.overflow = "";
  }

  function animate(d, from, to, after) {
    const overflow = d.style.overflow;
    d.style.overflow = "hidden";

    const anim = d.animate(
      [{ height: from + "px" }, { height: to + "px" }],
      { duration: MS, easing: EASE });

    running.set(d, anim);
    const done = () => {
      if (running.get(d) === anim) {
        running.delete(d);
        d.style.overflow = overflow;
        d.style.height = "";
      }
      if (after) after();
    };
    /* Only on finish. A cancel means another click landed mid-flight and has
       already taken over; running `after` then would slam a half-open panel
       shut behind the animation that replaced it. */
    anim.addEventListener("finish", done);
  }

  function onClick(e) {
    const summary = e.target.closest && e.target.closest("summary");
    if (!summary) return;
    const d = summary.parentElement;
    if (!d || d.tagName !== "DETAILS" || d.dataset.noAnim === "true") return;
    /* A link or a button inside the summary is doing its own job. */
    if (e.target !== summary && e.target.closest("a, button, input, label")) return;
    if (stillness()) return;
    if (!d.animate) return;

    e.preventDefault();
    settle(d);

    if (!d.open) {
      const shut = d.offsetHeight;
      d.open = true;
      const open = d.offsetHeight;
      d.style.height = shut + "px";
      animate(d, shut, open);
    } else {
      const open = d.offsetHeight;
      d.open = false;
      const shut = d.offsetHeight;
      /* Reopened for the duration, so there is something to watch on the way
         down. The attribute goes away once the height has arrived. */
      d.open = true;
      d.style.height = open + "px";
      animate(d, open, shut, () => { d.open = false; });
    }
  }

  /* One listener on the document rather than one per element, in the capture
     phase so it runs before the browser's own toggle. */
  document.addEventListener("click", onClick, true);
})();
