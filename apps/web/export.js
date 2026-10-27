"use strict";

/* Muletto - getting the library back out.

   The point of the whole product is the copy you walk away with, so this is
   the screen that has to be right. Three decisions, in the order people
   actually make them: what goes in, how it is arranged, and where it lands.
   Then a summary of what was done, and what to do with it next.

   Defaults are chosen so that pressing the primary button three times gives
   the thing most people want: every photo they decided to keep, in dated
   folders, with the real capture date written into each file. Everything else
   is there for the people who want it.

   Nothing is uploaded. A folder goes to a folder on this machine; an archive
   is streamed to the download the browser is already writing to disk. */

const MExport = (function () {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const fmtBytes = (n) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return MI18N.dec(n / Math.pow(1024, i), i ? 1 : 0) + " " + u[i];
  };
  const pad = (n) => String(n).padStart(2, "0");

  /* Every option, and what it means. Kept as data so the panel and the run
     cannot drift apart. */
  const LAYOUTS = {
    bucket: {
      label: T("The folders you asked for"),
      hint: T("People/, Notes/, Other/ - the buckets from your sorting instruction"),
      dir: (m) => [m.bucket || "Other"],
      /* Hidden until a plan has been applied. See plan.js. */
      when: (lib) => lib.media.some((m) => m.bucket),
    },
    "year-month": {
      label: T("Year, then month"),
      hint: T("2024/07/IMG_0421.jpg - what most photo apps expect"),
      dir: (m) => (m.at ? [String(m.at.getFullYear()), pad(m.at.getMonth() + 1)] : ["undated"]),
    },
    year: {
      label: T("Year only"),
      hint: T("2024/IMG_0421.jpg - fewer, larger folders"),
      dir: (m) => (m.at ? [String(m.at.getFullYear())] : ["undated"]),
    },
    "source-year": {
      label: T("Service, then year"),
      hint: T("Apple/2024/IMG_0421.jpg - keeps each export recognisable"),
      dir: (m) => [String(m.srcLabel || "unknown").replace(/[\\/:*?"<>|]/g, "-")]
        .concat(m.at ? [String(m.at.getFullYear())] : ["undated"]),
    },
    type: {
      label: T("Photos and videos apart"),
      hint: T("Photos/2024/... and Videos/2024/..."),
      dir: (m) => [m.kind === "video" ? "Videos" : "Photos"]
        .concat(m.at ? [String(m.at.getFullYear())] : ["undated"]),
    },
    flat: {
      label: T("One folder"),
      hint: T("Everything together - names are prefixed with the date so they still sort"),
      dir: () => [],
    },
  };

  let state = null;

  function defaults() {
    return {
      onlyKept: true,
      writeCaptions: true,
      layout: "year-month",
      datePrefix: false,
      writeDates: true,
      toJpeg: false,
      sidecars: false,
      manifest: true,
      includeData: false,
      includeWork: true,
      target: window.showDirectoryPicker ? "folder" : "zip",
    };
  }

  /* ---------- the panel ---------- */

  function open(opts) {
    state = {
      lib: opts.lib, sources: opts.sources, entries: opts.entries,
      opt: Object.assign(defaults(), opts.remember || {}),
      step: 0, result: null,
    };
    let el = document.getElementById("exportx");
    if (!el) {
      el = document.createElement("div");
      el.id = "exportx";
      document.body.appendChild(el);
    }
    draw();
    return el;
  }

  function close() {
    const el = document.getElementById("exportx");
    if (el) el.remove();
    document.body.classList.remove("exporting");
    state = null;
  }

  function pool() {
    const media = state.lib.media;
    return state.opt.onlyKept ? media.filter((m) => !m.drop) : media;
  }

  function estimate() {
    const list = pool();
    return { n: list.length, bytes: list.reduce((s, m) => s + (m.size || 0), 0) };
  }

  async function drawAfterExport() {
    /* Asked once ever, and only when there is somewhere for it to go. Resolved
       before drawing because summaryHtml() is synchronous. */
    state.askDonation = typeof MDonate !== "undefined" && await MDonate.shouldAsk();
    draw();
  }

  function draw() {
    const el = document.getElementById("exportx");
    document.body.classList.add("exporting");
    el.innerHTML = `<div class="xw-scrim"></div><div class="xw" role="dialog" aria-modal="true">${
      state.step === 3 ? summaryHtml() : stepHtml()}</div>`;
    el.querySelector(".xw-scrim").addEventListener("click", () => { if (state.step !== 2) close(); });
    wire(el);
    if (state.askDonation && typeof MDonate !== "undefined") MDonate.wire(el);
  }

  function stepHtml() {
    const e = estimate();
    const t = state.lib.media.filter((m) => m.drop).length;
    const steps = [T("What to take"), T("How to arrange it"), T("Where to put it")];
    return `
      <header class="xw-head">
        <div>
          <h2>${esc(steps[state.step])}</h2>
          <p class="muted small">${T("{files}, {size} selected", { files: N("{n} file", "{n} files", e.n), size: esc(fmtBytes(e.bytes)) })}</p>
        </div>
        <button class="xw-x" id="xw-close" aria-label="${T("Close")}">&times;</button>
      </header>
      <ol class="xw-steps">${steps.map((s, i) =>
        `<li class="${i === state.step ? "on" : i < state.step ? "done" : ""}">${esc(s)}</li>`).join("")}</ol>
      <div class="xw-body">${[whatHtml(t), howHtml(), whereHtml()][state.step]}</div>
      <footer class="xw-foot">
        ${state.step ? '<button class="btn secondary" id="xw-back">' + T("Back") + "</button>" : "<span></span>"}
        <button class="btn primary" id="xw-next">${state.step === 2 ? T("Save it") : T("Continue")}</button>
      </footer>`;
  }

  function whatHtml(dropped) {
    const o = state.opt;
    return `
      ${dropped ? `
      <label class="xw-opt">
        <input type="checkbox" data-o="onlyKept" ${o.onlyKept ? "checked" : ""} />
        <span><b>${T("Only what you chose to keep")}</b>
        <em>${N("{n} file was set aside in Clean up. Uncheck to take everything anyway.",
          "{n} files were set aside in Clean up. Uncheck to take everything anyway.", dropped)}</em></span>
      </label>` : `<p class="muted small">${T("Every photo and video in this library. Nothing has been set aside in Clean up.")}</p>`}

      <label class="xw-opt">
        <input type="checkbox" data-o="includeData" ${o.includeData ? "checked" : ""} />
        <span><b>${T("The data files too")}</b>
        <em>${T("The JSON and CSV your services shipped - messages, history, account records. " +
        "Off by default because most people want the pictures.")}</em></span>
      </label>

      ${state.lib.media.some((m) => m.heif) ? `
      <label class="xw-opt">
        <input type="checkbox" data-o="toJpeg" ${o.toJpeg ? "checked" : ""} />
        <span><b>${T("Turn HEIC photos into JPEG")}</b>
        <em>${N("{n} photo is HEIC", "{n} photos are HEIC", state.lib.media.filter((m) => m.heif).length)},
        ${T("which is what an iPhone shoots and what Apple exports. Windows, most older " +
        "software and a lot of the web cannot open one. Converting is done here on your " +
        "machine, keeps the date and place, and roughly doubles the file size.")}</em></span>
      </label>` : ""}

      <label class="xw-opt">
        <input type="checkbox" data-o="includeWork" ${o.includeWork ? "checked" : ""} />
        <span><b>${T("A Muletto work file")}</b>
        <em>${T("What was worked out about these files, so a future export recognises them " +
        "and nothing is done twice. Tiny, and holds no photos or messages.")}</em></span>
      </label>`;
  }

  function howHtml() {
    const o = state.opt;
    return `
      <fieldset class="xw-group">
        <legend>${T("Folders")}</legend>
        ${Object.keys(LAYOUTS).filter((k) =>
          !LAYOUTS[k].when || LAYOUTS[k].when(state.lib)).map((k) => `
          <label class="xw-radio">
            <input type="radio" name="layout" data-o="layout" value="${k}" ${o.layout === k ? "checked" : ""} />
            <span><b>${esc(LAYOUTS[k].label)}</b><em>${esc(LAYOUTS[k].hint)}</em></span>
          </label>`).join("")}
      </fieldset>

      <label class="xw-opt">
        <input type="checkbox" data-o="datePrefix" ${o.datePrefix ? "checked" : ""} />
        <span><b>${T("Put the date at the front of every filename")}</b>
        <em>${T("2024-07-14_IMG_0421.jpg. Useful anywhere that sorts by name and ignores dates.")}</em></span>
      </label>

      <label class="xw-opt">
        <input type="checkbox" data-o="writeDates" ${o.writeDates ? "checked" : ""} />
        <span><b>${T("Write the real date into each photo")}</b>
        <em>${T("Exports often lose it, and then everything looks like it was taken the day you " +
        "downloaded it. JPEG only - other formats are copied untouched.")}</em></span>
      </label>

      ${state.lib.media.some((m) => m.caption) ? `
      <label class="xw-opt">
        <input type="checkbox" data-o="writeCaptions" ${o.writeCaptions ? "checked" : ""} />
        <span><b>${T("Write the descriptions into the photos")}</b>
        <em>${T("As standard metadata, so Lightroom, Immich, digiKam and Photos can search on " +
        "them. Without this the descriptions stay here and are lost when you move the files.")}</em></span>
      </label>` : ""}

      <label class="xw-opt">
        <input type="checkbox" data-o="sidecars" ${o.sidecars ? "checked" : ""} />
        <span><b>${T("A small JSON beside each photo")}</b>
        <em>${T("Its date, place, which service it came from and where it sat in the original " +
        "export. For anything that reads sidecars, and for keeping the provenance.")}</em></span>
      </label>

      <label class="xw-opt">
        <input type="checkbox" data-o="manifest" ${o.manifest ? "checked" : ""} />
        <span><b>${T("An index of everything written")}</b>
        <em>${T("One CSV listing every file, its date and its origin, so you can check the " +
        "copy against what you had.")}</em></span>
      </label>`;
  }

  function whereHtml() {
    const o = state.opt;
    const canFolder = !!window.showDirectoryPicker;
    return `
      <fieldset class="xw-group">
        <legend>${T("Destination")}</legend>
        <label class="xw-radio${canFolder ? "" : " disabled"}">
          <input type="radio" name="target" data-o="target" value="folder" ${o.target === "folder" ? "checked" : ""} ${canFolder ? "" : "disabled"} />
          <span><b>${T("Straight into a folder")}</b>
          <em>${canFolder
            ? T("You pick the folder - a drive, a NAS share, anywhere this machine can write. Nothing is held in memory, so size does not matter.")
            : T("Needs Chrome or Edge. This browser cannot write folders directly.")}</em></span>
        </label>
        <label class="xw-radio">
          <input type="radio" name="target" data-o="target" value="zip" ${o.target === "zip" ? "checked" : ""} />
          <span><b>${T("One zip file")}</b>
          <em>${T("Downloaded like any other file. Written as it goes rather than built up " +
          "first, so a large library will not exhaust the tab.")}</em></span>
        </label>
        <label class="xw-radio">
          <input type="radio" name="target" data-o="target" value="work" ${o.target === "work" ? "checked" : ""} />
          <span><b>${T("Just the work file")}</b>
          <em>${T("No photos. Only what Muletto worked out, to bring back later or move to " +
          "another machine.")}</em></span>
        </label>
      </fieldset>
      <p class="xw-fine">${T("Wherever it goes, it goes there from this machine. Muletto has no " +
      "server to send it to.")}</p>`;
  }

  function wire(el) {
    const close_ = el.querySelector("#xw-close");
    if (close_) close_.addEventListener("click", close);
    el.querySelectorAll("[data-o]").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.opt[inp.dataset.o] = inp.type === "checkbox" ? inp.checked : inp.value;
        if (inp.dataset.o === "onlyKept") draw();
      });
    });
    const back = el.querySelector("#xw-back");
    if (back) back.addEventListener("click", () => { state.step--; draw(); });
    const next = el.querySelector("#xw-next");
    if (next) {
      next.addEventListener("click", () => {
        if (state.step < 2) { state.step++; draw(); return; }
        run();
      });
    }
    const done = el.querySelector("#xw-done");
    if (done) done.addEventListener("click", close);
    const again = el.querySelector("#xw-again");
    if (again) again.addEventListener("click", () => { state.step = 0; state.result = null; draw(); });
  }

  /* ---------- doing it ---------- */

  function nameFor(m) {
    /* A converted photo must not keep the old extension. A JPEG called .HEIC
       opens in about half the places a .jpg does, which would undo the point
       of converting it. */
    let name = m.name;
    if (state.opt.toJpeg && m.heif) name = name.replace(/.(heic|heif)$/i, ".jpg");
    if (!state.opt.datePrefix || !m.at) return name;
    const d = m.at;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${name}`;
  }

  function sidecarFor(m) {
    return JSON.stringify({
      file: nameFor(m),
      takenAt: m.at ? m.at.toISOString() : null,
      latitude: m.gps ? m.gps.lat : null,
      longitude: m.gps ? m.gps.lon : null,
      description: m.caption || null,
      camera: m.mime || null,
      fromService: m.srcLabel || null,
      originalPath: m.path,
    }, null, 1);
  }

  /* Writing the metadata back into the file is the whole point of the export
     step: a date or a description that only exists inside Muletto is lost the
     moment the photos are moved anywhere. */
  /* A file only has to become bytes if EXIF is going to be rewritten into it,
     and that is only ever a JPEG - a few megabytes at the outside. Anything
     larger is piped from the source archive to the destination without ever
     existing in one piece.
   *
   * That is not a nicety. Extracting unconditionally is what made a 5.3 GB
   * video in a Google Takeout impossible to save, and the export counted it as
   * "could not be written". Measured in Chrome on a machine with a 5.5 GB
   * storage quota, both of the obvious ways to hold it fail at almost exactly
   * the same place: a contiguous Uint8Array throws RangeError at 2 GB, and a
   * single Blob fails at 2048 MB while 1500 MB succeeds. So going by way of a
   * Blob would have moved the ceiling by nothing at all.
   *
   * A stream has no ceiling, because nothing is ever whole. */
  const HUGE = 64 * 1024 * 1024;

  async function bytesFor(m) {
    const file = state.sources[m.src || 0].file;
    const wantDate = state.opt.writeDates && !!m.at;
    const wantDesc = state.opt.writeCaptions && !!m.caption;

    if ((m.size || 0) > HUGE) {
      return { bytes: await MZip.streamEntry(file, m.entry), size: m.size,
               repaired: false, unrepairable: wantDate || wantDesc };
    }

    /* A caption Snapchat sent separately is drawn back on before anything
       else happens, so the saved copy is the memory as it was written rather
       than the memory plus a black square beside it. Photographs only - a
       video would need re-encoding, and that overlay is written out beside it
       instead. */
    let merged = null;
    if (typeof MOverlay !== "undefined" && MOverlay.canMerge(m)) {
      try {
        merged = await MOverlay.merge(
          await MZip.extractBlob(file, m.entry, m.mime),
          await MZip.extractBlob(file, m.overlay, "image/png"),
          m.mime);
      } catch (err) { merged = null; }
    }
    let bytes = merged
      ? new Uint8Array(await merged.arrayBuffer())
      : await MZip.extract(file, m.entry);
    const drawn = !!merged;

    /* HEIC out, JPEG in, if that was asked for.
     *
     * Apple exports what the camera shot, and what an iPhone shoots is HEIC.
     * It is a better format and it is unopenable on a lot of what people
     * actually own, so the copy somebody takes away is often a folder of
     * files their own computer will not preview. Converting is a real loss -
     * a re-encode, and about twice the bytes - so it is asked for rather than
     * assumed, and the original archive is untouched either way.
     *
     * Done before the date is written in, because what comes out is a JPEG
     * and a JPEG is exactly what MExif can write a date into. That is the
     * whole reason this ordering matters: a HEIC could never carry the
     * repaired date, so converting is also what lets the date survive. */
    let converted = false;
    if (state.opt.toJpeg && m.heif && typeof MHeif !== "undefined") {
      try {
        const jpeg = await MHeif.toJpegBlob(bytes, 0.92);
        if (jpeg) {
          bytes = new Uint8Array(await jpeg.arrayBuffer());
          converted = true;
        }
      } catch (err) { /* keep the original rather than lose the photograph */ }
    }
    const jpeg = MExif.isJpeg(bytes);
    if (!jpeg || (!wantDate && !wantDesc)) {
      return { bytes, drawn, converted, repaired: false, unrepairable: (wantDate || wantDesc) && !jpeg };
    }
    let repaired = false, captioned = false;
    try {
      if (wantDate) {
        // The description rides along in the same TIFF block, which is the only
        // safe way to add an EXIF tag to a photo that already has one.
        bytes = MExif.writeDate(bytes, m.at, m.gps || null, wantDesc ? m.caption : null);
        repaired = true;
      }
      if (wantDesc) {
        bytes = MExif.writeDescription(bytes, m.caption);
        captioned = true;
      }
    } catch { return { bytes, drawn, converted, repaired, captioned, unrepairable: true }; }
    return { bytes, drawn, converted, repaired, captioned };
  }

  async function run() {
    const list = pool();
    const o = state.opt;
    state.step = 2;
    const note = MNotify.task(T("Saving your library"));
    const res = { written: 0, failed: 0, bytes: 0, repaired: 0, unrepairable: 0,
                  captioned: 0, sidecars: 0, target: o.target, started: new Date() };
    const rows = [["path", "name", "taken", "service", "bytes", "originalPath"]];

    try {
      if (o.target === "work") {
        const { blob, ext } = await MDerived.toFile({ sources: state.sources.map((s) => s.name) });
        download(`muletto-work-${stamp()}.${ext}`, blob);
        res.workFile = blob.size;
        finish(res, note);
        return;
      }

      const writer = o.target === "folder" ? await folderWriter() : await zipWriter();
      if (!writer) { note.failed(T("Cancelled - nothing was written.")); close(); return; }

      let i = 0;
      for (const m of list) {
        i++;
        try {
          const dir = LAYOUTS[o.layout].dir(m);
          const name = nameFor(m);
          const { bytes, size, drawn, converted, repaired, captioned, unrepairable } = await bytesFor(m);
          await writer.file(dir, name, bytes, m.at);
          /* A caption that could not be drawn on - a video, or a picture the
             browser would not decode - is written beside its memory rather
             than thrown away, under a name that says what it is and sorts
             next to it. Losing it would be worse than the black square. */
          if (m.overlay && !drawn) {
            const capName = name.replace(/\.[^.]+$/, "") + "-caption.png";
            const capFrom = state.sources[m.src || 0].file;
            await writer.file(dir, capName, await MZip.extract(capFrom, m.overlay), m.at);
            res.captions = (res.captions || 0) + 1;
          }
          if (drawn) res.drawn = (res.drawn || 0) + 1;
          if (converted) res.converted = (res.converted || 0) + 1;
          if (repaired) res.repaired++;
          if (captioned) res.captioned++;
          if (unrepairable) res.unrepairable++;
          if (o.sidecars) {
            await writer.file(dir, name + ".json", new TextEncoder().encode(sidecarFor(m)), m.at);
            res.sidecars++;
          }
          rows.push([dir.concat(name).join("/"), name, m.at ? m.at.toISOString() : "",
                     m.srcLabel || "", String(m.size || 0), m.path]);
          res.written++;
          // A stream has no length, so a piped entry reports the size the
          // archive listed for it.
          res.bytes += (bytes && bytes.length !== undefined) ? bytes.length : (size || 0);
        } catch { res.failed++; }
        if (i % 5 === 0 || i === list.length) {
          note.say(T("{n} of {of}", { n: i.toLocaleString(LOC), of: list.length.toLocaleString(LOC) }) + " - " + fmtBytes(res.bytes));
        }
      }

      if (o.includeData) {
        note.say(T("Adding the data files..."));
        for (const f of state.lib.files) {
          try {
            const bytes = await MZip.extract(state.sources[f.src || 0].file, f.entry);
            await writer.file(["data", String(f.srcLabel || "export")], f.name, bytes, null);
            res.dataFiles = (res.dataFiles || 0) + 1;
          } catch { /* skip a file that will not read */ }
        }
      }

      if (o.manifest) {
        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        await writer.file([], "muletto-index.csv", new TextEncoder().encode(csv), null);
      }

      if (o.includeWork && typeof MDerived !== "undefined") {
        const { blob } = await MDerived.toFile({ sources: state.sources.map((s) => s.name) });
        await writer.file([], `muletto-work-${stamp()}.muletto`, new Uint8Array(await blob.arrayBuffer()), null);
        res.workFile = blob.size;
      }

      res.where = await writer.done();
      finish(res, note);
    } catch (err) {
      note.failed(T("Could not finish saving: {why}", { why: err && err.message ? err.message : T("unknown error") }));
      state.step = 1;
      draw();
    }
  }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  function finish(res, note) {
    res.ended = new Date();
    state.result = res;
    state.step = 3;
    // The summary is drawn through the async path so the donation ask can be
    // decided first. A failure to read that setting must not lose the summary,
    // which is the only place the results are shown.
    drawAfterExport().catch(draw);
    note.done(N("Saved {n} file", "Saved {n} files", res.written), {
      body: T("{size} written. Nothing was uploaded.", { size: fmtBytes(res.bytes) }),
      goto: () => { if (!document.getElementById("exportx")) { state.step = 3; open({ lib: state.lib, sources: state.sources, entries: state.entries }); } },
    });
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* Writing into a folder the user picks. Directories are made once and
     remembered, because asking for the same one repeatedly is slow. */
  async function folderWriter() {
    let root;
    try { root = await window.showDirectoryPicker({ mode: "readwrite" }); }
    catch { return null; }
    const dirs = new Map([["", root]]);
    const getDir = async (parts) => {
      const key = parts.join("/");
      if (dirs.has(key)) return dirs.get(key);
      let d = root;
      for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
      dirs.set(key, d);
      return d;
    };
    return {
      async file(dir, name, body) {
        const d = await getDir(dir);
        const fh = await d.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        /* A writable file handle is itself a WritableStream, so a large entry
           is piped straight from the source archive to disk and never exists
           in one piece. Small ones are still written in a single call. */
        if (body && typeof body.pipeTo === "function") {
          await body.pipeTo(w);          // pipeTo closes the destination
        } else {
          await w.write(body);
          await w.close();
        }
      },
      async done() { return T("the folder you chose"); },
    };
  }

  /* Streaming a zip. Straight to disk where the browser allows choosing a
     destination file, otherwise gathered and handed to the download. */
  async function zipWriter() {
    const filename = `muletto-library-${stamp()}.zip`;
    let sink, finishSink;

    if (window.showSaveFilePicker) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: T("Zip archive"), accept: { "application/zip": [".zip"] } }],
        });
      } catch { return null; }
      const w = await handle.createWritable();
      sink = w;
      finishSink = async () => T("the file you chose");
    } else {
      const chunks = [];
      sink = new WritableStream({ write: (c) => { chunks.push(c); } });
      finishSink = async () => {
        download(filename, new Blob(chunks, { type: "application/zip" }));
        return T("your downloads folder");
      };
    }

    const zip = MZipOut.create(sink);
    return {
      async file(dir, name, body, date) {
        // zipout already takes a Uint8Array or a ReadableStream, so a large
        // entry passes through as a stream with nothing held.
        await zip.add(dir.concat(name).join("/"), body, { date, deflate: /\.(json|csv|txt)$/i.test(name) });
      },
      async done() {
        await zip.close();
        return finishSink();
      },
    };
  }

  /* ---------- what happened ---------- */

  function summaryHtml() {
    const r = state.result || {};
    const secs = Math.max(1, Math.round((r.ended - r.started) / 1000));
    const guides = [
      ["dest-nas-generic", T("Put it on a NAS")],
      ["dest-drive", T("Keep it on an external drive")],
      ["dest-immich", T("Run your own photo server")],
      ["dest-icloud", T("Put it back into iCloud Photos")],
      ["dest-google-photos", T("Put it back into Google Photos")],
    ];
    return `
      <header class="xw-head">
        <div>
          <h2>${T("Saved")}</h2>
          <p class="muted small">${T("Into {where}, in {secs}s.", { where: esc(r.where || T("your downloads")), secs })}</p>
        </div>
        <button class="xw-x" id="xw-close" aria-label="${T("Close")}">&times;</button>
      </header>
      <div class="xw-body">
        <div class="xw-tiles">
          <div><b>${(r.written || 0).toLocaleString(LOC)}</b><span>${T("files written")}</span></div>
          <div><b>${esc(fmtBytes(r.bytes || 0))}</b><span>${T("on disk")}</span></div>
          ${r.repaired ? `<div><b>${r.repaired.toLocaleString(LOC)}</b><span>${T("dates repaired")}</span></div>` : ""}
          ${r.captioned ? `<div><b>${r.captioned.toLocaleString(LOC)}</b><span>${T("descriptions written in")}</span></div>` : ""}
          ${r.failed ? `<div class="bad"><b>${r.failed.toLocaleString(LOC)}</b><span>${T("could not be written")}</span></div>` : ""}
        </div>
        <ul class="xw-did">
          <li>${T("Arranged as <strong>{layout}</strong>.", { layout: esc((LAYOUTS[state.opt.layout] || {}).label || "") })}</li>
          ${state.opt.onlyKept && state.lib.media.some((m) => m.drop)
            ? `<li>${N("Left out {n} file you set aside in Clean up.", "Left out {n} files you set aside in Clean up.", state.lib.media.filter((m) => m.drop).length)}</li>` : ""}
          ${r.unrepairable ? `<li>${N("{n} file could not have a date written in - only JPEG can.", "{n} files could not have a date written in - only JPEG can.", r.unrepairable)}</li>` : ""}
          ${r.captioned ? `<li>${N("Wrote {n} description into the photos themselves, where Lightroom, Immich, digiKam and Photos can search them.", "Wrote {n} descriptions into the photos themselves, where Lightroom, Immich, digiKam and Photos can search them.", r.captioned)}</li>` : ""}
          ${r.drawn ? `<li>${N("Drew the caption back onto {n} memory that Snapchat had split into two files, so it is the picture as you wrote it rather than a photo and a black square.", "Drew the caption back onto {n} memories that Snapchat had split into two files, so each one is the picture as you wrote it rather than a photo and a black square.", r.drawn)}</li>` : ""}
          ${r.captions ? `<li>${N("{n} caption could not be drawn on - a video would have to be re-encoded - so it was written beside its memory as <strong>-caption.png</strong>.", "{n} captions could not be drawn on - a video would have to be re-encoded - so each was written beside its memory as <strong>-caption.png</strong>.", r.captions)}</li>` : ""}
          ${r.converted ? `<li>${N("Turned {n} HEIC photo into JPEG, so it opens on anything - and, because a date can only be written into a JPEG, it now carries its real capture date as well.", "Turned {n} HEIC photos into JPEG, so they open on anything - and, because a date can only be written into a JPEG, those now carry their real capture date as well.", r.converted)}</li>` : ""}
          ${r.sidecars ? `<li>${N("Wrote {n} sidecar beside the pictures.", "Wrote {n} sidecars beside the pictures.", r.sidecars)}</li>` : ""}
          ${r.dataFiles ? `<li>${N("Included {n} data file from the original exports.", "Included {n} data files from the original exports.", r.dataFiles)}</li>` : ""}
          ${state.opt.manifest ? "<li>" + T("Wrote <strong>muletto-index.csv</strong> listing everything.") + "</li>" : ""}
          ${r.workFile ? `<li>${T("Included a work file ({size}) so a later export recognises these files.", { size: esc(fmtBytes(r.workFile)) })}</li>` : ""}
          <li>${T("<strong>Your original archives were not touched</strong>, and nothing was uploaded.")}</li>
        </ul>
        <h3 class="xw-h3">${T("What now")}</h3>
        <div class="xw-guides">
          ${guides.map(([slug, label]) =>
            `<a class="xw-guide" href="guides/${slug}.html">${esc(label)}<span class="arrow">-&gt;</span></a>`).join("")}
        </div>
        ${state.askDonation ? MDonate.html() : ""}
      </div>
      <footer class="xw-foot">
        <button class="btn secondary" id="xw-again">${T("Save another copy")}</button>
        <button class="btn primary" id="xw-done">${T("Done")}</button>
      </footer>`;
  }

  return { open, close };
})();
