"use strict";

/* Muletto - resumable jobs.

   Saving a large photo library takes a long time. If the browser is closed,
   the machine reboots, or the tab crashes halfway through, the work done so
   far must not be lost.

   Everything needed to continue is kept in IndexedDB on the user's own
   machine: the chosen source files, the destination folder handle, and the
   list of files already written. Both File objects and FileSystemDirectoryHandle
   are structured-cloneable, so the browser can hand them back after a restart
   without asking the user to find anything again. Re-granting write permission
   needs one click, which is a browser security rule we cannot and should not
   bypass.

   Nothing here leaves the device. */

const MJobs = (function () {
  const DB = "muletto";
  const STORE = "jobs";

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
      const store = t.objectStore(STORE);
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }

  const put = (job) => tx("readwrite", (s) => s.put(job));
  const get = (id) => tx("readonly", (s) => s.get(id));
  const remove = (id) => tx("readwrite", (s) => s.delete(id));
  const all = () => tx("readonly", (s) => s.getAll());

  /* One job per set of source files, so reopening the same export continues
     the same job rather than starting a parallel one. */
  function signature(files) {
    return [...files].map((f) => `${f.name}:${f.size}`).sort().join("|");
  }

  async function find(files) {
    const sig = signature(files);
    const list = (await all()) || [];
    return list.find((j) => j.sig === sig) || null;
  }

  async function start(files, dirHandle, total) {
    const job = {
      id: signature(files),
      sig: signature(files),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fileNames: [...files].map((f) => f.name),
      sources: [...files],       // File objects survive a restart
      dirHandle,
      done: [],
      total,
    };
    await put(job);
    return job;
  }

  // Persist progress in batches; one write per file would dominate the run.
  const FLUSH_EVERY = 25;
  function progress(job) {
    let sinceFlush = 0;
    return {
      async mark(path) {
        job.done.push(path);
        if (++sinceFlush >= FLUSH_EVERY) {
          sinceFlush = 0;
          job.updatedAt = new Date().toISOString();
          await put(job);
        }
      },
      async flush() {
        job.updatedAt = new Date().toISOString();
        await put(job);
      },
    };
  }

  /* A directory handle from a previous session usually comes back as "prompt":
     the browser requires a fresh gesture before writing again. Call this from a
     click handler so the prompt is allowed to appear. */
  async function ensureWritable(dirHandle) {
    if (!dirHandle || !dirHandle.queryPermission) return false;
    const opts = { mode: "readwrite" };
    if ((await dirHandle.queryPermission(opts)) === "granted") return true;
    return (await dirHandle.requestPermission(opts)) === "granted";
  }

  /* Confirm the stored source files can still be read. If one has been moved,
     renamed or deleted since the job was created, reading it throws. */
  async function sourcesReadable(job) {
    try {
      for (const f of job.sources) await f.slice(0, 1).arrayBuffer();
      return true;
    } catch {
      return false;
    }
  }

  return { find, start, progress, ensureWritable, sourcesReadable, remove, all, get };
})();
