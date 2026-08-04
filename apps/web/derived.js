"use strict";

/* Muletto - what we worked out, kept against the file rather than the export.

   Some of this is expensive: hashing a photo to find near-duplicates costs a
   decode, and describing one with a model will cost real money. None of it
   should ever be paid for twice.

   The trick is what the work is filed under. Keying it to an export means a
   fresh export from the same provider next year looks entirely new, and every
   photo that was already there gets analysed again. Keying it to a path means
   the same picture in an Apple export and a Google export is analysed twice,
   and a rename loses the lot. So it is filed under the contents.

   Two things identify contents here, and the difference matters:

   - A SHA-256 of the bytes is the identity. Nothing is recorded under anything
     weaker, because a wrong match means one of your photos wearing another of
     your photos' results.
   - The CRC and length that the archive already lists for every entry are an
     index, not an identity. They cost nothing to read - no decompression at
     all - so they are what makes "have I already done this file?" answerable
     before deciding to open it.

   A 32-bit checksum starts colliding within a large library, so the index only
   ever *suggests* a record. Cheap local results are taken on that suggestion,
   because being wrong costs a slightly odd near-duplicate grouping. Anything
   that costs money, or gets written back into the user's files, calls verify()
   and confirms the digest first. The rule is written down in one place rather
   than left to each caller to remember.

   All of it stays on this device, and all of it can be written out to a file
   the user keeps - see MDerived.toFile. Nothing here is uploaded. */

const MDerived = (function () {
  const DB = "muletto";
  const STORE = "derived";
  const INDEX = "content-index";
  const SETTINGS = "settings";
  const FORMAT = "muletto-work/1";

  /* One database, four stores, opened from three files. They must all name the
     same version and all create every store, because whichever opens first
     runs the upgrade - and a later open at a lower version is a hard error
     that would take the whole app down. */
  const DB_VERSION = 5;
  const ALL_STORES = ["jobs", "libraries", "derived", "content-index", "settings", "thumbs"];

  function upgrade(db) {
    for (const name of ALL_STORES) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    }
  }


  /* The free index: straight out of the zip directory, no decompression. */
  function hintOf(entry) {
    if (!entry || !entry.crc || !entry.size) return null;
    return entry.crc.toString(36) + "-" + entry.size.toString(36);
  }

  function hintOfMedia(m) {
    return m && m.entry ? hintOf(m.entry) : null;
  }

  /* The identity. Everything is recorded under this.

     WebCrypto exists only in a secure context, which means https or localhost.
     Served over plain http it is simply absent, and since every photo goes
     through here that surfaces as "cannot read properties of undefined" on the
     first one - a mystery, from a cause nowhere near the symptom. Saying it
     plainly costs one branch. */
  async function digest(bytes) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      throw new Error(
        "This page needs a secure connection to identify files. Open it over " +
        "https (or localhost) rather than http.");
    }
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
    return out;
  }

  /* Confirm a suggested record really belongs to these bytes. Required before
     spending money on the strength of one, or writing its results anywhere. */
  async function verify(bytes, suggested) {
    if (!suggested || !suggested.id) return false;
    return (await digest(bytes)) === suggested.id;
  }

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  /* What might already be known about a set of files, without opening any of
     them. Keyed by the cheap index, so every answer is a suggestion: safe to
     act on for free work, and to be confirmed with verify() otherwise. */
  async function suggest(hints) {
    const found = new Map();
    const wanted = hints.filter(Boolean);
    if (!wanted.length) return found;
    const ids = new Map();
    try {
      await run(INDEX, "readonly", (s) => {
        for (const h of wanted) {
          const req = s.get(h);
          req.onsuccess = () => { if (req.result) ids.set(h, req.result.sha); };
        }
      });
      if (!ids.size) return found;
      await run(STORE, "readonly", (s) => {
        for (const [hint, sha] of ids) {
          const req = s.get(sha);
          req.onsuccess = () => { if (req.result) found.set(hint, req.result); };
        }
      });
    } catch (e) { /* no store yet, or private mode: everything is simply new */ }
    return found;
  }

  /* Merged rather than replaced, so a later pass that adds tags does not throw
     away an earlier pass that added a hash.

     Each record is filed under its digest, and its cheap index entry is
     written alongside so the next visit can find it without opening the file.
     Two different files sharing an index entry is possible; the later one wins
     the index, and verify() is what stops that mattering. */
  async function record(entries) {
    const good = entries.filter((e) => e && e.id);
    if (!good.length) return 0;
    let n = 0;
    try {
      await run(STORE, "readwrite", (s) => {
        for (const e of good) {
          const req = s.get(e.id);
          req.onsuccess = () => {
            const { hint, ...rest } = e;
            s.put(Object.assign({}, req.result || {}, rest, { at: new Date() }));
            n++;
          };
        }
      });
      const hints = good.filter((e) => e.hint);
      if (hints.length) {
        await run(INDEX, "readwrite", (s) => {
          for (const e of hints) s.put({ id: e.hint, sha: e.id });
        });
      }
    } catch (e) { return 0; }
    return n;
  }

  async function all() {
    try {
      return await run(STORE, "readonly", (s) => {
        const req = s.getAll();
        const box = { list: [] };
        req.onsuccess = () => { box.list = req.result || []; };
        return box;
      }).then((box) => box.list);
    } catch (e) { return []; }
  }

  async function count() {
    return (await all()).length;
  }

  /* The index travels with the records. Without it a restored file would hold
     every result and be unable to match any of them to a file cheaply. */
  async function allIndex() {
    try {
      return await run(INDEX, "readonly", (s) => {
        const req = s.getAll();
        const box = { list: [] };
        req.onsuccess = () => { box.list = req.result || []; };
        return box;
      }).then((box) => box.list);
    } catch (e) { return []; }
  }

  /* Small named things that belong to the person rather than to a file: which
     people they have said are the same person, and so on. */
  async function setting(id, value) {
    if (value === undefined) {
      try {
        return await run(SETTINGS, "readonly", (s) => {
          const req = s.get(id);
          const box = {};
          req.onsuccess = () => { box.v = req.result ? req.result.value : undefined; };
          return box;
        }).then((box) => box.v);
      } catch (e) { return undefined; }
    }
    try { await run(SETTINGS, "readwrite", (s) => s.put({ id, value })); } catch (e) { /* ignore */ }
    return value;
  }

  async function clear() {
    try {
      await run(STORE, "readwrite", (s) => s.clear());
      await run(INDEX, "readwrite", (s) => s.clear());
      await run(SETTINGS, "readwrite", (s) => s.clear());
      // The small copies are on disk too, and are usually the bulk of it. A
      // "forget everything" that left them behind would be a lie.
      await run(THUMBS, "readwrite", (s) => s.clear());
      return true;
    } catch (e) { return false; }
  }

  /* ---------- the portable copy ---------- */

  /* The same records, as a file the user keeps.

     IndexedDB is enough for coming back next month on this machine, but it is
     the browser's to evict and it does not travel. Work that cost money must
     not depend on a cache, so it can be written out and read back on another
     machine, another browser, or after clearing site data.

     It holds only what was worked out, keyed by content - never the photos,
     never the messages. Feeding it back alongside a fresh export from next
     year restores every tag for every picture that carried over. */
  async function toFile(meta) {
    const payload = {
      format: FORMAT,
      written: new Date().toISOString(),
      about: "Work Muletto did on your files, kept against the contents of each " +
        "file rather than its name, so it still applies to a later export. " +
        "It contains no photos and no messages.",
      library: meta || null,
      links: (await setting("people:links")) || [],
      records: await all(),
      index: await allIndex(),
    };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === "undefined") {
      return { blob: new Blob([bytes], { type: "application/json" }), ext: "json", raw: bytes.length };
    }
    const gz = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return { blob: await new Response(gz).blob(), ext: "muletto", raw: bytes.length };
  }

  async function fromFile(file) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {          // gzip
      if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot read a compressed work file.");
      }
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      bytes = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error("That does not look like a Muletto work file.");
    }
    if (!data || data.format !== FORMAT) {
      throw new Error("That file was written by a different version of Muletto.");
    }
    const added = await record(data.records || []);
    if (data.index && data.index.length) {
      try {
        await run(INDEX, "readwrite", (s) => {
          for (const row of data.index) if (row && row.id && row.sha) s.put(row);
        });
      } catch (e) { /* results still restored, just slower to match */ }
    }
    if (data.links && data.links.length) {
      const existing = (await setting("people:links")) || [];
      const merged = new Map(existing);
      for (const [a, b] of data.links) merged.set(a, b);
      await setting("people:links", [...merged]);
    }
    return { added, total: (data.records || []).length, written: data.written, library: data.library };
  }

  /* ---------- thumbnails, on disk ----------

     A library of three thousand phone photographs is several gigabytes. The
     grid cannot hold that, and re-reading and re-decoding an original every
     time a tile scrolls into view is the slow path this exists to avoid.

     So each picture is shrunk once and the small copy is written here.
     IndexedDB is on disk, not in memory: the browser holds a file, and a read
     brings back one thumbnail rather than keeping thousands resident. About
     25 KB each, so a big library is a few tens of megabytes on disk and the
     work is never repeated - not on the next visit, and not when the same
     photograph turns up inside next year's export.

     Keyed by the archive's own checksum and length, the same free index the
     rest of this file uses, so a lookup costs no reading at all. That is a
     suggestion rather than a proof, as it is everywhere else here: two
     different files would have to share both a CRC32 and an exact byte length
     to collide, and the worst it could do is show the wrong small picture. */
  const THUMBS = "thumbs";

  async function getThumbs(hints) {
    const out = new Map();
    const wanted = [...new Set(hints.filter(Boolean))];
    if (!wanted.length) return out;
    try {
      await run(THUMBS, "readonly", (store) => {
        for (const h of wanted) {
          const req = store.get(h);
          req.onsuccess = () => { if (req.result && req.result.blob) out.set(h, req.result.blob); };
        }
      });
    } catch { /* no store yet, or storage refused - fall back to originals */ }
    return out;
  }

  async function putThumbs(rows) {
    if (!rows || !rows.length) return 0;
    try {
      await run(THUMBS, "readwrite", (store) => {
        for (const r of rows) if (r && r.id && r.blob) store.put({ id: r.id, blob: r.blob, at: Date.now() });
      });
      return rows.length;
    } catch { return 0; }
  }

  async function countThumbs() {
    try { return await run(THUMBS, "readonly", (store) => store.count()).then((r) => r.result || 0); }
    catch { return 0; }
  }

  return {
    hintOf, hintOfMedia, digest, verify, suggest, record,
    all, count, setting, clear, toFile, fromFile, FORMAT,
    getThumbs, putThumbs, countThumbs,
  };
})();
