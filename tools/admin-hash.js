#!/usr/bin/env node
"use strict";

/* Turn a password into the thing that gets deployed.
 *
 *   node tools/admin-hash.js
 *
 * Run this on your own machine. It asks for a password without echoing it,
 * prints a scrypt hash, and never writes anything to disk or sends anything
 * anywhere. Put the printed line in the ADMIN_HASH environment variable on
 * the deployment.
 *
 * The password itself must never be typed into a file in this repository.
 * This repo is published, and a commit is forever even if the file is deleted
 * in the next one.
 *
 * The cost parameters are chosen to take roughly a tenth of a second on an
 * ordinary machine, which nobody notices once a day and which makes guessing
 * at scale hopeless.
 */

const crypto = require("crypto");
const readline = require("readline");

const N = 16384, r = 8, p = 1, KEYLEN = 32;

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /* Nothing is echoed, so a password does not end up in a screenshot or in
       whatever is scrolled back through afterwards. */
    /* Built from their codes rather than typed. A literal escape or
       end-of-transmission byte in the source is invisible in every editor
       and above ASCII 126, which check.js refuses - and it was right to. */
    const ESC = String.fromCharCode(27);
    const EOT = String.fromCharCode(4);
    const CLEAR = ESC + "[2K" + ESC + "[200D";
    const onKey = (char) => {
      const s = String(char);
      if (s === "\n" || s === "\r" || s === EOT) return;
      rl.output.write(CLEAR + prompt);
    };
    rl.output.write(prompt);
    process.stdin.on("data", onKey);
    rl.question("", (answer) => {
      process.stdin.removeListener("data", onKey);
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  const pw = (await ask("Password (not shown): ")).trim();
  if (pw.length < 12) {
    console.error("\nToo short. Use at least twelve characters - this is the only lock on the page.");
    process.exit(1);
  }
  const again = (await ask("Again: ")).trim();
  if (pw !== again) {
    console.error("\nThose did not match.");
    process.exit(1);
  }

  const salt = crypto.randomBytes(16);
  const t0 = Date.now();
  const hash = crypto.scryptSync(pw, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const ms = Date.now() - t0;

  const line = ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");

  console.log("\nADMIN_HASH=" + line);
  console.log("\nHashing took " + ms + " ms, which is what every guess would cost too.");
  console.log("\nPut that line in the deployment's environment - on Vercel, Settings then");
  console.log("Environment Variables - and redeploy. Nothing else needs to change, and the");
  console.log("password itself is not stored anywhere, including here.");
  console.log("\nThe counters need a store as well: add Vercel KV to the project and it sets");
  console.log("KV_REST_API_URL and KV_REST_API_TOKEN by itself. Without those the site works");
  console.log("exactly as before and counts nothing.\n");
})();
