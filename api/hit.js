"use strict";

/* One page view, counted, with nobody attached to it.
 *
 * What this deliberately does not do is the whole design:
 *
 *   No cookie, no localStorage, no sessionStorage, nothing written to the
 *   device at all - which is what a consent banner exists to ask permission
 *   for. There is nothing to ask about.
 *
 *   No IP address stored, hashed, or derived from. Not even a rotating salted
 *   hash for counting unique visitors, which is the usual privacy-preserving
 *   trick and is still processing an identifier. So there is no such thing
 *   here as a visitor, a session, or a return visit - only counts.
 *
 *   No user agent string. A coarse browser family is recorded and the rest is
 *   thrown away, because the full string is close enough to a fingerprint to
 *   not be worth having.
 *
 *   Nothing at all from app.html. The page where somebody's export is open
 *   sends no request of any kind, so "watch the Network tab" stays a clean
 *   demonstration rather than one with an exception in it.
 *
 * What is left is a tally per day: how many views, of which pages, arriving
 * from which sites, in which countries. That is enough to know whether the
 * guides are read and not enough to know anything about anyone.
 */

const { configured, pipeline } = require("./_store");

const DAYS_KEPT = 400;                 // just over a year, for a year-on-year look
const TTL = DAYS_KEPT * 24 * 60 * 60;

/* Only pages that exist, and never the app. An open list would let anyone
   fill the store with invented paths. */
/* 404.html is in the list, and it is counted as itself rather than as the
   address that was asked for. How many people hit a missing page is worth
   knowing; which addresses they asked for comes from whoever typed them, and
   accepting those would be an open list anybody could fill with anything. */
const ALLOWED = /^\/(?:index\.html|guides\.html|pricing\.html|privacy\.html|404\.html|guides\/[a-z0-9-]{1,60}\.html|)$/;

const BROWSERS = [
  [/\bEdg\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

function browserOf(ua) {
  for (const [re, name] of BROWSERS) if (re.test(ua)) return name;
  return "Other";
}

/* Only the site somebody came from, never the page. A full referring URL can
   carry a search query, and a search query can carry anything. */
function refHost(raw, ownHost) {
  if (!raw) return "direct";
  let h;
  try { h = new URL(raw).hostname.replace(/^www\./, ""); } catch { return "direct"; }
  if (!h || h === ownHost || h === "muletto.app") return "direct";
  if (h.length > 60) return "other";
  return h.toLowerCase();
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = async function handler(req, res) {
  /* A beacon is fire and forget: it never reads the answer, so the answer is
     "no content" whatever happened. A counter that fails must never be a
     thing the reader can notice. */
  const done = (code) => { res.statusCode = code; res.end(); };

  if (req.method !== "POST") return done(405);
  if (!configured()) return done(204);

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== "object") return done(204);

  const path = String(body.p || "").slice(0, 120);
  if (!ALLOWED.test(path)) return done(204);

  const day = today();
  const host = String(req.headers["host"] || "").replace(/^www\./, "").split(":")[0];
  const ref = refHost(body.r, host);
  const browser = browserOf(String(req.headers["user-agent"] || ""));
  /* Vercel works the country out at the edge and puts it in a header, so
     nothing here has to look at an address to know it. */
  const country = String(req.headers["x-vercel-ip-country"] || "??").slice(0, 2).toUpperCase();
  const mobile = body.m === true ? "mobile" : "desktop";

  /* One key per day, one field per thing counted.
   *
   * This was six sorted sets and six EXPIREs and an index - thirteen commands
   * for one page view - which matters because the store is billed by the
   * command. A hash does the same job in six, reads back in one instead of
   * six, and needs a single expiry rather than six. The whole day is one key,
   * so it also expires as one thing.
   *
   * The prefixes are how a field says what it is. Anything unrecognised is
   * ignored on the way out, so a field added later cannot break an older
   * reader. */
  const key = "mu:d:" + day;
  const cmds = [
    ["HINCRBY", key, "pv", 1],
    ["HINCRBY", key, "p:" + path, 1],
    ["HINCRBY", key, "r:" + ref, 1],
    ["HINCRBY", key, "g:" + country, 1],
    ["HINCRBY", key, "u:" + browser, 1],
    ["HINCRBY", key, "d:" + mobile, 1],
  ];

  try {
    const out = await pipeline(cmds);
    /* The expiry is set once, by whoever counted the first view of the day,
       rather than on every view for the rest of it. HINCRBY returns the new
       total, so a 1 is that first view. Costs one command a day instead of
       one per view. */
    if (out && Number(out[0]) === 1) {
      await pipeline([["EXPIRE", key, TTL]]);
    }
  } catch { /* a lost count is not worth an error */ }
  return done(204);
};
