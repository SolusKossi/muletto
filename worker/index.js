"use strict";

/* The only code on the deployment that runs anywhere but the reader's browser.
 *
 * wrangler.jsonc sends /api/* here and nothing else, so every page, script and
 * picture is served straight from Cloudflare's asset store without running a
 * line of this. That is the property that matters most: the site was paused on
 * Vercel twice because functions sat in front of things, and here they cannot.
 *
 * Two routes, the same two the Vercel functions in api/ had:
 *
 *   POST /api/hit    one page view, counted with nobody attached to it
 *   POST /api/stats  the counts, for the owner only
 *
 * The owner check is a long random key compared by hash - see below for why
 * that, rather than a password, is what lets it be cheap.
 */

const DAYS_KEPT = 400;
const ALLOWED = /^\/(?:no\/)?(?:index\.html|guides\.html|privacy\.html|404\.html|guides\/[a-z0-9-]{1,60}\.html|)$/;
const BROWSERS = [[/\bEdg\//, "Edge"], [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\//, "Firefox"], [/\bChrome\//, "Chrome"], [/\bSafari\//, "Safari"]];

const json = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- the counter ---------- */

async function hit(req, env) {
  const none = new Response(null, { status: 204 });
  if (!env.COUNTS) return none;
  let body;
  try { body = await req.json(); } catch (e) { return none; }
  const path = String((body && body.p) || "").slice(0, 120);
  if (!ALLOWED.test(path)) return none;

  let ref = "direct";
  try {
    const h = new URL(String(body.r || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (h && h !== "muletto.app" && !h.endsWith(".workers.dev")) ref = h.length > 60 ? "other" : h;
  } catch (e) { /* no referrer */ }
  const ua = req.headers.get("user-agent") || "";
  let browser = "Other";
  for (const [re, name] of BROWSERS) if (re.test(ua)) { browser = name; break; }
  /* Cloudflare works out the country at the edge; no address is looked at. */
  const country = String((req.cf && req.cf.country) || "??").slice(0, 2).toUpperCase();

  /* One key per day, a flat map of counts. Read, add, write: two views landing
     in the same instant can lose one, which for a tally like this is fine. */
  const key = "d:" + today();
  const day = (await env.COUNTS.get(key, "json")) || {};
  for (const f of ["pv", "p:" + path, "r:" + ref, "g:" + country, "u:" + browser,
                   "d:" + (body.m === true ? "mobile" : "desktop")]) {
    day[f] = (day[f] || 0) + 1;
  }
  try {
    await env.COUNTS.put(key, JSON.stringify(day), { expirationTtl: DAYS_KEPT * 86400 });
  } catch (e) { /* over the daily write allowance: a lost count, not an error */ }
  return none;
}

/* ---------- the owner check ----------
 *
 * A long random key, not a password, and that difference is the whole design.
 * A password a person chose can be guessed, so it needs a slow hash, and the
 * slow hash is what strangers spent the Vercel allowance on. A key from
 * tools/admin-key.js is 32 random characters - about 190 bits - and cannot be
 * guessed at any speed, so a plain SHA-256 comparison is enough and a wrong
 * guess costs microseconds. The deployment holds only the hash, as the secret
 * ADMIN_KEY_HASH; the key itself lives in the owner's password manager.
 *
 * A right answer gets a signed token valid for two hours, so the key is sent
 * once per session rather than with every request. */

const TOKEN_LIFE = 2 * 3600e3;
const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sign(env, exp) {
  const k = await crypto.subtle.importKey("raw", enc(env.ADMIN_KEY_HASH),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc(String(exp))));
}

async function owner(env, body) {
  const want = String(env.ADMIN_KEY_HASH || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) {
    return { ok: false, why: "No ADMIN_KEY_HASH is set on this deployment. Run node tools/admin-key.js." };
  }
  const tok = String(body.token || "");
  const dot = tok.indexOf(".");
  if (dot > 0) {
    const exp = Number(tok.slice(0, dot));
    if (exp > Date.now() && same(tok.slice(dot + 1), await sign(env, exp))) return { ok: true, token: tok };
  }
  const given = typeof body.password === "string" ? body.password.trim() : "";
  if (!given || given.length > 200) return { ok: false, why: "Wrong key." };
  if (!same(hex(await crypto.subtle.digest("SHA-256", enc(given))), want)) {
    return { ok: false, why: "Wrong key." };
  }
  const exp = Date.now() + TOKEN_LIFE;
  return { ok: true, token: exp + "." + await sign(env, exp) };
}

async function stats(req, env) {
  let body = {};
  try { body = await req.json(); } catch (e) { /* defaults */ }
  const who = await owner(env, body || {});
  if (!who.ok) return json(401, { error: who.why });
  if (!env.COUNTS) return json(200, { token: who.token, configured: false, days: [], found: [] });
  const n = Math.min(DAYS_KEPT, Math.max(1, Number(body.days) || 60));
  const list = [];
  for (let i = 0; i < n; i++) list.push(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10));
  const raws = await Promise.all(list.map((d) => env.COUNTS.get("d:" + d, "json")));

  const B = { "p:": new Map(), "r:": new Map(), "g:": new Map(), "u:": new Map(), "d:": new Map() };
  const perDay = raws.map((raw, i) => {
    const f = raw || {};
    for (const k of Object.keys(f)) {
      const b = B[k.slice(0, 2)];
      if (b) b.set(k.slice(2), (b.get(k.slice(2)) || 0) + (Number(f[k]) || 0));
    }
    return { day: list[i], views: Number(f.pv) || 0 };
  });
  const sorted = (m) => [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  return json(200, {
    token: who.token, configured: true, days: perDay, total: perDay.reduce((a, b) => a + b.views, 0),
    pages: sorted(B["p:"]).slice(0, 60), referrers: sorted(B["r:"]).slice(0, 40),
    countries: sorted(B["g:"]).slice(0, 40), browsers: sorted(B["u:"]), devices: sorted(B["d:"]),
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/hit") return req.method === "POST" ? hit(req, env) : json(405, {});
    if (url.pathname === "/api/stats") return req.method === "POST" ? stats(req, env) : json(405, {});
    if (url.pathname.startsWith("/api/")) return json(404, { error: "No such endpoint." });
    return env.ASSETS.fetch(req);
  },
};
