"use strict";

/* Muletto - drawing data as the shape it actually is.
 *
 * This began on the health page, which drew one sparkline fourteen times.
 * Every panel looked identical, so the page read as a spreadsheet with the
 * gridlines turned off: nothing about a picture of your weight told you it
 * was weight rather than your step count. It is now used by the chat, search
 * and sign-in views too, which had the same problem in a different costume -
 * a list of ten thousand rows, and no way to see the shape of any of it.
 *
 * The fix is not more decoration, it is choosing the drawing from what the
 * number means:
 *
 *   a daily count      bars        - a step count is a stack of days, and the
 *                                    gaps between them are the story
 *   a slow measure     line        - weight and HRV move by a little over
 *                                    years; a line is what a trend looks like
 *   a nightly range    band        - sleep is not a number, it is a spread,
 *                                    and the spread is what changes
 *   a bounded reading  dial        - a resting pulse sits inside a range
 *                                    everybody has a sense of
 *   an occasion        dots        - a workout either happened or it did not
 *   a whole span       ridge       - years at a glance, for the summary
 *
 * All of it is inline SVG built from strings: no library, nothing fetched,
 * and it prints. Colour is `currentColor` at varying opacity throughout, so
 * the whole page stays in the greyscale the rest of the site uses and follows
 * light and dark without being told twice.
 */

const MCharts = (function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* The points travel with the drawing.
   *
   * A chart that cannot say what is under the pointer is a picture, and a
   * picture of your own step count is a poor substitute for the number. The
   * readout needs the values, so they are written onto the element that was
   * drawn from them rather than looked up again from somewhere else - there
   * is then no way for the two to disagree.
   *
   * Only what is drawn: the buckets, not the twenty thousand readings behind
   * them. A year of daily steps is forty numbers here. */
  function carry(pts, meta) {
    const slim = pts.map((p) => {
      const o = { t: Math.round(p.t), v: Math.round(p.v * 100) / 100 };
      if (p.lo !== undefined && p.lo !== p.v) o.lo = Math.round(p.lo * 100) / 100;
      if (p.hi !== undefined && p.hi !== p.v) o.hi = Math.round(p.hi * 100) / 100;
      return o;
    });
    return " data-hv='" + JSON.stringify(slim).replace(/'/g, "&#39;") + "'" +
      " data-hv-meta='" + JSON.stringify(meta || {}).replace(/'/g, "&#39;") + "'";
  }

  /* The cursor, drawn once per chart and moved rather than rebuilt. */
  const CURSOR = '<g class="hv-cur" opacity="0">' +
    '<line class="hv-cur-l" y1="0" y2="100%" stroke="currentColor" stroke-width="1" ' +
    'opacity="0.45" vector-effect="non-scaling-stroke"/>' +
    '<circle class="hv-cur-d" r="3.2" fill="currentColor"/></g>';

  const svg = (w, h, inner, cls, data) =>
    '<svg class="hv ' + (cls || "") + '" viewBox="0 0 ' + w + " " + h +
    '" preserveAspectRatio="none"' + (data || "") + ">" + inner + CURSOR + "</svg>";

  const nums = (pts) => pts.map((p) => p.v).filter((v) => isFinite(v));
  const extent = (vals) => ({ lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) });

  /* Averaged into n buckets across the span, so a chart of two thousand days
     is a chart of forty shapes rather than two thousand hairlines. */
  function bucket(pts, n) {
    if (pts.length <= n) return pts.slice();
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = t0 + ((t1 - t0) * i) / n, b = t0 + ((t1 - t0) * (i + 1)) / n;
      const inside = pts.filter((p) => p.t >= a && (i === n - 1 ? p.t <= b : p.t < b));
      if (!inside.length) continue;
      const vals = nums(inside);
      /* A point that already knows its own spread keeps it. These arrive
         pre-bucketed from MInsight, and taking the min and max of the means
         instead would narrow the band every time it was drawn - which is how
         a chart whose whole purpose is showing a spread ended up showing a
         hairline. */
      out.push({
        t: (a + b) / 2,
        v: vals.reduce((s, x) => s + x, 0) / vals.length,
        lo: Math.min.apply(null, inside.map((q) => (q.lo === undefined ? q.v : q.lo))),
        hi: Math.max.apply(null, inside.map((q) => (q.hi === undefined ? q.v : q.hi))),
      });
    }
    return out;
  }

  /* ---------- a daily count ---------- */

  /* Bars, because a step count is a stack of days. A quiet week is a run of
     short bars and that is worth seeing; a line would smooth it into nothing. */
  function bars(pts, opt) {
    const o = opt || {};
    const w = o.w || 300, h = o.h || 68;
    const b = bucket(pts, o.n || 44);
    if (b.length < 2) return "";
    const { hi } = extent(nums(b));
    const top = hi || 1;
    const gap = 1.6;
    const bw = Math.max(1.2, (w - gap * (b.length - 1)) / b.length);
    let out = "";
    b.forEach((p, i) => {
      const bh = Math.max(1, (p.v / top) * (h - 2));
      out += '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h - bh).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) +
        '" rx="0.8" fill="currentColor" opacity="' + (0.28 + 0.5 * (p.v / top)).toFixed(2) + '"/>';
    });
    return svg(w, h, out, "hv-bars", carry(b, o.meta));
  }

  /* ---------- a slow measure ---------- */

  /* A line, with the ground under it shaded. Weight over six years is a
     direction, and a direction is the one thing a line says better than
     anything else. */
  function line(pts, opt) {
    const o = opt || {};
    const w = o.w || 300, h = o.h || 68;
    const b = bucket(pts, o.n || 60);
    if (b.length < 2) return "";
    const vals = nums(b);
    let { lo, hi } = extent(vals);
    if (hi === lo) { lo -= 1; hi += 1; }
    const pad = 3;
    const x = (i) => (i / (b.length - 1)) * w;
    const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const d = b.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
    const area = d + " L" + w + " " + h + " L0 " + h + " Z";
    return svg(w, h,
      '<path d="' + area + '" fill="currentColor" opacity="0.10"/>' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + x(b.length - 1).toFixed(1) + '" cy="' + y(b[b.length - 1].v).toFixed(1) +
      '" r="2.4" fill="currentColor"/>', "hv-line", carry(b, o.meta));
  }

  /* ---------- a nightly range ---------- */

  /* Sleep is not a number, it is a spread. The band is the range of nights in
     each stretch of time and the line through it is the middle of them, so a
     month of seven-hour nights and a month of five-to-nine nights do not draw
     the same picture - which on a mean they would. */
  function band(pts, opt) {
    const o = opt || {};
    const w = o.w || 300, h = o.h || 68;
    const b = bucket(pts, o.n || 40);
    if (b.length < 2) return "";
    let lo = Math.min.apply(null, b.map((p) => (p.lo === undefined ? p.v : p.lo)));
    let hi = Math.max.apply(null, b.map((p) => (p.hi === undefined ? p.v : p.hi)));
    if (hi === lo) { lo -= 1; hi += 1; }
    const pad = 3;
    const x = (i) => (i / (b.length - 1)) * w;
    const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const topEdge = b.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " +
      y(p.hi === undefined ? p.v : p.hi).toFixed(1)).join(" ");
    const botEdge = b.slice().reverse().map((p, i) => "L" +
      x(b.length - 1 - i).toFixed(1) + " " +
      y(p.lo === undefined ? p.v : p.lo).toFixed(1)).join(" ");
    const mid = b.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
    return svg(w, h,
      '<path d="' + topEdge + " " + botEdge + ' Z" fill="currentColor" opacity="0.14"/>' +
      '<path d="' + mid + '" fill="none" stroke="currentColor" stroke-width="1.4" ' +
      'stroke-linecap="round" vector-effect="non-scaling-stroke"/>', "hv-band", carry(b, o.meta));
  }

  /* ---------- an occasion ---------- */

  /* A workout happened or it did not, and how hard is secondary. Dots on a
     line say "roughly twice a week, with a gap in February" in a way no
     average does. */
  function dots(pts, opt) {
    const o = opt || {};
    const w = o.w || 300, h = o.h || 68;
    if (pts.length < 2) return "";
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const vals = nums(pts);
    let { lo, hi } = extent(vals);
    if (hi === lo) { lo -= 1; hi += 1; }
    /* Thinned to something a person can look at. Everything is still counted
       and said in words underneath; this is the shape, not the record. */
    const step = Math.max(1, Math.ceil(pts.length / 150));
    let out = '<line x1="0" y1="' + (h - 1) + '" x2="' + w + '" y2="' + (h - 1) +
      '" stroke="currentColor" opacity="0.16" stroke-width="1"/>';
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const x = (((p.t - t0) / (t1 - t0)) * (w - 4) + 2).toFixed(1);
      const r = 1.4 + 1.8 * ((p.v - lo) / (hi - lo));
      out += '<circle cx="' + x + '" cy="' + (h - 1 - r - 1).toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="currentColor" opacity="0.5"/>';
    }
    return svg(w, h, out, "hv-dots", carry(pts.filter((_, i) => i % step === 0), o.meta));
  }

  /* ---------- a bounded reading ---------- */

  /* A dial, for the two numbers everybody already has a sense of the range
     for. It is the only drawing here that says where a value sits rather than
     only where it has been, and it is deliberately not a gauge with a red
     zone: this is a picture of a record, not a diagnosis. */
  function dial(value, lo, hi, opt) {
    const o = opt || {};
    const size = o.size || 132;
    const c = size / 2, r = c - 12;
    const frac = Math.max(0, Math.min(1, (value - lo) / ((hi - lo) || 1)));
    const START = -220, SWEEP = 260;
    const pt = (deg) => {
      const a = (deg * Math.PI) / 180;
      return [(c + r * Math.cos(a)).toFixed(1), (c + r * Math.sin(a)).toFixed(1)];
    };
    let ticks = "";
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const on = i / N <= frac;
      const a = ((START + SWEEP * (i / N)) * Math.PI) / 180;
      const r1 = r - (on ? 7 : 4), r2 = r;
      ticks += '<line x1="' + (c + r1 * Math.cos(a)).toFixed(1) +
        '" y1="' + (c + r1 * Math.sin(a)).toFixed(1) +
        '" x2="' + (c + r2 * Math.cos(a)).toFixed(1) +
        '" y2="' + (c + r2 * Math.sin(a)).toFixed(1) +
        '" stroke="currentColor" stroke-width="' + (on ? 2 : 1.2) +
        '" opacity="' + (on ? 0.85 : 0.18) + '" stroke-linecap="round"/>';
    }
    const [hx, hy] = pt(START + SWEEP * frac);
    ticks += '<circle cx="' + hx + '" cy="' + hy + '" r="3.4" fill="currentColor"/>';
    return '<svg class="hv hv-dial" viewBox="0 0 ' + size + " " + size +
      '" aria-hidden="true">' + ticks + "</svg>";
  }

  /* ---------- a whole span ---------- */

  /* The summary at the top: one soft ridge per family of signals, six years
     wide. It is a shape rather than a chart - there is no axis and no reading
     it off - and that is the point. It says "this is what your record looks
     like from a distance", and everything precise is below it. */
  function ridge(pts, opt) {
    const o = opt || {};
    const w = o.w || 1000, h = o.h || 76;
    const b = bucket(pts, o.n || 56);
    if (b.length < 3) return "";
    const vals = nums(b);
    let { lo, hi } = extent(vals);
    if (hi === lo) { lo -= 1; hi += 1; }
    const mid = h / 2;
    const amp = (v) => (((v - lo) / (hi - lo)) * 0.78 + 0.22) * (h / 2 - 2);
    const x = (i) => (i / (b.length - 1)) * w;

    /* Smoothed with a midpoint curve rather than drawn straight, because the
       thing being shown is a tendency and a polyline of forty segments reads
       as forty facts. */
    const edge = (sign) => {
      let d = "M0 " + (mid + sign * amp(b[0].v)).toFixed(1);
      for (let i = 1; i < b.length; i++) {
        const x0 = x(i - 1), x1 = x(i);
        const y0 = mid + sign * amp(b[i - 1].v), y1 = mid + sign * amp(b[i].v);
        const cx = ((x0 + x1) / 2).toFixed(1);
        d += " C" + cx + " " + y0.toFixed(1) + " " + cx + " " + y1.toFixed(1) +
          " " + x1.toFixed(1) + " " + y1.toFixed(1);
      }
      return d;
    };
    const top = edge(-1);
    const bottom = edge(1).replace(/^M/, "L");
    /* The lower edge has to be walked backwards to close the shape. */
    const back = [];
    for (let i = b.length - 1; i >= 0; i--) {
      back.push((i === b.length - 1 ? "L" : "L") + x(i).toFixed(1) + " " +
        (mid + amp(b[i].v)).toFixed(1));
    }
    return '<svg class="hv hv-ridge" viewBox="0 0 ' + w + " " + h +
      '" preserveAspectRatio="none"' + carry(b, o.meta) + ">" +
      '<path d="' + top + " " + back.join(" ") + ' Z" fill="currentColor" opacity="0.17"/>' +
      '<path d="' + top + '" fill="none" stroke="currentColor" stroke-width="1" ' +
      'opacity="0.45" vector-effect="non-scaling-stroke"/>' + CURSOR + "</svg>";
  }

  /* ---------- one life, one line ----------
   *
   * A strip per person, every message a mark on it. Eight of these stacked is
   * the single most useful picture in the whole app: you can see a friendship
   * start, a run of years where somebody was in your life every week, and the
   * month it stopped - none of which is visible in a list sorted by name.
   *
   * Bucketed to a couple of hundred columns and shaded by how many fell in
   * each, so a busy fortnight is darker rather than being eight marks in the
   * same pixel. The eye reads that as density, which is what it is.
   */
  function ticks(pts, opt) {
    const o = opt || {};
    const w = o.w || 900, h = o.h || 26;
    const from = o.from, to = o.to;
    if (!pts.length || !(to > from)) return "";
    const slots = o.slots || 210;
    const counts = new Array(slots).fill(0);
    for (const p of pts) {
      let i = Math.floor(((p.t - from) / (to - from)) * slots);
      if (i < 0) i = 0; if (i >= slots) i = slots - 1;
      counts[i]++;
    }
    let top = 0;
    for (const c of counts) if (c > top) top = c;
    if (!top) return "";

    const cw = w / slots;
    let out = "";
    for (let i = 0; i < slots; i++) {
      const c = counts[i];
      if (!c) continue;
      /* Four steps rather than a smooth ramp. A continuous opacity looks like
         noise at this size; four is enough to read as light, medium, dark. */
      const step = c / top;
      const op = step > 0.66 ? 0.95 : step > 0.33 ? 0.7 : step > 0.12 ? 0.45 : 0.28;
      out += '<rect x="' + (i * cw).toFixed(2) + '" y="' + (h * 0.22).toFixed(1) +
        '" width="' + Math.max(0.9, cw * 0.55).toFixed(2) + '" height="' + (h * 0.56).toFixed(1) +
        '" rx="0.6" fill="currentColor" opacity="' + op + '"/>';
    }
    /* The rule underneath is the span, so an empty stretch reads as a gap in
       a life rather than as a chart that stopped. */
    return '<svg class="hv hv-ticks" viewBox="0 0 ' + w + " " + h +
      '" preserveAspectRatio="none">' +
      '<line x1="0" y1="' + (h / 2) + '" x2="' + w + '" y2="' + (h / 2) +
      '" stroke="currentColor" stroke-width="0.6" opacity="0.13"/>' + out + "</svg>";
  }

  /* ---------- the day, as a circle ----------
   *
   * Twenty-four hours is the one quantity that genuinely is a loop: 23:00 is
   * next to 00:00, and on a bar chart it is at the opposite end. Somebody
   * whose messages run from ten at night to one in the morning looks like two
   * unrelated habits on bars and like one arc here, which is what it is.
   */
  function clock(pts, opt) {
    const o = opt || {};
    const size = o.size || 210;
    const c = size / 2;
    const rIn = size * 0.17, rOut = size * 0.46;
    const counts = new Array(24).fill(0);
    for (const p of pts) {
      const d = new Date(p.t);
      if (!isNaN(d)) counts[d.getHours()]++;
    }
    let top = 0;
    for (const n of counts) if (n > top) top = n;
    if (!top) return "";

    let out = "";
    for (let hIdx = 0; hIdx < 24; hIdx++) {
      const n = counts[hIdx];
      /* Midnight at the top and clockwise, because that is where every clock
         anybody has looked at puts it. */
      const a0 = ((hIdx / 24) * 360 - 90 + 1.2) * (Math.PI / 180);
      const a1 = (((hIdx + 1) / 24) * 360 - 90 - 1.2) * (Math.PI / 180);
      const len = n ? rIn + (rOut - rIn) * (0.18 + 0.82 * (n / top)) : rIn + 2;
      /* Concentric dashes rather than one solid wedge: it reads as a count
         and a solid wedge reads as a proportion of the whole day. */
      const rings = n ? Math.max(1, Math.round(((len - rIn) / (rOut - rIn)) * 7)) : 0;
      for (let k = 0; k < Math.max(1, rings); k++) {
        const r = rIn + ((rOut - rIn) * (k + 0.6)) / 7;
        const x0 = c + r * Math.cos(a0), y0 = c + r * Math.sin(a0);
        const x1 = c + r * Math.cos(a1), y1 = c + r * Math.sin(a1);
        out += '<path d="M' + x0.toFixed(1) + " " + y0.toFixed(1) + " A" + r.toFixed(1) +
          " " + r.toFixed(1) + " 0 0 1 " + x1.toFixed(1) + " " + y1.toFixed(1) +
          '" fill="none" stroke="currentColor" stroke-width="' +
          (size * 0.028).toFixed(1) + '" stroke-linecap="round" opacity="' +
          (n ? (0.22 + 0.6 * (n / top)).toFixed(2) : "0.09") + '" data-hv-cell="' +
          esc(String(hIdx).padStart(2, "0") + ":00 &#183; " + n.toLocaleString() + " " +
              (n === 1 ? (o.noun || "message") : (o.noun || "message") + "s")) + '"/>';
      }
    }

    /* Sun and moon, so the ring needs no key. Noon is at the bottom of a
       clock face and midnight at the top, which is where they go. */
    const moon = '<path d="M' + (c + 5) + " " + (size * 0.31) +
      "a5.6 5.6 0 1 0 -6.4 8.6 6.6 6.6 0 0 1 6.4 -8.6z" +
      '" fill="currentColor" opacity="0.55"/>';
    const sunR = 4.2, sy = size * 0.685;
    let sun = '<circle cx="' + c + '" cy="' + sy + '" r="' + sunR +
      '" fill="currentColor" opacity="0.55"/>';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      sun += '<line x1="' + (c + Math.cos(a) * (sunR + 2.2)).toFixed(1) +
        '" y1="' + (sy + Math.sin(a) * (sunR + 2.2)).toFixed(1) +
        '" x2="' + (c + Math.cos(a) * (sunR + 4.4)).toFixed(1) +
        '" y2="' + (sy + Math.sin(a) * (sunR + 4.4)).toFixed(1) +
        '" stroke="currentColor" stroke-width="1.2" opacity="0.55" stroke-linecap="round"/>';
    }

    return '<div class="hv-clockwrap"><svg class="hv hv-clock" viewBox="0 0 ' + size +
      " " + size + '">' + out + moon + sun + "</svg>" +
      '<span class="hv-cl hv-cl-0">00:00</span>' +
      '<span class="hv-cl hv-cl-6">06:00</span>' +
      '<span class="hv-cl hv-cl-12">12:00</span>' +
      '<span class="hv-cl hv-cl-18">18:00</span></div>';
  }

  /* Where the busy hours actually are, in words.
   *
   * A chart says "evenings" to somebody who already knows what they are
   * looking at; a sentence says it to everybody.
   *
   * The first version asked for the shortest run of hours holding at least
   * half of everything, and returned nothing when no run reached it. On the
   * sample the best eight-hour window held forty-nine percent, so the
   * sentence and one of the insight cards silently disappeared - a cliff at
   * an arbitrary line, which is the worst way for a number to behave.
   *
   * It now finds the window that is furthest above what an even day would
   * give it, and reports whatever share that turns out to be. There is always
   * an answer, and the answer states its own size rather than implying "most".
   */
  function busiestRun(pts) {
    const counts = new Array(24).fill(0);
    let total = 0;
    for (const p of pts) {
      const d = new Date(p.t);
      if (isNaN(d)) continue;
      counts[d.getHours()]++;
      total++;
    }
    if (total < 24) return null;

    let best = null;
    for (let len = 3; len <= 8; len++) {
      for (let start = 0; start < 24; start++) {
        let sum = 0;
        for (let k = 0; k < len; k++) sum += counts[(start + k) % 24];
        const share = sum / total;
        /* How much more than an even day would put in a window this wide. A
           six-hour window holding a quarter of everything is unremarkable; a
           six-hour window holding half of it is the thing worth saying. */
        const excess = share - len / 24;
        if (!best || excess > best.excess) best = { start, len, share, excess };
      }
    }
    if (!best) return null;

    /* The quietest hour is only worth naming if the record actually covers
       it. An export with nothing at all before six in the morning has no
       quietest hour, it has a gap, and calling a gap "quietest" is wrong. */
    let quietest = -1;
    for (let h = 0; h < 24; h++) {
      if (!counts[h]) continue;
      if (quietest < 0 || counts[h] < counts[quietest]) quietest = h;
    }
    const hh = (n) => String(((n % 24) + 24) % 24).padStart(2, "0") + ":00";
    return {
      from: hh(best.start),
      to: hh(best.start + best.len),
      hours: best.len,
      share: Math.round(best.share * 100),
      quiet: quietest >= 0 ? hh(quietest) : null,
    };
  }

  /* ---------- a habit ----------
   *
   * Hour of the day against day of the week. It is the only drawing here that
   * shows a rhythm rather than a quantity, and it is the reason this exists:
   * a list of ten thousand messages cannot tell you that you and one person
   * only ever talk on Sunday evenings, and one glance at this can.
   *
   * Takes timestamps. Anything with a `t` will do - messages, searches,
   * sign-ins - because a habit is a habit whatever it is a habit of.
   */
  const DAYNAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function grid(pts, opt) {
    const o = opt || {};
    const cell = o.cell || 11, gap = 2;
    const noun = o.noun || "item";
    const counts = [];
    for (let d = 0; d < 7; d++) counts.push(new Array(24).fill(0));
    let top = 0;
    for (const p of pts) {
      const at = new Date(p.t);
      if (isNaN(at)) continue;
      const d = at.getDay(), h = at.getHours();
      counts[d][h]++;
      if (counts[d][h] > top) top = counts[d][h];
    }
    if (!top) return "";

    let cells = "";
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const n = counts[d][h];
        const x = h * (cell + gap), y = d * (cell + gap);
        /* An empty hour is drawn, faintly. The gaps are half the point - a
           week with nothing before nine in the morning is a fact about the
           person, and a chart that only drew what happened would hide it. */
        /* A circle that grows as well as darkens. Two channels for one
           number is redundant on purpose - it survives being printed, and it
           survives whatever the reader's screen does to faint greys. */
        const f = n / top;
        const r = (cell / 2) * (n ? 0.42 + 0.58 * Math.sqrt(f) : 0.34);
        cells += '<circle class="hv-cell" cx="' + (x + cell / 2) + '" cy="' +
          (y + cell / 2) + '" r="' + r.toFixed(2) + '" fill="currentColor" opacity="' +
          (n ? (0.16 + 0.74 * f).toFixed(2) : "0.07") + '" data-hv-cell="' +
          esc(DAYNAME[d] + " " + String(h).padStart(2, "0") + ":00 &#183; " +
              n.toLocaleString() + " " + (n === 1 ? noun : noun + "s")) + '"/>';
      }
    }
    const w = 24 * (cell + gap) - gap, h = 7 * (cell + gap) - gap;
    return '<div class="hv-gridwrap"><div class="hv-gridy">' +
      [1, 3, 5].map((d) => "<span>" + DAYNAME[d] + "</span>").join("") + "</div>" +
      '<div class="hv-gridmain"><svg class="hv hv-grid" viewBox="0 0 ' + w + " " + h +
      '">' + cells + "</svg>" +
      '<div class="hv-gridx"><span>midnight</span><span>noon</span><span>23:00</span></div>' +
      "</div></div>";
  }

  /* ---------- a league table ----------
   *
   * Who, or what, most - and by how much. HTML rather than SVG because it is
   * a list with a bar behind it, and a list should be selectable, searchable
   * and readable by a screen reader. */
  function ranked(items, opt) {
    const o = opt || {};
    const rows = items.slice(0, o.limit || 8);
    if (!rows.length) return "";
    const top = Math.max.apply(null, rows.map((r) => r.n)) || 1;
    return '<ol class="hv-rank">' + rows.map((r) =>
      "<li><span class=\"hv-rank-k\">" + esc(r.name) + "</span>" +
      '<span class="hv-rank-bar"><i style="width:' +
        Math.max(2, Math.round((r.n / top) * 100)) + '%"></i></span>' +
      '<span class="hv-rank-n">' + r.n.toLocaleString() +
      (r.note ? '<em>' + esc(r.note) + "</em>" : "") + "</span></li>").join("") + "</ol>";
  }

  /* ---------- a composition ---------- */

  /* What a night is made of. Only drawn when the export actually breaks sleep
     into stages - most do not, and an invented split would be the worst thing
     on the page. */
  function stack(parts, opt) {
    const o = opt || {};
    const w = o.w || 300, h = o.h || 14;
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    let x = 0, out = "";
    parts.forEach((p, i) => {
      const bw = (p.v / total) * w;
      out += '<rect x="' + x.toFixed(1) + '" y="0" width="' + Math.max(0, bw - 1.5).toFixed(1) +
        '" height="' + h + '" rx="3" fill="currentColor" opacity="' +
        (0.75 - i * 0.22).toFixed(2) + '"><title>' + esc(p.label) + " " +
        Math.round((p.v / total) * 100) + "%</title></rect>";
      x += bw;
    });
    return svg(w, h, out, "hv-stack");
  }

  /* ---------- what is under the pointer ---------- */

  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const day = (t) => {
    const d = new Date(t);
    return d.getDate() + " " + MONTH[d.getMonth()] + " " + d.getFullYear();
  };
  const monthOf = (t) => {
    const d = new Date(t);
    return MONTH[d.getMonth()] + " " + d.getFullYear();
  };

  /* Minutes are shown as hours wherever they are shown. "413" is not a
     quantity of sleep anybody recognises. */
  const asHours = (mins) => {
    const h = Math.floor(mins / 60), m = Math.round(mins - h * 60);
    return h + "h " + String(m).padStart(2, "0") + "m";
  };

  function fmtValue(v, meta) {
    if (meta && meta.hours) return asHours(v);
    const n = Math.abs(v) >= 100 ? Math.round(v)
      : Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
    return n.toLocaleString() + (meta && meta.unit ? " " + meta.unit : "");
  }

  /* The wording depends on the drawing, because the drawings mean different
     things. A bar is a stretch of days averaged, so it says which stretch. A
     band is a spread, so it says the spread and not only the middle. A dot is
     one occasion, so it says the day it happened. */
  function readout(kind, pt, meta) {
    const when = kind === "hv-bars" || kind === "hv-ridge" ? monthOf(pt.t) : day(pt.t);
    if (kind === "hv-band" && pt.lo !== undefined && pt.hi !== undefined) {
      return "<b>" + esc(fmtValue(pt.lo, meta)) + " to " + esc(fmtValue(pt.hi, meta)) +
        "</b><em>" + esc(when) + ", middle " + esc(fmtValue(pt.v, meta)) + "</em>";
    }
    return "<b>" + esc(fmtValue(pt.v, meta)) + "</b><em>" + esc(when) + "</em>";
  }

  /* A tooltip that says exactly what it was given, positioned at the pointer
     rather than above a chart. */
  function showText(text, x, y) {
    const el = tipEl();
    const bits = String(text).split("&#183;");
    el.innerHTML = "<b>" + (bits[1] ? bits[1].trim() : bits[0]) + "</b>" +
      (bits[1] ? "<em>" + bits[0].trim() + "</em>" : "");
    el.hidden = false;
    el.style.left = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6,
      x - el.offsetWidth / 2)) + "px";
    el.style.top = Math.max(6, y - el.offsetHeight - 14) + "px";
  }

  let tip = null;
  function tipEl() {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement("div");
    tip.className = "hv-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }

  function hide() {
    if (tip) tip.hidden = true;
    document.querySelectorAll(".hv .hv-cur").forEach((g) => g.setAttribute("opacity", "0"));
  }

  function show(chart, clientX) {
    let pts, meta;
    try {
      pts = JSON.parse(chart.getAttribute("data-hv") || "[]");
      meta = JSON.parse(chart.getAttribute("data-hv-meta") || "{}");
    } catch (e) { return; }
    if (!pts.length) return;

    const rect = chart.getBoundingClientRect();
    if (!rect.width) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.min(pts.length - 1, Math.max(0, Math.round(frac * (pts.length - 1))));
    const pt = pts[i];

    /* The cursor is positioned in the chart's own coordinates, which are not
       the screen's - preserveAspectRatio is none, so the box is stretched. */
    const box = (chart.getAttribute("viewBox") || "0 0 100 100").split(/\s+/).map(Number);
    const vw = box[2] || 100, vh = box[3] || 100;
    /* Where along the box the reading sits, which is not the same question
       for every chart. A line spreads its points from edge to edge, so the
       first sits at 0 and the last at the full width. Bars are boxes with a
       gap between them, so the reading is the middle of its bar - and using
       the line's spacing put the marker left of the first bars and right of
       the last, drifting further the nearer the ends, which is exactly what
       it looked like. */
    const nPts = Math.max(1, pts.length);
    let cx;
    if (chart.classList.contains("hv-bars")) {
      const gap = 1.6;
      const bw = Math.max(1.2, (vw - gap * (nPts - 1)) / nPts);
      cx = i * (bw + gap) + bw / 2;
    } else {
      cx = (i / Math.max(1, nPts - 1)) * vw;
    }
    const cur = chart.querySelector(".hv-cur");
    if (cur) {
      const l = cur.querySelector(".hv-cur-l");
      const d = cur.querySelector(".hv-cur-d");
      /* Moved with transforms, not with x and y attributes.
       *
       * Two reasons. A geometry attribute cannot be transitioned, so setting
       * cx and cy made the marker jump between readings; a transform can, so
       * it now travels. And because the marker slides along the straight run
       * between two points, and that run is exactly what the line draws, it
       * follows the line rather than cutting across it.
       *
       * The line keeps its own x at zero and rides the group. */
      if (l) { l.setAttribute("x1", 0); l.setAttribute("x2", 0); }
      if (d) {
        /* Measured against the same range the chart drew against.
         *
         * Every bucketed point carries a lo and a hi, and this took them for
         * all of them. Only the band is drawn against that spread; a line, a
         * ridge, bars and dots are drawn against the values alone. So on any
         * series where the nightly spread is wider than the run of averages -
         * which is most of them - the marker was working in a taller scale
         * than the ink and sat above or below it by a fixed fraction, on every
         * chart, at every point. */
        const isBand = chart.classList.contains("hv-band");
        let lo = Math.min.apply(null, pts.map((q) => (isBand && q.lo !== undefined ? q.lo : q.v)));
        let hi = Math.max.apply(null, pts.map((q) => (isBand && q.hi !== undefined ? q.hi : q.v)));
        if (hi === lo) { lo -= 1; hi += 1; }
        /* Where the marker sits has to be worked out the way the chart it sits
           on was drawn, and the three do not agree.
           
           A line and a band map a value between lo and hi with a 3-unit pad.
           Bars grow from the floor against the highest value alone, so the top
           of a bar is nowhere near what that formula gives. A dot chart puts
           every dot on the same baseline and says the value with the radius,
           so its y barely moves at all. One formula for all three put the
           marker above or below the ink on two of them, which is exactly what
           was reported and only on some charts. */
        /* Each chart is asked where it drew the value, because the five do
           not agree and one formula for all of them put the marker off the
           ink on most.

             line, band  a value between lo and hi inside a 3-unit pad
             bars        grown from the floor against the highest value alone
             dots        one baseline, the value carried by the radius
             ridge       mirrored about the middle, so half the amplitude

           Anything else - the stack, the ranked bars, the grid, the clock -
           has a geometry this cannot reproduce, and a dot in the wrong place
           is worse than none. Those keep the vertical line and the readout,
           which is what people actually hover for, and lose the dot. */
        const cl = chart.classList;
        const kind = cl.contains("hv-bars") ? "bars"
                   : cl.contains("hv-dots") ? "dots"
                   : cl.contains("hv-ridge") ? "ridge"
                   : (cl.contains("hv-line") || cl.contains("hv-band")) ? "line" : "";
        let cy = null;
        if (kind === "bars") {
          const top = Math.max.apply(null, pts.map((q) => q.v)) || 1;
          cy = vh - Math.max(1, (pt.v / top) * (vh - 2));
        } else if (kind === "dots") {
          cy = vh - 2 - (1.4 + 1.8 * ((pt.v - lo) / (hi - lo)));
        } else if (kind === "ridge") {
          const mid = vh / 2;
          cy = mid - (((pt.v - lo) / (hi - lo)) * 0.78 + 0.22) * (vh / 2 - 2);
        } else if (kind === "line") {
          cy = vh - 3 - ((pt.v - lo) / (hi - lo)) * (vh - 6);
        }
        d.setAttribute("opacity", cy === null ? "0" : "1");
        if (cy === null) cy = vh / 2;
        /* preserveAspectRatio is none, so one user unit across is not one unit
           down and a circle renders as a wide blob. Undo the stretch from the
           box the chart is actually drawn at, so the marker is round. */
        const r = chart.getBoundingClientRect();
        /* preserveAspectRatio is none, so one unit across is not one unit down
           and anything round is drawn as a wide smear. Undoing the stretch
           from the box the chart is really rendered at makes the marker's own
           shape ours to choose rather than whatever the width imposed. */
        const k = (r.width && r.height) ? (r.height * vw) / (vh * r.width) : 1;

        d.setAttribute("cx", 0);
        d.setAttribute("cy", 0);
        d.setAttribute("transform", "translate(0," + cy + ") scale(" + k.toFixed(4) + ",1)");
      }
      cur.setAttribute("transform", "translate(" + cx + ",0)");
      cur.setAttribute("opacity", "1");
    }

    const el = tipEl();
    el.innerHTML = readout(chart.classList.contains("hv-band") ? "hv-band"
      : chart.classList.contains("hv-bars") ? "hv-bars"
      : chart.classList.contains("hv-dots") ? "hv-dots"
      : chart.classList.contains("hv-ridge") ? "hv-ridge" : "hv-line", pt, meta);
    el.hidden = false;
    const tw = el.offsetWidth;
    el.style.left = Math.max(6, Math.min(window.innerWidth - tw - 6,
      rect.left + frac * rect.width - tw / 2)) + "px";
    el.style.top = Math.max(6, rect.top - el.offsetHeight - 9) + "px";
  }

  /* One listener for every chart in a view, rather than one per chart. The
     charts are rebuilt whenever the view redraws, and a per-chart listener
     would have to be re-attached each time or leak. */
  function hover(scope) {
    if (!scope || scope.dataset.hvWired) return;
    scope.dataset.hvWired = "1";
    scope.addEventListener("pointermove", (e) => {
      /* A grid cell already knows what it says - it is one hour of one day,
         not a position along a line - so it carries its own text and needs no
         lookup. */
      const cell = e.target.closest && e.target.closest("[data-hv-cell]");
      if (cell) { showText(cell.getAttribute("data-hv-cell"), e.clientX, e.clientY); return; }
      const chart = e.target.closest && e.target.closest(".hv[data-hv]");
      if (!chart) { hide(); return; }
      show(chart, e.clientX);
    });
    scope.addEventListener("pointerleave", hide);
    /* A scroll moves the chart out from under a tooltip that is positioned
       against the window. */
    scope.addEventListener("scroll", hide, true);
  }

  return { bars, line, band, dots, dial, ridge, stack, grid, ranked,
           ticks, clock, busiestRun, bucket, esc, hover, asHours };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MCharts;
