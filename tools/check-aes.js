"use strict";

/* Does the AES authentication code actually verify?
 *
 * Every entry in a Samsung export is WinZip AES-256, so a real export is the
 * only honest test of the code path. This walks whatever directory it is
 * given, decrypts every encrypted entry with the shipped zipcrypt.js, and
 * reports how many verified. Then it flips one byte of one entry's ciphertext
 * and checks the failure is caught - a verifier that never fails is not a
 * verifier, and this is the half that is easy to forget to test.
 *
 *   node tools/check-aes.js <dir-of-zips> <password>
 *
 * The password is an argument and not a file on purpose: it belongs to a real
 * person's archive and has no business in this repository. Nothing here prints
 * file contents or names outside the given directory.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { centralDirectory, dataOffset, readAt } = require("./count-exif.js");

const MZipCrypt = require("../apps/web/zipcrypt.js");

const dir = process.argv[2];
const password = process.argv[3];
if (!dir || !password) {
  console.error("usage: node tools/check-aes.js <dir-of-zips> <password>");
  process.exit(2);
}

/* The 0x9901 extra field, where method 99 hides the real method and the key
   strength. Same read as zip.js does, over a Buffer rather than a Uint8Array. */
function aesExtra(buf) {
  let o = 0;
  while (o + 4 <= buf.length) {
    const id = buf.readUInt16LE(o);
    const size = buf.readUInt16LE(o + 2);
    if (id === 0x9901 && size >= 7) {
      return { strength: buf[o + 8], method: buf.readUInt16LE(o + 9) };
    }
    o += 4 + size;
  }
  return null;
}

function localExtra(fd, e) {
  const head = readAt(fd, e.local, 30);
  if (head.length < 30) return null;
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  if (!extraLen) return null;
  return readAt(fd, e.local + 30 + nameLen, extraLen);
}

function zips(root) {
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...zips(full));
    else if (/\.zip$/i.test(name)) out.push(full);
  }
  return out;
}

(async function main() {
  const files = zips(dir);
  if (!files.length) { console.error("no .zip under " + dir); process.exit(2); }

  let checked = 0, verified = 0, plain = 0, bytes = 0, inflated = 0;
  const failures = [];
  let victim = null;                       // kept for the damage test below
  const started = process.hrtime.bigint();

  for (const file of files) {
    const fd = fs.openSync(file, "r");
    let entries;
    try { entries = centralDirectory(fd, fs.statSync(file).size) || []; }
    catch (err) { console.log("  skipped " + path.basename(file) + ": " + err.message); fs.closeSync(fd); continue; }

    for (const e of entries) {
      if (!e.usize) continue;
      if (e.method !== 99) { plain++; continue; }
      const extra = localExtra(fd, e);
      const aes = extra && aesExtra(extra);
      if (!aes) { failures.push([e.name, "no 0x9901 extra field"]); continue; }
      const off = dataOffset(fd, e);
      if (off === null) { failures.push([e.name, "bad local header"]); continue; }

      const raw = readAt(fd, off, e.csize);
      checked++;
      bytes += raw.length;
      try {
        const out = await MZipCrypt.decryptAes(new Uint8Array(raw), password, aes.strength);
        verified++;
        if (!victim) victim = { raw, strength: aes.strength };
        /* Verified is not the same as correct. Inflating proves the keystream
           was right as well as the MAC, which is what makes the two together
           worth anything. */
        if (aes.method === 8) {
          try { zlib.inflateRawSync(Buffer.from(out)); inflated++; } catch (err) {
            failures.push([e.name, "MAC passed but inflate threw"]);
          }
        } else if (aes.method === 0) inflated++;
      } catch (err) {
        failures.push([e.name, err.damaged ? "authentication code failed"
                              : err.badPassword ? "password rejected" : err.message]);
      }
    }
    fs.closeSync(fd);
  }

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log("AES entries      " + checked + " in " + files.length + " archives" +
              (plain ? " (" + plain + " unencrypted)" : ""));
  console.log("verified         " + verified + " of " + checked);
  console.log("decompressed     " + inflated + " of " + verified);
  console.log("throughput       " + (bytes / 1048576).toFixed(1) + " MB in " +
              ms.toFixed(0) + " ms");
  for (const [name, why] of failures) console.log("  FAIL " + path.basename(name) + ": " + why);

  /* And the half that proves the check is real. One byte of ciphertext,
     changed, must be caught - and caught as damage, not as a bad password. */
  if (!victim) { console.log("\nno entry to damage, skipping the negative test"); return; }
  const bent = Buffer.from(victim.raw);
  const at = Math.floor(bent.length / 2);
  bent[at] = bent[at] ^ 0x01;
  let caught = null;
  try { await MZipCrypt.decryptAes(new Uint8Array(bent), password, victim.strength); }
  catch (err) { caught = err; }
  console.log("\none flipped bit  " +
    (!caught ? "NOT CAUGHT - the check is doing nothing"
     : caught.damaged ? "caught as damage"
     : "caught, but reported as: " + caught.message));

  /* And a wrong password must still be a wrong password, not damage - the
     two check bytes have to be reached first or every mistyped password
     turns into a confusing message about a corrupt download. */
  let pw = null;
  try { await MZipCrypt.decryptAes(new Uint8Array(victim.raw), password + "x", victim.strength); }
  catch (err) { pw = err; }
  console.log("wrong password   " +
    (!pw ? "NOT CAUGHT" : pw.badPassword ? "caught as a bad password"
     : "caught as: " + pw.message));

  process.exitCode = (failures.length || !caught || !caught.damaged || !pw || !pw.badPassword) ? 1 : 0;
})();
