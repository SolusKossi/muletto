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
  const zlib = require("zlib");
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.bytes);
    const c = crc32(raw);
    /* Deflated when it is worth it. This wrote everything stored, which was
       a reasonable call when the additions were a few kilobytes of CSV and a
       poor one once they included a thousand rows of near-identical activity
       markup - most of a megabyte that compresses to a few percent of that,
       on a demo the visitor downloads. Anything that does not get smaller is
       still stored, so a JPEG is never re-packed for nothing. */
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const deflated = packed.length < raw.length;
    const body = deflated ? packed : raw;
    const method = deflated ? 8 : 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(c, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    parts.push(head, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(c, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
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

/* Google's My Activity pages, in the markup Google actually writes.
 *
 * Enough of them, over enough time, that the views which summarise a history
 * have a history to summarise. The hours are not uniform: real activity
 * clusters in the evening and thins out overnight, and a flat scatter would
 * make the hour-of-day grid look like a bug.
 *
 * Deterministic - the seed is fixed, like everything else here - so a rebuild
 * does not churn the archive. */
function activitySeed(n) {
  let x = 20260728 + n * 7919;
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
}

const MONTH3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function activityHtml(product, verb, phrases, hrefBase, count, seedN) {
  const rnd = activitySeed(seedN);
  const start = Date.UTC(2020, 2, 1), end = Date.UTC(2026, 6, 20);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(start + rnd() * (end - start));
    /* Evenings and lunchtimes, with a long tail. Nobody searches uniformly
       across twenty-four hours, and the grid exists to show that. */
    const r = rnd();
    const hour = r < 0.42 ? 18 + Math.floor(rnd() * 5)
      : r < 0.68 ? 11 + Math.floor(rnd() * 3)
      : r < 0.9 ? 8 + Math.floor(rnd() * 3)
      : Math.floor(rnd() * 24);
    t.setUTCHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60));
    const what = phrases[Math.floor(rnd() * phrases.length)];
    const when = t.getUTCDate() + " " + MONTH3[t.getUTCMonth()] + " " +
      t.getUTCFullYear() + ", " + String(t.getUTCHours()).padStart(2, "0") + ":" +
      String(t.getUTCMinutes()).padStart(2, "0") + ":" +
      String(t.getUTCSeconds()).padStart(2, "0");
    rows.push({ t: +t, what, when });
  }
  rows.sort((a, b) => b.t - a.t);
  return "<html><body>" + rows.map((r) =>
    '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">' +
    '<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">' +
    product + "<br></p></div>" +
    '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">' +
    verb + ' <a href="' + hrefBase + encodeURIComponent(r.what).slice(0, 40) + '">' +
    r.what + "</a><br>" + r.when + "</div></div></div>").join("") + "</body></html>";
}

const SEARCHES_LONG = [
  "how to request my data from google", "ferry timetable bergen", "why is my export a tgz",
  "sourdough hydration", "northern lights forecast tromso", "heic to jpg windows",
  "train oslo to bergen tickets", "what is a nas", "best coffee grinder under 200",
  "how long does apple take to send data", "immich vs photoprism", "gdpr right to data",
  "cabin rental hardanger", "how to read an mbox file", "bike puncture repair",
  "pasta carbonara without cream", "flights to lisbon september", "raid 1 vs raid 5",
  "why are my photos undated", "exif editor mac", "snapchat memories expire",
  "external ssd 4tb", "how to back up whatsapp", "rye bread recipe",
];
const VIDEOS_LONG = [
  "Slow television: Bergensbanen", "How a zip file actually works",
  "Baking bread in a cabin", "Everything about EXIF, in twelve minutes",
  "Self-hosting your photo library", "Norway by train, the whole route",
  "Why HEIC exists and why you hate it", "Building a NAS from spare parts",
  "The story of the JPEG", "Northern lights explained by a physicist",
  "Sourdough for people who have failed twice", "What GDPR actually gives you",
];

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
    activityHtml("Search", "Searched for", SEARCHES_LONG,
      "https://www.google.com/search?q=", 420, 1)],
  ["Takeout/My Activity/YouTube/My Activity.html",
    activityHtml("YouTube", "Watched", VIDEOS_LONG,
      "https://www.youtube.com/results?search_query=", 260, 2)],
  ["Takeout/My Activity/Maps/My Activity.html",
    activityHtml("Maps", "Viewed", ["Bergen", "Oslo S", "Tromso", "Hardanger",
      "Lisbon", "Berlin Hbf", "Rome Termini", "Copenhagen"],
      "https://www.google.com/maps/place/", 90, 3)],

  /* Four sign-ins cannot show a pattern, and a pattern is the whole reason
     to look at this page - a country you were in once, a week of activity
     while you were away from your desk. Six years, mostly from home. */
  ["Takeout/Google Account/Access log activity.csv",
    (() => {
      const WHERE = [
        ["81.166.4.10", "Oslo", "Norway", 0.62],
        ["77.16.9.4", "Bergen", "Norway", 0.14],
        ["45.10.2.7", "Amsterdam", "Netherlands", 0.06],
        ["93.44.18.2", "Rome", "Italy", 0.06],
        ["88.12.7.31", "Lisbon", "Portugal", 0.05],
        ["185.3.9.44", "Berlin", "Germany", 0.05],
        ["203.0.113.9", "Singapore", "Singapore", 0.02],
      ];
      const AGENTS = ["Chrome on Windows", "Safari on iPhone", "Chrome on Android",
                      "Firefox on Linux", "Safari on Mac", "Edge on Windows"];
      const rnd = activitySeed(11);
      const start = Date.UTC(2020, 2, 1), end = Date.UTC(2026, 6, 20);
      const rows = [];
      for (let i = 0; i < 240; i++) {
        const t = new Date(start + rnd() * (end - start));
        const r = rnd();
        t.setUTCHours(r < 0.5 ? 18 + Math.floor(rnd() * 5)
          : r < 0.85 ? 8 + Math.floor(rnd() * 6) : Math.floor(rnd() * 24),
          Math.floor(rnd() * 60), Math.floor(rnd() * 60));
        let pick = rnd(), acc = 0, where = WHERE[0];
        for (const w of WHERE) { acc += w[3]; if (pick <= acc) { where = w; break; } }
        rows.push({ t: +t, line: t.toISOString().slice(0, 19) + "Z," +
          where[0] + "," + AGENTS[Math.floor(rnd() * AGENTS.length)] + "," +
          where[1] + "," + where[2] });
      }
      rows.sort((a, b) => b.t - a.t);
      return "Activity Timestamp,IP Address,User Agent,City,Country\n" +
        rows.map((r) => r.line).join("\n") + "\n";
    })()],

  /* A real inbox is mostly machine-written HTML - receipts, dispatch notes,
     newsletters - with a few actual letters between them, and the five
     one-line plain-text messages here showed none of that. The reading view
     renders a message the way a mail client does, and there was nothing in
     the sample that would prove it. */
  ["Takeout/Mail/All mail Including Spam and Trash.mbox",
    ["From 1 Mon Jan  6 00:00:00 2025",
     "From: Fjord Logistikk <post@example.com>",
     "To: you@example.com",
     "Subject: Your delivery is on the way",
     "Date: Mon, 06 Jan 2025 09:14:00 +0100",
     "Content-Type: text/html; charset=utf-8", "",
     '<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px">',
     '  <div style="background:#0b3d2e;color:#fff;padding:22px 26px">',
     '    <div style="font-size:19px;letter-spacing:.08em">FJORD LOGISTIKK</div></div>',
     '  <div style="padding:26px">',
     '    <h1 style="font-size:20px;margin:0 0 10px;color:#0b3d2e">On its way</h1>',
     "    <p style=\"color:#444;line-height:1.6;margin:0 0 18px\">Parcel " +
       "<b>FL-4471-2290</b> left our Oslo depot this morning and is due with you " +
       "on Wednesday between 09:00 and 13:00.</p>",
     '    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333">',
     '      <tr style="background:#f4f6f5">',
     '        <th align="left" style="padding:9px 12px">Stage</th>',
     '        <th align="left" style="padding:9px 12px">When</th></tr>',
     '      <tr><td style="padding:9px 12px;border-top:1px solid #e4e8e6">Collected</td>',
     '          <td style="padding:9px 12px;border-top:1px solid #e4e8e6">Mon 06 Jan, 07:40</td></tr>',
     '      <tr><td style="padding:9px 12px;border-top:1px solid #e4e8e6">Oslo depot</td>',
     '          <td style="padding:9px 12px;border-top:1px solid #e4e8e6">Mon 06 Jan, 09:05</td></tr>',
     '      <tr><td style="padding:9px 12px;border-top:1px solid #e4e8e6">Out for delivery</td>',
     '          <td style="padding:9px 12px;border-top:1px solid #e4e8e6">Wed 08 Jan</td></tr>',
     "    </table>",
     '    <p style="margin:22px 0 0"><a href="https://example.com/track/FL44712290" ' +
       'style="background:#0b3d2e;color:#fff;padding:11px 20px;border-radius:5px;' +
       'text-decoration:none;display:inline-block;font-size:14px">Track this parcel</a></p>',
     '    <p style="color:#8a8a8a;font-size:12px;margin:26px 0 0">You are receiving this ' +
       "because you placed an order. This is an automated message.</p>",
     "  </div></div>", "",

     "From 2 Tue Feb 11 00:00:00 2025",
     "From: Ada Byron <ada@example.com>",
     "To: you@example.com",
     "Subject: Re: the engine notes",
     "Date: Tue, 11 Feb 2025 18:02:00 +0100", "",
     "Finally got these scanned. The second set is the one worth reading - the",
     "first is mostly arithmetic I had already done twice and got wrong both",
     "times.",
     "",
     "Page 4 is where it gets interesting. If the machine can be made to act on",
     "things that are not numbers, then it is not a calculating engine at all,",
     "and calling it one has held the whole idea back by a decade.",
     "",
     "Let me know if the handwriting defeats you. It defeats me in places.",
     "",
     "Ada",
     "",
     "> On 9 Feb, you wrote:",
     "> No rush at all on the notes - whenever they surface. I am still working",
     "> through the earlier set and there is plenty there.", "",

     "From 3 Sat Mar 15 00:00:00 2025",
     "From: Ada Byron <ada@example.com>",
     "To: you@example.com",
     "Subject: Coffee Thursday?",
     "Date: Sat, 15 Mar 2025 11:30:00 +0100", "",
     "Usual place, usual time? I have an hour between things.", "",

     "From 4 Sun Jun 21 00:00:00 2025",
     "From: Bergen Kommune <ikkesvar@example.com>",
     "To: you@example.com",
     "Subject: Kvittering for innsendt skjema",
     "Date: Sun, 21 Jun 2025 08:00:00 +0200",
     "Content-Type: text/html; charset=utf-8", "",
     '<div style="font-family:Georgia,serif;max-width:560px;color:#222">',
     '  <p style="font-size:13px;color:#666;margin:0 0 18px">Bergen kommune</p>',
     '  <h2 style="font-size:18px;margin:0 0 12px">Kvittering</h2>',
     '  <p style="line-height:1.7;margin:0 0 14px">Vi har mottatt skjemaet ditt. ' +
       "Saken er registrert og du hoerer fra oss innen tre uker.</p>",
     '  <table style="border-collapse:collapse;font-size:14px">',
     '    <tr><td style="padding:5px 18px 5px 0;color:#666">Saksnummer</td>' +
       '<td style="padding:5px 0"><b>2025/04417</b></td></tr>',
     '    <tr><td style="padding:5px 18px 5px 0;color:#666">Mottatt</td>' +
       '<td style="padding:5px 0">21. juni 2025</td></tr>',
     "  </table>",
     '  <p style="line-height:1.7;margin:18px 0 0">Du trenger ikke gjoere noe mer naa. ' +
       "Ta vare paa dette nummeret hvis du skal kontakte oss om saken.</p>",
     '  <p style="color:#888;font-size:12px;margin:24px 0 0">Dette er en automatisk ' +
       "melding. Ikke svar paa denne e-posten.</p></div>", "",

     "From 5 Wed Sep 10 00:00:00 2025",
     "From: Grace Hopper <grace@example.com>",
     "To: you@example.com",
     "Subject: Nanoseconds",
     "Date: Wed, 10 Sep 2025 16:45:00 +0200", "",
     "A foot of wire. That is how far light travels in a nanosecond, and it is",
     "the only way I have found to make anyone care about the number.",
     "",
     "I hand them out at talks. People who have sat through an hour of diagrams",
     "with a polite expression will hold a piece of wire and suddenly ask a real",
     "question.", "",

     "From 6 Thu Nov 13 00:00:00 2025",
     "From: The Long Read <weekly@example.com>",
     "To: you@example.com",
     "Subject: Issue 214 - what we lost when everything moved to the cloud",
     "Date: Thu, 13 Nov 2025 07:00:00 +0100",
     "Content-Type: text/html; charset=utf-8", "",
     '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:580px;color:#1a1a1a">',
     '  <p style="font-size:11px;letter-spacing:.16em;color:#999;margin:0 0 6px">' +
       "THE LONG READ &middot; ISSUE 214</p>",
     '  <h1 style="font-size:26px;line-height:1.25;margin:0 0 16px">What we lost when ' +
       "everything moved to the cloud</h1>",
     '  <p style="line-height:1.75;font-size:15px;color:#333;margin:0 0 16px">There is a ' +
       "particular kind of file that no longer exists: the one you could hold. Not a " +
       "reference to a file, not a synced copy that a service maintains on your behalf, " +
       "but the thing itself, on a disk you own.</p>",
     '  <blockquote style="border-left:3px solid #1a1a1a;margin:0 0 16px;padding:2px 0 2px 16px;' +
       'font-size:16px;line-height:1.6;color:#444">"Nobody set out to take your files away. ' +
       'It happened one convenient default at a time."</blockquote>',
     '  <p style="line-height:1.75;font-size:15px;color:#333;margin:0 0 20px">The strange ' +
       "part is that the law caught up before the software did. You have had the right to " +
       "a copy of all of it for years. Almost nobody asks.</p>",
     '  <p style="margin:0 0 26px"><a href="https://example.com/issues/214" ' +
       'style="color:#1a1a1a;font-weight:600">Read the rest</a></p>',
     '  <hr style="border:0;border-top:1px solid #e5e5e5;margin:0 0 14px">',
     '  <p style="font-size:12px;color:#999;margin:0">You are subscribed as ' +
       'you@example.com. <a href="https://example.com/unsubscribe" style="color:#999">' +
       "Unsubscribe</a>.</p></div>", ""].join("\r\n")],

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
/* A Reddit export, which is a flat bag of CSVs and nothing else.
 *
 * Built here rather than in make-sample-data.py because it needs no photos -
 * it is text all the way down, which is what makes Reddit the easiest export
 * any service ships and the least like the others.
 *
 * The IP column is in it on purpose. Reddit really does put the address you
 * were connected from on every post and every comment, and a sample that
 * quietly left that out would be demonstrating a friendlier export than the
 * one people actually receive. */
function buildReddit() {
  const NL = String.fromCharCode(10);
  const rnd = activitySeed(31);
  const start = Date.UTC(2019, 4, 2), end = Date.UTC(2026, 6, 12);
  const SUBS = ["DataHoarder", "selfhosted", "norge", "privacy", "photography",
                "homelab", "AskHistorians", "bergen", "degoogle", "sourdough"];
  const TITLES = [
    "Finally got my Google Takeout down to something readable",
    "What do you all do with the HEIC files?",
    "Is there a way to see which photos are in both exports?",
    "Six years of Snapchat memories, all links, all expired",
    "PSA: your Reddit export has your IP on every comment",
    "Best way to date photos that lost their EXIF?",
    "Anyone else request everything at once and regret it?",
    "Cheapest 4TB drive that is not garbage",
  ];
  const BODIES = [
    "Turns out the dates were in a sidecar the whole time.",
    "Took about a week to arrive, which is faster than I expected.",
    "I ended up writing a script, but there must be an easier way.",
    "This is the thing nobody warns you about before you request it.",
    "Worth doing before the links expire, whatever you decide after.",
    "Same here - I only noticed when I opened it on a different machine.",
    "Thanks, that is exactly what I was looking for.",
  ];
  const IPS = ["81.166.4.10", "77.16.9.4", "45.10.2.7", "93.44.18.2"];

  const stamp = (t) => new Date(t).toISOString().slice(0, 19) + "+00:00";
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const when = () => {
    const t = new Date(start + rnd() * (end - start));
    const r = rnd();
    t.setUTCHours(r < 0.4 ? 19 + Math.floor(rnd() * 5)
      : r < 0.75 ? 9 + Math.floor(rnd() * 8) : Math.floor(rnd() * 24),
      Math.floor(rnd() * 60), Math.floor(rnd() * 60));
    return +t;
  };

  const posts = [];
  for (let i = 0; i < 96; i++) {
    const t = when(), sub = pick(SUBS), id = "t3_" + (100000 + i).toString(36);
    posts.push({ t, id, sub,
      perma: "/r/" + sub + "/comments/" + id.slice(3) + "/",
      line: [id, "/r/" + sub + "/comments/" + id.slice(3) + "/", stamp(t), pick(IPS),
             sub, "", q(pick(TITLES)), "", q(pick(BODIES))].join(",") });
  }
  const comments = [];
  for (let i = 0; i < 340; i++) {
    const t = when(), sub = pick(SUBS), id = "t1_" + (200000 + i).toString(36);
    comments.push({ t, id, sub,
      perma: "/r/" + sub + "/comments/x/" + id.slice(3) + "/",
      line: [id, "/r/" + sub + "/comments/x/" + id.slice(3) + "/", stamp(t), pick(IPS),
             sub, "", "", "", q(pick(BODIES))].join(",") });
  }
  posts.sort((a, b) => b.t - a.t);
  comments.sort((a, b) => b.t - a.t);

  const votes = (n, prefix) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = prefix + (300000 + i).toString(36);
      out.push([id, "/r/" + pick(SUBS) + "/comments/" + id.slice(3) + "/",
                rnd() < 0.86 ? "up" : "down"].join(","));
    }
    return out.join(NL);
  };

  const WHO = ["bjorn_a", "ingrid_k", "sanne_m"];
  const msgs = [];
  for (let i = 0; i < 34; i++) {
    const t = when();
    const other = "u/" + pick(WHO);
    const mine = rnd() < 0.5;
    msgs.push({ t, line: ["t4_" + (400000 + i).toString(36),
      "/message/messages/" + (400000 + i).toString(36) + "/",
      "thr_" + Math.floor(i / 3), stamp(t), pick(IPS),
      mine ? "u/martin_l" : other, mine ? other : "u/martin_l",
      q("Re: " + pick(TITLES).slice(0, 40)), q(pick(BODIES))].join(",") });
  }
  msgs.sort((a, b) => b.t - a.t);

  const idPerma = (x) => x.id + "," + x.perma;

  return [
    ["posts.csv", "id,permalink,date,ip,subreddit,gildings,title,url,body" + NL +
      posts.map((x) => x.line).join(NL) + NL],
    ["comments.csv", "id,permalink,date,ip,subreddit,gildings,link,parent,body" + NL +
      comments.map((x) => x.line).join(NL) + NL],
    ["post_votes.csv", "id,permalink,direction" + NL + votes(180, "t3_") + NL],
    ["comment_votes.csv", "id,permalink,direction" + NL + votes(420, "t1_") + NL],
    ["saved_posts.csv", "id,permalink" + NL +
      posts.slice(0, 22).map(idPerma).join(NL) + NL],
    ["saved_comments.csv", "id,permalink" + NL +
      comments.slice(0, 31).map(idPerma).join(NL) + NL],
    ["hidden_posts.csv", "id,permalink" + NL +
      posts.slice(30, 34).map(idPerma).join(NL) + NL],
    ["subscribed_subreddits.csv", "subreddit" + NL + SUBS.join(NL) + NL],
    ["messages.csv", "id,permalink,thread_id,date,ip,from,to,subject,body" + NL +
      msgs.map((x) => x.line).join(NL) + NL],
    ["friends.csv", "username,note" + NL + WHO.map((u) => u + ",").join(NL) + NL],
    ["statistics.csv", "statistic,value" + NL +
      "account_created," + stamp(start) + NL +
      "comment_karma,4187" + NL + "post_karma,912" + NL],
  ];
}

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

/* Reddit is written whole rather than added to something, because there is
   no Reddit archive to add to - it is the seventh sample and the only one
   that is text all the way down. */
{
  const out = path.join(SAMPLES, "reddit-export.zip");
  const files = buildReddit().map(([name, body]) =>
    ({ name, bytes: Buffer.from(body, "utf8") }));
  fs.writeFileSync(out, writeZip(files));
  console.log("  reddit-export.zip: " + files.length + " files, " +
    (fs.statSync(out).size / 1024).toFixed(1) + " KB");
}
console.log("\nRun node tools/build-site.js next, so the cache stamps move.\n");
