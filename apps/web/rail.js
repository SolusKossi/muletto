/* The date rail: the scrollbar for anything arranged by time.

   A normal scrollbar tells you how far through you are, which is useless when
   what you want to know is "am I in 2021 yet". This puts the months and years
   down the side of the scroller and magnifies whatever is currently on screen,
   easing between neighbours as you scroll so the movement reads as one motion
   rather than a label snapping from one value to the next.

   It is used by the timeline and by the image library, so it knows nothing
   about either: it is handed a list of dated anchors and a way to reveal one. */
(function (global) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* How far the magnification reaches, in marks, and how much it lifts. A
     narrow falloff feels twitchy; a wide one makes everything the same size. */
  const REACH = 4.2;
  const LIFT = 1.0;

  function monthKey(d) { return d.getFullYear() * 12 + d.getMonth(); }

  /* Marks across the whole span, including periods with nothing in them - a gap
     in the data should read as a gap in time, not be closed up.

     One mark per month works for a few years and falls apart for twenty. A
     library running from 2005 to 2026 is 260 months, and 260 marks down the
     side of a window leaves two pixels each: too small to magnify, too small to
     label, too small to hit. So the step widens - a mark per month, per
     quarter, per half year, per year - until the marks that exist have room to
     be read. Coarser is not less information here; 260 illegible ticks tell you
     nothing that 21 legible years do not. */
  const STEPS = [1, 2, 3, 6, 12, 24, 60];

  function chooseStep(anchors, capacity) {
    if (!anchors.length) return 1;
    const keys = anchors.map((a) => monthKey(a.date));
    const span = Math.max(...keys) - Math.min(...keys) + 1;
    for (const s of STEPS) if (Math.ceil(span / s) <= capacity) return s;
    return Math.ceil(span / Math.max(1, capacity));
  }

  function buildMarks(anchors, step) {
    if (!anchors.length) return [];
    const keys = anchors.map((a) => monthKey(a.date));
    const lo = Math.min(...keys), hi = Math.max(...keys);
    const marks = [];
    for (let k = hi; k >= lo; k -= step) {
      const y = Math.floor(k / 12), m = k % 12;
      marks.push({
        key: k, year: y, month: m, anchor: null,
        // Past a yearly step every mark is a year; below it, January and the
        // newest mark carry the year so the reader has fixed points.
        isYear: step >= 12 || m === 0 || k === hi,
      });
    }
    // Point each mark at the first anchor that falls inside its period.
    for (const a of anchors) {
      const i = Math.floor((hi - monthKey(a.date)) / step);
      const mark = marks[i];
      if (mark && mark.anchor === null) mark.anchor = a;
    }
    return { marks, hi, step };
  }

  /* Attach a rail to a scrolling element.

     opts.scroller    the element that scrolls
     opts.anchors     [{ date, index }] in document order, newest first
     opts.elementFor  (index) -> the rendered element, or null if not rendered
                      yet. Must be cheap and must not render anything.
     opts.locate      (index) -> element, rendering whatever is needed first.
                      Used for clicks and drags.
     opts.host        where to put the rail; defaults to the scroller's parent */
  function attach(opts) {
    const { scroller, anchors, elementFor, locate } = opts;
    const host = opts.host || scroller.parentElement;
    if (!host) return null;

    const rail = document.createElement("div");
    rail.className = "rail";

    /* The step depends on how tall the rail is, and the rail has no height
       until it is in the document - so it goes in empty, gets measured, and is
       filled once. 12px is about the least a label can be read at. */
    rail.style.visibility = "hidden";
    host.appendChild(rail);
    const capacity = Math.max(6, Math.floor((rail.clientHeight || 600) / 12));
    const built = buildMarks(anchors, chooseStep(anchors, capacity));
    rail.style.visibility = "";
    if (!built || built.marks.length < 2) { rail.remove(); return null; }
    const { marks, hi, step } = built;

    // Which mark a date belongs to, by arithmetic rather than a lookup, since
    // one mark can now stand for several months.
    const markAt = {
      get: (k) => {
        const i = Math.floor((hi - k) / step);
        return i >= 0 && i < marks.length ? i : undefined;
      },
    };
    /* The rail replaces the native scrollbar rather than sitting beside it.
       A native thumb measures rendered height, and the timeline renders in
       pages, so the thumb would claim you were at the bottom while years of
       history were still unrendered. Measuring in months instead means the
       position is true whatever has been drawn so far. */
    rail.innerHTML =
      '<span class="rail-thumb" aria-hidden="true"></span>' +
      marks.map((m, i) => `
      <button class="rail-m${m.isYear ? " y" : ""}${m.anchor ? "" : " empty"}"
              data-i="${i}" type="button" title="${MONTHS[m.month]} ${m.year}">
        <span class="rail-t">${m.isYear ? m.year : MONTHS[m.month]}</span>
        <span class="rail-b"></span>
      </button>`).join("");

    const buttons = [...rail.querySelectorAll(".rail-m")];
    const thumb = rail.querySelector(".rail-thumb");
    let raf = 0;
    let painted = -1;

    /* Six and a half years is 79 marks, and 79 month labels do not fit down the
       side of a browser window. They used to be laid out at their natural
       height anyway, so the rail ran on past the bottom of its own box and the
       oldest third of the history was simply cut off - the library looked like
       it held a few months because the only months you could see were a few.

       So the marks share the height they actually have, and past the point
       where a label can no longer fit, the ordinary months keep their tick but
       give up their text. Years always keep theirs, and the magnified one under
       the cursor gets its text back, so you can still read your way to a month
       that has no room to name itself. */
    function fit() {
      const h = rail.clientHeight;
      const n = buttons.length;
      if (!h || !n) return;

      /* Each mark reserves a resting height plus room to grow when the cursor
         magnifies it. Both were fixed at 11px and 13px, which is 858px of
         demand for six years of months in a rail 648px tall - so it ran off
         the bottom. They are worked out from the height there actually is.

         The lift is only ever paid by the handful of marks near the peak. A
         Gaussian of width REACH integrates to REACH * sqrt(pi) marks' worth,
         so that is the allowance set aside for it rather than n * lift. */
      const lift = Math.min(13, Math.max(6, (h / n) * 1.1));
      const budget = lift * REACH * Math.sqrt(Math.PI);
      const rest = Math.max(4, Math.min(11, (h - budget) / n));
      rail.style.setProperty("--rest", rest.toFixed(2) + "px");
      rail.style.setProperty("--lift", lift.toFixed(2) + "px");
      // Only if the step could not open things up enough on its own.
      rail.classList.toggle("dense", rest < 9);
    }
    fit();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(fit).observe(rail);
    }

    /* Where each *month* starts, measured once per change rather than once per
       frame.

       Measuring per anchor was the jitter. Scrolling through a month with
       twenty days in it advanced the anchor twenty times, and each advance
       restarted the ease towards the next month from zero - so the label crept
       forward and snapped back, twenty times per month. Interpolating between
       month boundaries instead gives one monotonic ramp per month, which is
       what a scrollbar should be.

       Asking every anchor for its rectangle on every scroll frame also forces
       a layout each time. Positions only move when the content changes, so
       they are cached and the scroll handler binary-searches numbers. */
    let tops = [], idxs = [];

    function recompute() {
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      tops = [];
      idxs = [];
      let lastMark = -1;
      for (let i = 0; i < anchors.length; i++) {
        const mark = markAt.get(monthKey(anchors[i].date));
        if (mark === undefined || mark === lastMark) continue;   // same month, already have it
        const el = elementFor(anchors[i].index);
        if (!el) continue;
        tops.push(el.getBoundingClientRect().top - base);
        idxs.push(mark);
        lastMark = mark;
      }
    }

    /* Magnify by distance from the current position. A Gaussian falloff means
       every mark's size changes a little on every scroll step, so the rail
       reads as one continuous motion instead of a label snapping between
       values. Position is fractional, which is what puts the peak between two
       marks while you are between two months. */
    function paint(pos) {
      // Writing 80 style properties per frame is wasted work when the value
      // has not moved enough to be visible.
      if (Math.abs(pos - painted) < 0.004) return;
      painted = pos;
      for (let i = 0; i < buttons.length; i++) {
        const d = (i - pos) / REACH;
        const w = Math.exp(-d * d);
        buttons[i].style.setProperty("--w", w.toFixed(3));
        buttons[i].style.setProperty("--s", (1 + LIFT * w).toFixed(3));
        buttons[i].classList.toggle("near", w > 0.5);
      }
      const cur = marks[Math.max(0, Math.min(marks.length - 1, Math.round(pos)))];
      if (cur) rail.dataset.label = MONTHS[cur.month] + " " + cur.year;
      if (thumb && buttons.length > 1) {
        const at = Math.max(0, Math.min(buttons.length - 1, pos));
        thumb.style.setProperty("--p", (at / (buttons.length - 1)).toFixed(4));
      }
    }

    /* Where are we, as a fractional mark position?

       Taken from the last anchor whose top has passed the top of the viewport,
       then advanced towards the next mark by how far through that anchor's
       block we have scrolled. Without that second term the value would only
       change when an anchor crossed the edge, and the rail would jump. */
    function measure() {
      raf = 0;
      if (!tops.length) recompute();
      if (!tops.length) return;

      const y = scroller.scrollTop + 4;

      // Last month boundary at or above the top of the viewport.
      let lo = 0, hi = tops.length - 1, at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid] <= y) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
      }

      // Ramp evenly from this month's boundary to the next one.
      let pos = idxs[at];
      if (at + 1 < tops.length) {
        const from = tops[at], to = tops[at + 1];
        if (to > from) {
          const t = Math.min(1, Math.max(0, (y - from) / (to - from)));
          pos = idxs[at] + (idxs[at + 1] - idxs[at]) * t;
        }
      }
      paint(pos);
    }

    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    /* Clicking or dragging a month jumps to it. Months with nothing in them
       are still drawn - a gap in the data should read as a gap in time - but
       they resolve to the nearest month that has something. */
    function jump(i, behavior) {
      for (let step = 0; step < marks.length; step++) {
        const m = marks[i + step] || marks[i - step];
        if (m && m.anchor) {
          const el = locate(m.anchor.index);
          if (el) el.scrollIntoView({ block: "start", behavior: behavior || "smooth" });
          return;
        }
      }
    }

    rail.addEventListener("click", (e) => {
      const b = e.target.closest(".rail-m");
      if (b && !dragging) jump(Number(b.dataset.i));
    });

    /* Dragging scrolls continuously, and is the exact inverse of measure().

       It used to round the pointer position to a whole month and call
       scrollIntoView on it, which meant a drag moved in month-sized jumps -
       with six years on the rail, one pixel of pointer travel could throw the
       library several thousand pixels, and every step landed hard at the top of
       a month. It read as a broken scrollbar because it behaved like one.

       measure() turns scrollTop into a fractional mark position by finding the
       month boundary above it and ramping to the next. This does that
       backwards: fractional mark position from the pointer, then the scroll
       offset that would produce it. Because the two are inverses, the month
       under the cursor is the month you land on. */
    function scrollTopForPos(pos) {
      if (!tops.length) recompute();
      if (!tops.length) return null;
      if (pos <= idxs[0]) return tops[0];
      if (pos >= idxs[idxs.length - 1]) return tops[tops.length - 1];

      let lo = 0, hi = idxs.length - 1, at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (idxs[mid] <= pos) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (at + 1 >= idxs.length) return tops[at];
      const span = idxs[at + 1] - idxs[at];
      const t = span > 0 ? (pos - idxs[at]) / span : 0;
      return tops[at] + (tops[at + 1] - tops[at]) * t;
    }

    let dragging = false;
    const scrub = (clientY) => {
      const r = rail.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      const y = scrollTopForPos(t * (marks.length - 1));
      if (y === null) return;
      // Assigned rather than scrollIntoView'd: no snapping to an element edge,
      // and no smooth animation to fight the next pointer move.
      scroller.scrollTop = Math.max(0, y);
    };
    rail.addEventListener("pointerdown", (e) => {
      dragging = true;
      rail.classList.add("dragging");
      rail.setPointerCapture(e.pointerId);
      scrub(e.clientY);
      e.preventDefault();
    });
    rail.addEventListener("pointermove", (e) => { if (dragging) scrub(e.clientY); });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove("dragging");
      try { rail.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    };
    rail.addEventListener("pointerup", stop);
    rail.addEventListener("pointercancel", stop);

    paint(0);
    requestAnimationFrame(measure);

    const onResize = () => { recompute(); measure(); };
    window.addEventListener("resize", onResize);

    return {
      el: rail,
      // One entry per month rather than per day, so this stays cheap.
      refresh() { recompute(); measure(); },
      remeasure() { recompute(); measure(); },
      destroy() {
        scroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        rail.remove();
      },
    };
  }

  global.MRail = { attach, buildMarks };
})(window);
