"use strict";

/* Muletto - keeping an opened library between visits.

   Re-choosing five archives and waiting for them to be read again, every time
   you come back, is a bad trade for nothing. So what was worked out from an
   export is kept on this device: the parsed library, the file list, and a
   reference to each archive.

   The archives themselves are not copied. A File handed to IndexedDB is stored
   as a reference to the file already on disk, so this costs a few megabytes of
   metadata rather than a second copy of your photos. It also means the library
   goes stale if the archive is moved or deleted, which is checked on the way
   back in rather than failing later.

   None of this is an upload. It is the same machine, the same disk, and the
   same browser profile, and clearing it is one button. */

const MStore = (function () {
  const DB = "muletto";
  const STORE = "libraries";

  /* Bumped whenever the reader learns to get more out of the same archive.

     A saved library is the parsed result, not the archive, so a refresh
     replays whatever the reader understood on the day it ran. After the
     sectioned-CSV work an existing library kept showing the old three tables
     and there was nothing on screen to say why. When this does not match what
     is stored, the library is offered for re-reading instead of restored. */
  /* Bumped whenever the reading changes in a way a stored library would
     carry forward wrongly. Provider detection counts: an Apple export saved
     before AppleCare and the other archive names were recognised comes back
     still labelled as itself, and every view built on the provider - the
     grouping in the sidebar, the "not read in a tailored way" notice - goes
     on being wrong until it is read again. */
  const PARSE_VERSION = 5;
  const KEY = "current";

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

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  /* The library holds Date objects, nested arrays and plain records, all of
     which the structured clone algorithm handles. It does not hold any blob
     or decoded image: those are rebuilt from the archive on demand. */
  function strip(lib) {
    return {
      provider: lib.provider,
      media: lib.media,
      conversations: lib.conversations,
      events: lib.events,
      places: lib.places,
      tables: lib.tables,
      files: lib.files,
      notes: lib.notes,
      insights: lib.insights,
      self: lib.self,
    };
  }

  /* Each source is kept whole - its file, its entry list and its own parsed
     library - rather than only the merged result. Merging is cheap to redo,
     and keeping the parts is what lets a further export be added later to a
     library that was restored rather than freshly opened. */
  async function save(sources, lib, entries) {
    try {
      await tx("readwrite", (s) => s.put({
        id: KEY,
        savedAt: new Date(),
        parse: PARSE_VERSION,
        sources: sources.map((x) => ({
          name: x.name,
          file: x.file,          // a reference to the file on disk, not a copy
          det: x.det || null,
          entries: x.entries,
          lib: strip(x.lib),
        })),
      }));
      return true;
    } catch (e) {
      // Private browsing, no quota, or a file the browser will not hand back.
      return false;
    }
  }

  async function peek() {
    try {
      const rec = await tx("readonly", (s) => s.get(KEY));
      if (!rec) return null;
      return {
        savedAt: rec.savedAt,
        sources: rec.sources.map((s) => ({
          name: s.name,
          label: s.det ? s.det.label : s.name,
          slug: s.det ? s.det.slug : "box",
          size: s.file ? s.file.size : 0,
        })),
        files: rec.sources.reduce((n, s) => n + ((s.entries && s.entries.length) || 0), 0),
      };
    } catch (e) {
      return null;
    }
  }

  /* An archive that has been moved, renamed or deleted since last time still
     hands back a File object; reading one byte is what actually proves it is
     still there. Better to find out here than halfway through a thumbnail. */
  async function load() {
    let rec;
    try {
      rec = await tx("readonly", (s) => s.get(KEY));
    } catch (e) {
      return null;
    }
    if (!rec || !rec.sources || !rec.sources.length) return null;

    const missing = [];
    for (const s of rec.sources) {
      try {
        await s.file.slice(0, 1).arrayBuffer();
      } catch (e) {
        missing.push(s.name);
      }
    }
    return {
      savedAt: rec.savedAt,
      // Saved by an older reader: the files are still here, the reading is stale.
      stale: (rec.parse || 1) !== PARSE_VERSION,
      sources: rec.sources.map((s) => ({
        name: s.name, file: s.file, det: s.det, entries: s.entries, lib: s.lib,
      })),
      missing,
    };
  }

  async function clear() {
    try {
      await tx("readwrite", (s) => s.delete(KEY));
      return true;
    } catch (e) {
      return false;
    }
  }

  return { save, load, peek, clear };
})();
