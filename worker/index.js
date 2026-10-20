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
 * The owner check is Cloudflare Access, not a password. The scrypt check that
 * guarded this on Vercel was expensive on purpose, which made it the thing
 * strangers spent the allowance on - and it would not fit in the free plan's
 * processor limit here anyway. Access stops a stranger at Cloudflare's edge
 * before this code runs, and the signed token it adds is verified below so the
 * workers.dev address cannot be used to walk round it.
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

/* ---------- the owner check ---------- */

let certs = null, certsAt = 0;
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")
  .padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function accessOk(req, env) {
  const team = env.ACCESS_TEAM, aud = env.ACCESS_AUD;
  if (!team || !aud) return { ok: false, why: "Cloudflare Access is not configured for this deployment." };
  const tok = req.headers.get("cf-access-jwt-assertion");
  if (!tok) return { ok: false, why: "Not signed in through Cloudflare Access." };
  const [h, p, s] = tok.split(".");
  if (!s) return { ok: false, why: "Malformed Access token." };
  let head, claims;
  try {
    head = JSON.parse(new TextDecoder().decode(b64u(h)));
    claims = JSON.parse(new TextDecoder().decode(b64u(p)));
  } catch (e) { return { ok: false, why: "Malformed Access token." }; }

  if (!certs || Date.now() - certsAt > 3600e3) {
    const r = await fetch("https://" + team + ".cloudflareaccess.com/cdn-cgi/access/certs");
    certs = (await r.json()).keys || [];
    certsAt = Date.now();
  }
  const jwk = certs.find((k) => k.kid === head.kid);
  if (!jwk) return { ok: false, why: "Access token signed by an unknown key." };
  const key = await crypto.subtle.importKey("jwk", jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s),
    new TextEncoder().encode(h + "." + p));
  const auds = [].concat(claims.aud || []);
  if (!good || !auds.includes(aud) || (claims.exp || 0) * 1000 < Date.now()) {
    return { ok: false, why: "Access token did not verify." };
  }
  return { ok: true };
}

async function stats(req, env) {
  const who = await accessOk(req, env);
  if (!who.ok) return json(401, { error: who.why });
  if (!env.COUNTS) return json(200, { configured: false, days: [], found: [] });
  let body = {};
  try { body = await req.json(); } catch (e) { /* defaults */ }
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
    configured: true, days: perDay, total: perDay.reduce((a, b) => a + b.views, 0),
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
