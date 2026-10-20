#!/usr/bin/env node
"use strict";

/* Make the key for the usage page, and the hash the deployment keeps.
 *
 *   node tools/admin-key.js
 *
 * Prints two lines. The KEY goes in your password manager and nowhere else.
 * The HASH goes into Cloudflare as the secret ADMIN_KEY_HASH. Nothing is
 * written to disk or sent anywhere.
 *
 * Random rather than chosen, because that is what lets the server check it
 * with a fast hash: 32 characters from 62 is about 190 bits, which no amount
 * of guessing reaches. Run it again to replace the key; the old one stops
 * working as soon as the new hash is saved.
 */

const crypto = require("crypto");
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let key = "";
while (key.length < 32) {
  const b = crypto.randomBytes(1)[0];
  if (b < 248) key += A[b % 62];          // 248 = 4 x 62, so no bias
}
const hash = crypto.createHash("sha256").update(key).digest("hex");
console.log("");
console.log("KEY  (password manager only): " + key);
console.log("HASH (Cloudflare secret ADMIN_KEY_HASH): " + hash);
console.log("");
