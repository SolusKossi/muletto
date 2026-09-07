#!/usr/bin/env node
"use strict";

/* The failure budget in front of scrypt, exercised rather than read.
 *
 *   node tools/check-admin-gate.js
 *
 * This exists because the thing being checked is an absence: that a sixth
 * wrong password does *not* reach the hash. Reading the code tells you the
 * branch is in the right order; only counting the calls tells you it works.
 *
 * The store is faked with a Map, so nothing here needs Upstash, a network, or
 * a real password. What is not faked is api/stats.js itself - the real module
 * is loaded and the real handler called, because a test that reimplements the
 * logic it is testing agrees with itself and nothing else.
 *
 * scryptSync is wrapped to count how often it is reached. That counter is the
 * whole point of the file: every assertion below is really a statement about
 * how much processor time a stranger can spend.
 */

const crypto = require("crypto");
const path = require("path");
const Module = require("module");

const N = 16384, r = 8, p = 1, KEYLEN = 32;
const ROOT = path.join(__dirname, "..");
const PASSWORD = "a-password-only-this-test-knows";

const salt = crypto.randomBytes(16);
const want = crypto.scryptSync(PASSWORD, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
process.env.ADMIN_HASH = ["scrypt", N, r, p,
  salt.toString("base64"), want.toString("base64")].join("$");

/* The fake store. A Map, and enough of the Redis verbs that _store.pipeline
   is asked for. HGETALL answers empty because this file is about the gate,
   not about the counters behind it. */
const db = new Map();
let hashCalls = 0;

const realScrypt = crypto.scryptSync;
crypto.scryptSync = function () { hashCalls++; return realScrypt.apply(crypto, arguments); };

const realLoad = Module._load;
Module._load = function (request) {
  if (request === "./_store") {
    return {
      configured: () => true,
      foundVars: () => [],
      pipeline: async (cmds) => cmds.map((c) => {
        const op = c[0], key = c[1];
        if (op === "GET") return db.has(key) ? String(db.get(key)) : null;
        if (op === "INCR") { db.set(key, (db.get(key) || 0) + 1); return db.get(key); }
        if (op === "DEL") { db.delete(key); return 1; }
        if (op === "EXPIRE") return 1;
        if (op === "HGETALL") return {};
        return null;
      }),
    };
  }
  return realLoad.apply(this, arguments);
};

const handler = require(path.join(ROOT, "api", "stats.js"));

function call(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      out: {},
      setHeader(k, v) { this.out[k.toLowerCase()] = v; },
      end(s) { resolve({ code: this.statusCode, body: JSON.parse(s || "{}"), headers: this.out }); },
    };
    handler({ method: "POST", headers: {}, body }, res);
  });
}

let failed = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) failed++;
};

(async () => {
  console.log("\nThe admin failure budget");

  hashCalls = 0;
  for (let i = 0; i < 5; i++) await call({ password: "wrong" + i });
  check("five wrong answers cost one hash each", hashCalls === 5, "hashes " + hashCalls);

  hashCalls = 0;
  const blocked = await call({ password: "wrong-again" });
  check("the sixth is refused", blocked.code === 429, "status " + blocked.code);
  check("and never reaches scrypt", hashCalls === 0, "hashes " + hashCalls);
  check("and says how long to wait", blocked.headers["retry-after"] === "900",
    String(blocked.headers["retry-after"]));

  hashCalls = 0;
  const held = await call({ password: PASSWORD });
  check("even the right password is held off, unhashed",
    held.code === 429 && hashCalls === 0);

  hashCalls = 0;
  for (let i = 0; i < 50; i++) await call({ password: "flood" + i });
  check("fifty more attempts cost nothing at all", hashCalls === 0, "hashes " + hashCalls);

  /* Emptying the store is what the fifteen minute expiry does in Redis. */
  db.clear();
  hashCalls = 0;
  const ok = await call({ password: PASSWORD });
  check("after the window the right password is accepted",
    ok.code === 200 && !!ok.body.token, "status " + ok.code);
  check("and a correct answer clears the record", !db.has("mu:admin:fails"));

  db.clear();
  hashCalls = 0;
  const empty = await call({});
  check("no password is refused without hashing", empty.code === 401 && hashCalls === 0);
  check("and does not spend the budget", !db.has("mu:admin:fails"));

  db.clear();
  hashCalls = 0;
  const huge = await call({ password: "x".repeat(5000) });
  check("an absurd password is refused without hashing",
    huge.code === 401 && hashCalls === 0);

  /* The one that matters most for the owner: somebody else hammering the door
     must never lock out a session that is already open. */
  db.set("mu:admin:fails", 999);
  hashCalls = 0;
  const session = await call({ token: ok.body.token });
  check("an open session is unaffected by a shut window",
    session.code === 200 && hashCalls === 0, "status " + session.code);

  console.log(failed ? "\n" + failed + " failed.\n" : "\nAll gate behaviour confirmed.\n");
  process.exit(failed ? 1 : 0);
})();
