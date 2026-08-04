"use strict";

/* Muletto - the little explanations next to things.

   Every feature here needs a sentence of explanation, and there is nowhere
   good to put it. Written into the button the labels become paragraphs;
   left out, half the app is guesswork - "find similar photos" does not say
   whether it deletes anything, and nobody should have to click to find out.

   So: one bubble, borrowed by whatever is being hovered.

   It is a single element on <body> with position:fixed, which is the whole
   trick. A tooltip rendered inside the thing it explains gets clipped by any
   scrolling ancestor and stacked under any panel with a higher z-index, and
   both of those happen constantly in this app - the sidebar scrolls, the
   export panel sits at z-index 400. Fixed positioning on body has no
   ancestors to be clipped by, so it cannot happen.

   It prefers to sit below its trigger and flips above when there is no room,
   measured against the real viewport rather than assumed. A tooltip you
   cannot read is worse than no tooltip, because the reader hovered on
   purpose and got nothing. */

const MTips = (function () {
  let bubble = null;
  let current = null;
  const GAP = 10;
  const EDGE = 8;

  function ensure() {
    if (bubble) return bubble;
    bubble = document.createElement("div");
    bubble.className = "tip-bubble";
    bubble.id = "m-tip";
    bubble.setAttribute("role", "tooltip");
    document.body.appendChild(bubble);
    return bubble;
  }

  function place(el) {
    const b = ensure();
    /* Measured before placing. The bubble wraps, so its height depends on the
       width it is given, and the flip decision depends on that height. */
    b.style.maxWidth = Math.min(300, innerWidth - EDGE * 2) + "px";
    b.style.left = "0px";
    b.style.top = "0px";

    const r = el.getBoundingClientRect();
    const box = b.getBoundingClientRect();

    const below = r.bottom + GAP;
    const above = r.top - GAP - box.height;
    const roomBelow = below + box.height <= innerHeight - EDGE;
    /* Below unless it would run off the bottom, and then only if above
       actually fits. On a short viewport neither does, and the least bad
       answer is below with the edge clamp doing the rest. */
    const useAbove = !roomBelow && above >= EDGE;

    let left = r.left + r.width / 2 - box.width / 2;
    left = Math.max(EDGE, Math.min(left, innerWidth - box.width - EDGE));
    const top = Math.max(EDGE, useAbove ? above : below);

    b.style.left = Math.round(left) + "px";
    b.style.top = Math.round(top) + "px";
    b.classList.toggle("above", useAbove);

    /* The arrow tracks the trigger rather than the bubble, so a tooltip
       pushed sideways by the viewport edge still points at what it explains. */
    const cx = r.left + r.width / 2 - left;
    b.style.setProperty("--tip-ax",
      Math.max(14, Math.min(cx, box.width - 14)) + "px");
  }

  function show(el) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    const b = ensure();
    b.textContent = text;
    b.classList.add("on");
    current = el;
    place(el);
    el.setAttribute("aria-describedby", "m-tip");
  }

  function hide() {
    if (!bubble) return;
    bubble.classList.remove("on");
    if (current) current.removeAttribute("aria-describedby");
    current = null;
  }

  /* Delegated, so anything gaining a data-tip later works without being told
     about - which matters here, since most of the app redraws itself. */
  function attach() {
    document.addEventListener("pointerover", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el === current) return;
      if (el) show(el); else hide();
    });
    document.addEventListener("pointerdown", hide);
    // Keyboard users get the same help, on focus.
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el) show(el);
    });
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    // A fixed bubble does not travel with the page, so it is repositioned
    // rather than left pointing at where the button used to be.
    addEventListener("scroll", () => { if (current) place(current); }, true);
    addEventListener("resize", () => { if (current) place(current); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }

  /* The marker itself, so every explained control looks the same. */
  function dot(text) {
    return '<span class="tip-dot" tabindex="0" role="button" aria-label="What is this?" ' +
      'data-tip="' + String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;") + '">?</span>';
  }

  return { show, hide, dot };
})();
