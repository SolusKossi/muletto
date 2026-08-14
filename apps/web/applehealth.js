"use strict";

/* Muletto - Apple Health's export.xml.

   Health is not in Apple's Data and Privacy export and never will be: it is
   end-to-end encrypted in iCloud, so Apple holds a blob it has no key for.
   This file comes off the phone instead, and it is one XML document with an
   element per reading.

   Measured on a real one: 161 MB of XML in a 6.8 MB zip, 383,000 records
   across four years in 16 types. That is why this streams and never builds a
   document - the same reason mbox.js streams a mailbox.

   Records are aggregated to one value per day as they go by. Nothing else is
   viable: a chart of 87,000 basal energy readings is a solid block of ink,
   and holding them to find that out costs more memory than the file. A day is
   also the unit every one of these is actually read in.

   Not a general XML parser. It scans for Record tags and reads four
   attributes out of each by hand, because a parser that understands XML would
   spend all its time on structure this file does not have. */

const MAppleHealth = (function () {

  /* Totals over a day, against readings taken during it.
   *
   * Steps and distance accumulate - twelve step counts in an hour are twelve
   * separate parts of the same walk and the day's figure is their sum. A
   * heart rate does not accumulate; twelve readings are twelve samples of one
   * thing and the day's figure is their average. Getting this backwards gives
   * a resting heart rate in the thousands. */
  const SUMMED = /^(StepCount|FlightsClimbed|DistanceWalking|DistanceCycling|DistanceSwimming|ActiveEnergyBurned|BasalEnergyBurned|AppleExerciseTime|AppleStandTime|DietaryWater|SwimmingStrokeCount|PushCount|Sleep(Asleep|InBed))/;

  /* Camel case is not a label. StepCount reads as "Step count", and it has to
     happen before anything is matched as well as before it is shown - the
     catalogue looks for "energy burned" with a space in it, which
     ActiveEnergyBurned does not have and "Active energy burned" does. */
  function readable(type) {
    const s = type.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                  .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /* One attribute out of a tag body, without building a regex per record.
     At 383,000 records that difference is the whole runtime. */
  function attr(s, name) {
    const key = " " + name + '="';
    const i = s.indexOf(key);
    if (i < 0) return "";
    const from = i + key.length;
    const end = s.indexOf('"', from);
    return end < 0 ? "" : s.slice(from, end);
  }

  const TYPE_RE = /^HK[A-Za-z]*TypeIdentifier([A-Za-z]+)$/;

  /* Apple writes "2026-08-14 07:23:45 +0200", which is not ISO 8601 and which
     Date.parse rejects: a space instead of a T, and an offset with no colon
     sitting after another space. Swapping only the first space, which is the
     obvious fix, leaves the offset dangling and still fails - and the failure
     is silent, so the first version of this dropped every sleep record and
     simply showed no sleep at all. */
  function stamp(s) {
    return Date.parse(s.replace(" ", "T").replace(/\s*([+-]\d{2})(\d{2})$/, "$1:$2"));
  }

  /* Index a Health export from a byte stream.

     onProgress(bytesRead, recordsSeen) fires per chunk. Returns one entry per
     record type, each holding a sorted array of [day, value] and the unit
     Apple used. */
  async function index(stream, { onProgress = null, maxTypes = 200 } = {}) {
    const reader = stream.getReader();
    const dec = new TextDecoder("utf-8");        // the file is UTF-8; latin-1 mangles device names
    const byType = new Map();                    // type -> { unit, days: Map<day, {sum,n}> }
    let carry = "", read = 0, records = 0, skipped = 0;
    let minDay = "9999-99-99", maxDay = "";

    const bump = (type, unit, day, value) => {
      let t = byType.get(type);
      if (!t) {
        if (byType.size >= maxTypes) return;
        t = { unit: unit || "", days: new Map() };
        byType.set(type, t);
      }
      if (!t.unit && unit) t.unit = unit;
      let d = t.days.get(day);
      if (!d) { d = { sum: 0, n: 0 }; t.days.set(day, d); }
      d.sum += value; d.n++;
      if (day < minDay) minDay = day;
      if (day > maxDay) maxDay = day;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      const text = carry + dec.decode(value, { stream: true });

      let at = 0;
      for (;;) {
        const open = text.indexOf("<Record ", at);
        if (open < 0) break;
        const close = text.indexOf(">", open);
        /* A record split across two chunks: leave it in the carry and pick it
           up whole next time round. */
        if (close < 0) break;
        /* From the space, not past it. `attr` looks for ` name="` with the
           separator included so it cannot match the tail of another attribute
           name, which means the body has to start with one. Slicing at +8
           dropped it and every single record was rejected for having no type
           - 399,512 of them, silently, because a skip counter is not an
           error. */
        const body = text.slice(open + 7, close);
        at = close + 1;

        const rawType = attr(body, "type");
        const m = TYPE_RE.exec(rawType);
        if (!m) { skipped++; continue; }
        const type = m[1];
        const start = attr(body, "startDate");
        if (start.length < 10) { skipped++; continue; }
        const day = start.slice(0, 10);
        records++;

        if (type === "SleepAnalysis") {
          /* No number on a sleep record - the value is a category. What is
             wanted is how long it lasted, so the hours come from the two
             dates. Filed against the day it began, so a night that crosses
             midnight stays one night. */
          /* Apple records sleep as overlapping spans, and which spans exist
             depends on the hardware. A watch worn overnight writes AsleepCore,
             AsleepDeep and AsleepREM; a phone alone writes only InBed, which
             is when you put it down and not when you slept. Summing all of
             them together double-counts the same hours, so they are kept
             apart here and one is chosen at the end.

             Measured on a real export: 1,872 records, every one InBed and not
             a single Asleep among them. Filtering to Asleep, which is the
             obvious way to write this, would have shown no sleep at all. */
          const cat = attr(body, "value");
          const key = /Asleep/i.test(cat) ? "SleepAsleep"
                    : /InBed/i.test(cat) ? "SleepInBed" : "";
          if (!key) { skipped++; continue; }        // Awake spans are not sleep
          const a = stamp(start);
          const b = stamp(attr(body, "endDate"));
          if (isFinite(a) && isFinite(b) && b > a) bump(key, "hr", day, (b - a) / 3600000);
          continue;
        }

        const v = Number(attr(body, "value"));
        if (!isFinite(v)) { skipped++; continue; }
        bump(type, attr(body, "unit"), day, v);
      }

      /* Exactly what has not been consumed, and nothing else.
       *
       * This used to keep the last kilobyte regardless of how far the scan had
       * got. Where a chunk happened to end just after a run of records, those
       * records sat in the carry and were counted a second time on the next
       * pass - and because the sums are what the charts draw, a double-counted
       * step record inflates that day's total rather than showing up as an
       * error.
       *
       * It was invisible until the same file was read twice with different
       * chunk sizes: Node reported 399,511 records and the browser 388,873.
       * Neither was right. `at` is the index after the last tag consumed, so
       * slicing there is exact and cannot do either. */
      carry = text.slice(at);
      if (onProgress) onProgress(read, records);
    }

    /* One sleep series, named after what was actually measured.
     *
     * Time in bed is not sleep and labelling it "Sleep" would be a claim the
     * data does not support - the phone knows when it was put down, not when
     * anybody fell asleep. So the watch figure wins where it exists, and where
     * it does not the series says what it really is. */
    if (byType.has("SleepAsleep")) byType.delete("SleepInBed");
    const SLEEP_LABEL = { SleepAsleep: "Sleep", SleepInBed: "Time in bed" };

    const types = [];
    for (const [type, t] of byType) {
      const points = [];
      const summed = SUMMED.test(type);
      for (const [day, d] of t.days) {
        points.push([day, summed ? d.sum : d.sum / d.n]);
      }
      points.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      types.push({
        type, label: SLEEP_LABEL[type] || readable(type), unit: t.unit,
        aggregate: summed ? "total" : "average",
        days: points.length, points,
      });
    }
    types.sort((a, b) => b.days - a.days);
    return {
      types, records, skipped, bytesRead: read,
      span: maxDay ? { from: minDay, to: maxDay } : null,
    };
  }

  return { index, readable, SUMMED };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MAppleHealth;
