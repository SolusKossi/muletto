"use strict";

/* Muletto - what is inside an export.

   The library shows what Muletto understood. This shows what was actually
   there, which is the only way to tell "the parser skipped it" apart from "the
   export never had it".

   It is built from the archive's structure: folder layout, file counts and
   extensions, JSON key names, CSV column headers. Values are not read - a key
   name is enough to see that a parser is looking for `takenAt` in a file that
   calls it `photoTakenTime`, and reading the value would tell us nothing more
   about that.

   Names are not redacted. This is the reader's own export, described on the
   reader's own machine, and hiding their folder names from them helps nobody:
   "Messages/inbox/bjorn_a" tells them something, "<name>" does not. Digits are
   still collapsed, so IMG_4471.jpg and IMG_0002.jpg report as one shape rather
   than four thousand.

   If a way to submit one of these is ever built, redaction becomes a question
   again - and it belongs at the moment of sending, as a choice, not baked into
   a file that never leaves the machine. */

const MDiagnose = (function () {
  const ext = (n) => {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(n);
    return m ? m[1].toLowerCase() : "(none)";
  };

  /* IMG_4471.jpg and IMG_0002.jpg are the same shape. Collapsing the digits is
     what turns four thousand file names into one line. */
  const maskDigits = (s) => s.replace(/\d+/g, (d) => "#".repeat(Math.min(d.length, 4)));

  /* A file name is often the only thing in an export a person wrote themselves.

     Folder names describe the service - Takeout/Chrome, Heart Rate - and are
     what makes this report worth reading. File names are note titles, document
     names, the name of somebody a shared album belongs to. Digit masking alone
     left "Egg hjelm.spd" and "Kevin tanke.csv" in a report meant to be safe to
     hand over, so the letters go too and only the shape and the extension are
     kept. */
  /* Some folders are named after people.

     Meta writes messages/inbox/<the other person>_<id>/, Google Photos names a
     folder after the album, Snapchat after the friend. Keeping folder names
     because they identify the service is right at the top of a tree and wrong
     underneath these, so anything below one of them is shaped like a file
     name. Checked against a real export: KevinFurseth_9fj3 survived the first
     version of this. */
  // The container, not its parent: threads/inbox/<person>, not threads/<person>.
  const PERSONAL_PARENT = /^(inbox|message_requests|archived_threads|filtered_threads|e2ee_cutover|chats|conversations|calls|friends|albums|shared_albums|groups|Google Photos)$/i;

  function shapeSegment(seg) {
    return seg.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/\d/g, "9")
      .replace(/(.)\1{3,}/g, (m, c) => c + c + c + c);
  }

  function maskDir(dir) {
    if (!dir) return dir;
    const parts = dir.split("/");
    let personal = false;
    const out = parts.map((seg) => {
      if (personal) return shapeSegment(seg);
      if (PERSONAL_PARENT.test(seg)) { personal = true; return seg; }
      return maskDigits(seg);
    });
    return out.join("/");
  }

  function maskName(path) {
    const cut = path.lastIndexOf("/");
    const dir = cut < 0 ? "" : path.slice(0, cut + 1);
    let base = path.slice(cut + 1);
    let dot = base.lastIndexOf(".");
    if (dot <= 0) dot = base.length;
    const stem = base.slice(0, dot), ext = base.slice(dot);
    /* Not every file name is somebody's writing. Heart Rate/Heart Rate.csv
       names the measurement, message_1.json is generated, IMG_####.JPG is a
       camera. What gives a person away is a title they typed: capitals and
       lower case with a space in it. Those are shaped; the rest keep their
       name with the digits collapsed, because losing them would cost most of
       what makes the report worth reading. */
    const parent = dir.replace(/\/$/, "").split("/").pop() || "";
    const same = stem.toLowerCase() === parent.toLowerCase();
    const written = /\s/.test(stem) && /[a-z]/.test(stem) && /[A-Z]/.test(stem);
    const odd = /[^ -~]/.test(stem);
    const keep = same || (!written && !odd);
    const shaped = keep ? maskDigits(stem) : shapeSegment(stem);
    return maskDir(dir.replace(/\/$/, "")) + (dir ? "/" : "") + shaped + ext.toLowerCase();
  }

  /* Key names only, never values. Arrays report their length and the shape of
     the first element. */
  function shapeOf(value, depth = 0) {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      if (!value.length) return "array(0)";
      if (depth >= 2) return `array(${value.length})`;
      return { _array: value.length, of: shapeOf(value[0], depth + 1) };
    }
    if (typeof value === "object") {
      if (depth >= 2) return "object";
      const out = {};
      for (const k of Object.keys(value).slice(0, 40)) out[k] = shapeOf(value[k], depth + 1);
      return out;
    }
    return typeof value;   // "string" / "number" / "boolean" - never the value
  }

  /* Twenty-five was enough to describe an archive and nowhere near enough to
     debug one: a Takeout has hundreds of distinct shapes and the twenty-sixth
     is where the interesting one usually is. What was skipped is reported, so
     a thin report never reads as a complete one. */
  const MAX_INSPECT = 400;
  const INSPECT_LIMIT_BYTES = 8 * 1024 * 1024;

  async function build(source) {
    const { file, entries, det } = source;

    // Folder summary
    const folders = new Map();
    const extensions = new Map();
    let totalBytes = 0;
    for (const e of entries) {
      totalBytes += e.size;
      const dir = e.name.includes("/") ? e.name.slice(0, e.name.lastIndexOf("/")) : "(root)";
      const shape = dir === "(root)" ? dir : maskDir(dir);
      const f = folders.get(shape) || { files: 0, bytes: 0, extensions: {} };
      f.files++; f.bytes += e.size;
      const x = ext(e.name);
      f.extensions[x] = (f.extensions[x] || 0) + 1;
      folders.set(shape, f);
      extensions.set(x, (extensions.get(x) || 0) + 1);
    }

    // Schema of a sample of the structured files
    const structured = [];
    /* One of each shape rather than the first N files. A Takeout with 3,000
       photo sidecars used the whole budget on the same schema repeated. */
    const eligible = entries.filter((e) =>
      /\.(json|csv)$/i.test(e.name) && e.size <= INSPECT_LIMIT_BYTES);
    const bySchema = new Map();
    for (const e of eligible) {
      const k = maskName(e.name);
      if (!bySchema.has(k)) bySchema.set(k, e);
    }
    const distinct = [...bySchema.values()];
    const candidates = distinct.slice(0, MAX_INSPECT);

    for (const e of candidates) {
      const shape = maskName(e.name);
      try {
        if (/\.json$/i.test(e.name)) {
          const data = await MZip.extractJson(file, e);
          structured.push({ path: shape, kind: "json", bytes: e.size, shape: shapeOf(data) });
        } else {
          const text = await MZip.extractText(file, e);
          const { columns, rows } = MParse.parseCsv(text);
          structured.push({ path: shape, kind: "csv", bytes: e.size, rows: rows.length, columns });
        }
      } catch (err) {
        structured.push({ path: shape, kind: "unreadable", bytes: e.size, error: String(err.message || err) });
      }
    }

    return {
      report: "muletto-structure",
      version: 2,
      note: "Folder layout, key names and column headers only. No file contents or values. File names are reduced to their shape; folder names are kept because they name the service.",
      archive: {
        detectedAs: det ? det.label : "not recognised",
        files: entries.length,
        bytes: totalBytes,
        compressionMethods: [...new Set(entries.map((e) => e.method))],
      },
      inspected: {
        distinctShapes: distinct.length,
        read: candidates.length,
        skipped: Math.max(0, distinct.length - candidates.length),
        tooBig: eligible.length - distinct.length >= 0
          ? entries.filter((e) => /\.(json|csv)$/i.test(e.name) && e.size > INSPECT_LIMIT_BYTES).length
          : 0,
      },
      extensions: Object.fromEntries([...extensions.entries()].sort((a, b) => b[1] - a[1])),
      folders: Object.fromEntries(
        [...folders.entries()].sort((a, b) => b[1].files - a[1].files).slice(0, 60)
      ),
      structuredFiles: structured,
    };
  }

  /* What the parser actually managed to read - the other half of a mismatch. */
  function coverage(lib) {
    return {
      media: lib.media.length,
      conversations: lib.conversations.length,
      messages: lib.conversations.reduce((s, c) => s + c.messages.length, 0),
      timelineEvents: lib.events.length,
      places: lib.places.length,
      recordTables: lib.tables.map((t) => ({ name: t.name, columns: t.columns.length, rows: t.rows.length })),
      otherFiles: lib.files.length,
    };
  }

  /* Account for every single entry, and say what happened to it.
   *
   * The question this answers is the one nobody can answer by looking at a
   * library: is this everything? Two thousand photographs on screen look
   * complete whether or not another four hundred files were walked past in
   * silence. Counting what was read tells you nothing; the only useful
   * number is what was not.
   *
   * So every entry in the archive lands in exactly one bucket and the buckets
   * have to add up to the total. Anything that cannot be explained is the
   * answer - and in a real Takeout that turned out to be Drive, Play Games and
   * a mailbox, roughly a fifth of the archive, none of which was visible as
   * missing anywhere in the interface.
   */
  function reconcile(source) {
    const entries = source.entries || [];
    const lib = source.lib || {};
    const used = new Map();          // path -> what became of it
    const mark = (path, what) => { if (path && !used.has(path)) used.set(path, what); };

    for (const m of lib.media || []) mark(m.path, "media");
    for (const t of lib.tables || []) mark(t.path, "table");
    for (const c of lib.conversations || []) {
      for (const src of (c.paths || (c.path ? [c.path] : []))) mark(src, "messages");
    }

    /* The topic views read files the library never holds - a note, a vCard, a
       recording. Counting those as unread said an Apple export was 33 percent
       understood while 809 notes and 319 recordings were on screen. */
    if (typeof MTopics !== "undefined" && MTopics.claims) {
      try {
        for (const name of MTopics.claims(entries)) mark(name, "view");
      } catch (err) { /* the older, gloomier count stands */ }
    }

    /* A sidecar is read and then thrown away, so it never appears in the
       library. Rather than thread that through every parser, the pairing is
       re-derived here: a .json whose name reduces to the name of a picture we
       did read was that picture's date and place. */
    const mediaPaths = new Set((lib.media || []).map((m) => m.path));
    const stem = (n) => n
      .replace(/\((\d+)\)(?=\.json$)/i, "")
      .replace(/\.supp[a-z-]*\.json$/i, "")
      .replace(/\.json$/i, "");
    let orphanSidecars = 0;
    for (const e of entries) {
      if (used.has(e.name) || !/\.json$/i.test(e.name)) continue;
      const base = stem(e.name);
      if (mediaPaths.has(base)) mark(e.name, "sidecar");
      else if (/\.(jpe?g|png|heic|heif|gif|webp|mp4|mov|avi|m4v)$/i.test(base)) {
        // Names a picture that is not in the library: the pair broke.
        mark(e.name, "orphan-sidecar");
        orphanSidecars++;
      }
    }

    // Things that are documentation about the export rather than data in it.
    const NOISE = /(^|\/)(archive_browser|archiv_ubersicht|index|start_here|readme)[^/]*$|file[_ ]?description|_description\.pdf$/i;
    const nested = [];
    const unread = new Map();        // extension -> count
    const unreadWhere = new Map();   // top folder -> count
    let noise = 0, insideNested = 0;

    for (const e of entries) {
      if (used.has(e.name)) continue;
      if (/\.zip$/i.test(e.name)) { nested.push(e.name); continue; }
      if (NOISE.test(e.name)) { noise++; continue; }
      const x = (e.name.match(/\.([a-z0-9]{1,6})$/i) || [, "(none)"])[1].toLowerCase();
      unread.set(x, (unread.get(x) || 0) + 1);
      const parts = e.name.split("/");
      const where = parts.length > 2 && /^takeout$/i.test(parts[0]) ? parts[1]
        : parts.length > 1 ? parts[0] : "(root)";
      unreadWhere.set(where, (unreadWhere.get(where) || 0) + 1);
    }

    const readCount = used.size;
    const unreadCount = [...unread.values()].reduce((a, b) => a + b, 0);
    return {
      total: entries.length,
      read: readCount,
      noise,
      nested: nested.length,
      nestedNames: nested.slice(0, 20),
      unread: unreadCount,
      orphanSidecars,
      byType: [...unread.entries()].sort((a, b) => b[1] - a[1]),
      byArea: [...unreadWhere.entries()].sort((a, b) => b[1] - a[1]),
      // The whole point: this must be zero.
      unexplained: entries.length - readCount - noise - nested.length - unreadCount,
    };
  }

  return { build, coverage, reconcile };
})();
