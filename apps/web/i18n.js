"use strict";

/* The app's words, in the reader's language.
 *
 *   T("Merged {n} exports", { n: 6 })
 *
 * The key is the English itself. That keeps every call site readable as the
 * sentence it prints, and it makes the failure mode a sentence in English
 * rather than a missing key or a blank: a string with no Norwegian entry
 * simply stays as it was. check.js lists every T("...") in the app and fails
 * if the Norwegian dictionary does not cover it, so that fallback is a net
 * rather than a habit.
 *
 * The Norwegian lives in no/i18n.js, which only the Norwegian app page loads.
 * The English page carries no dictionary at all.
 *
 * Only words a person reads go through here. Category ids, table names and
 * provider names that the code compares or looks things up by stay as they
 * are: translating a key is how a translation changes behaviour.
 */
const MI18N = (function () {
  const LANG = document.documentElement.lang === "nb" ? "nb" : "en";
  const LOCALE = LANG === "nb" ? "nb-NO" : "en-GB";
  const dict = Object.create(null);

  function add(entries) { Object.assign(dict, entries); }

  function fill(s, vars) {
    if (!vars) return s;
    for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
    return s;
  }

  function T(s, vars) {
    return fill(LANG === "nb" && dict[s] !== undefined ? dict[s] : s, vars);
  }

  /* A count and its noun: N("{n} file", "{n} files", 3). Norwegian has the
     same one/many split, so two forms are enough for both languages. */
  function N(one, many, n, vars) {
    return T(n === 1 ? one : many, Object.assign({ n: num(n) }, vars));
  }

  const num = (n) => Number(n || 0).toLocaleString(LOCALE);

  /* A decimal for people to read: "12.0" in English, "12,0" in Norwegian.
     Never for SVG coordinates or CSS values, which must keep the point. */
  const dec = (n, digits) => Number(n || 0).toLocaleString(LOCALE,
    { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /* Month and weekday names from the browser's own tables rather than six
     hand-written arrays of English. Norwegian writes them lower case and
     abbreviates with a full stop ("jan."); the full stop is dropped where a
     chart wants a bare label. Months start at January, days at Sunday, the
     same order Date uses. */
  const names = (opts, list) => list.map((d) =>
    new Intl.DateTimeFormat(LOCALE, opts).format(d).replace(/\.$/, ""));
  const months = (style) => names({ month: style, timeZone: "UTC" },
    Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2021, i, 15))));
  const days = (style) => names({ weekday: style, timeZone: "UTC" },
    Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2021, 0, 3 + i))));

  return { LANG, LOCALE, add, T, N, num, dec, months, days, has: (s) => dict[s] !== undefined };
})();

const T = MI18N.T;
const N = MI18N.N;
const LOC = MI18N.LOCALE;
