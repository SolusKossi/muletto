/* Opening a password protected zip, in the browser.

   Samsung protects every archive it sends, and the password arrives by email.
   Without this, a Samsung export is a full file list and nothing else.

   Two schemes turn up, and one export uses both:

   **WinZip AES** (compression method 99). The real method hides in an extra
   field, 0x9901, along with the key strength. The entry data is
   salt | 2-byte password check | ciphertext | 10-byte authentication code.
   The key comes from PBKDF2-HMAC-SHA1, 1000 iterations, deriving key, MAC key
   and the two check bytes in one go.

   **ZipCrypto**, the legacy scheme. Three 32-bit registers and a CRC table.
   Trivially breakable and still in wide use; the first 12 decrypted bytes are
   a header whose last byte must match the high byte of the CRC.

   ---- why AES is implemented here rather than handed to WebCrypto ----

   WinZip AES is counter mode, and the counter is little endian: block one is
   01 00 00 ... and block two is 02 00 00 ... WebCrypto's AES-CTR increments
   big endian, and there is no parameter that changes that, so its CTR cannot
   produce this keystream. The alternative - one WebCrypto call per 16 bytes,
   emulating ECB with a zero-IV CBC - is correct and unusably slow on anything
   but a tiny file.

   So the block cipher is implemented here and WebCrypto does the key
   derivation, which is the part where a mistake would actually be dangerous.
   The cipher is encryption only: counter mode never needs decryption. */
"use strict";

const MZipCrypt = (function () {

  /* ---------- AES block cipher, encryption only ---------- */

  /* The AES substitution box, as published in FIPS-197 table 4.
     Written out rather than derived: a derivation that is wrong in one
     byte still produces a cipher that runs, and this one was - the
     inverse of 1 came out as 0 because the log table wrapped at 255.
     A literal can be checked against the standard by eye. */
  const SBOX = new Uint8Array([
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
  ]);

  /* Round constants. Ten are needed for a 128-bit key, seven for 256. */
  const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36,
    0x6c, 0xd8, 0xab, 0x4d]);

  const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;

  function expandKey(key) {
    const nk = key.length / 4;
    const nr = nk + 6;
    const w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    for (let i = nk; i < 4 * (nr + 1); i++) {
      const o = i * 4;
      let t0 = w[o - 4], t1 = w[o - 3], t2 = w[o - 2], t3 = w[o - 1];
      if (i % nk === 0) {
        const tmp = t0;
        t0 = SBOX[t1] ^ RCON[i / nk - 1];
        t1 = SBOX[t2];
        t2 = SBOX[t3];
        t3 = SBOX[tmp];
      } else if (nk > 6 && i % nk === 4) {
        t0 = SBOX[t0]; t1 = SBOX[t1]; t2 = SBOX[t2]; t3 = SBOX[t3];
      }
      w[o] = w[o - nk * 4] ^ t0;
      w[o + 1] = w[o - nk * 4 + 1] ^ t1;
      w[o + 2] = w[o - nk * 4 + 2] ^ t2;
      w[o + 3] = w[o - nk * 4 + 3] ^ t3;
    }
    return { w, nr };
  }

  /* One block, encrypted in place. */
  function encryptBlock(sched, s) {
    const { w, nr } = sched;
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    for (let round = 1; round <= nr; round++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      // ShiftRows, on a column-major state.
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t;
      t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (round !== nr) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
          const all = a0 ^ a1 ^ a2 ^ a3;
          s[c] ^= all ^ xtime(a0 ^ a1);
          s[c + 1] ^= all ^ xtime(a1 ^ a2);
          s[c + 2] ^= all ^ xtime(a2 ^ a3);
          s[c + 3] ^= all ^ xtime(a3 ^ a0);
        }
      }
      const off = round * 16;
      for (let i = 0; i < 16; i++) s[i] ^= w[off + i];
    }
  }

  /* ---------- WinZip AES ---------- */

  const SALT_LEN = { 1: 8, 2: 12, 3: 16 };   // by strength: 128, 192, 256
  const KEY_LEN = { 1: 16, 2: 24, 3: 32 };

  async function deriveAes(password, salt, strength) {
    const keyLen = KEY_LEN[strength];
    const bits = (keyLen * 2 + 2) * 8;       // key, MAC key, 2 check bytes
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const out = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 1000, hash: "SHA-1" }, base, bits));
    return {
      key: out.subarray(0, keyLen),
      macKey: out.subarray(keyLen, keyLen * 2),
      check: out.subarray(keyLen * 2, keyLen * 2 + 2),
    };
  }

  /* Counter mode with the counter counted little endian, which is the whole
     reason this file exists. */
  function ctr(sched, data) {
    const out = new Uint8Array(data.length);
    const counter = new Uint8Array(16);
    const block = new Uint8Array(16);
    for (let off = 0; off < data.length; off += 16) {
      /* Increment first: WinZip's counter starts at one, not zero.

         The carry has to be tested on the stored byte, not on the result of
         ++. On a Uint8Array, ++counter[i] evaluates to the arithmetic result -
         256 - while storing the truncated 0, so testing the expression meant
         the carry never fired. Everything up to block 255 was correct and
         every block after it was wrong, which reads as a file that decrypts
         and then fails to inflate a few kilobytes in. */
      for (let i = 0; i < 16; i++) {
        counter[i] = (counter[i] + 1) & 0xff;
        if (counter[i] !== 0) break;
      }
      block.set(counter);
      encryptBlock(sched, block);
      const n = Math.min(16, data.length - off);
      for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ block[i];
    }
    return out;
  }

  /* Returns the ciphertext decrypted, or throws with .badPassword set. */
  async function decryptAes(bytes, password, strength) {
    const saltLen = SALT_LEN[strength];
    if (!saltLen) throw new Error("Unknown AES strength in archive");
    if (bytes.length < saltLen + 2 + 10) throw new Error("Encrypted entry is too short");

    const salt = bytes.subarray(0, saltLen);
    const given = bytes.subarray(saltLen, saltLen + 2);
    const body = bytes.subarray(saltLen + 2, bytes.length - 10);

    const { key, check } = await deriveAes(password, salt, strength);
    if (given[0] !== check[0] || given[1] !== check[1]) {
      const err = new Error("That password does not open this archive");
      err.badPassword = true;
      throw err;
    }
    // The authentication code at the end is not verified. It would confirm the
    // data as well as the password, but the two check bytes have already told
    // us the password is right, and a wrong password is the failure that
    // actually happens.
    return ctr(expandKey(key), body);
  }

  /* ---------- ZipCrypto ---------- */

  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function zipCryptoKeys(password) {
    const k = [0x12345678, 0x23456789, 0x34567890];
    const bytes = new TextEncoder().encode(password);
    const update = (b) => {
      k[0] = (CRC[(k[0] ^ b) & 0xff] ^ (k[0] >>> 8)) >>> 0;
      k[1] = (k[1] + (k[0] & 0xff)) >>> 0;
      k[1] = (Math.imul(k[1], 134775813) + 1) >>> 0;
      k[2] = (CRC[(k[2] ^ (k[1] >>> 24)) & 0xff] ^ (k[2] >>> 8)) >>> 0;
    };
    for (const b of bytes) update(b);
    return { k, update };
  }

  function decryptZipCrypto(bytes, password, check) {
    const { k, update } = zipCryptoKeys(password);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const temp = (k[2] | 2) & 0xffff;
      const b = bytes[i] ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 0xff);
      out[i] = b;
      update(b);
    }
    // The first twelve bytes are a header, and its last byte has to match.
    if (check != null && out[11] !== check) {
      const err = new Error("That password does not open this archive");
      err.badPassword = true;
      throw err;
    }
    return out.subarray(12);
  }

  return { decryptAes, decryptZipCrypto, expandKey, ctr };
})();

if (typeof module !== "undefined") module.exports = MZipCrypt;
