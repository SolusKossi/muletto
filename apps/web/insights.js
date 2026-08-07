/* Turn record tables into something worth looking at.
 *
 * The tables an export ships are database dumps: a heart rate table is
 * fourteen rows of create_time, datauuid, pkg_name and a number. Showing that
 * more prettily is still showing a spreadsheet, and the whole point of this
 * product is not having to read one.
 *
 * So this reads the shape rather than the service. A column that parses as
 * dates is a date; a column of numbers under a heading like amount is money; a
 * column with few distinct values repeated many times is a category. From that
 * it decides what the table is: a measurement over time, a purchase history, a
 * profile, a list of things. Each becomes a card that says something.
 *
 * Reading the shape rather than the service matters because the data is
 * lopsided. One person has fourteen heart rate readings from 2016 and another
 * has four hundred thousand; one has two purchases and another has eight
 * years of them. The same code has to produce something honest from both, so
 * every card degrades: a chart with three points draws three points and says
 * so rather than pretending to a trend.
 *
 * Nothing here touches the network or the disk. It is given parsed tables and
 * returns plain objects.
 */

const MInsight = (function () {
  /* ---------- reading a column ---------- */

  /* "total" alone is not money. Galaxy Store has a column called "Total
     download count" and it was totalled into a card reading "36 across 6
     charges" - a number with no unit pretending to be a receipt. */
  const MONEY_WORDS = /amount|price|paid|payment|cost|charge|\bfee\b|spend|revenue|\btax\b/i;
  const NOT_MONEY = /count|qty|quantity|number|index|rate$|percent/i;
  const COUNT_WORDS = /count|qty|quantity|number of|times/i;
  const ID_WORDS = /uuid|guid|^id$| id$|hash|token|key$|package|pkg|imei|serial|deviceid/i;
  const URL_WORDS = /url|link|address|site|domain/i;
  /* Bookkeeping the database needs and the reader does not. A profile card
     showing "Time offset 7200000" and "Goal type 40011" is the spreadsheet
     again, only with rounded corners. */
  const NOISE = /offset|uuid|guid|pkg|package|version|_?flag|revision|deviceid|device.?uuid|datauuid|^id$|[ _]id$|hash|token|sync|deleted|extra.?data|binning|checksum/i;
  const TITLE_WORDS = /title|name|app|content|subject|label|description|note|activity|item|product/i;

  // Currency signs by code point, because this file has to stay plain ASCII.
  // dollar, pound, euro, yen, won, rupee - as code points, so the source stays ASCII
  const SIGNS = String.fromCharCode(36, 163, 8364, 165, 8361, 8377);
  const CURRENCY = new RegExp(
    "^\\s*([A-Z]{3})?\\s*[" + SIGNS + "]?\\s*(-?[\\d.,]+)\\s*([A-Z]{3})?\\s*$");

  function looksNumeric(v) {
    if (v == null || v === "") return false;
    const m = String(v).match(CURRENCY);
    if (!m) return false;
    return /\d/.test(m[2]);
  }

  function toNumber(v) {
    const m = String(v == null ? "" : v).match(CURRENCY);
    if (!m) return NaN;
    let s = m[2];
    // 1,234.56 and 1.234,56 both occur. The last separator is the decimal one.
    const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* Exports date things in every format anyone has ever used. Milliseconds
     since the epoch turn up as bare integers, which is why a plain number of
     the right magnitude is treated as a date before it is treated as a count. */
  function toDate(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (/^\d{10}$/.test(s)) return stamp(parseInt(s, 10) * 1000);
    if (/^\d{13}$/.test(s)) return stamp(parseInt(s, 10));
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{4}\/\d{2}\/\d{2}/.test(s)) {
      const d = new Date(s.replace(" ", "T"));
      return isNaN(d) ? null : d;
    }
    if (/^\d{2}[/.]\d{2}[/.]\d{4}/.test(s)) {
      const p = s.slice(0, 10).split(/[/.]/);
      const d = new Date(+p[2], +p[1] - 1, +p[0]);
      return isNaN(d) ? null : d;
    }
    if (/^\d{8}$/.test(s)) {
      const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
      return isNaN(d) ? null : d;
    }
    if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s)) {
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }
    return null;
  }
  function stamp(ms) {
    // Anything outside living memory is a number that happens to be long.
    if (ms < 631152000000 || ms > Date.now() + 31536000000) return null;
    const d = new Date(ms);
    return isNaN(d) ? null : d;
  }

  /* Math.min(...array) passes every element as an argument, and an argument
     list has a limit. Four hundred thousand heart rate readings - an ordinary
     number for someone who has worn a watch for a few years - overflowed the
     stack and took the whole card down. */
  function extent(nums) {
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let i = 0; i < nums.length; i++) {
      const v = nums[i];
      if (!isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n++;
    }
    return n ? { min, max, sum, mean: sum / n, n } : { min: NaN, max: NaN, sum: 0, mean: NaN, n: 0 };
  }

  function readColumn(name, values) {
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    const n = nonEmpty.length;
    const col = { name, filled: n, distinct: 0, type: "text" };
    if (!n) { col.type = "empty"; return col; }

    const seen = new Set();
    for (const v of nonEmpty) { seen.add(String(v)); if (seen.size > 400) break; }
    col.distinct = seen.size;

    const sample = nonEmpty.slice(0, 60);
    const hit = (f) => sample.filter(f).length / sample.length;

    if (ID_WORDS.test(name)) { col.type = "id"; return col; }
    if (hit((v) => toDate(v) !== null) > 0.7) { col.type = "date"; return col; }
    if (hit(looksNumeric) > 0.8) {
      const signed = sample.some((v) => new RegExp("[" + SIGNS + "]").test(String(v)));
      col.type = (signed || (MONEY_WORDS.test(name) && !NOT_MONEY.test(name))) ? "money" : "number";
      const e = extent(nonEmpty.map(toNumber));
      col.min = e.min; col.max = e.max; col.sum = e.sum; col.mean = e.mean;
      return col;
    }
    if (hit((v) => /^https?:\/\//i.test(String(v))) > 0.6 || URL_WORDS.test(name)) {
      col.type = "url"; return col;
    }
    // Few values repeated many times is a category; mostly-unique text is a label.
    if (col.distinct > 1 && col.distinct <= Math.max(2, n / 3) && col.distinct <= 40) {
      col.type = "category"; return col;
    }
    if (TITLE_WORDS.test(name)) { col.type = "title"; return col; }
    return col;
  }

  function readTable(t) {
    const cols = t.columns.map((c, i) => readColumn(c, t.rows.map((r) => r[i])));
    return { table: t, cols,
      by: (type) => cols.filter((c) => c.type === type),
      idx: (c) => cols.indexOf(c) };
  }

  /* Field names and values as a person would write them.

     A profile card showed "height_unit cm", "birth_date 19951005", "disclosure
     Y". Every one of those is readable and none of them is written the way
     anybody writes. The keys come from inside the data here, not from the
     column headings, so the parser's tidying never reached them. */
  const KEY_WORDS = {
    dob: "Born", birth: "Born", birthdate: "Born", birthday: "Born",
    id: "ID", url: "URL", uuid: "UUID", os: "OS", sa: "Samsung account",
  };
  function niceKey(name) {
    let s = String(name || "").trim();
    s = s.replace(/^[A-Z]{2,4}@/, "").replace(/^com\.samsung\.[a-z.]*/i, "");
    if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase();
    s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ")
         .replace(/\s+/g, " ").trim().toLowerCase();
    if (!s) return String(name || "");
    const flat = s.replace(/ /g, "");
    if (KEY_WORDS[flat]) return KEY_WORDS[flat];
    const out = s.split(" ").map((w) => KEY_WORDS[w] || w).join(" ");
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function niceValue(key, v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return s;
    if (/^[YN]$/i.test(s)) return s.toUpperCase() === "Y" ? "Yes" : "No";
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true" ? "Yes" : "No";
    // 19951005 is a birthday, not eleven million.
    if (/date|birth|dob|time|created|updated/i.test(key)) {
      const d = toDate(s);
      if (d) return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
    }
    return s;
  }

  /* A cell that is a JSON document.

     S Note writes the whole record into one CSV field, so the list of 21 notes
     read as 21 lines of {"FILEDETAIL":[{"path":... Rejecting those left the
     notes invisible; the name of each one is sitting inside, under a key like
     path or title. Exports do this often enough to be worth handling once. */
  const NAME_KEY = /^(path|title|name|subject|filename|file|label|caption)$/i;
  function findNamed(node, depth) {
    if (depth > 4 || node == null) return null;
    if (Array.isArray(node)) {
      for (const x of node) { const hit = findNamed(x, depth + 1); if (hit) return hit; }
      return null;
    }
    if (typeof node !== "object") return null;
    for (const k of Object.keys(node)) {
      if (NAME_KEY.test(k) && typeof node[k] === "string" && node[k].trim()) return node[k];
    }
    for (const k of Object.keys(node)) {
      const hit = findNamed(node[k], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  function unwrap(v) {
    const s = String(v == null ? "" : v).trim();
    if (!/^[{[]/.test(s)) return s;
    let hit = null;
    try { hit = findNamed(JSON.parse(s), 0); } catch (e) { return ""; }
    if (!hit) return "";
    // A path is a name with the folders still attached.
    return String(hit).split(/[\/]/).filter(Boolean).pop()
      .replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  }

  /* ---------- units ---------- */

  /* A number with no unit is a number nobody can read. The unit is not in the
     data, so it comes from what the table is called. */
  const UNITS = [
    /* Before heart rate, deliberately: "heart_rate_variability" contains
       "heart_rate", and the first match wins. */
    [/\bhrv\b|variability/i, { unit: "ms", label: "Heart rate variability", agg: "mean" }],
    [/heart[ _]?rate|\bbpm\b|pulse/i, { unit: "bpm", label: "Heart rate", agg: "mean" }],
    [/weight/i, { unit: "kg", label: "Weight", agg: "last" }],
    [/height/i, { unit: "cm", label: "Height", agg: "last" }],
    [/step[ _]?count|\bsteps\b/i, { unit: "steps", label: "Steps", agg: "sum" }],
    [/sleep/i, { unit: "h", label: "Sleep", agg: "mean" }],
    [/calorie|nutrition|food/i, { unit: "kcal", label: "Calories", agg: "sum" }],
    [/distance/i, { unit: "m", label: "Distance", agg: "sum" }],
    [/blood[ _]?pressure/i, { unit: "mmHg", label: "Blood pressure", agg: "mean" }],
    [/oxygen|spo2/i, { unit: "%", label: "Blood oxygen", agg: "mean" }],
    [/stress/i, { unit: "", label: "Stress", agg: "mean" }],
    /* A watch records these every night and nothing here knew what they were,
       so six panels on the health page showed a reading count and no shape at
       all - which is the one thing a nightly measurement is good for. */
    [/respirat|breathing/i, { unit: "br/min", label: "Breathing rate", agg: "mean" }],
    [/skin[ _]?temp|temperature/i, { unit: "C", label: "Skin temperature", agg: "mean" }],
    [/floor/i, { unit: "floors", label: "Floors climbed", agg: "sum" }],
    [/water|caffeine|hydration/i, { unit: "", label: "Water", agg: "sum" }],
    [/exercise|workout|activity/i, { unit: "", label: "Exercise", agg: "count" }],
  ];
  function unitFor(name) {
    /* The rule travels with the unit it chose, so the column search below can
       ask it directly instead of guessing from the label. */
    for (const [re, u] of UNITS) if (re.test(name)) return Object.assign({ re }, u);
    return null;
  }

  /* ---------- shaping ---------- */

  const fmtNum = (n) => {
    if (!isFinite(n)) return "-";
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (Math.abs(n) >= 10000) return Math.round(n / 1000) + "k";
    if (Number.isInteger(n)) return n.toLocaleString();
    return (Math.round(n * 10) / 10).toLocaleString();
  };

  /* Money is not abbreviated the way a count is. "140M" for a total of 140
     kroner was wrong twice over, and even a correct "1.2k" reads badly against
     a currency - a total someone might recognise from a bank statement should
     be the number they would see there. */
  const fmtMoney = (n, code) => {
    if (!isFinite(n)) return "-";
    const body = Math.abs(n) >= 1000
      ? Math.round(n).toLocaleString()
      : (Math.round(n * 100) / 100).toLocaleString();
    return code ? body + " " + code : body;
  };

  // Smallest of the positive values, for deciding whether a column is in micros.
  const se0 = (list) => list.reduce((a, b) => (b < a ? b : a), Infinity);

  /* Points down to a drawable number without lying about the shape: an average
     per bucket, not a sample, so a spike between two kept points still shows. */
  function bucket(points, want) {
    if (points.length <= want) return points.slice();
    const first = points[0].t, last = points[points.length - 1].t;
    const span = last - first;
    // Everything at one instant cannot be spread over time; it is one point.
    if (span <= 0) {
      return [{ t: first, v: points.reduce((a, p) => a + p.v, 0) / points.length, n: points.length }];
    }
    /* One pass. Filtering the whole array once per bucket was 60 passes over
       50,000 readings, and a heavy Samsung Health export is far larger than
       that. Points arrive sorted, so a running index is enough. */
    const sums = new Float64Array(want), counts = new Float64Array(want);
    for (const p of points) {
      let b = Math.floor(((p.t - first) / span) * want);
      if (b >= want) b = want - 1;
      if (b < 0) b = 0;
      sums[b] += p.v;
      counts[b]++;
    }
    const out = [];
    for (let i = 0; i < want; i++) {
      if (!counts[i]) continue;
      out.push({ t: Math.round(first + (span * (i + 0.5)) / want),
                 v: sums[i] / counts[i], n: counts[i] });
    }
    return out;
  }

  function tally(values) {
    const m = new Map();
    for (const v of values) {
      const k = String(v == null ? "" : v).trim();
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
  }

  /* ---------- the cards ---------- */

  function cardsFor(t) {
    const r = readTable(t);
    const rows = t.rows;
    if (!rows.length) return [];
    const out = [];
    const dates = r.by("date");
    const money = r.by("money");
    const numbers = r.by("number");
    const cats = r.by("category");
    const titles = r.by("title");
    const urls = r.by("url");
    const unit = unitFor(t.name);

    const when = dates[0];
    const whenIdx = when ? r.idx(when) : -1;
    const dateOf = (row) => (whenIdx >= 0 ? toDate(row[whenIdx]) : null);
    const stamps = whenIdx >= 0 ? rows.map(dateOf).filter(Boolean).map((d) => +d).sort((a, b) => a - b) : [];
    const span = stamps.length ? { from: stamps[0], to: stamps[stamps.length - 1] } : null;

    /* A short table with one row per field is a profile, not a dataset. Samsung
       writes these as key/value pairs, which read as two useless columns until
       they are turned back into the record they describe. */
    const keyCol = r.cols.find((c) => /^key$|^field$|^name$|^attribute$/i.test(c.name));
    const valCol = r.cols.find((c) => /^value$|^text ?value$|^data$/i.test(c.name));
    if (keyCol && valCol && rows.length <= 60) {
      const ki = r.idx(keyCol), vi = r.idx(valCol);
      const facts = rows.map((x) => [String(x[ki] || "").trim(), String(x[vi] || "").trim()])
        .filter(([k, v]) => k && v && !NOISE.test(k))
        .map(([k, v]) => [niceKey(k), niceValue(k, v)]);
      if (facts.length) {
        out.push({ kind: "facts", title: t.name, source: t.source, path: t.path,
                   facts: facts.slice(0, 24), n: facts.length });
        return out;
      }
    }
    if (rows.length === 1 && t.columns.length > 2) {
      const facts = t.columns.map((c, i) => [c, String(rows[0][i] == null ? "" : rows[0][i]).trim()])
        .filter(([k, v]) => v && !ID_WORDS.test(k) && !NOISE.test(k))
        .map(([k, v]) => [niceKey(k), niceValue(k, v)]);
      if (facts.length >= 2) {
        out.push({ kind: "facts", title: t.name, source: t.source, path: t.path,
                   facts: facts.slice(0, 24), n: facts.length });
        return out;
      }
    }

    /* A number measured over time is the one thing worth a chart. */
    /* Which column is the measurement.

       Samsung's heart rate table has both heart_rate and heart_beat_count.
       Matching on the first word of the label picked the count, and the card
       read "1 bpm average" - a wrong number stated confidently, which is worse
       than no card at all. Match the whole name first, and never take a column
       that is an offset, an index or a running total. */
    /* `type` earns its place here: Samsung writes the kind of workout as a
       code - 1001 for running, 13001 for swimming - and it is the first
       numeric column in the table, so the Workouts panel charted those codes
       and reported the average of them falling by seven percent. A category
       that happens to be written as a number is not a measurement. */
    const NOT_A_MEASURE = /offset|index|_?id$|count$|type$|version|flag|zone|order/i;
    const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
    const usable = numbers.filter((c) => !NOT_A_MEASURE.test(c.name));
    /* A column named exactly `amount` or `value` is the measurement, whatever
       else is in the table. This used to come last, after a loose match on
       the rule that chose the unit, and the water table has both `amount` and
       `caffeine` in it - so /water|caffeine|hydration/ found caffeine and the
       Water panel charted cups of coffee. */
    const PLAIN = /^(value|amount|total|score|level|duration)$/i;
    let measure = null;
    if (unit) {
      const want = norm(unit.label);
      measure = usable.find((c) => norm(c.name) === want) ||
                usable.find((c) => norm(c.name).indexOf(want) >= 0) ||
                usable.find((c) => PLAIN.test(c.name.trim())) ||
                /* The label is a plural or a phrase and the column is not:
                   "Calories" never found "calorie", so the food table fell
                   through to the first numeric column and charted meal_type -
                   the numbers 1 to 4, presented as a calorie count. Asking
                   the rule that chose this unit in the first place is both
                   simpler and right. */
                usable.find((c) => unit.re && unit.re.test(c.name)) ||
                usable.find((c) => norm(c.name) === norm(t.name));
    }
    if (!measure) measure = usable.find((c) => PLAIN.test(c.name.trim()));
    /* Drawn from every numeric column rather than the filtered ones, because
       `count$` is excluded above for good reason - Samsung's heart rate table
       has heart_beat_count in it - and yet a column named exactly `count` is
       the measurement in its step table. An exact name is a strong enough
       signal to override a rule about suffixes. */
    if (!measure) measure = numbers.find((c) => /^count$/i.test(c.name.trim()));
    if (!measure && unit) measure = usable[0];
    if (when && measure && rows.length >= 2) {
      const mi = r.idx(measure);
      const pts = [];
      for (const row of rows) {
        const d = dateOf(row), v = toNumber(row[mi]);
        if (d && isFinite(v)) pts.push({ t: +d, v });
      }
      pts.sort((a, b) => a.t - b.t);
      if (pts.length >= 2) {
        const e = extent(pts.map((p) => p.v));
        const agg = (unit && unit.agg) || "mean";
        /* Sleep is written in minutes by Samsung and in hours by others, and
           the column says "duration" either way. Guessing from the name gave
           "413.2 h average", which is seventeen days asleep. The numbers
           themselves settle it: nobody sleeps twenty-four hours, so anything
           above that is minutes. */
        let unitText = (unit && unit.unit) || "";
        if (unitText === "h" && e.mean > 24) unitText = "min";
        const head = agg === "sum" ? e.sum
          : agg === "last" ? pts[pts.length - 1].v
          : agg === "count" ? pts.length
          : e.mean;
        out.push({
          kind: "series", title: (unit && unit.label) || t.name, source: t.source, path: t.path,
          unit: unitText,
          stat: fmtNum(head),
          statLabel: agg === "sum" ? "total" : agg === "last" ? "latest" : agg === "count" ? "records" : "average",
          low: fmtNum(e.min), high: fmtNum(e.max),
          /* Two readings that happen to be equal drew a full-width grey
             rectangle and a footer saying "56 low 56 high". There is no shape
             in two identical numbers, so there is no chart to draw. */
          chart: pts.length >= 4 && e.min !== e.max,
          points: bucket(pts, 60), n: pts.length, span,
        });
      }
    }

    /* Money is the one column everyone wants totalled. */
    if (money.length) {
      const m = money[0], mi = r.idx(m);
      const nums = rows.map((x) => toNumber(x[mi])).filter(isFinite);
      const spent = nums.filter((v) => v > 0);
      if (spent.length) {
        /* The currency is nearly always sitting in the next column along, and
           ignoring it produced the worst card in the app. YouTube live chats
           read "140M across 4 charges": the unit was missing, the total was in
           millionths, and 197 chat messages had been called charges because
           four of them carried a price.

           Google writes money in micros - millionths of a unit - wherever a
           currency code column sits beside the amount. Confirmed against a
           real export: four prices of magnitude 10^7 to 10^8 with the code
           NOK, which is 140 kroner rather than 140 million of anything.

           Scoped deliberately. The division only happens when there is a
           currency-code column next to the amount and every value is a whole
           number, because that pairing is what Google's exports do and an
           amount that is already in kroner is rarely a bare integer. */
        const curCol = r.cols.find((c) => /currency|curr[_ ]?code/i.test(c.name));
        const cui = curCol ? r.idx(curCol) : -1;
        const codes = cui >= 0
          ? [...new Set(rows.map((x) => String(x[cui] == null ? "" : x[cui]).trim()).filter(Boolean))]
          : [];
        const currency = codes.length === 1 ? codes[0] : null;
        const allWhole = spent.every((v) => Number.isInteger(v));
        const micros = !!currency && allWhole && se0(spent) >= 10000;
        const scale = micros ? 1e6 : 1;
        const byYear = new Map();
        if (whenIdx >= 0) {
          for (const row of rows) {
            const d = dateOf(row), v = toNumber(row[mi]);
            if (d && isFinite(v) && v > 0) {
              const y = d.getFullYear();
              byYear.set(y, (byYear.get(y) || 0) + v);
            }
          }
        }
        const se = extent(spent);
        out.push({
          kind: "money", title: t.name, source: t.source, path: t.path,
          stat: fmtMoney(se.sum / scale, currency),
          statLabel: "total", n: spent.length,
          /* How many rows the total actually came from, so a table where four
             rows in two hundred carry a price says so instead of implying the
             whole table was charges. */
          rows: rows.length,
          currency,
          biggest: fmtMoney(se.max / scale, currency),
          years: [...byYear.entries()].sort((a, b) => a[0] - b[0])
            .map(([label, v]) => ({ label: String(label), n: v / scale })),
          span,
        });
      }
    }

    /* Otherwise: what is in it, most common first. */
    /* A ranking of two things is not a ranking. Browser tabs split across two
       account names told the reader nothing; the titles of the tabs are what
       they came to see, and that is a list. */
    const rank = cats.find((c) => c.distinct >= 3) || null;
    if (rank && rows.length >= 4) {
      const bars = tally(rows.map((x) => x[r.idx(rank)])).slice(0, 8);
      if (bars.length >= 3) {
        out.push({ kind: "rank", title: t.name, subtitle: "By " + rank.name.toLowerCase(),
                   source: t.source, path: t.path, bars, n: rows.length, span });
      }
    }

    /* A list of named things - notes, tabs, apps - with a date if there is one. */
    /* Which column names the thing.

       Taking the first column matching /name/ picked ACCOUNT_NAME out of the
       browser tabs table, so a list of 56 tabs was the same email address
       printed 56 times. And S-Note stores a JSON blob per row, which was shown
       raw. Score the candidates instead, and look at the values. */
    const labelScore = (c) => {
      if (!c || c.type === "id" || c.type === "date" || NOISE.test(c.name)) return -1;
      const vals = rows.slice(0, 40).map((x) => unwrap(x[r.idx(c)])).filter(Boolean);
      if (!vals.length) return -1;
      // Paragraphs are not labels, and neither is a blob nothing could be read from.
      const junk = vals.filter((v) => /^[{[]/.test(v) || v.length > 90).length / vals.length;
      if (junk > 0.3) return -1;
      const got = vals.length / Math.max(1, Math.min(rows.length, 40));
      if (got < 0.5) return -1;
      let sc = 0;
      if (/title|subject|caption/i.test(c.name)) sc += 6;
      else if (/\bname\b/i.test(c.name)) sc += 2;
      else if (/app|content|item|product|label|note|activity/i.test(c.name)) sc += 4;
      if (c.type === "title") sc += 2;
      if (c.type === "url") sc += 1;
      // A column that repeats one value says nothing; one that is all distinct names things.
      sc += Math.min(4, (c.distinct / Math.max(1, Math.min(rows.length, 400))) * 4);
      if (c.distinct === 1) sc -= 6;
      return sc;
    };
    const label = r.cols
      .map((c) => ({ c, s: labelScore(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)[0];
    if (!out.length && label) {
      const li = r.idx(label);
      const items = rows.map((row) => ({
        label: unwrap(row[li]),
        at: dateOf(row) ? +dateOf(row) : null,
      })).filter((x) => x.label);
      if (items.length) {
        items.sort((a, b) => (b.at || 0) - (a.at || 0));
        /* Twelve are drawn and the rest are carried so the card can be opened
           without going back to the table. Sixty is where a card stops being
           a summary; past that the reader wants Records. */
        out.push({ kind: "list", title: t.name, source: t.source, path: t.path,
                   items: items.slice(0, 60), n: items.length, span });
      }
    }

    // Nothing recognisable, but a row count is still a fact.
    if (!out.length) {
      out.push({ kind: "count", title: t.name, source: t.source, path: t.path,
                 stat: fmtNum(rows.length), statLabel: rows.length === 1 ? "record" : "records", span });
    }
    return out;
  }

  /* Cards worth showing first. A chart of four hundred readings beats a count
     of two, and a card that is only a row count is the last thing anyone
     wants to see. */
  const WEIGHT = { series: 100, money: 90, facts: 70, rank: 60, list: 40, count: 10, other: 1 };
  function score(c) {
    return (WEIGHT[c.kind] || 0) + Math.min(30, Math.log10(Math.max(1, c.n || 1)) * 12);
  }

  /* refreshCounts redraws the sidebar on every filter change and asks how many
     cards there are each time. Building them is a full pass over every table,
     so the answer is remembered against the exact array it was built from. */
  let lastIn = null, lastOut = null;
  function build(tables) {
    if (tables === lastIn && lastOut) return lastOut;
    const out = buildNow(tables);
    lastIn = tables; lastOut = out;
    return out;
  }

  function buildNow(tables) {
    const cards = [];
    for (const t of tables || []) {
      try {
        for (const c of cardsFor(t)) cards.push(c);
      } catch (e) { /* one bad table must not cost the rest */ }
    }

    /* Tables nothing could be made of become one line each in a single card,
       rather than four cards apiece saying "1 record". Samsung ships a section
       per feature whether or not the feature was ever used, so an export is
       mostly empty sections and they should read as a footnote. */
    const thin = cards.filter((c) => c.kind === "count");
    if (thin.length > 1) {
      for (const c of thin) cards.splice(cards.indexOf(c), 1);
      cards.push({
        kind: "other", title: "Also in this export",
        note: "Tables with too little in them to chart.",
        rows: thin.map((c) => ({ label: c.title, n: c.n || 1, path: c.path })),
        n: thin.length,
      });
    }

    cards.sort((a, b) => score(b) - score(a));
    return cards;
  }

  return { build, cardsFor, extent, niceKey, niceValue, unwrap, readTable, readColumn, toDate, toNumber, fmtNum, bucket, tally };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MInsight;
