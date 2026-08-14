"use strict";

/* Muletto - provider parsers.
   Each parser turns a provider's export into one normalized library shape, so
   the viewer can display every kind of exported data the same way:

     { provider, media[], conversations[], events[], places[], tables[], files[], notes[] }

   All parsing happens in the browser on the user's own file. */

const MParse = (function () {
  // Its own, like every other module here. Reaching for app.js's copy works
  // only because of load order, which is not a thing to depend on.
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  /* ---------- shared helpers ---------- */

  const MEDIA_EXT = {
    photo: ["jpg", "jpeg", "png", "heic", "heif", "avif", "gif", "webp", "bmp", "tif", "tiff", "dng"],
    video: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp"],
    audio: ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"],
  };
  const MIME = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", heic: "image/heic", heif: "image/heif", avif: "image/avif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  };
  const ext = (n) => (n.split(".").pop() || "").toLowerCase();
  const base = (n) => n.split("/").pop();

  function mediaKind(name) {
    const e = ext(name);
    for (const k of Object.keys(MEDIA_EXT)) if (MEDIA_EXT[k].includes(e)) return k;
    return null;
  }
  function mimeOf(name) { return MIME[ext(name)] || ""; }

  // Browsers will not put HEIC in an <img>, but we can decode the HEIF family
  // ourselves through WebCodecs - see heif.js.
  function renderable(name) {
    const e = ext(name);
    return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(e);
  }
  function heifFamily(name) {
    return ["heic", "heif", "avif"].includes(ext(name));
  }

  function parseDate(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
      const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
      return ms ? new Date(ms) : null;
    }
    let s = String(v).trim();
    // "2024-03-01 12:33:55 UTC" -> ISO
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` + (/UTC|Z/i.test(s) ? "Z" : "");
      const d = new Date(iso);
      if (!isNaN(d)) return d;
    }
    const d2 = new Date(s);
    return isNaN(d2) ? null : d2;
  }

  /* RFC4180-ish CSV parser: handles quotes, embedded commas and newlines. */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();
    if (!rows.length) return { columns: [], rows: [] };
    return { columns: rows[0], rows: rows.slice(1) };
  }

  /* One CSV, several tables.

     Samsung writes a section title on a line of its own, the column names
     under it, the rows under those, then a blank line and the next section.
     Read as one table that is a single column of 107 rows with the heading
     "Review history" - technically parsed, and useless. Split on the shape
     instead: a lone field followed by a wider row starts a new section. */
  function csvSections(text) {
    const all = parseCsv(text);
    const rows = all.columns.length ? [all.columns].concat(all.rows) : [];
    const width = (r) => { let n = 0; for (let i = 0; i < r.length; i++) if (r[i] !== "") n = i + 1; return n; };
    const out = [];
    let cur = null;
    for (let i = 0; i < rows.length; i++) {
      const w = width(rows[i]);
      if (!w) { cur = null; continue; }               // blank line ends a section
      const next = rows[i + 1] ? width(rows[i + 1]) : 0;
      /* A heading can also turn up part way down, with no blank line before
         it. SmartThings Find writes title, header, row, title, header, row -
         and reading the second title as data meant the card listed the names
         of the fields instead of what was in them. */
      if (cur && cur.columns && w === 1 && next > 1) cur = null;
      if (!cur) {
        // A lone field above a wider row is a heading, not the column names.
        if (w === 1 && next > 1) {
          cur = { title: rows[i][0].trim(), columns: null, rows: [] };
          out.push(cur);
        } else {
          cur = { title: "", columns: rows[i], rows: [] };
          out.push(cur);
        }
        continue;
      }
      if (!cur.columns) { cur.columns = rows[i]; continue; }
      cur.rows.push(rows[i]);
    }
    const kept = out.filter((t) => t.columns && t.columns.length && t.rows.length);
    /* Nothing sectioned about it after all - hand back the plain reading.

       This used to fire on one section too. A file with a real heading and one
       usable section fell back to reading the whole thing as a single table,
       which put the heading in the column slot and every subsequent line under
       it - SmartThings Find came out as one column of 19 rows that were mostly
       field names. An ordinary CSV yields exactly one section and the plain
       reading of it is identical, so only a total miss needs the fallback. */
    if (!kept.length && all.columns.length) {
      return [{ title: "", columns: all.columns, rows: all.rows }];
    }
    return kept;
  }

  /* Column names as the database wrote them: datauuid, pkg_name, SBR@DATE_CREATED.
     The table is real content and it reads like a schema dump, which is most of
     why a Samsung export looks like it holds nothing worth seeing. */
  const COLUMN_WORDS = {
    uuid: "UUID", id: "ID", url: "URL", os: "OS", imei: "IMEI", ip: "IP",
    pkg: "Package", dt: "Date", ts: "Time", num: "Number", no: "Number",
    sa: "Samsung account", tab: "Tab", app: "App", sim: "SIM",
  };
  // Names the database glued together and never took apart again.
  const GLUED = [["datauuid", "data uuid"], ["pkgname", "package name"],
    ["devicetype", "device type"], ["filename", "file name"],
    ["createtime", "create time"], ["updatetime", "update time"]];
  function niceColumn(name) {
    let s = String(name || "").trim();
    s = s.replace(/^[A-Z]{2,4}@/, "");                    // SBR@, SCN@ table tags
    s = s.replace(/^com\.samsung\.[a-z.]*/i, "");
    // SHOUTED_COLUMN_NAMES carry no capitalisation worth keeping.
    if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase();
    s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");         // camelCase
    s = s.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    for (const [from, to] of GLUED) s = s.split(from).join(to);
    if (!s) return String(name || "");
    const out = s.split(" ").map((w) => COLUMN_WORDS[w] || w).join(" ");
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  /* How much of a kind of file to read, and what to say when it stops.

     Every parser here used to take the first N and drop the rest in silence.
     A real Takeout has 137 CSVs and the cap was 30, so 107 of them - every
     YouTube playlist - vanished with nothing on screen to say they existed.
     The count was invented rather than measured, too: a playlist CSV is a
     couple of kilobytes and thirty of those is nothing, while thirty CSVs from
     somewhere else could be a gigabyte.

     So the budget is bytes, with a generous ceiling on the count as a backstop,
     and whatever it refuses is returned rather than forgotten. */
  const READ_BUDGET = { bytes: 48 * 1024 * 1024, count: 1500 };

  function withinBudget(entries, budget) {
    const cap = budget || READ_BUDGET;
    const taken = [];
    let bytes = 0;
    for (const e of entries) {
      if (taken.length >= cap.count || bytes + e.size > cap.bytes) break;
      taken.push(e);
      bytes += e.size;
    }
    return { taken, dropped: entries.length - taken.length };
  }

  /* Said plainly, in the library, rather than left for somebody to notice. */
  function noteDropped(lib, dropped, what) {
    if (!dropped) return;
    lib.notes.push(dropped + " " + what + " were not read, because this export holds " +
      "more of them than Muletto opens in one go. Nothing is wrong with the files - " +
      "they are listed under All files, and What is in here counts them.");
  }

  // Find the first array of objects hiding under any key matching a pattern.
  function pickArrays(obj, re) {
    const out = [];
    if (!obj || typeof obj !== "object") return out;
    for (const k of Object.keys(obj)) {
      if (Array.isArray(obj[k]) && re.test(k)) out.push({ key: k, list: obj[k] });
    }
    return out;
  }
  const field = (o, ...names) => {
    for (const n of names) {
      for (const k of Object.keys(o)) {
        if (k.toLowerCase().replace(/[^a-z]/g, "") === n.toLowerCase().replace(/[^a-z]/g, "")) return o[k];
      }
    }
    return undefined;
  };

  function emptyLib(slug, label) {
    return {
      provider: { slug, label },
      media: [], conversations: [], events: [], places: [],
      tables: [], files: [], notes: [], accounts: [], insights: [],
    };
  }

  // Very large JSON inside an export can exhaust browser memory. Skip those and
  // say so, rather than freezing the tab.
  const JSON_LIMIT = 60 * 1024 * 1024;
  async function readJsonSafe(file, entry) {
    if (!entry || entry.size > JSON_LIMIT) return null;
    try { return await MZip.extractJson(file, entry); } catch { return null; }
  }

  /* Meta escapes the UTF-8 bytes of a string one at a time instead of the code
     point, so accented text and emoji arrive broken. The repair, and the three
     guards that stop it damaging text that was never broken, are in
     mojibake.js.

     The version that lived here matched only a C2 or C3 lead byte, which
     covers Latin accents and misses emoji entirely - an emoji leads with F0,
     so every one of them was left mangled, and three of its four bytes are
     invisible control characters. That is why a smiling face showed up as a
     single stray letter. It also decoded without the fatal flag, so a string
     that was genuinely Latin-1 came back full of replacement characters
     instead of being left alone. */
  const fixMojibake = (s) =>
    (typeof MMoji === "undefined" ? s : MMoji.repair(s));

  /* Videos carry their recording date in the container header; read it for a
     bounded number so the timeline is right without scanning everything. */
  /* The creation date of an MP4 lives in its `moov` atom, which may be at
     either end of the file, so there is no way to read it without unpacking
     the whole video. That is affordable for a phone clip and absurd for the
     4 GB videos a Google Takeout can hold - it was unpacking gigabytes to read
     a timestamp, which is most of where "opening this takes forever" came
     from. Big videos keep whatever date the provider's sidecar gave them. */
  const VIDEO_DATE_MAX = 128 * 1024 * 1024;

  async function readVideoDates(lib, file, cap = 200, say) {
    if (typeof MVideo === "undefined") return;
    let done = 0, skipped = 0;
    for (const m of lib.media) {
      if (m.kind !== "video" || done >= cap) continue;
      if (MZip.cancelled()) return;
      if ((m.size || 0) > VIDEO_DATE_MAX) { skipped++; continue; }
      try {
        const blob = await MZip.extractBlob(file, m.entry, m.mime);
        const at = await MVideo.readCreationDate(blob);
        if (at) { m.at = at; lib.events.push({ at, kind: "video", label: m.name }); }
        done++;
        if (say && done % 10 === 0) say("Reading dates out of the videos - " + done + " so far...");
      } catch { /* skip unreadable video */ }
    }
    if (skipped) {
      lib.notes.push(plural(skipped, "video is", "videos are") + " too large to unpack just to " +
        "read a date, so they keep whatever date came with the export. Nothing about them is missing.");
    }
  }

  /* EXIF writes "2020:07:01 19:10:00" - colons in the date part, which no
     Date parser accepts, and no timezone, so it means local time where the
     photo was taken. Building the date field by field says that explicitly
     rather than hoping a string parser guesses the same thing. */
  function exifToDate(stamp) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(stamp || ""));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    // A camera with a dead clock writes 1970 or 1980; that is not a date.
    return isNaN(d) || d.getFullYear() < 1990 ? null : d;
  }

  /* Dates and coordinates out of the photos themselves.

     Nothing read EXIF before this, so a date only survived when the provider
     shipped a sidecar JSON beside the file. Google does; Apple, Snapchat and
     Instagram do not, and their photos arrived with no date at all - which is
     most of what a photo library is.

     Only the head of each file is decompressed, and a sidecar date already
     found wins, because the provider knows better than the camera when the
     camera clock was wrong. */
  async function readPhotoDates(lib, file, cap = 800, say) {
    if (typeof MExif === "undefined") return;
    let done = 0, dated = 0, located = 0;
    for (const m of lib.media) {
      if (done >= cap) break;
      if (MZip.cancelled()) return;
      if (m.kind !== "photo" || m.at) continue;
      if (!/\.jpe?g$/i.test(m.name)) continue;
      done++;
      if (say && done % 50 === 0) {
        say("Reading dates and places out of the photographs - " + done + " of up to " + cap + "...");
      }
      try {
        const head = await MZip.readHead(file, m.entry, 96 * 1024);
        const stamp = MExif.readDate(head);
        if (stamp) {
          const at = exifToDate(stamp);
          if (at) {
            m.at = at;
            lib.events.push({ at, kind: "photo", label: m.name });
            dated++;
          }
        }
        const gps = MExif.readGps(head);
        if (gps) {
          m.gps = gps;
          lib.places.push({ at: m.at || null, lat: gps.lat, lon: gps.lon });
          located++;
        }
      } catch { /* unreadable photo; leave it undated */ }
    }
    if (dated) {
      lib.notes.push("Recovered the date from " + dated.toLocaleString() +
        " photo" + (dated === 1 ? "" : "s") + " by reading what the camera wrote into the file" +
        (located ? ", and the location from " + located.toLocaleString() : "") + ".");
    }
  }

  /* What a file is, when the name refuses to say.

     Samsung's Pinall folder stores clipped screenshots under names like
     hashCode2102669541, with no extension at all. They are ordinary PNGs, and
     going by the name alone they were filed under "other files" and never
     shown - six real pictures sitting in a list of unknowns. Samsung also
     names PNG data .jpg inside its note files, so the bytes are the only
     honest answer in both directions. */
  const MAGIC = [
    [[0xff, 0xd8, 0xff], "photo", "image/jpeg", ".jpg"],
    [[0x89, 0x50, 0x4e, 0x47], "photo", "image/png", ".png"],
    [[0x47, 0x49, 0x46, 0x38], "photo", "image/gif", ".gif"],
    [[0x42, 0x4d], "photo", "image/bmp", ".bmp"],
  ];
  function sniff(head) {
    for (const [sig, kind, mime, ext] of MAGIC) {
      let ok = true;
      for (let i = 0; i < sig.length; i++) if (head[i] !== sig[i]) { ok = false; break; }
      if (ok) return { kind, mime, ext };
    }
    // RIFF....WEBP
    if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
      return { kind: "photo", mime: "image/webp", ext: ".webp" };
    }
    /* "From " at the very start is an mbox, and mbox is mail.
     *
     * Samsung's Pinall folder names three of them hashCode1539051287 and so
     * on, with no extension - sitting beside the PNGs this check already
     * rescues, and unread for exactly the same reason. The mail reader only
     * ever looked for `.mbox`.
     *
     * The separator is "From " followed by a sender, so the space matters:
     * without it this would claim any text file beginning with the word From. */
    if (head[0] === 0x46 && head[1] === 0x72 && head[2] === 0x6f &&
        head[3] === 0x6d && head[4] === 0x20) {
      return { kind: "mail", mime: "application/mbox", ext: ".mbox" };
    }
    /* "From:" with a colon is not mail, and the difference is that one byte.
     *
     * Samsung Internet saves a web page as MHTML, which is a MIME document -
     * so it opens "From: <Saved by WebKit>" and looks exactly like a message
     * until you read the fifth character. Three of them sit unnamed in a real
     * Samsung export as hashCode1539051287 and the like. Calling those mail
     * would have put somebody browsing history in their inbox. */
    if (head[0] === 0x46 && head[1] === 0x72 && head[2] === 0x6f &&
        head[3] === 0x6d && head[4] === 0x3a) {
      return { kind: "page", mime: "multipart/related", ext: ".mht" };
    }
    return null;
  }

  const SNIFF_CAP = 300;   // reading a head is cheap, doing it 40,000 times is not

  async function classifyFiles(lib, entries, file) {
    const unknown = [];
    for (const e of entries) {
      const kind = mediaKind(e.name);
      if (kind) {
        lib.media.push({
          name: base(e.name), path: e.name, size: e.size, entry: e,
          kind, mime: mimeOf(e.name), renderable: renderable(e.name),
          heif: heifFamily(e.name),
        });
      } else if (!/\.(json|csv|html?|txt|xml)$/i.test(e.name)) {
        const rec = { name: base(e.name), path: e.name, size: e.size, entry: e };
        lib.files.push(rec);
        // No extension, or one nothing recognises, and big enough to be an image.
        if (file && e.size > 256 && !/\.[a-z0-9]{1,5}$/i.test(base(e.name))) unknown.push(rec);
      }
    }

    for (const rec of unknown.slice(0, SNIFF_CAP)) {
      let hit = null;
      try { hit = sniff(await MZip.readHead(file, rec.entry, 32)); } catch { /* unreadable */ }
      if (!hit) continue;
      /* Mail is not media, so it stays in the file list and is marked instead.
         The Mail view looks for the mark as well as for the extension, which
         is the whole point: the file never had one. */
      if (hit.kind === "mail" || hit.kind === "page") {
        const as = hit.kind === "mail" ? "mbox" : "webpage";
        rec.entry.sniffedAs = as;
        rec.sniffedAs = as;
        if (as === "webpage") rec.name = rec.name + " (saved web page)";
        continue;
      }
      lib.files.splice(lib.files.indexOf(rec), 1);
      lib.media.push({
        name: rec.name + hit.ext, path: rec.path, size: rec.size, entry: rec.entry,
        kind: hit.kind, mime: hit.mime, renderable: true, heif: false, sniffed: true,
      });
    }
    if (unknown.length > SNIFF_CAP) {
      lib.notes.push("Checked the first " + SNIFF_CAP + " files that had no extension to see " +
        "whether they were pictures. " + (unknown.length - SNIFF_CAP) + " more were left in " +
        "Other files unchecked.");
    }
  }

  /* ---------- Snapchat ---------- */
  /* Export from accounts.snapchat.com "My Data": a json/ folder with
     chat_history, snap_history, memories_history, location_history, friends,
     account, plus html/ copies of the same. */

  async function snapchat(file, entries) {
    const lib = emptyLib("snapchat", "Snapchat");
    const jsons = entries.filter((e) => /\.json$/i.test(e.name));
    const read = async (re) => {
      const hit = jsons.find((e) => re.test(e.name.toLowerCase()));
      if (!hit) return null;
      try { return await MZip.extractJson(file, hit); } catch { return null; }
    };

    // Chats
    const chat = await read(/chat_?history/);
    if (chat) {
      const convs = new Map();
      for (const { key, list } of pickArrays(chat, /chat/i)) {
        const dir = /sent/i.test(key) ? "sent" : "received";
        for (const m of list) {
          const title = field(m, "Conversation Title", "conversationtitle") ||
                        field(m, "From", "from") || "Conversation";
          if (!convs.has(title)) convs.set(title, { title, messages: [] });
          convs.get(title).messages.push({
            from: field(m, "From", "from") || (dir === "sent" ? "You" : "Them"),
            direction: dir,
            text: field(m, "Content", "text", "body") || "",
            type: (field(m, "Media Type", "mediatype") || "TEXT").toString(),
            at: parseDate(field(m, "Created", "created", "timestamp", "date")),
          });
        }
      }
      for (const c of convs.values()) {
        c.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
        lib.conversations.push(c);
      }
      lib.conversations.sort((a, b) => b.messages.length - a.messages.length);
    }

    // Snaps -> timeline events
    const snaps = await read(/snap_?history/);
    if (snaps) {
      for (const { key, list } of pickArrays(snaps, /snap/i)) {
        const dir = /sent/i.test(key) ? "Sent" : "Received";
        for (const s of list) {
          lib.events.push({
            at: parseDate(field(s, "Created", "created", "timestamp")),
            kind: "snap",
            label: `${dir} ${(field(s, "Media Type", "mediatype") || "snap").toLowerCase()}` +
                   (field(s, "From", "from") ? ` with ${field(s, "From", "from")}` : ""),
          });
        }
      }
    }

    // Memories (media lives behind expiring links, so we list them as records)
    const mem = await read(/memories_?history/);
    if (mem) {
      let n = 0;
      for (const { list } of pickArrays(mem, /media|memories|saved/i)) {
        for (const m of list) {
          n++;
          lib.events.push({
            at: parseDate(field(m, "Date", "date", "created")),
            kind: "memory",
            label: `Memory (${(field(m, "Media Type", "mediatype") || "media").toLowerCase()})`,
          });
        }
      }
      if (n) lib.notes.push(`${n.toLocaleString()} Memories are listed in this export as time-limited download links rather than files. Download them from Snapchat before the links expire, then open them here.`);
    }

    // Locations
    const loc = await read(/location_?history/);
    if (loc) {
      for (const { list } of pickArrays(loc, /location/i)) {
        for (const p of list) {
          const pair = field(p, "Latitude, Longitude", "latitudelongitude", "coordinates");
          let lat = null, lon = null;
          if (typeof pair === "string" && pair.includes(",")) {
            const [a, b] = pair.split(",").map((x) => parseFloat(x));
            if (!isNaN(a) && !isNaN(b)) { lat = a; lon = b; }
          }
          lat = lat !== null ? lat : parseFloat(field(p, "Latitude", "lat"));
          lon = lon !== null ? lon : parseFloat(field(p, "Longitude", "lon", "lng"));
          if (isNaN(lat) || isNaN(lon)) continue;
          lib.places.push({
            at: parseDate(field(p, "Time", "time", "date", "created")),
            lat, lon,
          });
        }
      }
    }

    // Friends
    const friends = await read(/friends/);
    if (friends) {
      for (const { key, list } of pickArrays(friends, /friend/i)) {
        if (!list.length) continue;
        const cols = Object.keys(list[0]);
        lib.tables.push({
          name: key,
          columns: cols,
          rows: list.map((o) => cols.map((c) => String(o[c] === undefined || o[c] === null ? "" : o[c]))),
        });
      }
    }

    // Account details
    const acct = await read(/account/);
    if (acct && typeof acct === "object") {
      for (const k of Object.keys(acct)) {
        const v = acct[k];
        if (Array.isArray(v) && v.length && typeof v[0] === "object") {
          const cols = Object.keys(v[0]);
          lib.tables.push({ name: k, columns: cols, rows: v.map((o) => cols.map((c) => String(o[c] ?? ""))) });
        } else if (v && typeof v === "object") {
          // key/value blocks (account details) render as a two-column table
          lib.tables.push({
            name: k, columns: ["Field", "Value"],
            rows: Object.entries(v).map(([a, b]) => [a, String(b)]),
          });
        }
      }
    }

    await classifyFiles(lib, entries, file);
    return lib;
  }

  /* ---------- Apple ---------- */
  /* Apple's privacy export is mostly folders of CSVs plus iCloud Photos media.
     Structure varies by which services you selected, so we parse defensively:
     every CSV becomes a browsable table, every media file becomes an item. */

  async function apple(file, entries) {
    const lib = emptyLib("apple", "Apple");

    const csvPick = withinBudget(entries.filter((e) => /\.csv$/i.test(e.name)));
    const csvs = csvPick.taken;
    noteDropped(lib, csvPick.dropped, "record tables");
    for (const e of csvs) {
      try {
        const txt = await MZip.extractText(file, e);
        const { columns, rows } = parseCsv(txt);
        if (!columns.length) continue;
        lib.tables.push({ name: base(e.name).replace(/\.csv$/i, ""), path: e.name, columns, rows });

        // Purchases and similar dated rows make good timeline events
        const dateIdx = columns.findIndex((c) => /date|time|purchase/i.test(c));
        const labelIdx = columns.findIndex((c) => /item|title|name|description|product/i.test(c));
        if (dateIdx >= 0 && labelIdx >= 0 && rows.length <= 5000) {
          for (const r of rows) {
            const at = parseDate(r[dateIdx]);
            if (at && r[labelIdx]) lib.events.push({ at, kind: "record", label: r[labelIdx] });
          }
        }
      } catch { /* skip unreadable csv */ }
    }

    const jsonPick = withinBudget(entries.filter((e) => /\.json$/i.test(e.name)));
    const jsons = jsonPick.taken;
    noteDropped(lib, jsonPick.dropped, "data files");
    for (const e of jsons) {
      try {
        const data = await MZip.extractJson(file, e);
        if (Array.isArray(data) && data.length && typeof data[0] === "object") {
          const cols = Object.keys(data[0]);
          lib.tables.push({
            name: base(e.name).replace(/\.json$/i, ""), path: e.name, columns: cols,
            rows: data.slice(0, 5000).map((o) => cols.map((c) => String(o[c] ?? ""))),
          });
        }
      } catch { /* skip */ }
    }

    await classifyFiles(lib, entries, file);

    if (lib.media.some((m) => /heic|heif/i.test(m.name))) {
      lib.notes.push("Some photos are HEIC. Muletto decodes them for preview and can convert them to JPG; writing dates back into HEIC itself is not supported yet.");
    }
    if (!lib.media.length && lib.tables.length) {
      lib.notes.push("This part of your Apple export contains account and service records. Photos arrive in a separate iCloud Photos archive - open that file too.");
    }
    return lib;
  }

  /* ---------- Google Takeout ---------- */
  /* Takeout stores each photo's real date and place in a sidecar JSON next to
     the file, named <photo>.json or <photo>.supplemental-metadata.json. Reading
     those is what lets us put a library back in the right order. */

  const SIDECAR_RE = /\.(supplemental-metadata|suppl)?\.?json$/i;
  /* Sidecars are a few hundred bytes of JSON each, so reading them is cheap
     next to decoding a photograph. The old limit of 1,200 meant a library of
     three thousand got dates back for the first 1,200 and nothing after -
     silently, beyond one line of small print. The cap is now high enough to
     cover any real library and exists only so a pathological archive cannot
     hang the tab. */
  const SIDECAR_CAP = 60000;

  async function google(file, entries) {
    const lib = emptyLib("google", "Google Takeout");
    await classifyFiles(lib, entries, file);

    // index sidecars by the media path they describe
    const sidecars = new Map();
    for (const e of entries) {
      if (!/\.json$/i.test(e.name)) continue;
      /* Google truncates the sidecar name to fit a filename length limit, and
         does not truncate it consistently. The same export contains
         photo.jpg.supplemental-metadata.json, photo.jpg.supplemental-m.json,
         photo.jpg.suppl.json and photo.jpg.supplemental-metadata(1).json.
         Matching only the full spelling and one abbreviation dropped the rest,
         and a dropped sidecar is a photograph that keeps neither its date nor
         its location - which is most of the reason to open a Takeout at all.
         Anything beginning .supp and ending .json is one of these. */
      const stripped = e.name
        .replace(/\(\d+\)(?=\.json$)/i, "")
        .replace(/\.supp[a-z-]*\.json$/i, "")
        .replace(/\.json$/i, "");
      if (stripped !== e.name && mediaKind(stripped)) sidecars.set(stripped, e);
      /* Google also numbers a repeated name as photo(1).jpg while calling its
         sidecar photo.jpg(1).json, so the number has to move into the stem to
         find the file it describes. */
      const numbered = e.name.match(/^(.*)\.(\w+)\((\d+)\)\.json$/i);
      if (numbered) {
        const alt = numbered[1] + "(" + numbered[3] + ")." + numbered[2];
        if (mediaKind(alt) && !sidecars.has(alt)) sidecars.set(alt, e);
      }
    }

    let withDate = 0, read = 0, capped = false;
    for (const m of lib.media) {
      const sc = sidecars.get(m.path);
      if (!sc) continue;
      if (read >= SIDECAR_CAP) { capped = true; break; }
      read++;
      const meta = await readJsonSafe(file, sc);
      if (!meta) continue;
      const ts = meta.photoTakenTime || meta.creationTime;
      if (ts && ts.timestamp) {
        m.at = new Date(Number(ts.timestamp) * 1000);
        withDate++;
        lib.events.push({ at: m.at, kind: "photo", label: m.name });
      }
      const geo = (meta.geoData && meta.geoData.latitude) ? meta.geoData : meta.geoDataExif;
      if (geo && (geo.latitude || geo.longitude)) {
        m.place = { lat: geo.latitude, lon: geo.longitude };
        lib.places.push({ at: m.at || null, lat: geo.latitude, lon: geo.longitude });
      }
    }

    if (sidecars.size) {
      lib.insights.push({
        n: (capped ? sidecars.size : withDate).toLocaleString(),
        label: "Dates recoverable",
        note: "from Takeout metadata", accent: true,
      });
      lib.notes.push(
        "Google stores each photo's real date and location in a separate metadata file rather than in the photo itself. " +
        "That is why re-uploaded Takeout libraries often show up in the wrong order. Muletto reads those files and can write the correct date back into each photo." +
        (capped ? " This export is large, so only the first " + SIDECAR_CAP.toLocaleString() + " were read here." : "")
      );
    }

    // Location history (can be enormous, so guard the size)
    /* Counted across this block only, so the check below asks whether the
       Timeline folder produced anything - not whether the export has places
       at all, which it usually does from the photographs. */
    const placesBefore = lib.places.length;
    const locEntry = entries.find((e) => /location\s*history.*\/records\.json$/i.test(e.name) || /\/records\.json$/i.test(e.name));
    if (locEntry) {
      if (locEntry.size > JSON_LIMIT) {
        /* Said plainly. This used to promise that "the desktop app handles
           files this size", and there is no desktop app - it offered the
           reader a way out that does not exist. */
        lib.notes.push("Your location history file is " + Math.round(locEntry.size / 1048576) + " MB, which is larger than this reads in one pass, so the places in it have been skipped. Everything else in the export is unaffected.");
      } else {
        const rec = await readJsonSafe(file, locEntry);
        const list = rec && (rec.locations || rec.Records || []);
        if (Array.isArray(list)) {
          for (const p of list.slice(0, 20000)) {
            const lat = p.latitudeE7 !== undefined ? p.latitudeE7 / 1e7 : parseFloat(p.latitude);
            const lon = p.longitudeE7 !== undefined ? p.longitudeE7 / 1e7 : parseFloat(p.longitude);
            if (!isFinite(lat) || !isFinite(lon)) continue;
            lib.places.push({ at: parseDate(p.timestamp || p.timestampMs), lat, lon });
          }
        }
      }
    }

    /* Google Fit, split one table per measurement.
     *
     * NEVER RUN ON A REAL EXPORT. Built from Google's own documentation and
     * from what several published Takeout readers agree the columns are
     * called. The maintainer's Takeout has no Fit folder at all, so there was
     * nothing here to check it against. `PROVIDERS.md` says so plainly and
     * `TESTPLAN.md` marks it `S`. Correct all of this the first time a real
     * one turns up rather than trusting it.
     *
     * The shape, as documented: `Fit/Daily activity metrics/` holds one CSV
     * per day of fifteen-minute windows plus a `Daily Summaries.csv` of one
     * row per day, and `Fit/Activities/` holds a TCX per session. The daily
     * summary is the one worth reading - it is small, it is already
     * aggregated, and it covers the whole record.
     *
     * A wide row is split into one table per measurement rather than kept as
     * it arrived, because the health page matches a table to a kind and takes
     * the first that fits. Left wide, a file carrying steps, calories, heart
     * rate and weight would be filed as whichever one matched first and the
     * rest would vanish. One table each gives each measurement its own panel
     * and its own chart, which is the whole point of that page.
     *
     * Columns are found by pattern and never by position. Google has renamed
     * these between exports and a fixed index would read heart rate as
     * distance without complaining. */
    const fitCsv = entries.filter((e) =>
      /(^|\/)fit\/.*\.csv$/i.test(e.name) && !/\/activities\//i.test(e.name));
    if (fitCsv.length) {
      /* The summary if it exists, otherwise the per-day files, capped. Reading
         a decade of daily files is thousands of tiny CSVs for data the summary
         already holds. */
      const summary = fitCsv.filter((e) => /daily\s*summar/i.test(e.name));
      const use = summary.length ? summary : fitCsv.slice(0, 400);
      const series = new Map();          // measurement -> [[date, value], ...]

      for (const e of use) {
        let text;
        try { text = await MZip.extractText(file, e); } catch (err) { continue; }
        for (const sec of csvSections(text)) {
          const cols = sec.columns || [];
          if (!cols.length || !sec.rows.length) continue;
          /* Whichever column carries the moment. A summary is dated by day, a
             per-day file by the start of each fifteen-minute window. */
          const timeIdx = cols.findIndex((c) => /^(date|start ?time)$/i.test(String(c).trim()));
          if (timeIdx < 0) continue;
          for (let c = 0; c < cols.length; c++) {
            if (c === timeIdx) continue;
            const label = String(cols[c] || "").trim();
            if (!label || /^end ?time$/i.test(label)) continue;
            for (const row of sec.rows) {
              const raw = row[c];
              if (raw === undefined || raw === null || String(raw).trim() === "") continue;
              const v = Number(raw);
              if (!isFinite(v)) continue;
              if (!series.has(label)) series.set(label, []);
              series.get(label).push([row[timeIdx], raw]);
            }
          }
        }
      }

      /* One series per measurement, not three.
       *
       * Fit writes average, maximum and minimum heart rate as separate
       * columns, and all three match the catalogue's heart rate pattern - so
       * left alone they produce three panels with the same title and
       * different numbers, which reads as a bug whichever one you look at.
       * The average is the one that means "your heart rate that day". The
       * others stay in the export and remain visible as tables. */
      const better = (a, b) => (/^average/i.test(a) ? a : /^average/i.test(b) ? b : a);
      const best = new Map();
      for (const label of series.keys()) {
        const norm = label.replace(/^(average|avg|max|min|maximum|minimum)\s+/i, "")
                          .replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim();
        best.set(norm, best.has(norm) ? better(best.get(norm), label) : label);
      }
      const keep = new Set(best.values());

      for (const [label, rows] of series) {
        if (!rows.length || !keep.has(label)) continue;
        lib.tables.push({
          name: label,
          /* The path keeps "Fit" in it deliberately: the health page will not
             believe a loose kind like temperature or floors unless the source
             has already proved itself health-shaped, and this is how it does. */
          path: "Takeout/Fit/Daily activity metrics/" + label + ".csv",
          columns: ["Date", label],
          rows,
        });
      }
      if (series.size) {
        lib.stats.push({ n: series.size.toLocaleString(), label: "Fit measurements" });
      }
    }

    /* Timeline that Google no longer sends.
     *
     * Google moved Location History onto the device during 2024 and 2025 and
     * shut the server-side Timeline down on 9 June 2025. A Takeout requested
     * since then still has a Timeline folder, so it looks like the data is
     * there, but it holds settings and nothing else - measured in a real
     * export: `Takeout/Timeline/Settings.json`, 1,099 bytes, and no records.
     *
     * Without this the reader gets an empty map and no reason for it, and
     * concludes the export failed or that we cannot read it. Neither is true:
     * Google did not send it. The note says so and says where it went. */
    const hasTimelineFolder = entries.some((e) =>
      /(^|\/)(location history|timeline)( \(timeline\))?\//i.test(e.name));
    const gotPlaces = lib.places.length > placesBefore;
    if (hasTimelineFolder && !gotPlaces) {
      lib.notes.push("Google sent a Timeline folder with no location history in it. " +
        "That is not a fault in the export: Google moved Timeline onto the phone during " +
        "2024 and 2025 and shut the server-side one down in June 2025, so a Takeout has " +
        "nothing left to include. The history is still on your phone and can be exported " +
        "from the Google Maps app, under Settings and then Personal Content.");
    }

    // YouTube watch history
    const yt = entries.find((e) => /watch-history\.json$/i.test(e.name));
    if (yt) {
      const list = await readJsonSafe(file, yt);
      if (Array.isArray(list)) {
        for (const v of list.slice(0, 8000)) {
          const at = parseDate(v.time);
          if (at) lib.events.push({ at, kind: "video", label: (v.title || "Watched a video").replace(/^Watched\s+/, "Watched ") });
        }
      }
    }

    // Gmail is shipped as MBOX, often many gigabytes. Report rather than parse.
    const mbox = entries.filter((e) => /\.mbox$/i.test(e.name));
    if (mbox.length) {
      const bytes = mbox.reduce((s, e) => s + e.size, 0);
      const size = bytes >= 1073741824
        ? (bytes / 1073741824).toFixed(1) + " GB"
        : Math.max(1, Math.round(bytes / 1048576)) + " MB";
      // Streamed, headers only - the bodies are never held in memory.
      let indexed = 0;
      for (const e of mbox.slice(0, 3)) {
        try {
          const res = await MMbox.index(await MZip.streamEntry(file, e), { limit: 20000 });
          const { senders, events } = MMbox.summarise(res);
          indexed += res.messages.length;
          lib.events.push(...events);
          if (senders.length) {
            lib.tables.push({
              name: "Mail - who writes to you", path: e.name,
              columns: ["Sender", "Address", "Messages"],
              rows: senders.slice(0, 2000).map((x) => [x.name, x.address, String(x.count)]),
            });
          }
        } catch { /* leave it listed under All files */ }
      }
      if (indexed) {
        lib.insights.push({
          n: indexed.toLocaleString(), label: "Emails indexed",
          note: "headers only, from " + size + " of mail", accent: true,
        });
        lib.notes.push("Your Gmail mailbox (" + size + ") was indexed by header: sender, subject and date. Message bodies and attachments are deliberately not loaded.");
      } else {
        lib.notes.push("This export contains your Gmail mailbox (" + size + " as MBOX). It is listed under All files.");
      }
    }

    // Any remaining CSVs become browsable tables
    const gCsv = withinBudget(entries.filter((x) => /\.csv$/i.test(x.name)));
    noteDropped(lib, gCsv.dropped, "record tables");
    for (const e of gCsv.taken) {
      try {
        const { columns, rows } = parseCsv(await MZip.extractText(file, e));
        if (columns.length) lib.tables.push({ name: base(e.name).replace(/\.csv$/i, ""), path: e.name, columns, rows });
      } catch { /* skip */ }
    }

    return lib;
  }

  /* ---------- Meta (Facebook and Instagram share one format) ---------- */

  async function meta(file, entries, slug, label) {
    const lib = emptyLib(slug || "facebook", label || "Meta");
    await classifyFiles(lib, entries, file);

    // Conversations: messages/inbox/<thread>/message_N.json
    const threads = entries.filter((e) => /messages\/(inbox|archived_threads|filtered_threads)\/[^/]+\/message_\d+\.json$/i.test(e.name));
    const byThread = new Map();
    for (const e of threads.slice(0, 400)) {
      const key = e.name.replace(/\/message_\d+\.json$/i, "");
      if (!byThread.has(key)) byThread.set(key, []);
      byThread.get(key).push(e);
    }
    for (const [key, parts] of byThread) {
      const conv = { title: fixMojibake(decodeURIComponent(key.split("/").pop().replace(/_\w+$/, "").replace(/_/g, " "))), messages: [] };
      for (const part of parts.slice(0, 6)) {
        const data = await readJsonSafe(file, part);
        if (!data) continue;
        if (data.title) conv.title = fixMojibake(data.title);
        for (const m of (data.messages || []).slice(0, 3000)) {
          conv.messages.push({
            from: fixMojibake(m.sender_name || "Unknown"),
            direction: null,  // resolved later; Meta does not mark who is who
            text: fixMojibake(m.content || ""),
            type: m.photos ? "PHOTO" : m.videos ? "VIDEO" : m.share ? "LINK" : "TEXT",
            at: m.timestamp_ms ? new Date(m.timestamp_ms) : null,
          });
        }
      }
      if (conv.messages.length) {
        conv.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
        lib.conversations.push(conv);
      }
    }
    lib.conversations.sort((a, b) => b.messages.length - a.messages.length);

    // Posts and other dated content
    const contentFiles = entries.filter((e) =>
      /(posts_\d+\.json|your_posts.*\.json|stories\.json|reels\.json|profile_photos\.json)$/i.test(e.name)).slice(0, 12);
    for (const e of contentFiles) {
      const data = await readJsonSafe(file, e);
      const list = Array.isArray(data) ? data : (data && (data.ig_stories || data.ig_reels_media || data.photos)) || [];
      if (!Array.isArray(list)) continue;
      for (const post of list.slice(0, 4000)) {
        const t = post.creation_timestamp || (post.media && post.media[0] && post.media[0].creation_timestamp);
        const at = t ? new Date(t * 1000) : null;
        const title = fixMojibake(post.title || (post.media && post.media[0] && post.media[0].title) || "Post");
        if (at) lib.events.push({ at, kind: "post", label: title || "Post" });
      }
    }

    // Everything else structured becomes a table
    const mJson = withinBudget(entries.filter((x) => /\.json$/i.test(x.name)));
    noteDropped(lib, mJson.dropped, "data files");
    for (const e of mJson.taken) {
      if (/message_\d+\.json$/i.test(e.name)) continue;
      const data = await readJsonSafe(file, e);
      if (!data || typeof data !== "object") continue;
      // Some Meta files (posts_1.json) are a top-level array rather than an
      // object of named arrays, so handle both shapes.
      const lists = Array.isArray(data)
        ? [{ key: "entries", list: data }]
        : pickArrays(data, /./);
      for (const { key, list } of lists) {
        if (!list.length || typeof list[0] !== "object") continue;
        const cols = Object.keys(list[0]).filter((c) => typeof list[0][c] !== "object").slice(0, 8);
        if (!cols.length) continue;
        lib.tables.push({
          name: base(e.name).replace(/\.json$/i, "") + " - " + key,
          path: e.name, columns: cols,
          rows: list.slice(0, 2000).map((o) => cols.map((c) => fixMojibake(String(o[c] === undefined || o[c] === null ? "" : o[c])))),
        });
      }
      if (lib.tables.length > 40) break;
    }

    if (lib.conversations.length) {
      lib.insights.push({
        n: lib.conversations.reduce((s, c) => s + c.messages.length, 0).toLocaleString(),
        label: "Messages", note: "across " + lib.conversations.length.toLocaleString() + " conversations", accent: true,
      });
    }
    return lib;
  }

  /* ---------- Samsung ---------- */
  /* Samsung's export is a set of per-service folders. Gallery and Cloud hold
     media; Samsung Health ships CSVs whose first line is a service header
     rather than the column names. */

  async function samsung(file, entries) {
    const lib = emptyLib("samsung", "Samsung");
    await classifyFiles(lib, entries, file);

    let healthRows = 0;
    const sCsv = withinBudget(entries.filter((x) => /\.csv$/i.test(x.name)));
    noteDropped(lib, sCsv.dropped, "record tables");
    for (const e of sCsv.taken) {
      try {
        const text = await MZip.extractText(file, e);
        const fileName = base(e.name).replace(/\.csv$/i, "")
          .replace(/^com\.samsung\.(shealth\.|health\.)?/i, "")
          // GalaxyStore_<account>_<date>_access, ANS_gk<id>_<date>_access
          .replace(/[_-][a-z]{0,3}\d{6,}[_-]\d{6,}[_-]access$/i, "")
          /* Samsung stamps the export time onto the end of the file name, and
             separates it with a dot as often as with an underscore. Only the
             underscore was stripped, so half the tables were called things
             like "step_daily_trend.20260720000000". */
          .replace(/[._-]\d{6,}$/, "").replace(/[._-]+$/, "").trim();

        for (const sec of csvSections(text)) {
          let columns = sec.columns;
          let rows = sec.rows;
          // Samsung Health prefixes the file with a service line such as
          // "com.samsung.shealth.step_count,1". The real headers are the next row.
          if (rows.length && /^com\.samsung/i.test(columns[0] || "")) {
            columns = rows[0];
            rows = rows.slice(1);
          }
          if (!columns.length || !rows.length) continue;
          const name = sec.title
            ? (fileName ? fileName + ": " + sec.title : sec.title)
            : fileName;
          lib.tables.push({ name, path: e.name, columns: columns.map(niceColumn), rows });
          if (/health|step|sleep|exercise|heart|weight/i.test(e.name)) healthRows += rows.length;

          /* A measurement is not a moment.
           *
           * Every dated health row used to become a timeline entry, and a
           * watch worn for six years produces twenty-three thousand of them.
           * The timeline became eight hundred consecutive days of "Activity -
           * Samsung", nine to a day, with the photographs and messages
           * somebody actually came to look at buried a thousand rows apart.
           * Ninety-six percent of the timeline was skin temperature and
           * blood oxygen readings.
           *
           * Those belong on the health page, where they are a line with a
           * shape. What belongs on a timeline is the things that happened:
           * a workout, a badge, a challenge. The readings are still read,
           * still counted and still charted - they are just not events. */
          const OCCASION = /exercise|workout|activity_?type|reward|badge|milestone|trophy|challenge|social/i;
          const dateIdx = columns.findIndex((c) => /start_time|create_time|day_time|date|time/i.test(c));
          if (dateIdx >= 0 && rows.length <= 4000 && OCCASION.test(e.name + " " + name)) {
            for (const r of rows) {
              const at = parseDate(r[dateIdx]);
              if (at) lib.events.push({ at, kind: "record", label: name });
            }
          }
        }
      } catch { /* skip unreadable csv */ }
    }

    if (healthRows) {
      lib.insights.push({
        n: healthRows.toLocaleString(), label: "Health records",
        note: "steps, sleep and workouts", accent: true,
      });
    }
    if (!lib.media.length && lib.tables.length) {
      lib.notes.push("This part of your Samsung export holds service records. Gallery photos arrive only if Samsung Cloud backup was switched on, and may be in a separate archive.");
    }
    return lib;
  }

  /* ---------- Generic fallback ---------- */

  async function generic(file, entries, slug, label) {
    const lib = emptyLib(slug || "unknown", label || "Export");
    const genCsv = withinBudget(entries.filter((x) => /\.csv$/i.test(x.name)));
    noteDropped(lib, genCsv.dropped, "record tables");
    for (const e of genCsv.taken) {
      try {
        const fileName = base(e.name).replace(/\.csv$/i, "");
        for (const sec of csvSections(await MZip.extractText(file, e))) {
          if (!sec.columns.length || !sec.rows.length) continue;
          lib.tables.push({
            name: sec.title ? fileName + ": " + sec.title : fileName,
            path: e.name, columns: sec.columns.map(niceColumn), rows: sec.rows,
          });
        }
      } catch { /* skip */ }
    }
    const genJson = withinBudget(entries.filter((x) => /\.json$/i.test(x.name)));
    noteDropped(lib, genJson.dropped, "data files");
    for (const e of genJson.taken) {
      try {
        const data = await MZip.extractJson(file, e);
        for (const { key, list } of pickArrays(data, /./)) {
          if (!list.length || typeof list[0] !== "object") continue;
          const cols = Object.keys(list[0]);
          lib.tables.push({
            name: `${base(e.name).replace(/\.json$/i, "")} - ${key}`, path: e.name, columns: cols,
            rows: list.slice(0, 3000).map((o) => cols.map((c) => String(o[c] ?? ""))),
          });
        }
      } catch { /* skip */ }
    }
    await classifyFiles(lib, entries, file);
    return lib;
  }

  /* One table that arrived as fourteen files.
   *
   * Google splits a large table across numbered CSVs - a real Takeout ships
   * `comments.csv` through `comments(13).csv`, 206 rows each - and every one
   * of them was listed as its own table. Fourteen entries in the sidebar with
   * the same name, none of which is the thing the reader is looking for, and
   * no single view of their comments anywhere.
   *
   * Merged only when the columns match exactly, because a matching name is not
   * on its own evidence that two tables are the same table. Rows that appear
   * twice are dropped: the numbered files are pages, but an export that
   * repeats a page should not double it.
   */
  function mergePagedTables(lib) {
    const groups = new Map();
    for (const t of lib.tables || []) {
      const stem = String(t.name || "").replace(/\s*\((\d+)\)\s*$/, "").trim();
      // JSON rather than a separator character. Written with control bytes
      // between the parts, this put a literal 0x00 and 0x01 into the source -
      // the failure this project has a house rule about.
      const key = JSON.stringify([stem, t.columns || []]);
      if (!groups.has(key)) groups.set(key, { stem, list: [] });
      groups.get(key).list.push(t);
    }
    const out = [];
    let mergedFrom = 0, mergedInto = 0;
    for (const { stem, list } of groups.values()) {
      if (list.length === 1) { out.push(list[0]); continue; }
      const seen = new Set();
      const rows = [];
      for (const t of list) {
        for (const r of t.rows || []) {
          const k = JSON.stringify(r);
          if (seen.has(k)) continue;
          seen.add(k);
          rows.push(r);
        }
      }
      mergedFrom += list.length;
      mergedInto++;
      out.push({ name: stem, path: list[0].path, source: list[0].source,
                 columns: list[0].columns, rows, fromFiles: list.length });
    }
    if (mergedInto) {
      lib.tables = out;
      lib.notes.push(plural(mergedFrom, "file was", "files were") + " joined into " +
        plural(mergedInto, "table", "tables") + ", because this export splits a long " +
        "table across numbered files. Nothing was lost and repeated rows were dropped.");
    }
  }

  /* Spreadsheets, which are zips of XML.
   *
   * Samsung sends the Samsung Account dump and the support ticket list as
   * .xlsx and both were unread - the one format in that export where the
   * container was already openable and nobody had opened it. Confirmed by
   * magic bytes on the real files: 50 4b 03 04, an ordinary zip.
   *
   * Two parts matter. `xl/sharedStrings.xml` is a pool of every distinct
   * string in the workbook, and `xl/worksheets/sheet1.xml` holds the cells,
   * where a cell of type `s` carries an index into that pool rather than the
   * text. Reading the sheet without the pool gives a spreadsheet of integers.
   */
  function xmlText(s) {
    return String(s == null ? "" : s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, "&");
  }

  // "BC12" -> 54. Needed because empty cells are simply absent from the XML,
  // so a row's values have to be placed by column rather than in order.
  function colIndexOf(ref) {
    const m = /^([A-Z]+)/.exec(String(ref || ""));
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function readXlsx(file, entry) {
    const bytes = await MZip.extract(file, entry);
    const inner = new Blob([bytes]);
    const parts = await MZip.readDirectory(inner);
    const sheet = parts.find((p) => /^xl\/worksheets\/sheet1\.xml$/i.test(p.name)) ||
                  parts.find((p) => /^xl\/worksheets\/.*\.xml$/i.test(p.name));
    if (!sheet) return null;

    const pool = [];
    const shared = parts.find((p) => /^xl\/sharedStrings\.xml$/i.test(p.name));
    if (shared) {
      const sx = await MZip.extractText(inner, shared);
      for (const si of sx.split(/<si[ >]/).slice(1)) {
        // A string can be split across several runs; the text is all of them.
        let text = "";
        for (const t of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
        pool.push(xmlText(text));
      }
    }

    const sx = await MZip.extractText(inner, sheet);
    const rows = [];
    for (const rowXml of sx.split(/<row[ >]/).slice(1)) {
      const cells = [];
      for (const c of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
        const attrs = c[1] || c[3] || "";
        const body = c[2] || "";
        const at = colIndexOf((/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]);
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || "n";
        let v = "";
        if (type === "inlineStr") {
          for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += t[1];
          v = xmlText(v);
        } else {
          const raw = xmlText((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1] || "");
          v = type === "s" ? (pool[+raw] || "") : raw;
        }
        if (at >= 0) cells[at] = v; else cells.push(v);
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1].every((x) => !x)) rows.pop();
    if (rows.length < 2) return null;
    return { columns: rows[0].map((c, i) => c || "Column " + (i + 1)), rows: rows.slice(1) };
  }

  async function addSpreadsheets(lib, file, entries, say) {
    const sheets = entries.filter((e) => /\.xlsx$/i.test(e.name));
    if (!sheets.length) return;
    if (say) say("Reading " + plural(sheets.length, "spreadsheet", "spreadsheets") + "...");
    for (const e of sheets.slice(0, 40)) {
      try {
        const t = await readXlsx(file, e);
        if (t && t.rows.length) {
          lib.tables.push({ name: base(e.name).replace(/\.xlsx$/i, ""), path: e.name,
                            columns: t.columns, rows: t.rows });
        }
      } catch (err) { /* a spreadsheet we cannot read is still listed as a file */ }
    }
  }

  /* Snapchat sends a captioned memory as two files.
   *
   *   2024-10-31_D00F8CF2-...-main.mp4       the picture or clip
   *   2024-10-31_D00F8CF2-...-overlay.png    the caption, stickers and drawing,
   *                                          on a transparent background
   *
   * This is by design, not a broken export, and it is the single worst thing
   * about a Snapchat export: import the folder into Photos and every overlay
   * arrives as white text on a black square, sitting beside the memory it
   * belongs to. Somebody with two thousand memories and captions on half of
   * them has a thousand of those.
   *
   * Paired here by the name they share. The overlay stops being a picture in
   * its own right - which is what produced the black squares - and becomes a
   * property of the memory it was drawn on.
   */
  const OVERLAY_RE = /^(.*?)[-_]overlay\.[a-z0-9]+$/i;
  /* The other half is usually named -main, but not always: some exports drop
     the suffix and leave the bare shared name. Both are tried, longest first,
     so a file that does say -main is never matched to the wrong memory. */
  const stems = (path) => {
    const cut = path.replace(/\.[^.\/]+$/, "");
    const bare = cut.replace(/[-_]main$/i, "");
    return bare === cut ? [cut] : [bare, cut];
  };

  function pairOverlays(lib) {
    const overlays = new Map();
    for (const m of lib.media || []) {
      const hit = OVERLAY_RE.exec(m.path);
      if (hit) overlays.set(hit[1], m);
    }
    if (!overlays.size) return;

    let paired = 0;
    for (const m of lib.media || []) {
      if (OVERLAY_RE.test(m.path)) continue;
      let over = null;
      for (const s of stems(m.path)) { over = overlays.get(s); if (over) break; }
      if (!over || over.isOverlay) continue;
      m.overlay = over.entry;
      m.overlaySize = over.size;
      over.isOverlay = true;
      paired++;
    }
    /* An overlay whose memory is not in the export cannot be put back on
       anything, and it is the black square in person: white writing on
       nothing, sitting in the library as though it were a photograph. It
       stays, because it is a real file and quietly dropping somebody's data
       is worse, but it is named for what it is so nobody has to work it out
       from a thumbnail. */
    const stranded = (lib.media || []).filter(
      (m) => !m.isOverlay && OVERLAY_RE.test(m.path)).length;
    if (stranded) {
      lib.notes.push(plural(stranded, "caption is", "captions are") + " in this export " +
        "without the memory they were drawn on - Snapchat sends the two as separate " +
        "files, and only one arrived. They show up as writing on a transparent " +
        "background, because that is all they are.");
    }
    if (!paired) return;

    // The overlays themselves leave the library: they are not memories.
    lib.media = lib.media.filter((m) => !m.isOverlay);
    lib.notes.push(plural(paired, "memory has", "memories have") + " a caption or " +
      "sticker that Snapchat sent as a separate transparent picture. They have been " +
      "put back onto the memory they belong to, so they are not sitting in your " +
      "library as black squares.");
  }

  /* ---------- Reddit ----------
   *
   * A Reddit export is the plainest thing any of these services ships: a flat
   * bag of CSVs, no folder, no manifest, no index page. That makes it easy to
   * read and easy to get wrong, because "posts.csv" is a name anything could
   * use - hence the detection on the set rather than on any one of them.
   *
   * Written from the format rather than from anybody's reader. There is a good
   * open-source viewer for these exports, and it is AGPL, which Muletto's
   * licence cannot take. The shape of a CSV is a fact and not the author's to
   * license, so this reads the files and owes that project nothing but the
   * courtesy of saying so.
   *
   * Columns are matched by pattern, never by position. Reddit has changed
   * these before and will again, and a reader that assumes column four is the
   * subreddit turns into silent nonsense the day they insert a column.
   */
  const RED_KIND = [
    [/^posts?\.csv$/i, "posts", "Posts"],
    [/^comments?\.csv$/i, "comments", "Comments"],
    [/^post_votes?\.csv$/i, "post_votes", "Votes on posts"],
    [/^comment_votes?\.csv$/i, "comment_votes", "Votes on comments"],
    [/^saved_posts?\.csv$/i, "saved_posts", "Saved posts"],
    [/^saved_comments?\.csv$/i, "saved_comments", "Saved comments"],
    [/^hidden_posts?\.csv$/i, "hidden", "Hidden posts"],
    [/^subscribed_subreddits?\.csv$/i, "subs", "Subreddits you follow"],
    [/^messages?\.csv$/i, "messages", "Private messages"],
    [/^chat_history\.csv$/i, "chat", "Chat"],
    [/^drafts?\.csv$/i, "drafts", "Drafts"],
    [/^friends?\.csv$/i, "friends", "Friends"],
    [/^linked_identities\.csv$/i, "identities", "Linked accounts"],
    [/^ip_logs?\.csv$/i, "iplog", "Sign-in addresses"],
  ];

  const redCol = (cols, re) => cols.findIndex((c) => re.test(String(c || "")));
  const redAt = (row, i) => (i >= 0 ? parseDate(row[i]) : null);
  const redVal = (row, i) => (i >= 0 ? String(row[i] == null ? "" : row[i]).trim() : "");

  /* A subreddit comes back as "r/name", "/r/name" or a bare name depending on
     which file it is in. One spelling, so the counts add up. */
  const redSub = (v) => {
    const s = String(v || "").trim().replace(/^\/?r\//i, "").replace(/\/$/, "");
    return s ? "r/" + s : "";
  };

  async function reddit(file, entries) {
    const lib = emptyLib("reddit", "Reddit");
    await classifyFiles(lib, entries, file);

    const csvs = withinBudget(entries.filter((e) => /\.csv$/i.test(e.name)));
    noteDropped(lib, csvs.dropped, "record tables");

    const found = new Map();
    let withIp = 0, ipFiles = [];

    for (const e of csvs.taken) {
      let text;
      try { text = await MZip.extractText(file, e); } catch { continue; }
      const name = base(e.name);
      const hit = RED_KIND.find(([re]) => re.test(name));
      const key = hit ? hit[1] : null;

      for (const sec of csvSections(text)) {
        const cols = sec.columns || [];
        const rows = sec.rows || [];
        if (!cols.length || !rows.length) continue;

        lib.tables.push({
          name: hit ? hit[2] : name.replace(/\.csv$/i, ""),
          path: e.name,
          columns: cols.map(niceColumn),
          rows,
        });
        if (key) found.set(key, (found.get(key) || 0) + rows.length);

        /* Reddit puts the address you were using on every post and every
           comment. It is the single most surprising thing in the archive and
           the reason this reader says so out loud rather than filing it as
           column six of a table nobody opens. */
        const ipIdx = redCol(cols, /^ip[ _]?(address)?$/i);
        if (ipIdx >= 0 && rows.some((r) => redVal(r, ipIdx))) {
          withIp += rows.filter((r) => redVal(r, ipIdx)).length;
          if (ipFiles.indexOf(name) < 0) ipFiles.push(name);
        }

        const dateIdx = redCol(cols, /^(date|created|created_?utc|timestamp|sent)/i);
        const subIdx = redCol(cols, /subreddit/i);
        const bodyIdx = redCol(cols, /^(body|text|content|message)$/i);
        const titleIdx = redCol(cols, /^(title|subject)$/i);

        /* Posts and comments become timeline entries, labelled with the
           subreddit they were in - which is the part somebody scrolling their
           own history actually recognises. */
        if ((key === "posts" || key === "comments") && dateIdx >= 0) {
          let added = 0;
          for (const r of rows) {
            const at = redAt(r, dateIdx);
            if (!at || added >= 4000) continue;
            const sub = redSub(redVal(r, subIdx));
            const what = redVal(r, titleIdx) ||
              redVal(r, bodyIdx).replace(/\s+/g, " ").slice(0, 120);
            lib.events.push({
              at,
              kind: key === "posts" ? "post" : "comment",
              label: (key === "posts" ? "Posted" : "Commented") +
                (sub ? " in " + sub : "") + (what ? ": " + what : ""),
            });
            added++;
          }
        }

        /* Messages and chat become conversations, grouped by who they were
           with. Reddit's own chat export has one row per message with the
           channel on it, and the private-message file has a subject instead -
           two shapes, one view. */
        if (key === "messages" || key === "chat") {
          const fromIdx = redCol(cols, /^(from|author|username|sender)$/i);
          const toIdx = redCol(cols, /^(to|recipient)$/i);
          const chanIdx = redCol(cols, /^(channel_name|conversation|thread_id)/i);

          /* Which name is yours.
           *
           * A private-message file has a from and a to and says nowhere which
           * account it belongs to - so grouping by "from" titled half the
           * threads with the reader's own handle, which is nobody's idea of a
           * conversation. The account holder is the name on both sides of
           * almost every row, so it is the one that appears most often across
           * the two columns together. */
          const seen = new Map();
          for (const r of rows) {
            for (const i of [fromIdx, toIdx]) {
              const v = redVal(r, i);
              if (v) seen.set(v, (seen.get(v) || 0) + 1);
            }
          }
          let me = "";
          for (const [name, count] of seen) {
            if (!me || count > seen.get(me)) me = name;
          }

          const byThread = new Map();
          for (const r of rows) {
            const text = redVal(r, bodyIdx);
            if (!text) continue;
            const from = redVal(r, fromIdx), to = redVal(r, toIdx);
            /* Whoever is not you. If both or neither match, the channel name
               or the subject is a better title than a guess. */
            const other = from && from !== me ? from : to && to !== me ? to : "";
            const title = other || redVal(r, chanIdx) || redVal(r, titleIdx) || "Reddit";
            if (!byThread.has(title)) byThread.set(title, []);
            byThread.get(title).push({
              at: redAt(r, dateIdx), text, from,
              direction: me && from === me ? "sent" : "received",
              type: "text",
            });
          }
          for (const [title, msgs] of byThread) {
            msgs.sort((a, b) => (a.at || 0) - (b.at || 0));
            lib.conversations.push({ title, messages: msgs });
          }
        }
      }
    }

    if (withIp) {
      lib.notes.push("Reddit includes the internet address you were connected from on " +
        plural(withIp, "row", "rows") + " of this export" +
        (ipFiles.length ? " (" + ipFiles.slice(0, 3).join(", ") + ")" : "") +
        ". Nobody expects that in a copy of their own posts, and it is worth knowing " +
        "before you put the folder anywhere shared.");
    }

    const posts = found.get("posts") || 0, comments = found.get("comments") || 0;
    if (posts || comments) {
      lib.insights.push({
        n: (posts + comments).toLocaleString(),
        label: "Posts and comments",
        note: posts && comments
          ? plural(posts, "post", "posts") + " and " + plural(comments, "comment", "comments")
          : "in this export",
        accent: true,
      });
    }
    if (found.get("subs")) {
      lib.insights.push({
        n: (found.get("subs")).toLocaleString(),
        label: "Subreddits followed", note: "at the time of the export",
      });
    }

    /* What Reddit ships that this export does not have. Said only for Reddit,
       because it is a statement about Reddit. */
    if (!found.size) {
      lib.notes.push("This looks like a Reddit export, but none of the files it usually " +
        "contains were found. If the download was split, open the other parts alongside it.");
    }

    lib.conversations.sort((a, b) => b.messages.length - a.messages.length);
    return lib;
  }

  async function parse(file, entries, detected, say) {
    const slug = detected && detected.slug;
    const finish = async (libPromise) => {
      if (say) say("Working out what is in " + (detected && detected.label ? detected.label : "this export") + "...");
      const lib = await libPromise;
      pairOverlays(lib);
      await addSpreadsheets(lib, file, entries, say);
      mergePagedTables(lib);
      await readPhotoDates(lib, file, 800, say);
      await readVideoDates(lib, file, 200, say);
      return lib;
    };
    if (slug === "snapchat") return finish(snapchat(file, entries));
    if (slug === "apple") return finish(apple(file, entries));
    if (slug === "google") return finish(google(file, entries));
    if (slug === "samsung") return finish(samsung(file, entries));
    if (slug === "reddit") return finish(reddit(file, entries));
    if (slug === "facebook" || slug === "instagram") {
      return finish(meta(file, entries, slug, detected.label));
    }
    return finish(generic(file, entries, slug, detected && detected.label));
  }

  return { parse, parseCsv, parseDate, mediaKind, mimeOf, renderable, heifFamily };
})();
