#!/usr/bin/env node
"use strict";

/* Tell Bing what changed, in one request.
 *
 *   node tools/ping-indexnow.js
 *
 * IndexNow is a small open protocol: you publish a key file at the root of the
 * site, then POST a list of URLs that changed, and the engines that speak it
 * re-fetch those within minutes rather than whenever they were next going to
 * look. Bing, Yandex, Seznam and Naver take it, and DuckDuckGo's results come
 * from Bing - so this covers everything except Google, which has no equivalent
 * and wants Search Console instead.
 *
 * The key is public on purpose. It sits at the root so an engine can check
 * that whoever sent the ping controls the site; there is nothing secret in it
 * and committing it is how it is meant to work.
 *
 * It sends the sitemap's own list, so it can never disagree with what the site
 * says about itself.
 */

const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "apps", "web");

function key() {
  const hit = fs.readdirSync(WEB).find((f) => /^[0-9a-f]{8,128}\.txt$/i.test(f));
  if (!hit) throw new Error("No IndexNow key file in apps/web. Expected <key>.txt");
  return hit.replace(/\.txt$/i, "");
}

function urls() {
  const xml = fs.readFileSync(path.join(WEB, "sitemap.xml"), "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

(async () => {
  const k = key();
  const list = urls();
  const host = new URL(list[0]).host;

  const body = {
    host,
    key: k,
    keyLocation: "https://" + host + "/" + k + ".txt",
    urlList: list,
  };

  console.log("Telling IndexNow about " + list.length + " URLs on " + host + "...");

  const res = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  /* 200 and 202 both mean accepted - 202 means the key is still being
     checked, which is normal on a first run. 403 means the key file is not
     reachable at the address above, which is the only thing that usually
     goes wrong. */
  const text = await res.text().catch(() => "");
  console.log("  " + res.status + " " + res.statusText + (text ? " " + text.slice(0, 200) : ""));
  if (res.status === 200 || res.status === 202) {
    console.log("\nAccepted. Bing, DuckDuckGo, Yandex and the rest will re-fetch shortly.");
    console.log("Google does not take IndexNow - use Search Console for that.");
  } else if (res.status === 403) {
    console.log("\nRefused: the key file could not be read at");
    console.log("  " + body.keyLocation);
    console.log("Deploy first, check that address opens in a browser, then run this again.");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
