#!/usr/bin/env node
"use strict";

/* Give the sample exports one of everything.
 *
 *   node tools/enrich-samples.js
 *
 * The demo existed to show somebody what the app is like before they trust it
 * with their own data, and it was four archives of photographs. None of the
 * views built since - contacts, calendar, notes, audio, comments, health,
 * mail, sign-ins, search history - had anything to draw, so the one thing the
 * demo is for was the one thing it could not do.
 *
 * This adds a small, invented example of each to the existing archives. Every
 * name, address and phone number here is made up; the point is the shape.
 *
 * Entries are written stored rather than deflated. A few kilobytes of CSV does
 * not need compressing, and stored means this script needs nothing but the
 * standard library.
 */

const fs = require("fs");
const path = require("path");

const SAMPLES = path.join(__dirname, "..", "apps", "web", "samples");

/* ---------- a minimal zip reader and writer ---------- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* Reads an existing archive back into {name, bytes} pairs. Only stored and
   deflated entries occur in our own samples, and Node can inflate the latter. */
function readZip(buf) {
  const zlib = require("zlib");
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    out.push({ name, bytes: method === 8 ? zlib.inflateRawSync(raw) : raw });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function writeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const body = Buffer.from(f.bytes);
    const c = crc32(body);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(c, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(name.length, 26);
    parts.push(head, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(c, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(off, 42);
    central.push(cd, name);
    off += head.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(parts), cdBuf, end]);
}

/* ---------- a playable recording ---------- */

/* A real WAV, so the audio view has a duration to show and a bar to move.
   A rising tone, because silence looks identical to a broken player. */
function wav(seconds, hz) {
  const rate = 8000, n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const f = hz + (i / n) * hz * 0.5;
    const v = Math.sin((i / rate) * f * 2 * Math.PI) * 7000 * (1 - i / n);
    b.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return b;
}

/* ---------- a Snapchat caption, as Snapchat sends it ----------
 *
 * Snapchat does not burn a caption into the memory. It exports the picture,
 * and beside it a second file of the same scene holding only the caption on a
 * transparent background. Dropped into any photo app that is a black square
 * with white writing on it, sitting next to the memory it belonged to.
 *
 * The sample needs a real one of these or there is no way to see that Muletto
 * puts them back together. It is a genuine RGBA PNG - transparent everywhere
 * except the letters - written with nothing but zlib, so this script keeps its
 * promise of needing no packages.
 *
 * The font is 5x7 and covers only the letters these two captions use. It is
 * not meant to look like Snapchat's; it is meant to be legible enough that
 * somebody looking at the merged result can tell the caption arrived. */

const GLYPHS = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  O: "01110 10001 10001 10001 10001 10001 01110",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  " ": "00000 00000 00000 00000 00000 00000 00000",
  "!": "00100 00100 00100 00100 00100 00000 00100",
};

function png(w, h, rgba) {
  const zlib = require("zlib");
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* The size of the memory the caption belongs to, read out of the JPEG itself.
   A real Snapchat overlay is the shape of the screen it was written on, so an
   invented one that is the wrong shape would be testing the fitting code
   rather than the merge. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/* The same picture, but not the same bytes.
 *
 * The captioned memories here are copies of memories the archive already has,
 * so that the pair is a real photograph rather than an invented rectangle. A
 * straight copy does not survive: an export is deduplicated by CRC before it is
 * ever parsed, so the copy was dropped and its caption was left behind with
 * nothing to attach to - which is precisely the black square the whole feature
 * exists to prevent. Found by opening the sample rather than by reading it.
 *
 * A JPEG comment segment straight after the SOI marker changes the bytes and
 * the CRC while leaving the image identical, which is what a genuinely
 * different photograph would look like to the reader. */
function tweakJpeg(buf, text) {
  const body = Buffer.from(text, "latin1");
  const seg = Buffer.alloc(4 + body.length);
  seg[0] = 0xFF; seg[1] = 0xFE;
  seg.writeUInt16BE(body.length + 2, 2);
  body.copy(seg, 4);
  return Buffer.concat([buf.slice(0, 2), seg, buf.slice(2)]);
}

/* White letters with a soft dark shadow behind them, which is what makes a
   caption readable over a bright photograph - and what makes the merge
   obviously right or obviously wrong when you look at it. */
function overlayPng(text, w, h) {
  const rgba = Buffer.alloc(w * h * 4);
  const up = text.toUpperCase();
  const scale = Math.max(2, Math.floor(w / (up.length * 8)));
  const tw = up.length * 6 * scale;
  const x0 = Math.floor((w - tw) / 2);
  const y0 = Math.floor(h * 0.72);

  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    if (rgba[i + 3] >= a) return;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };

  for (let c = 0; c < up.length; c++) {
    const rows = (GLYPHS[up[c]] || GLYPHS[" "]).split(" ");
    for (let ry = 0; ry < rows.length; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = x0 + c * 6 * scale + rx * scale + sx;
            const y = y0 + ry * scale + sy;
            const blur = Math.max(1, Math.round(scale / 3));
            for (let dy = -blur; dy <= blur; dy++) {
              for (let dx = -blur; dx <= blur; dx++) put(x + dx, y + dy, 0, 0, 0, 150);
            }
            put(x, y, 255, 255, 255, 255);
          }
        }
      }
    }
  }
  return png(w, h, rgba);
}

/* ---------- the invented content ---------- */

const vcard = (fn, org, title, tel, mail, adr) =>
  "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:" + fn + "\r\nN:" + fn.split(" ").reverse().join(";") + ";;;\r\n" +
  "ORG:" + org + "\r\nTITLE:" + title + "\r\nTEL;type=CELL:" + tel + "\r\n" +
  "EMAIL;type=INTERNET:" + mail + "\r\nADR;type=HOME:;;" + adr + "\r\nEND:VCARD\r\n";

const APPLE_EXTRA = [
  ["iCloud Contacts/ada.vcf", vcard("Ada Byron", "Analytical Engines", "Mathematician",
    "+44 20 7946 0100", "ada@example.com", "12 Dorset Street\\, Marylebone;London;;W1U;England")],
  ["iCloud Contacts/grace.vcf", vcard("Grace Hopper", "Naval Systems", "Rear Admiral",
    "+1 202 555 0143", "grace@example.com", "1 Yard Road;Arlington;;22204;USA")],
  ["iCloud Contacts/kari.vcf", vcard("Kari Nordmann", "Fjord Logistikk", "Driftsleder",
    "+47 900 00 000", "kari@example.com", "Storgata 1\\, 3B;Oslo;;0155;Norway")],
  ["iCloud Contacts/olav.vcf", vcard("Olav Hansen", "", "",
    "+47 400 00 000", "olav@example.com", "Bryggen 4;Bergen;;5003;Norway")],

  ["iCloud Calendars and Reminders/Calendar.ics",
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Sample//EN\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Coffee with Kari\r\nDTSTART:20250312T090000Z\r\nLOCATION:Oslo\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Flight to Bergen\r\nDTSTART:20250418T063000Z\r\nLOCATION:Gardermoen\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Midsummer\r\nDTSTART;VALUE=DATE:20250621\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Monday standup\r\nDTSTART:20250106T080000Z\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Dentist\r\nDTSTART:20251104T134500Z\r\nLOCATION:Majorstuen\r\nEND:VEVENT\r\n" +
    "BEGIN:VTODO\r\nSUMMARY:Renew passport\r\nDUE:20250901T120000Z\r\nEND:VTODO\r\n" +
    "BEGIN:VTODO\r\nSUMMARY:Book winter tyres\r\nDUE:20251015T090000Z\r\nEND:VTODO\r\n" +
    "END:VCALENDAR\r\n"],

  ["iCloud Notes/Packing list.txt",
    "Packing list\n\nwaterproof, wool socks, the good camera, charger for the good camera,\n" +
    "passport, kroner, the book I keep not reading\n"],
  ["iCloud Notes/Bread.txt",
    "Bread\n\n500g flour, 350g water, 10g salt, 3g yeast.\nMix, rest an hour, fold four times,\n" +
    "prove overnight in the fridge. Hot oven, lid on for twenty minutes.\n"],
  ["iCloud Notes/Things Kari said.txt",
    "Things Kari said\n\n\"The ferry does not care that you are late.\"\n" +
    "\"Buy the boots once.\"\n"],
  ["iCloud Notes/Wifi.txt", "Wifi\n\nCabin: fjordview / the usual one\nOffice guest: ask at reception\n"],

  ["Apple Features Using iCloud/Siri/Recording 1.wav", wav(24, 220)],
  ["Apple Features Using iCloud/Siri/Recording 2.wav", wav(9, 330)],
  ["Apple Features Using iCloud/Siri/Recording 3.wav", wav(16, 180)],

  ["iCloud/Apple ID Device Information.csv",
    "Device Name,Device Model,Last Seen,IP Address,City\n" +
    "Kari's iPhone,iPhone 15 Pro,2026-07-14T08:12:04Z,81.166.4.10,Oslo\n" +
    "Kari's MacBook Air,Mac14\\,2,2026-07-13T19:40:11Z,81.166.4.10,Oslo\n" +
    "Living room Apple TV,AppleTV11\\,1,2026-06-30T21:02:55Z,81.166.4.10,Oslo\n" +
    "Kari's iPad,iPad13\\,4,2026-05-02T11:23:00Z,77.16.9.4,Bergen\n"],
];

const GOOGLE_EXTRA = [
  ["Takeout/YouTube and YouTube Music/comments.csv",
    "Comment ID,Channel ID,Comment create timestamp,Price,Parent comment ID,Post ID,Video ID,Comment text,Top-level comment ID\n" +
    "C1,UCdemo,2025-02-11T19:04:00Z,0,,,dQw4w9WgXcQ,\"{\"\"text\"\":\"\"That intro is perfect\"\"}\",\n" +
    "C2,UCdemo,2025-02-11T20:15:00Z,0,C1,,dQw4w9WgXcQ,\"{\"\"text\"\":\"\"agreed, the drums especially\"\"}\",\n" +
    "C3,UCdemo,2025-02-12T08:00:00Z,0,C1,,dQw4w9WgXcQ,\"{\"\"text\"\":\"\"came back to this a year later\"\"}\",\n" +
    "C4,UCdemo,2025-06-02T12:30:00Z,0,,,aaaaaaaaaaa,\"{\"\"text\"\":\"\"@fjordlogistikk\"\",\"\"mention\"\":{\"\"externalChannelId\"\":\"\"UCx\"\"}},{\"\"text\"\":\"\" thanks for the tip\"\"}\",\n" +
    "C5,UCdemo,2025-09-19T22:41:00Z,0,,,bbbbbbbbbbb,\"{\"\"text\"\":\"\"Where was this filmed?\"\"}\",\n"],
  ["Takeout/YouTube and YouTube Music/channel.csv",
    "Channel ID,Channel description (Original),Channel title (Original),Channel visibility\n" +
    "UCdemo,Field recordings and slow television,Fjordcast,Public\n"],
  ["Takeout/YouTube and YouTube Music/channel URL configs.csv",
    "Channel ID,channel vanity URL 1 name\nUCdemo,fjordcast\n"],

  ["Takeout/My Activity/Search/My Activity.html",
    "<html><body>" +
    [["Searched for", "how to request my data from google", "https://www.google.com/search?q=a", "14 Jul 2026, 08:11:02"],
     ["Searched for", "ferry timetable bergen", "https://www.google.com/search?q=b", "2 Jul 2026, 17:45:20"],
     ["Searched for", "why is my export a tgz", "https://www.google.com/search?q=c", "28 Jun 2026, 12:02:41"],
     ["Searched for", "sourdough hydration", "https://www.google.com/search?q=d", "3 Jun 2026, 20:15:00"]]
      .map(([v, w, h, t]) =>
        '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">' +
        '<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">Search<br></p></div>' +
        '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">' +
        v + ' <a href="' + h + '">' + w + "</a><br>" + t + "</div></div></div>").join("") +
    "</body></html>"],
  ["Takeout/My Activity/YouTube/My Activity.html",
    "<html><body>" +
    [["Watched", "Slow television: Bergensbanen", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "13 Jul 2026, 22:04:00"],
     ["Watched", "How a zip file actually works", "https://www.youtube.com/watch?v=aaaaaaaaaaa", "9 Jul 2026, 09:30:12"],
     ["Watched", "Baking bread in a cabin", "https://www.youtube.com/watch?v=bbbbbbbbbbb", "1 Jun 2026, 18:55:41"]]
      .map(([v, w, h, t]) =>
        '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">' +
        '<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div>' +
        '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">' +
        v + ' <a href="' + h + '">' + w + "</a><br>" + t + "</div></div></div>").join("") +
    "</body></html>"],

  ["Takeout/Google Account/Access log activity.csv",
    "Activity Timestamp,IP Address,User Agent,City,Country\n" +
    "2026-07-14T08:10:55Z,81.166.4.10,Chrome on Windows,Oslo,Norway\n" +
    "2026-07-02T17:44:10Z,81.166.4.10,Safari on iPhone,Oslo,Norway\n" +
    "2026-06-11T07:20:00Z,77.16.9.4,Chrome on Android,Bergen,Norway\n" +
    "2026-04-28T13:05:33Z,45.10.2.7,Firefox on Linux,Amsterdam,Netherlands\n"],

  ["Takeout/Mail/All mail Including Spam and Trash.mbox",
    ["From 1 Mon Jan  6 00:00:00 2025",
     "From: Fjord Logistikk <post@example.com>",
     "To: you@example.com",
     "Subject: Your delivery is on the way",
     "Date: Mon, 06 Jan 2025 09:14:00 +0100", "", "Tracking inside.", "",
     "From 2 Tue Feb 11 00:00:00 2025",
     "From: Ada Byron <ada@example.com>",
     "To: you@example.com",
     "Subject: Re: the engine notes",
     "Date: Tue, 11 Feb 2025 18:02:00 +0100", "", "Attached, finally.", "",
     "From 3 Sat Mar 15 00:00:00 2025",
     "From: Ada Byron <ada@example.com>",
     "To: you@example.com",
     "Subject: Coffee Thursday?",
     "Date: Sat, 15 Mar 2025 11:30:00 +0100", "", "Usual place.", "",
     "From 4 Sun Jun 21 00:00:00 2025",
     "From: Bergen Kommune <ikkesvar@example.com>",
     "To: you@example.com",
     "Subject: Kvittering",
     "Date: Sun, 21 Jun 2025 08:00:00 +0200", "", "Takk.", "",
     "From 5 Wed Sep 10 00:00:00 2025",
     "From: Grace Hopper <grace@example.com>",
     "To: you@example.com",
     "Subject: Nanoseconds",
     "Date: Wed, 10 Sep 2025 16:45:00 +0200", "", "A foot of wire.", ""].join("\r\n")],

  ["Takeout/Fit/Daily activity metrics.csv",
    (() => {
      let s = "Date,Step count,Heart rate,Weight\n";
      for (let i = 0; i < 90; i++) {
        const d = new Date(Date.UTC(2026, 3, 1 + i));
        s += d.toISOString().slice(0, 10) + "," + (4200 + ((i * 271) % 7400)) + "," +
          (58 + (i % 22)) + "," + (77 + ((i % 9) * 0.2)).toFixed(1) + "\n";
      }
      return s;
    })()],
];

/* ---------- do it ---------- */

function enrich(file, extras) {
  const full = path.join(SAMPLES, file);
  if (!fs.existsSync(full)) { console.log("  skip " + file + " (not here)"); return; }
  const had = readZip(fs.readFileSync(full));
  const have = new Set(had.map((e) => e.name));
  const add = extras
    .filter(([name]) => !have.has(name))
    .map(([name, body]) => ({ name, bytes: Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8") }));
  if (!add.length) { console.log("  " + file + " already has all of it"); return; }
  fs.writeFileSync(full, writeZip(had.concat(add)));
  console.log("  " + file + ": " + had.length + " -> " + (had.length + add.length) + " entries");
}

/* The split-caption memories, which have to be built from what the archive
   already holds: the picture is a copy of a memory that is in there, so the
   pair is a real photograph with a real caption beside it rather than two
   invented rectangles. Named the way Snapchat names them - a shared prefix,
   then -main and -overlay. */
function enrichSnapchat() {
  const file = "snapchat-export.zip";
  const full = path.join(SAMPLES, file);
  if (!fs.existsSync(full)) { console.log("  skip " + file + " (not here)"); return; }
  const had = readZip(fs.readFileSync(full));
  const have = new Set(had.map((e) => e.name));
  const base = had.filter((e) => /^memories\/.*\.jpg$/i.test(e.name));
  if (!base.length) { console.log("  " + file + ": no memory to copy"); return; }

  const pairs = [
    ["2021-07-04_8f2c41ab-6d0e-4b19-9a55-31c7e0d4f8aa", "BEST DAY!", base[0]],
    ["2021-08-19_3d71c9e4-2fb8-4a06-8c13-7e5029ab6d10", "HELLO OSLO", base[1] || base[0]],
  ];
  const add = [];
  for (const [id, text, from] of pairs) {
    const main = "memories/" + id + "-main.jpg";
    const over = "memories/" + id + "-overlay.png";
    if (have.has(main)) continue;
    const size = jpegSize(from.bytes) || { w: 720, h: 1280 };
    add.push({ name: main, bytes: tweakJpeg(from.bytes, "Muletto sample memory " + id.slice(0, 10)) });
    add.push({ name: over, bytes: overlayPng(text, size.w, size.h) });
  }
  if (!add.length) { console.log("  " + file + " already has its caption pairs"); return; }
  fs.writeFileSync(full, writeZip(had.concat(add)));
  console.log("  " + file + ": " + had.length + " -> " + (had.length + add.length) +
    " entries (" + (add.length / 2) + " caption pairs)");
}

console.log("\nGiving the samples one of everything\n");
enrich("apple-export.zip", APPLE_EXTRA);
enrich("google-takeout.zip", GOOGLE_EXTRA);
enrichSnapchat();
console.log("\nRun node tools/build-site.js next, so the cache stamps move.\n");
