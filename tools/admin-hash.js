#!/usr/bin/env node
"use strict";

/* Turn a password into the thing that gets deployed.
 *
 *   node tools/admin-hash.js
 *
 * Run this on your own machine. It asks for a password without showing it,
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

const N = 16384, r = 8, p = 1, KEYLEN = 32;

/* Control characters built from their codes. Typing them literally puts bytes
   outside printable ASCII into the source, which check.js refuses - and it is
   right to, because they are invisible in every editor. */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const ETX = String.fromCharCode(3);         // Ctrl-C
const EOT = String.fromCharCode(4);         // Ctrl-D
const BS = String.fromCharCode(8);
const DEL = String.fromCharCode(127);

/* Read a line without showing it.
 *
 * The first version of this tried to hide the typing by writing an erase
 * sequence after every keypress. That is a race the terminal wins: the
 * password appeared on screen anyway, and on Windows the second prompt then
 * hung. It was caught by running the thing rather than by reading it.
 *
 * Raw mode is the version that works. The terminal stops echoing entirely and
 * hands over one character at a time, so nothing is ever drawn that has to be
 * erased afterwards.
 *
 * When stdin is not a terminal - piped, or driven by a script - there is
 * nothing to hide from and no raw mode to set, so it reads a plain line. That
 * is also what makes this testable without a person typing a real password.
 */
/* Piped input is read once, whole, and handed out a line at a time.
 *
 * Reading it a line at a time instead does not work: pausing the stream after
 * the first line loses whatever arrived with it, so the second prompt waits
 * forever on a stream that has already ended. */
let piped = null;
function pipedLines() {
  if (piped) return piped;
  let text = "";
  try {
    text = require("fs").readFileSync(0, "utf8");
  } catch (e) { text = ""; }
  piped = text.split(LF).map((l) => l.replace(/\r$/, ""));
  return piped;
}

function ask(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      const lines = pipedLines();
      resolve(lines.length ? lines.shift() : "");
      return;
    }

    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let buf = "";
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === CR || ch === LF) return finish(buf);
        if (ch === ETX) return finish("", 130);
        if (ch === EOT && !buf) return finish("", 130);
        if (ch === DEL || ch === BS) { buf = buf.slice(0, -1); continue; }
        if (ch.charCodeAt(0) < 32) continue;      // arrows, escapes, tabs
        buf += ch;
      }
    };
    const finish = (value, code) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write(LF);
      if (code !== undefined) process.exit(code);
      resolve(value);
    };

    stdin.on("data", onData);
  });
}

(async () => {
  const pw = (await ask("Password (not shown): ")).trim();
  if (pw.length < 12) {
    console.error("Too short. Use at least twelve characters - this is the only lock on the page.");
    process.exit(1);
  }
  const again = (await ask("Again: ")).trim();
  if (pw !== again) {
    console.error("Those did not match. Nothing was written; run it again.");
    process.exit(1);
  }

  const salt = crypto.randomBytes(16);
  const t0 = Date.now();
  const hash = crypto.scryptSync(pw, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const ms = Date.now() - t0;

  const line = ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");

  console.log("");
  console.log("ADMIN_HASH=" + line);
  console.log("");
  console.log("Hashing took " + ms + " ms, which is what every guess would cost an attacker too.");
  console.log("");
  console.log("Next, on Vercel:");
  console.log("  1. Settings, then Environment Variables. Add ADMIN_HASH with the value above.");
  console.log("  2. Storage, then create a KV store and connect it to this project. That sets");
  console.log("     KV_REST_API_URL and KV_REST_API_TOKEN by itself.");
  console.log("  3. Redeploy.");
  console.log("");
  console.log("Without step 1 the usage page says so and lets nobody in. Without step 2 the");
  console.log("site works exactly as it always has and counts nothing.");
  console.log("");
  console.log("The password is not stored anywhere, including here. Lose it and run this again.");
  console.log("");
})();
