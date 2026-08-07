"use strict";

/* Muletto - drawing health data as the shape it actually is.
 *
 * The health page used to draw one sparkline, fourteen times. Every panel
 * looked identical, so the page read as a spreadsheet with the gridlines
 * turned off: nothing about a picture of your weight told you it was weight
 * rather than your step count.
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

const MHealthViz = (function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const svg = (w, h, inner, cls) =>
    '<svg class="hv ' + (cls || "") + '" viewBox="0 0 ' + w + " " + h +
    '" preserveAspectRatio="none" aria-hidden="true">' + inner + "</svg>";

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
      out.push({
        t: (a + b) / 2,
        v: vals.reduce((s, x) => s + x, 0) / vals.length,
        lo: Math.min.apply(null, vals),
        hi: Math.max.apply(null, vals),
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
    return svg(w, h, out, "hv-bars");
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
      '" r="2.4" fill="currentColor"/>', "hv-line");
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
      'stroke-linecap="round" vector-effect="non-scaling-stroke"/>', "hv-band");
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
    return svg(w, h, out, "hv-dots");
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
      '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + top + " " + back.join(" ") + ' Z" fill="currentColor" opacity="0.17"/>' +
      '<path d="' + top + '" fill="none" stroke="currentColor" stroke-width="1" ' +
      'opacity="0.45" vector-effect="non-scaling-stroke"/>' + "</svg>";
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
        (0.75 - i * 0.22).toFixed(2) + '"/>';
      x += bw;
    });
    return svg(w, h, out, "hv-stack");
  }

  return { bars, line, band, dots, dial, ridge, stack, bucket, esc };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MHealthViz;
