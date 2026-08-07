/* The data explorer: a full-window, three-column view of an opened export.

   Left is where the data came from and which slice of it you are looking at.
   The middle is the record itself. The right is one item in full, plus what
   else was happening around it - which is the part that turns a pile of files
   into something you can actually read.

   Everything here runs on the merged library from parsers.js. It shows what is
   in the export and nothing else: no field is invented, and a category with no
   data does not appear at all. */
(function (global) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const num = (n) => Number(n || 0).toLocaleString();

  const fmtBytes = (n) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
  };

  const DAY = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  const SHORTDAY = { year: "numeric", month: "short", day: "numeric" };
  const TIME = { hour: "2-digit", minute: "2-digit" };
  const fmtDay = (d) => d.toLocaleDateString(undefined, DAY);
  const fmtShort = (d) => d.toLocaleDateString(undefined, SHORTDAY);
  const fmtTime = (d) => d.toLocaleTimeString(undefined, TIME);

  /* Each kind of record gets one colour, used by its icon here, its dot in the
     timeline and its chip in the legend, so the eye learns it once. */
  const KIND = {
    photo: { label: "Photo", colour: "blue" },
    video: { label: "Video", colour: "violet" },
    chat: { label: "Chat message", colour: "green" },
    place: { label: "Location", colour: "amber" },
    event: { label: "Activity", colour: "slate" },
  };

  let state = null;

  /* ---------- shell ---------- */

  function open(opts) {
    const { lib, entries, sources, ctx } = opts;
    const stream = MViews.buildStream(lib);

    state = {
      lib, entries, sources, ctx, stream,
      view: stream.days.length ? "timeline" : (lib.media.length ? "photos" : "files"),
      query: "", selected: null, actions: opts.actions || {},
      /* Sources are excluded rather than selected: everything is in view until
         you take something out. Choosing one source at a time made "Apple and
         Google together" impossible to ask for. */
      srcOff: new Set(),
      range: { from: null, to: null },
      // Bumped whenever the library is redrawn, so a background decode pass
      // started for the previous one stops instead of racing the new one.
      // Tiles holding a decoded picture, oldest first, so the ones furthest
      // from the reader can hand their memory back.
      decoded: [],
    };

    let root = document.getElementById("explorer");
    if (!root) {
      root = document.createElement("div");
      root.id = "explorer";
      document.body.appendChild(root);
    }
    /* A new library means the counts a previous one published are stale. */
    if (typeof MTopics !== "undefined" && MTopics.reset) MTopics.reset();
    document.body.classList.add("exploring");
    root.innerHTML = shellHtml();
    wireShell(root);
    showView(state.view);
    return root;
  }

  function close() {
    releaseDecoded();
    document.body.classList.remove("exploring");
    const root = document.getElementById("explorer");
    if (root) root.remove();
    state = null;
  }

  /* Empty sections are not listed as places to go, but they are still named.
   *
   * The first rule here was that every section is always listed, because
   * hiding them meant a reader looking for their messages found no Chats entry
   * and could not tell whether the export lacked messages or Muletto had lost
   * them. That reasoning was right and the conclusion no longer follows: the
   * coverage line at the top of the timeline now answers "did anything get
   * lost" directly, so an empty entry is no longer the only thing standing
   * between the reader and that doubt.
   *
   * So they come out of the list and go underneath it as a quiet line of
   * names - "Nothing here: chat history, location history". Still stated,
   * still impossible to mistake for something we dropped, and no longer eight
   * dead ends between the reader and the sections that do have their data.
   *
   * Topic views were never listed empty, so this only affects the fixed ones. */
  const ALWAYS = new Set(["timeline", "files"]);
  function navItems() {
    const lib = scopedLib();
    const stream = !filtering() ? state.stream : MViews.buildStream(lib);
    const entries = filtering() ? state.entries.filter((e) => srcOk(e)) : state.entries;
    const photos = lib.media.filter((m) => m.kind !== "video").length;
    const videos = lib.media.length - photos;
    const msgs = lib.conversations.reduce((n, c) => n + c.messages.length, 0);
    const dupes = exactGroups().reduce((n, g) => n + g.length - 1, 0);
    const rep = state.actions.report && state.actions.report();

    const items = [
      ["timeline", "Timeline", "clock", stream.items.length],
      ["photos", videos ? "Images and videos" : "Images", "image", lib.media.length],
      ["chats", "Chat history", "chat", msgs],
      ["map", "Location history", "pin", lib.places.filter((p) => isFinite(p.lat)).length],
      /* The count is tables, not cards. Building the cards means a pass over
         every row, and this runs on every sidebar redraw - with a filter on,
         scopedLib hands back a fresh array each time, so nothing would be
         reused and a large health export would stall the sidebar for a second
         each redraw. The cards are built when the view is opened. */
    ];

    /* Views that exist because the data does.
     *
     * A fixed sidebar meant anything without a home became a row in Records,
     * which is the provider's spreadsheet with the provider's column names on
     * it. Comments, health readings and whatever turns up next deserve to be
     * looked at rather than scrolled through, and only when they are actually
     * present - a Comments entry on an export with no comments in it is the
     * same lie in the other direction.
     *
     * Inserted here, with the content views, rather than appended after the
     * housekeeping ones. */
    if (typeof MTopics !== "undefined") {
      /* Entries follow the source filter, so a topic that reads files counts
         the same set the rest of the sidebar does. */
      state.topics = MTopics.detect(lib, { entries, sources: state.sources });
      for (const t of state.topics) items.push([t.key, t.label, t.icon, t.n]);
    }

    items.push(
      ["highlights", "Highlights", "chart", lib.tables.length],
      ["files", "All files", "folder", entries.length]
    );
    return items;
  }

  const liveItems = () => navItems().filter(([k, , , n]) => n > 0 || ALWAYS.has(k));
  const emptyItems = () => navItems().filter(([k, , , n]) => !(n > 0) && !ALWAYS.has(k));

  /* Named, not offered. The distinction is the whole point: "this export has
     no chat history" is information, and a button leading to a page that says
     so is a detour. */
  function emptyNote() {
    const gone = emptyItems();
    if (!gone.length) return "";
    return '<p class="ex-none">Nothing here: ' +
      gone.map(([, label]) => esc(String(label).toLowerCase())).join(", ") + ".</p>";
  }

  /* The sidebar counts and the headline figures answer "how much of this am I
     looking at", so they follow the filter. */
  function refreshCounts(root) {
    const nav = root.querySelector("#ex-nav");
    const on = state.view;
    nav.innerHTML = liveItems().map(([k, label, icon, n]) =>
      '<button class="ex-navi' + (k === on ? " on" : "") + '" data-k="' + k + '">' +
        '<i data-icon="' + icon + '"></i><span>' + esc(label) + "</span><em>" + num(n) + "</em></button>").join("") + emptyNote();
    const box = root.querySelector(".ex-stats");
    if (box) {
      box.innerHTML = stats().map((s) => {
        const tag = s.click ? "button" : "div";
        return "<" + tag + ' class="ex-stat' + (s.wide ? " wide" : "") + (s.cls ? " " + s.cls : "") + '"' +
          (s.click ? ' id="' + s.click + '" type="button" title="Set your own range"' : "") + ">" +
          '<span class="ex-stat-l">' + esc(s.label) + "</span>" +
          '<span class="ex-stat-v">' + esc(s.value) + "</span>" +
          '<i data-icon="' + s.icon + '"></i></' + tag + ">";
      }).join("");
      wireRange(root);
      paintRange(root);
    }
    state.ctx.hydrate(root);
  }

  /* Anything that narrows the library goes through here, so the counts, the
     headline figures and the current view can never disagree about what is
     being shown. */
  function afterFilterChange(root) {
    state.scopedStream = null;
    refreshCounts(root);
    paintSourceFilter(root);
    paintRange(root);
    showView(state.view);
    if (state.actions.rememberFilters) {
      state.actions.rememberFilters({ off: [...state.srcOff], range: state.range });
    }
  }

  // A row can stand for several archives, so data-src is a list.
  const srcIdx = (b) => b.dataset.src.split(",").map(Number);

  function paintSourceFilter(root) {
    const boxes = [...root.querySelectorAll(".ex-srcone, .ex-srcall")];
    for (const b of boxes) {
      const mine = srcIdx(b);
      const off = mine.filter((i) => state.srcOff.has(i)).length;
      b.checked = off < mine.length;
      // A company with some archives off and some on is neither, and says so.
      b.indeterminate = off > 0 && off < mine.length;
    }
    const groups = root.querySelectorAll(".ex-srcg");
    groups.forEach((g) => {
      const all = g.querySelector(".ex-srcall");
      g.classList.toggle("off", all && !all.checked && !all.indeterminate);
    });
    const clear = root.querySelector("#ex-clearsrc");
    if (clear) {
      clear.hidden = state.srcOff.size === 0;
      clear.textContent = "Turn all " + groups.length + " back on";
    }
  }

  /* One test every view applies, so a narrowed library means the same thing in
     the timeline, the library, the chats and the map. */
  function srcOk(x) { return !state.srcOff.has(x.src); }

  function dateOk(d) {
    const { from, to } = state.range;
    if (!from && !to) return true;
    if (!d) return false;                 // undated cannot be inside a range
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function filtering() {
    return state.srcOff.size > 0 || !!state.range.from || !!state.range.to;
  }

  /* The narrowed library. Built fresh rather than mutated, so clearing a
     filter is just dropping it.

     A conversation is kept when any of its messages fall inside the range, and
     then only those messages - otherwise narrowing to a week would show whole
     threads that merely touched it. */
  function scopedLib() {
    if (!filtering()) return state.lib;
    const l = state.lib;
    const dated = (arr, get) => arr.filter((x) => srcOk(x) && dateOk(get(x)));
    return Object.assign({}, l, {
      media: dated(l.media, (m) => m.at),
      events: dated(l.events, (e) => e.at),
      places: dated(l.places, (p) => p.at),
      tables: l.tables.filter(srcOk),
      files: l.files.filter(srcOk),
      conversations: l.conversations.filter(srcOk).map((c) => {
        if (!state.range.from && !state.range.to) return c;
        const msgs = c.messages.filter((m) => dateOk(m.at));
        return msgs.length ? Object.assign({}, c, { messages: msgs }) : null;
      }).filter(Boolean),
    });
  }

  /* The headline figures describe the view you are looking at.
   *
   * They used to describe the timeline, always, on every screen - so Chat
   * history read "Total items 15" directly above "No messages in this export",
   * and Calendar read 15 above its own 33 events. Four tiles that contradicted
   * the page under them, on every page but one.
   *
   * A view that draws its own summary gets no tiles at all, because two
   * summaries of the same thing is how they came to disagree in the first
   * place. */
  const OWN_STATS = new Set(["comments", "health", "contacts", "calendar", "notes",
                             "audio", "mail", "logins", "activity"]);

  function stats() {
    const lib = scopedLib();
    const view = state.view;
    if (OWN_STATS.has(view)) return [];

    const range = (items) => {
      const dates = items.map((x) => x.at && +x.at).filter(Boolean).sort();
      if (!dates.length) return null;
      return { label: "Date range", wide: true, cls: "range", click: "ex-range", icon: "clock",
               value: fmtShort(new Date(dates[0])) + " to " + fmtShort(new Date(dates[dates.length - 1])) };
    };
    const srcCount = state.sources.reduce((a, _, i) => a + (state.srcOff.has(i) ? 0 : 1), 0);

    if (view === "chats") {
      const msgs = lib.conversations.reduce((n, c) => n + c.messages.length, 0);
      const out = [{ label: "Messages", value: num(msgs), icon: "chat" },
                   { label: lib.conversations.length === 1 ? "Conversation" : "Conversations",
                     value: num(lib.conversations.length), icon: "layers" }];
      const r = range(lib.conversations.flatMap((c) => c.messages));
      if (r) out.push(r);
      return out;
    }
    if (view === "map") {
      const withCoords = lib.places.filter((p) => isFinite(p.lat));
      const out = [{ label: "Places", value: num(withCoords.length), icon: "pin" }];
      const r = range(withCoords);
      if (r) out.push(r);
      return out;
    }
    if (view === "photos") {
      const vids = lib.media.filter((m) => m.kind === "video").length;
      const out = [{ label: "Images", value: num(lib.media.length - vids), icon: "image" }];
      if (vids) out.push({ label: vids === 1 ? "Video" : "Videos", value: num(vids), icon: "video" });
      const r = range(lib.media);
      if (r) out.push(r);
      return out;
    }
    if (view === "files" && state.filesTab === "tables") {
      return [{ label: lib.tables.length === 1 ? "Table" : "Tables",
                value: num(lib.tables.length), icon: "table" },
              { label: "Rows", value: num(lib.tables.reduce((n, t) => n + t.rows.length, 0)),
                icon: "layers" }];
    }
    if (view === "files") {
      const entries = filtering() ? state.entries.filter((e) => srcOk(e)) : state.entries;
      const bytes = entries.reduce((n, e) => n + (e.size || 0), 0);
      return [{ label: "Files", value: num(entries.length), icon: "folder" },
              { label: "Size", value: fmtBytes(bytes), icon: "layers" },
              { label: srcCount === 1 ? "Archive" : "Archives", value: num(srcCount), icon: "box" }];
    }
    return timelineStats();
  }

  function timelineStats() {
    const lib = scopedLib();
    const stream = !filtering() ? state.stream : MViews.buildStream(lib);
    const sources = state.sources.filter((_, i) => !state.srcOff.has(i));
    const entries = filtering() ? state.entries.filter((e) => srcOk(e)) : state.entries;
    /* Count the exports actually contributing to what is on screen. Indices
       belong to the full source list, so the test has to run over that rather
       than over the filtered copy - counting positions in a filtered array
       against absolute indices is how this said "1" for two sources. */
    const contributes = (i) =>
      lib.media.some((m) => m.src === i) || lib.files.some((f) => f.src === i) ||
      lib.conversations.some((c) => c.src === i) || lib.events.some((e) => e.src === i) ||
      lib.places.some((pl) => pl.src === i);
    const n = state.sources.reduce((acc, _, i) =>
      acc + (!state.srcOff.has(i) && contributes(i) ? 1 : 0), 0) || sources.length;
    const out = [
      { label: "Total items", value: num(stream.items.length || entries.length), icon: "table" },
      { label: n === 1 ? "Source" : "Sources", value: num(n), icon: "layers" },
    ];
    if (stream.days.length) {
      const a = stream.days[stream.days.length - 1].date, b = stream.days[0].date;
      out.push({ label: "Date range", value: `${fmtShort(a)} to ${fmtShort(b)}`,
                 icon: "clock", wide: true, cls: "range", click: "ex-range" });
    }
    const cats = new Set(stream.items.map((i) => i.type));
    if (cats.size) out.push({ label: "Categories", value: num(cats.size), icon: "folder" });
    return out;
  }

  /* One row per download, not per file.

     A Takeout that arrived in six zips is one thing the reader asked Google
     for, and listing it six times says the opposite - it reads as six separate
     exports, five of them redundant. Parts are summed into a single row that
     toggles all of them together. */
  function sourceRows() {
    const { sources, lib } = state;
    const one = (i) => ({
      label: sources[i].det ? sources[i].det.label : sources[i].name,
      slug: sources[i].det ? sources[i].det.slug : "box",
      key: (lib.sources && lib.sources[i] && lib.sources[i].exportKey) || String(i),
      superseded: !!(lib.sources && lib.sources[i] && lib.sources[i].superseded),
      idx: [i],
      n: lib.media.filter((m) => m.src === i).length +
         lib.files.filter((f) => f.src === i).length +
         lib.conversations.filter((c) => c.src === i).reduce((n, c) => n + c.messages.length, 0) +
         lib.events.filter((e) => e.src === i).length +
         lib.places.filter((p) => p.src === i).length,
    });

    const rows = [];
    const at = new Map();
    sources.forEach((_, i) => {
      const r = one(i);
      if (at.has(r.key)) {
        const g = rows[at.get(r.key)];
        g.n += r.n;
        g.idx.push(i);
        g.parts = g.idx.length;
        // A download is only older if every part of it is.
        g.superseded = g.superseded && r.superseded;
      } else {
        at.set(r.key, rows.length);
        rows.push(r);
      }
    });

    /* Then group those by the company, because that is the unit a person
       thinks in. Apple answers one request with eighteen archives under
       eighteen different names, so grouping by export key alone listed
       "Apple" eight times down the sidebar with no way to tell them apart or
       to switch one off. */
    const groups = [];
    const byLabel = new Map();
    for (const r of rows) {
      let g = byLabel.get(r.label);
      if (!g) {
        g = { label: r.label, slug: r.slug, idx: [], n: 0, files: [] };
        byLabel.set(r.label, g);
        groups.push(g);
      }
      g.idx = g.idx.concat(r.idx);
      g.n += r.n;
      g.files.push({
        // The archive's own name, which is the only thing that tells two apart.
        name: r.idx.map((i) => sources[i].name).join(", "),
        idx: r.idx, n: r.n, superseded: r.superseded, parts: r.parts || 1,
      });
    }
    for (const g of groups) g.superseded = g.files.every((f) => f.superseded);
    return groups;
  }

  function shellHtml() {
    const counts = sourceRows();

    return `
      <div class="ex">
        <aside class="ex-side">
          <a class="ex-home" href="index.html" title="Back to muletto.app">
            <span class="wordmark">muletto</span>
          </a>

          <nav class="ex-nav" id="ex-nav" aria-label="Sections">
            ${liveItems().map(([k, label, icon, n]) => `
              <button class="ex-navi${k === state.view ? " on" : ""}" data-k="${k}">
                <i data-icon="${icon}"></i><span>${esc(label)}</span><em>${num(n)}</em>
              </button>`).join("")}
            ${emptyNote()}
          </nav>

          <div class="ex-sources">
            <h4>Where it came from</h4>
            ${counts.filter((s) => s.n > 0).map((g, gi) => {
              const all = g.idx.join(",");
              const many = g.files.length > 1;
              /* The checkbox is its own target now, and the rest of the row
                 opens the group. Wrapping the whole header in a <label> meant
                 every click on a provider's name switched that provider off,
                 which is a destructive default for the thing you touch to look
                 inside. A single-archive provider has nothing to open, so
                 there the name still toggles it. */
              return `
              <div class="ex-srcg${g.superseded ? " superseded" : ""}" data-g="${gi}">
                <div class="ex-srch">
                  <input type="checkbox" class="ex-srcall" data-src="${all}" checked
                    id="srcall-${gi}" aria-label="Include ${esc(g.label)}" />
                  <button class="ex-srcname" type="button" data-many="${many ? 1 : 0}"
                    data-for="srcall-${gi}"${many ? ` aria-expanded="false"` : ""}>
                    <i data-icon="${esc(g.slug || "box")}"></i>
                    <span>${esc(g.label)}</span>
                  </button>
                  <em>${num(g.n)}</em>
                  ${many ? `<span class="ex-srctwist" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m7 10 5 5 5-5"/></svg></span>` : ""}
                </div>
                ${many ? `<ul class="ex-srcf">
                  ${g.files.map((f) => `
                    <li><label class="ex-srcbox">
                      <input type="checkbox" class="ex-srcone" data-src="${f.idx.join(",")}" checked />
                      <span title="${esc(f.name)}">${esc(f.name)}</span>
                    </label><em>${num(f.n)}</em></li>`).join("")}
                </ul>` : ""}
              </div>`;
            }).join("")}
            <button class="ex-clearsrc" id="ex-clearsrc" hidden>Show every source</button>
            <button class="ex-add" id="ex-add" data-tip="Add a second export to the same
              library - another service, or a newer download from the same one. Duplicates
              between them are found automatically.">+ Open another export</button>
          </div>

          ${state.ctx.demo ? `<div class="ex-demo">
            <strong>This is sample data</strong>
            <p>Five invented exports, so you can see what is in one before using anything of
            your own. Look at all of it - open any file, read the messages, scroll the years.
            Saving, comparing and describing are held back until it is your own data, and
            nothing here is written to your browser.</p>
            <button class="btn secondary sm" id="ex-realfile">Open my own export</button>
          </div>` : ""}
          <div class="ex-privacy">
            <strong>Nothing was uploaded</strong>
            <p>Every file was read in this browser. What you see was worked out
            on this machine and kept here, so it is waiting next time. No part
            of it has been sent anywhere.</p>
            <button class="ex-savework" id="ex-savework" data-tip="Writes the results - the
              comparisons, the repaired dates, the descriptions - to a small file you keep. It
              holds no photos or messages. Open it alongside a fresh export next year and
              nothing has to be worked out twice.">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5"/><path d="M5 17.5v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1"/>
              </svg>
              Save your work to a file
            </button>
            <button class="ex-forget" id="ex-forget" data-tip="Clears everything Muletto has
              kept about this library from your browser. Your archives are untouched.">Forget
              this library</button>
          </div>
        </aside>

        <main class="ex-main">
          <header class="ex-top">
            <div class="ex-search">
              <i data-icon="search"></i>
              <input id="ex-q" type="search" placeholder="Search your data" autocomplete="off" />
            </div>
            <div class="ex-topact">
              <span id="ex-bell"></span>
              <button class="btn primary sm" id="ex-save" data-tip="Write the tidied library
                out to a folder, a drive or a single archive - with the real dates, locations
                and descriptions inside the files.">Export</button>
              <button class="ex-nav-btn" id="ex-close" title="Close">&times;</button>
            </div>
          </header>

          <div class="ex-scroll" id="ex-scroll">
            <div class="ex-headline">
              <h1 id="ex-title">Timeline</h1>
              <p class="muted" id="ex-sub">Everything in this export, in the order it happened.</p>
            </div>
            <div class="ex-stats">
              ${stats().map((s) => `
                <${s.click ? "button" : "div"} class="ex-stat${s.wide ? " wide" : ""}${s.cls ? " " + s.cls : ""}"
                     ${s.click ? `id="${s.click}" type="button" title="Set your own range"` : ""}>
                  <span class="ex-stat-l">${esc(s.label)}</span>
                  <span class="ex-stat-v">${esc(s.value)}</span>
                  <i data-icon="${s.icon}"></i>
                </${s.click ? "button" : "div"}>`).join("")}
            </div>
            <p class="ex-status muted small" id="ex-status"></p>
            <div id="ex-body"></div>
          </div>
        </main>

        <aside class="ex-detail" id="ex-detail" hidden></aside>
      </div>`;
  }

  function wireShell(root) {
    const { ctx } = state;
    ctx.hydrate(root);
    /* A topic that has read its files knows better than the file count the
       sidebar guessed with, so it says so and the sidebar redraws. */
    if (typeof MTopics !== "undefined") {
      MTopics.onCount = () => { try { refreshCounts(root); } catch (e) { /* gone */ } };
      /* Counted now rather than when somebody clicks, so the sidebar is right
         before it is read instead of correcting itself afterwards. */
      if (MTopics.precount) {
        setTimeout(() => {
          MTopics.precount(scopedLib(), { entries: state.entries, sources: state.sources })
            .catch(() => { /* the file counts stand */ });
        }, 60);
      }
    }
    // The shell has just replaced the page, taking the navigation bar with it.
    if (typeof MNotify !== "undefined" && MNotify.park) MNotify.park();

    /* Filtering by source runs through the same path as searching, so every
       view honours it without knowing it exists. */
    const sources = root.querySelector(".ex-sources");

    /* Checkboxes rather than toggling buttons.

       The old row was a button that meant "leave this out", and with several
       archives from one company there was no way to reach an individual one.
       A checkbox says what its state is without being clicked, which matters
       when eight of them are off. */
    sources.addEventListener("change", (e) => {
      const box = e.target.closest(".ex-srcall, .ex-srcone");
      if (!box) return;
      const mine = box.dataset.src.split(",").map(Number);
      mine.forEach((i) => (box.checked ? state.srcOff.delete(i) : state.srcOff.add(i)));
      afterFilterChange(root);
    });

    /* Opening a group, and the one case where the name still toggles.
     *
     * `hidden` is gone: the list animates open, which needs a real height to
     * animate to, and `hidden` would win over any of it. The group carries the
     * state as a class instead. */
    sources.addEventListener("click", (e) => {
      const name = e.target.closest(".ex-srcname");
      const twist = e.target.closest(".ex-srctwist");
      if (!name && !twist) return;
      const group = (name || twist).closest(".ex-srcg");
      const btn = group.querySelector(".ex-srcname");

      // Nothing to open: the name means what it used to mean.
      if (btn && btn.dataset.many !== "1") {
        const box = group.querySelector(".ex-srcall");
        if (box) { box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); }
        return;
      }
      const open = !group.classList.contains("open");
      group.classList.toggle("open", open);
      if (btn) btn.setAttribute("aria-expanded", String(open));
    });

    root.querySelector("#ex-clearsrc").addEventListener("click", () => {
      state.srcOff.clear();
      afterFilterChange(root);
    });

    root.querySelector("#ex-nav").addEventListener("click", (e) => {
      const b = e.target.closest(".ex-navi");
      if (!b) return;
      root.querySelectorAll(".ex-navi").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      showView(b.dataset.k);
    });

    const q = root.querySelector("#ex-q");
    let t = null;
    q.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = q.value.trim().toLowerCase(); showView(state.view); }, 160);
    });

    root.querySelector("#ex-close").addEventListener("click", close);
    wireRange(root);
    paintRange(root);
    const real = root.querySelector("#ex-realfile");
    if (real && state.actions.addSource) real.addEventListener("click", state.actions.addSource);
    const add = root.querySelector("#ex-add");
    if (add && state.actions.addSource) add.addEventListener("click", state.actions.addSource);
    const status = root.querySelector("#ex-status");
    /* Anything started from a button is wrapped, because a rejection that
       nobody catches presents as a task that never finishes - which is
       indistinguishable from slow work and wastes the reader's time. */
    const act = (id, fn) => {
      const b = root.querySelector(id);
      if (!b) return;
      if (!fn) { b.remove(); return; }
      b.addEventListener("click", async () => {
        try {
          await fn(status);
        } catch (e) {
          MNotify.push("That did not finish", {
            kind: "warn",
            body: (e && e.message) ? e.message : "Something went wrong part way through.",
          });
        }
      });
    };
    act("#ex-save", state.actions.save);
    act("#ex-savework", state.actions.saveWork);
    act("#ex-loadwork", state.actions.loadWork);
    const forget = root.querySelector("#ex-forget");
    if (forget && state.actions.forget) forget.addEventListener("click", askForget);
    act("#ex-similar", state.lib.media.length ? state.actions.findSimilar : null);

    /* On the samples, everything past looking and opening is marked as held
       back rather than left looking available and then refusing.
       They stay visible and stay clickable - clicking one is how you find out
       why, and hiding them would misrepresent what the product does, which is
       the opposite of the point of a demonstration. */
    if (state.ctx.demo) {
      root.querySelectorAll("#ex-save, #ex-savework, #ex-loadwork, #ex-similar, #ex-forget")
        .forEach((b) => {
          b.classList.add("held-back");
          b.setAttribute("data-tip", "Held back on the sample data. Open your own export " +
            "and this works.");
        });
    }

    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", sizeGrid);
    const ex = root.querySelector(".ex");
    // Only the rail needs re-measuring once the column has settled. The grid
    // deliberately keeps its column count, so it has nothing to recompute.
    ex.addEventListener("transitionend", (e) => {
      if (e.propertyName === "grid-template-columns" && state.rail) state.rail.remeasure();
    });
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === "Escape" && !document.querySelector("#explorer .ex-detail[hidden]")) closeDetail();
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const q = document.getElementById("ex-q");
      if (q) q.focus();
    }
  }

  /* Why a section is empty, which is a different question from what is in it.

     "Your export has no messages" and "the filter you set has no messages in
     it" call for different things from the reader, so they are never phrased
     the same way. */
  function emptyHtml(what, hint) {
    if (filtering()) {
      return `<div class="ex-empty">
        <h3>No ${esc(what)} in what you are looking at</h3>
        <p class="muted">The filters are hiding the rest. There may well be ${esc(what)} in
          the export outside them.</p>
        <button class="btn secondary sm" id="ex-clearall">Clear the filters</button>
      </div>`;
    }
    return `<div class="ex-empty">
      <h3>No ${esc(what)} in this export</h3>
      <p class="muted">${esc(hint)}</p>
    </div>`;
  }

  function wireEmpty(body) {
    const b = body.querySelector("#ex-clearall");
    if (b) b.addEventListener("click", () => {
      state.srcOff.clear();
      state.range = { from: null, to: null };
      afterFilterChange(document.getElementById("explorer"));
    });
  }

  /* ---------- date range ---------- */

  /* A calendar of our own rather than the browser's date inputs. Two of those
     side by side cannot express "a range", look different in every browser,
     and none of them know which days actually have anything in them - which is
     the one thing worth showing when picking a range over somebody's own
     history. Months with nothing in them are dimmed and unselectable. */
  const DOW = ["M", "T", "W", "T", "F", "S", "S"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function fullSpan() {
    const days = state.stream.days;
    if (!days.length) return null;
    return { from: dayStart(days[days.length - 1].date), to: dayEnd(days[0].date) };
  }

  /* Which days have anything at all, so the calendar can show where the
     history actually is rather than an even grid of empty boxes. */
  function busyDays() {
    if (state.busy) return state.busy;
    const set = new Set();
    for (const d of state.stream.days) set.add(d.key);
    state.busy = set;
    return set;
  }

  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function openRange(anchor) {
    closeRange();
    const span = fullSpan();
    if (!span) return;
    const pick = { from: state.range.from, to: state.range.to, half: false };
    let shown = new Date((state.range.from || span.to).getFullYear(),
                         (state.range.from || span.to).getMonth(), 1);

    const pop = document.createElement("div");
    pop.className = "cal";
    /* Clicks inside never reach the document.

       The month arrows redraw the popover, which detaches the button that was
       clicked - so by the time a document-level "did you click outside?"
       handler runs, the target is no longer inside anything and the calendar
       closes itself. Stopping propagation here is the fix that does not depend
       on the target still existing. */
    pop.addEventListener("click", (e) => e.stopPropagation());
    document.getElementById("explorer").appendChild(pop);
    state.cal = pop;

    const draw = () => {
      pop.innerHTML = `
        <div class="cal-presets">
          ${[["All of it", null], ["This year", "year"], ["Last 12 months", "12m"],
             ["Last 30 days", "30d"]].map(([label, k]) =>
            `<button class="cal-preset" data-k="${k || ""}">${esc(label)}</button>`).join("")}
        </div>
        <div class="cal-head">
          <button class="cal-nav" data-d="-1" aria-label="Earlier">&lsaquo;</button>
          <span>${esc(MONTH_NAMES[shown.getMonth()])} ${shown.getFullYear()}</span>
          <button class="cal-nav" data-d="1" aria-label="Later">&rsaquo;</button>
        </div>
        <div class="cal-grid">
          ${DOW.map((d) => `<span class="cal-dow">${d}</span>`).join("")}
          ${monthCells(shown, pick)}
        </div>
        <div class="cal-foot">
          <span>${pick.from ? esc(fmtShort(pick.from)) : "start"} to ${
            pick.to ? esc(fmtShort(pick.to)) : "end"}</span>
          <button class="btn ghost sm" id="cal-clear">Clear</button>
        </div>`;

      pop.querySelectorAll(".cal-nav").forEach((b) => b.addEventListener("click", () => {
        shown = new Date(shown.getFullYear(), shown.getMonth() + Number(b.dataset.d), 1);
        draw();
      }));
      pop.querySelectorAll(".cal-preset").forEach((b) => b.addEventListener("click", () => {
        applyPreset(b.dataset.k, span);
        closeRange();
      }));
      pop.querySelector("#cal-clear").addEventListener("click", () => {
        state.range = { from: null, to: null };
        closeRange();
        afterFilterChange(document.getElementById("explorer"));
      });
      pop.querySelectorAll(".cal-day:not(.empty)").forEach((b) => {
        b.addEventListener("click", () => {
          const d = new Date(b.dataset.d + "T12:00:00");
          if (!pick.half) { pick.from = dayStart(d); pick.to = null; pick.half = true; }
          else {
            if (d < pick.from) { pick.to = dayEnd(pick.from); pick.from = dayStart(d); }
            else pick.to = dayEnd(d);
            pick.half = false;
            state.range = { from: pick.from, to: pick.to };
            closeRange();
            afterFilterChange(document.getElementById("explorer"));
            return;
          }
          draw();
        });
      });
    };

    draw();
    const r = anchor.getBoundingClientRect();
    const host = document.getElementById("explorer").getBoundingClientRect();
    pop.style.left = Math.max(12, Math.min(r.left - host.left, host.width - 330)) + "px";
    pop.style.top = (r.bottom - host.top + 8) + "px";

    setTimeout(() => document.addEventListener("click", outsideRange), 0);
  }

  function monthCells(shown, pick) {
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;                 // weeks start Monday
    const days = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
    const busy = busyDays();
    let out = "";
    for (let i = 0; i < lead; i++) out += '<span class="cal-day empty"></span>';
    for (let d = 1; d <= days; d++) {
      const date = new Date(shown.getFullYear(), shown.getMonth(), d);
      const k = keyOf(date);
      const has = busy.has(k);
      const inRange = pick.from && pick.to && date >= pick.from && date <= pick.to;
      const edge = sameDay(date, pick.from) || sameDay(date, pick.to);
      out += `<button class="cal-day${has ? " has" : ""}${inRange ? " in" : ""}${edge ? " edge" : ""}"
                data-d="${k}"${has ? "" : " disabled"}>${d}</button>`;
    }
    return out;
  }

  function applyPreset(kind, span) {
    const now = span.to;
    if (!kind) state.range = { from: null, to: null };
    else if (kind === "year") state.range = { from: new Date(now.getFullYear(), 0, 1), to: null };
    else if (kind === "12m") {
      state.range = { from: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), to: null };
    } else if (kind === "30d") {
      state.range = { from: new Date(now.getTime() - 30 * 86400000), to: null };
    }
    afterFilterChange(document.getElementById("explorer"));
  }

  function outsideRange(e) {
    if (state.cal && !state.cal.contains(e.target)) closeRange();
  }

  function closeRange() {
    document.removeEventListener("click", outsideRange);
    if (state.cal) { state.cal.remove(); state.cal = null; }
  }

  function wireRange(root) {
    const b = root.querySelector("#ex-range");
    if (b) b.addEventListener("click", (e) => { e.stopPropagation(); openRange(b); });
  }

  function paintRange(root) {
    const card = root.querySelector(".ex-stat.range .ex-stat-v");
    if (!card) return;
    const { from, to } = state.range;
    const span = fullSpan();
    card.textContent = !from && !to
      ? (span ? `${fmtShort(span.from)} to ${fmtShort(span.to)}` : "no dates")
      : `${from ? fmtShort(from) : "the start"} to ${to ? fmtShort(to) : "now"}`;
    root.querySelector(".ex-stat.range").classList.toggle("set", !!(from || to));
  }

  /* ---------- views ---------- */

  const TITLES = {
    timeline: ["Timeline", "Everything in this export, in the order it happened."],
    photos: ["Images and videos", "Every picture and clip found, newest first where a date survived."],
    chats: ["Chat history", "Grouped by person, with platforms shown together."],
    map: ["Location history", "Drawn on this device. No map service is contacted."],
    report: ["What is in here", "Everything your export contains, and how much of it Muletto understood."],
    highlights: ["Highlights", "What the records add up to, rather than the rows they came in."],
    records: ["Records", "The tables the export shipped, as they were written."],
    files: ["All files", "Everything inside the archive, including what could not be read."],
  };

  function showView(k) {
    /* Clean up used to be its own section. It is not a separate place - it is
       the second thing you do to the pictures you are already looking at, so
       it is a tab inside them. The old name still resolves, because plenty of
       buttons and saved state refer to it. */
    if (k === "cleanup") { state.photoTab = "cleanup"; k = "photos"; }
    /* Records is a tab inside All files now. The old key still resolves,
       because saved state and a couple of buttons still ask for it. */
    if (k === "records") { state.filesTab = "tables"; k = "files"; }
    else if (k === "files" && state.filesTab === undefined) state.filesTab = "files";
    state.view = k;
    if (state.rail) { state.rail.destroy(); state.rail = null; }
    if (state.thumbIo) { state.thumbIo.disconnect(); state.thumbIo = null; }
    closeDetail();
    const root = document.getElementById("explorer");
    const body = root.querySelector("#ex-body");
    /* A topic names itself, so adding one does not mean editing this table. */
    const topic = (state.topics || []).find((t) => t.key === k);
    const [title, sub] = TITLES[k] || (topic ? [topic.label, topic.sub] : [k, ""]);
    // A view that manages its own scrolling has to own the height, otherwise
    // its inner panes sit below the fold and can never be scrolled.
    root.querySelector("#ex-scroll").classList.toggle("fills", k === "chats" || k === "map");
    root.querySelector("#ex-title").textContent = title;
    root.querySelector("#ex-sub").textContent = sub;
    root.querySelector("#ex-scroll").scrollTop = 0;
    /* The headline figures belong to the view, so they are redrawn with it.
       Rendering them only when a filter changed is why every screen carried
       the timeline's numbers. */
    refreshCounts(root);

    /* Whatever the last view had decoded goes back now, not whenever a view
       that happens to use thumbnails is next drawn. Leaving the pictures for
       the map meant a screenful of originals stayed held the whole time you
       were somewhere else, and another screenful joined them each time. */
    releaseDecoded();

    if (k === "timeline") drawTimeline(body);
    else if (k === "photos") drawPhotos(body);
    else if (k === "report") drawReport(body);
    else if (k === "files") drawFilesShell(body);
    else if (k === "chats") MViews.renderPeople(body, scopedLib(), viewCtx());
    else if (k === "map") MViews.renderMap(body, scopedLib(), viewCtx());
    else if (typeof MTopics !== "undefined" && MTopics.has(k) &&
             MTopics.draw(k, body, scopedLib(),
               { entries: filtering() ? state.entries.filter((e) => srcOk(e)) : state.entries,
                 sources: state.sources })) { /* drawn */ }
    else if (state.actions.legacy) state.actions.legacy(k, body, viewCtx(), scopedLib());
    state.ctx.hydrate(body);
  }

  function viewCtx() {
    return {
      get query() { return state.query; },
      // So a view can tell "the export has none" from "your filter hides them".
      get filtered() { return filtering(); },
      clearFilters: () => {
        state.srcOff.clear();
        state.range = { from: null, to: null };
        afterFilterChange(document.getElementById("explorer"));
      },
      thumb: state.ctx.thumb,
      hydrate: state.ctx.hydrate,
    };
  }

  /* ---------- timeline ---------- */

  /* Everything is rendered at once.

     Paging looked like a kindness and was not. It left the document shorter
     than the data, so the scrollbar and the rail both lied about where you
     were; it inserted a screenful of DOM in the middle of a scroll every time
     you reached the bottom; and it put a "load more" button in front of a
     record the reader owns. Rows are cheap - it is decoding pictures that is
     expensive, and that is deferred separately.

     Beyond this many rows the browser starts to struggle, and a cap with a
     visible note is better than a page that will not scroll. */
  const ROW_CAP = 8000;

  function filteredDays() {
    const q = state.query;
    // A source filter changes the stream itself, not just which rows show.
    const stream = !filtering()
      ? state.stream
      : (state.scopedStream || (state.scopedStream = MViews.buildStream(scopedLib())));
    if (!q) return stream.days;
    return stream.days
      .map((d) => ({ ...d, items: d.items.filter((it) => itemMatches(it, q)) }))
      .filter((d) => d.items.length);
  }

  function itemMatches(it, q) {
    if (String(it.title || "").toLowerCase().includes(q)) return true;
    if (String(it.srcLabel || "").toLowerCase().includes(q)) return true;
    if (it.media && String(it.media.caption || "").toLowerCase().includes(q)) return true;
    if (it.type === "chat") return it.messages.some((m) => (m.text || "").toLowerCase().includes(q));
    return false;
  }

  /* "Did I get everything?" is the question this product exists to answer, and
     it was the ninth entry in a sidebar under the name "What is in here" -
     which sounds like a table of contents rather than an audit. Nobody reads
     the ninth entry. It is a line at the top of the first screen now, saying
     the number and offering the detail. */
  function coverageBanner() {
    const rep = state.actions.report && state.actions.report();
    if (!rep || !rep.length) return "";
    let total = 0, unread = 0;
    for (let i = 0; i < rep.length; i++) {
      if (state.srcOff.has(i)) continue;
      const rc = rep[i] && rep[i].reconciled;
      if (!rc) continue;
      total += rc.total || 0;
      unread += rc.unread || 0;
    }
    if (!total) return "";
    const read = total - unread;
    const share = Math.round((read / total) * 100);
    return '<button type="button" class="ex-cover' + (unread ? "" : " ex-cover-clean") + '" id="ex-cover">' +
      "<span><b>" + num(read) + " of " + num(total) + " files read</b>" +
      (unread
        ? " - " + num(unread) + " produced nothing, which is normal for some of them."
        : " - everything in this export was understood.") +
      "</span><em>" + share + "%</em></button>";
  }

  function drawTimeline(body) {
    let days = filteredDays();
    days.forEach((d, i) => { d.di = i; });

    if (!days.length) {
      body.innerHTML = state.query
        ? `<div class="ex-empty"><h3>Nothing matches "${esc(state.query)}"</h3>
           <p class="muted">Try a shorter search, or a different word.</p></div>`
        : emptyHtml("dated items", "Nothing here carries a date, so there is no order to put it in. " +
            "The other sections still work.");
      wireEmpty(body);
      state.days = days;
      return;
    }

    let total = 0, capped = 0;
    const shown = [];
    for (const d of days) {
      if (total >= ROW_CAP) { capped += d.items.length; continue; }
      shown.push(d);
      total += d.items.length;
    }
    state.days = shown;

    body.innerHTML = coverageBanner() + `
      <p class="muted small ex-count">${plural(total, "item", "items")} across
        ${plural(shown.length, "day", "days")}${capped
          ? `. ${num(capped)} older items are not shown - narrow it down with the search or a source.`
          : "."}</p>
      <div class="ex-tl" id="ex-tl">${shown.map(dayHtml).join("")}</div>`;

    const cover = body.querySelector("#ex-cover");
    if (cover) cover.addEventListener("click", () => showView("report"));

    const tl = body.querySelector("#ex-tl");
    state.ctx.hydrate(tl);
    watchThumbs(tl);

    tl.addEventListener("click", (e) => {
      const row = e.target.closest(".ex-row");
      if (row) selectItem(row.dataset.day, Number(row.dataset.i));
    });

    attachRail(shown.map((d, i) => ({ date: d.date, index: i })),
      (i) => document.querySelector(`#ex-tl .ex-day[data-di="${i}"]`),
      (i) => document.querySelector(`#ex-tl .ex-day[data-di="${i}"]`));
  }

  /* One rail per view. Rebuilt rather than updated, because switching views
     changes what the anchors even are. */
  function attachRail(anchors, elementFor, locate) {
    const root = document.getElementById("explorer");
    if (state.rail) { state.rail.destroy(); state.rail = null; }
    if (!global.MRail || anchors.length < 2) return;
    state.rail = MRail.attach({
      scroller: root.querySelector("#ex-scroll"),
      host: root.querySelector(".ex-main"),
      anchors, elementFor, locate,
    });
  }

  /* Pictures are decoded when they are about to be seen, and never twice.
     This is what makes rendering the whole record affordable. */
  /* There is no read-ahead of the whole library, on purpose.

     Warming every picture in the background sounded right and was badly wrong.
     A thumbnail holds the inflated file - a few megabytes for a phone photo -
     so reading three thousand of them ahead of time meant six to nine
     gigabytes resident. The machine starts swapping, and pictures arrive at
     wildly uneven speeds depending on what is still in memory, which is
     exactly the "some load much faster than others" that gave it away.

     The observer below looks 1600px past the edge of the screen, which is
     several rows in either direction. That is the read-ahead: enough to stay
     in front of a reader who is scrolling, bounded by what they are actually
     near rather than by the size of their library.

     What is decoded is capped too, and the tiles furthest from the reader give
     their memory back - see recycle(). */

  // Decoded tiles, oldest first. Roughly ten screens' worth at eight columns.
  const DECODED_CAP = 400;

  /* Give up every decoded picture this view was holding. */
  function releaseDecoded() {
    if (!state || !state.decoded) return;
    for (const d of state.decoded) {
      if (d && d.m && state.ctx.forget) state.ctx.forget(d.m);
    }
    state.decoded.length = 0;
  }

  function recycle() {
    const keep = state.decoded;
    while (keep.length > DECODED_CAP) {
      const old = keep.shift();
      if (!old || !old.el.isConnected) continue;
      // Put it back exactly as it was before it was decoded, so scrolling
      // into it again simply decodes it again.
      const box = old.box;
      if (box) {
        box.style.backgroundImage = "";
        box.classList.add("skeleton");
      }
      old.el.dataset.cell = old.cell;
      if (state.ctx.forget) state.ctx.forget(old.m);
      if (state.thumbIo) state.thumbIo.observe(old.el);
    }
  }

  function watchThumbs(scope) {
    if (state.thumbIo) state.thumbIo.disconnect();
    /* Hand back everything the previous view had decoded.

       This list used to be emptied and nothing else. The tiles were gone, so
       nothing could recycle them, but their pictures were still held - every
       one still in the cache and still holding an object URL the browser
       cannot collect. Scroll a few hundred pictures, switch to the map, come
       back, and that is a few hundred originals stranded in memory each time.
       It is what ran the tab out of memory. */
    releaseDecoded();
    state.decoded = [];
    const root = document.getElementById("explorer").querySelector("#ex-scroll");
    const all = [...scope.querySelectorAll("[data-thumb], [data-cell]")];

    /* The first screenful is decoded unconditionally rather than waiting to be
       observed. An observer that never fires - no layout yet, a hidden tab, a
       browser without one - would otherwise leave the view as placeholders
       forever, and "some pictures appear late" is a far better failure than
       "no pictures ever appear". */
    const eager = all.slice(0, 60);
    pool(eager, decodeCell, 6);

    const rest = all.slice(eager.length);
    if (!rest.length) return;
    if (!("IntersectionObserver" in window)) {
      pool(rest, decodeCell, 4);
      return;
    }
    state.thumbIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        state.thumbIo.unobserve(e.target);
        decodeCell(e.target);
      }
    }, { root, rootMargin: "1600px" });
    rest.forEach((el) => state.thumbIo.observe(el));
  }

  async function decodeCell(el) {
    if (el.dataset.thumb) {
      const [dk, i] = el.dataset.thumb.split(":");
      el.removeAttribute("data-thumb");
      const day = state.days.find((d) => d.key === dk);
      const it = day && day.items[Number(i)];
      if (!it || !it.media) return;
      const url = await state.ctx.thumb(it.media);
      if (url) el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
      else el.classList.add("nodecode");
      return;
    }
    if (el.dataset.cell && el.dataset.cell.startsWith("cl:")) {
      const [, gid, i] = el.dataset.cell.split(":");
      el.removeAttribute("data-cell");
      const m = (state.clGroups[gid] || [])[Number(i)];
      if (!m) return;
      const url = await state.ctx.thumb(m);
      const box = el.querySelector(".lib-img");
      if (!box) return;
      box.classList.remove("skeleton");
      if (url) box.style.backgroundImage = `url("${url}")`;
      else box.textContent = (m.name.split(".").pop() || "").toUpperCase();
      return;
    }
    if (el.dataset.cell) {
      const [gi, i] = el.dataset.cell.split(":").map(Number);
      el.removeAttribute("data-cell");
      const g = state.photoGroups[gi];
      const m = g && g.items[i];
      if (!m) return;
      const url = await state.ctx.thumb(m);
      const box = el.querySelector(".lib-img");
      if (!box) return;
      box.classList.remove("skeleton");
      if (url) box.style.backgroundImage = `url("${url}")`;
      else if (m.kind !== "video") box.textContent = (m.name.split(".").pop() || "").toUpperCase();
      state.decoded.push({ el, box, m, cell: gi + ":" + i });
      recycle();
    }
  }

  function dayHtml(d) {
    return `
      <section class="ex-day" data-day="${esc(d.key)}" data-di="${d.di}">
        <h3 class="ex-dayh">${esc(fmtDay(d.date))}<span>${plural(d.items.length, "item", "items")}</span></h3>
        <div class="ex-rows">
          ${d.items.map((it, i) => rowHtml(it, d.key, i)).join("")}
        </div>
      </section>`;
  }

  function rowHtml(it, dk, i) {
    const k = KIND[it.type] || { label: it.type, colour: "slate" };
    const iconKey = it.type === "chat" ? "chat" : it.type === "place" ? "pin"
      : it.type === "video" ? "video" : it.type === "photo" ? "image" : "activity";
    return `
      <article class="ex-row" data-day="${esc(dk)}" data-i="${i}" tabindex="0">
        <span class="ex-time">${esc(fmtTime(it.at))}</span>
        <span class="ex-ic c-${k.colour}" data-icon="${iconKey}"></span>
        <span class="ex-what">
          <b>${esc(k.label)}</b>
          <em>${esc(it.srcLabel || "")}</em>
        </span>
        <span class="ex-desc">
          <span class="ex-desc1">${esc(rowTitle(it))}</span>
          <span class="ex-desc2">${esc(rowSub(it))}</span>
        </span>
        <span class="ex-thumb${it.media ? " has" : ""}" ${it.media ? `data-thumb="${esc(dk)}:${i}"` : ""}></span>
      </article>`;
  }

  function rowTitle(it) {
    if (it.type === "chat") {
      // Prefer the last thing actually said; fall back to what was sent when
      // the final message was an attachment with no text.
      for (let i = it.messages.length - 1; i >= 0; i--) {
        if (it.messages[i].text) return it.messages[i].text;
      }
      const t = it.messages[it.messages.length - 1];
      return t && t.type ? `Sent ${String(t.type).toLowerCase()}` : "Attachment";
    }
    return it.title;
  }

  function rowSub(it) {
    if (it.type === "chat") return `${it.title} - ${plural(it.count, "message", "messages")}`;
    if (it.type === "place") return plural(it.count, "point", "points");
    if (it.media) return [it.media.size ? fmtBytes(it.media.size) : "", it.media.mime || ""].filter(Boolean).join(" - ");
    return "";
  }

  /* A small pool keeps the main thread responsive when several pictures are
     decoded at once. */
  async function pool(items, worker, width = 6) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }));
  }

  /* ---------- clean up ---------- */

  /* Muletto never deletes anything from your archives. They are read-only, and
     removing someone's only copy of a photo is not a decision a browser tab
     should be making. What this view collects is a decision about what a
     tidied copy would contain - and "Save into folders" writes exactly that.

     Exact copies come pre-decided, because keeping one of two identical files
     is not a judgement call. Photos that merely look alike do not: a burst of
     five is often five pictures you want, so nothing is dropped until you say
     so. */
  function exactGroups() {
    const lib = scopedLib();
    const byContent = new Map();
    for (const m of lib.media) {
      if (!m.entry || !m.entry.crc || !m.size) continue;
      const k = m.entry.crc + ":" + m.size;
      if (!byContent.has(k)) byContent.set(k, []);
      byContent.get(k).push(m);
    }
    const out = [];
    for (const list of byContent.values()) if (list.length > 1) out.push(list);
    out.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
    return out;
  }

  function tally() {
    const lib = scopedLib();
    let keep = 0, drop = 0, freed = 0, kept = 0;
    for (const m of lib.media) {
      if (m.drop) { drop++; freed += m.size || 0; }
      else { keep++; kept += m.size || 0; }
    }
    return { keep, drop, freed, kept };
  }

  /* How many copies to keep, and which.

     Deciding one picture at a time is fine for a handful and miserable for a
     hundred. A rule does the whole library at once; a group can then disagree
     with it, and go on disagreeing when the global rule changes again. */
  const RULES = {
    biggest: { label: "Keep the biggest", pick: (g) => [...g].sort((a, b) => (b.size || 0) - (a.size || 0)) },
    smallest: { label: "Keep the smallest", pick: (g) => [...g].sort((a, b) => (a.size || 0) - (b.size || 0)) },
    oldest: { label: "Keep the earliest", pick: (g) => [...g].sort((a, b) => (a.at || 0) - (b.at || 0)) },
    all: { label: "Keep every copy", pick: (g) => [...g] },
  };

  function applyRule(group, rule, keepN) {
    const r = RULES[rule] || RULES.biggest;
    const order = r.pick(group);
    const n = rule === "all" ? order.length : Math.max(1, Math.min(order.length, keepN || 1));
    order.forEach((m, i) => { m.drop = i >= n; });
  }

  function ruleFor(gid) {
    state.clRules = state.clRules || {};
    return state.clRules[gid] || null;      // null means "follow the global rule"
  }

  function drawCleanup(body) {
    const exact = exactGroups();
    /* Prepended after the body is built, below. */

    /* A byte-identical pair is also a perfect visual match, so it appears in
       the lookalike results too. Shown in both places it reads as two separate
       problems, and - worse - whichever section was registered last decided
       the outcome, so the exact copies kept being un-decided by the lookalike
       default of keeping everything.

       Identical wins: it is the stricter, more certain grouping. Anything the
       exact pass has already claimed is taken out of the lookalike list, and a
       lookalike group with nothing left to say is dropped. */
    const claimed = new Set();
    for (const g of exact) for (const m of g) claimed.add(m);

    const similar = (state.lib.similar || [])
      .map((g) => g.filter((m) => !claimed.has(m)))
      .filter((g) => g.length > 1)
      .filter((g) => g.some(srcOk));

    state.clGroups = {};
    state.keepRule = state.keepRule || "biggest";
    state.similarRule = state.similarRule || "all";

    // Exact copies default to one; lookalikes default to keeping everything,
    // because a burst of five is often five pictures worth having.
    exact.forEach((g, i) => registerGroup("e" + i, g, state.keepRule, 1));
    similar.forEach((g, i) => registerGroup("s" + i, g, state.similarRule, 1));

    body.innerHTML = `
      <div class="cl-wrap">
      ${planStripHtml()}
      <div class="cl-summary" id="cl-summary"></div>

      ${exact.length || similar.length ? `
      <div class="cl-rules">
        <label>Exact copies
          <select id="cl-rule-e">${ruleOptions(state.keepRule)}</select>
        </label>
        <label>Pictures that look alike
          <select id="cl-rule-s">${ruleOptions(state.similarRule)}</select>
        </label>
        <span class="muted small">Any group can be set differently below.</span>
      </div>` : ""}

      ${!exact.length && !similar.length ? `
        <p class="muted small">No exact copies found${state.lib.similar
          ? " and nothing that merely looks alike either"
          : ". Run <strong>Find similar photos</strong> to look for pictures that are not identical but nearly so"}.</p>` : ""}

      ${exact.length ? `
        <h3 class="cl-h">Exact copies</h3>
        <p class="muted small cl-note">Identical files, byte for byte. Keeping more than one of these
          gains nothing but space.</p>
        <div class="cl-groups">${exact.map((g, i) => groupHtml("e" + i)).join("")}</div>` : ""}

      ${similar.length ? `
        <h3 class="cl-h">Pictures that look alike</h3>
        <p class="muted small cl-note">Not identical - a burst, a crop, a re-save. Nothing here is dropped
          until you say so.</p>
        <div class="cl-groups">${similar.map((g, i) => groupHtml("s" + i)).join("")}</div>` : ""}
      </div>`;

    paintSummary();
    watchThumbs(body);
    // Wired to the freshly built inner element, never to the container: the
    // container survives a redraw and would collect a listener each time.
    wireCleanup(body.querySelector(".cl-wrap"));
    // showView hydrates once; this view redraws itself on every decision, and
    // the service badges would come back empty after the first one.
    state.ctx.hydrate(body);
  }

  function ruleOptions(current) {
    return Object.keys(RULES).map((k) =>
      `<option value="${k}"${k === current ? " selected" : ""}>${RULES[k].label}</option>`).join("");
  }

  function registerGroup(gid, group, defaultRule, defaultKeep) {
    state.clGroups[gid] = group;
    state.clKeep = state.clKeep || {};
    if (state.clKeep[gid] === undefined) state.clKeep[gid] = defaultKeep;
    applyRule(group, ruleFor(gid) || defaultRule, state.clKeep[gid]);
  }

  function groupHtml(gid) {
    const g = state.clGroups[gid];
    const own = ruleFor(gid);
    const globalRule = gid[0] === "e" ? state.keepRule : state.similarRule;
    const rule = own || globalRule;
    const keptN = g.filter((m) => !m.drop).length;
    const freed = g.filter((m) => m.drop).reduce((n, m) => n + (m.size || 0), 0);
    const order = (RULES[rule] || RULES.biggest).pick(g);

    return `
      <section class="cl-group" data-g="${gid}">
        <header>
          <span class="cl-gcount">${plural(g.length, "copy", "copies")}${
            freed ? ` - ${fmtBytes(freed)} left out` : " - all kept"}</span>
          <span class="cl-gtools">
            <select class="cl-grule" data-g="${gid}" title="How this group is decided">
              <option value=""${own ? "" : " selected"}>Follow the setting above</option>
              ${ruleOptions(own || "")}
            </select>
            <span class="cl-keepn${rule === "all" ? " off" : ""}">
              <button class="cl-step" data-g="${gid}" data-d="-1" ${keptN <= 1 ? "disabled" : ""}>-</button>
              <b>keep ${keptN}</b>
              <button class="cl-step" data-g="${gid}" data-d="1" ${keptN >= g.length ? "disabled" : ""}>+</button>
            </span>
          </span>
        </header>
        <div class="cl-row">
          ${order.map((m) => {
            const i = g.indexOf(m);
            return `
            <figure class="cl-cell${m.drop ? " dropped" : ""}" data-g="${gid}" data-i="${i}"
                    data-cell="cl:${gid}:${i}" tabindex="0"
                    title="${esc((m.srcLabel ? m.srcLabel + " - " : "") + fmtBytes(m.size || 0) + " - " + m.path)}">
              <span class="lib-img skeleton"></span>
              <i class="src-badge" data-icon="${esc(m.srcSlug || "box")}"></i>
              <span class="cl-mark"></span>
            </figure>`;
          }).join("")}
        </div>
      </section>`;
  }

  function wireCleanup(scope) {
    if (!scope) return;
    const body = scope.parentElement;
    const redraw = () => { drawCleanup(body); saveDecisions(); };

    const planBtn = holdBack(scope.querySelector("#cl-plan"));
    if (planBtn) planBtn.addEventListener("click", () => state.actions.plan());

    const e = scope.querySelector("#cl-rule-e");
    if (e) e.addEventListener("change", () => {
      state.keepRule = e.value;
      // A group that has said nothing follows along; one that has disagreed keeps disagreeing.
      Object.keys(state.clGroups).filter((k) => k[0] === "e" && !ruleFor(k))
        .forEach((k) => applyRule(state.clGroups[k], e.value, state.clKeep[k]));
      redraw();
    });
    const sr = scope.querySelector("#cl-rule-s");
    if (sr) sr.addEventListener("change", () => {
      state.similarRule = sr.value;
      Object.keys(state.clGroups).filter((k) => k[0] === "s" && !ruleFor(k))
        .forEach((k) => applyRule(state.clGroups[k], sr.value, state.clKeep[k]));
      redraw();
    });

    scope.querySelectorAll(".cl-grule").forEach((sel) => {
      sel.addEventListener("change", () => {
        const gid = sel.dataset.g;
        state.clRules = state.clRules || {};
        if (sel.value) state.clRules[gid] = sel.value; else delete state.clRules[gid];
        const rule = sel.value || (gid[0] === "e" ? state.keepRule : state.similarRule);
        applyRule(state.clGroups[gid], rule, state.clKeep[gid]);
        redraw();
      });
    });

    scope.addEventListener("click", (ev) => {
      const step = ev.target.closest(".cl-step");
      if (step) {
        const gid = step.dataset.g;
        const g = state.clGroups[gid];
        const now = g.filter((m) => !m.drop).length;
        state.clKeep[gid] = Math.max(1, Math.min(g.length, now + Number(step.dataset.d)));
        applyRule(g, ruleFor(gid) || (gid[0] === "e" ? state.keepRule : state.similarRule), state.clKeep[gid]);
        redraw();
        return;
      }
      const cell = ev.target.closest(".cl-cell");
      if (cell) {
        const m = state.clGroups[cell.dataset.g][Number(cell.dataset.i)];
        if (!m) return;
        m.drop = !m.drop;
        cell.classList.toggle("dropped", !!m.drop);
        // Hand-picking overrides the count for this group.
        state.clKeep[cell.dataset.g] = state.clGroups[cell.dataset.g].filter((x) => !x.drop).length;
        paintSummary();
        const head = cell.closest(".cl-group").querySelector(".cl-gcount");
        const g = state.clGroups[cell.dataset.g];
        const freed = g.filter((x) => x.drop).reduce((n, x) => n + (x.size || 0), 0);
        head.textContent = plural(g.length, "copy", "copies") +
          (freed ? " - " + fmtBytes(freed) + " left out" : " - all kept");
        saveDecisions();
      }
    });
  }

  function paintSummary() {
    const box = document.getElementById("cl-summary");
    if (!box) return;
    const t = tally();
    box.innerHTML = `
      <div class="cl-stat"><span>${num(t.keep)}</span><em>kept</em></div>
      <div class="cl-stat${t.drop ? " out" : ""}"><span>${num(t.drop)}</span><em>left out</em></div>
      <div class="cl-stat"><span>${esc(fmtBytes(t.freed))}</span><em>space saved</em></div>
      <p class="cl-explain">Nothing is deleted from your archives - they are never written to.
        These are the pictures a tidied copy would contain when you
        <strong>Save into folders</strong>.</p>`;
  }

  function saveDecisions() {
    if (state.actions.persist) state.actions.persist();
  }

  /* ---------- image library ---------- */

  /* Grouped by month rather than dumped in one grid, so the rail has something
     to point at and so a year of photos does not read as an undifferentiated
     wall. Undated pictures are a real case - plenty of exports lose EXIF - so
     they get their own group at the end rather than being dropped. */
  /* Every month is laid out immediately, with each picture as a sized
     placeholder. That gives the document its true height straight away, so the
     rail is accurate from the first frame and there is no button between the
     reader and their own photos. Only the decoding is deferred, and only until
     a picture is nearly on screen. */
  function photoMonths() {
    const q = state.query;
    const scoped = scopedLib();
    const pool_ = q
      ? scoped.media.filter((m) => m.path.toLowerCase().includes(q) ||
          String(m.caption || "").toLowerCase().includes(q) ||
          String(m.srcLabel || "").toLowerCase().includes(q))
      : scoped.media;

    const dated = pool_.filter((m) => m.at).sort((a, b) => b.at - a.at);
    const undated = pool_.filter((m) => !m.at);

    const groups = [];
    let cur = null;
    for (const m of dated) {
      const k = m.at.getFullYear() * 12 + m.at.getMonth();
      if (!cur || cur.key !== k) { cur = { key: k, date: m.at, items: [] }; groups.push(cur); }
      cur.items.push(m);
    }
    if (undated.length) groups.push({ key: null, date: null, items: undated });
    groups.forEach((g, i) => { g.gi = i; });
    return { groups, total: pool_.length, undated: undated.length };
  }

  function drawPhotos(body) {
    const tab = state.photoTab === "cleanup" ? "cleanup" : "library";
    const lib = scopedLib();
    const dupes = exactGroups().reduce((n, g) => n + g.length - 1, 0) +
      ((state.lib.similar || []).length);

    body.innerHTML =
      '<div class="ph-tabs" role="tablist">' +
        phTab("library", "All pictures", lib.media.length, tab) +
        phTab("cleanup", "Clean up", dupes, tab) +
      '</div><div id="ph-panel"></div>';

    body.querySelector(".ph-tabs").addEventListener("click", (e) => {
      const b = e.target.closest(".ph-tab");
      if (!b || b.dataset.t === tab) return;
      state.photoTab = b.dataset.t;
      showView("photos");
    });

    const root = document.getElementById("explorer");
    root.querySelector("#ex-sub").textContent = tab === "cleanup"
      ? "Decide what a tidied copy of your library would contain."
      : "Every picture and clip found, newest first where a date survived.";

    const panel = body.querySelector("#ph-panel");
    if (tab === "cleanup") drawCleanup(panel);
    else drawLibrary(panel);
  }

  /* Files and the tables inside them, in one place.
   *
   * "Records" and "All files" sat beside each other as equals and they are not
   * equals: a table is a file that could be read. Two sidebar entries for the
   * same archive, one of them a subset of the other, is a question the reader
   * has to answer before every click - and the answer was never obvious from
   * the names. The same tab pattern the pictures already use. */
  function drawFilesShell(body) {
    const tab = state.filesTab === "tables" ? "tables" : "files";
    const lib = scopedLib();
    const entries = filtering() ? state.entries.filter((e) => srcOk(e)) : state.entries;

    body.innerHTML =
      '<div class="ph-tabs" role="tablist">' +
        phTab("files", "Everything", entries.length, tab) +
        phTab("tables", "Tables in them", lib.tables.length, tab) +
      '</div><div id="fl-panel"></div>';

    body.querySelector(".ph-tabs").addEventListener("click", (e) => {
      const b = e.target.closest(".ph-tab");
      if (!b || b.dataset.t === tab) return;
      state.filesTab = b.dataset.t;
      showView("files");
    });

    const root = document.getElementById("explorer");
    root.querySelector("#ex-sub").textContent = tab === "tables"
      ? "The spreadsheets and lists inside those files, as the service wrote them."
      : "Everything inside the archive, including what could not be read.";

    const panel = body.querySelector("#fl-panel");
    if (state.actions.legacy) {
      state.actions.legacy(tab === "tables" ? "records" : "files", panel, viewCtx(), lib);
    }
    state.ctx.hydrate(panel);
  }

  function phTab(k, label, n, on) {
    return '<button class="ph-tab' + (k === on ? " on" : "") + '" data-t="' + k + '" ' +
      'role="tab" aria-selected="' + (k === on) + '">' + esc(label) +
      "<em>" + num(n) + "</em></button>";
  }

  function drawLibrary(body) {
    const info = photoMonths();
    state.photoGroups = info.groups;

    if (!info.total) {
      body.innerHTML = state.query
        ? '<div class="ex-empty"><h3>No pictures match "' + esc(state.query) + '"</h3></div>'
        : emptyHtml("pictures", "This export is data rather than media - messages, history " +
            "or account records. Photos usually come from a separate request.");
      wireEmpty(body);
      return;
    }

    body.innerHTML =
      '<div class="lib-bar">' +
        '<p class="muted small">' + plural(info.total, "picture", "pictures") +
        (info.undated ? ", " + num(info.undated) + " with no date recorded" : "") + ".</p>" +
        libToolsHtml() +
      "</div>" +
      aiBlockHtml() +
      '<div class="ex-lib" id="ex-lib">' + info.groups.map(monthHtml).join("") + "</div>";

    const lib = body.querySelector("#ex-lib");
    sizeGrid();
    watchThumbs(lib);

    lib.addEventListener("click", (e) => {
      const cell = e.target.closest(".lib-cell");
      if (cell) openPhoto(Number(cell.dataset.gi), Number(cell.dataset.i));
    });

    const scan = holdBack(body.querySelector("#lib-scan"));
    if (scan && state.actions.findSimilar) scan.addEventListener("click", () => state.actions.findSimilar());
    const toClean = body.querySelector("#lib-cleanup");
    if (toClean) toClean.addEventListener("click", () => showView("cleanup"));
    const ai = holdBack(body.querySelector("#lib-describe"));
    if (ai) ai.addEventListener("click", () => state.actions.describe());

    attachRail(
      info.groups.filter((g) => g.date).map((g) => ({ date: g.date, index: g.gi })),
      (i) => document.querySelector('#ex-lib .lib-month[data-gi="' + i + '"]'),
      (i) => document.querySelector('#ex-lib .lib-month[data-gi="' + i + '"]'));
  }

  /* The comparison belongs beside the pictures it is about, not in a global
     toolbar three views away from them. Once it has run, the same strip is
     where the result lives. */
  function libToolsHtml() {
    const groups = (state.lib.similar || []).length;
    const inner = state.lib.similar
      ? '<span class="lib-found">' + (groups
          ? plural(groups, "group", "groups") + " of lookalike pictures found"
          : "No lookalike pictures found") + "</span>" +
        (groups ? '<button class="btn secondary sm" id="lib-cleanup" data-tip="Go through ' +
          'the groups and choose which copy to keep. Nothing is deleted from your archives - ' +
          'it only decides what goes into the library you export.">Decide what to keep</button>' : "") +
        '<button class="btn ghost sm" id="lib-scan" data-tip="Run the comparison again, for ' +
          'instance after opening another export.">Compare again</button>'
      : '<span class="lib-found">Some of these may be near-copies of each other.</span>' +
        '<button class="btn secondary sm" id="lib-scan" data-tip="Compares every photo against ' +
          'every other to find exact copies and near-copies - the burst, the crop, the re-save. ' +
          'It deletes nothing on its own; you choose afterwards.">Find similar photos</button>';
    return '<div class="lib-tools">' + inner + "</div>";
  }

  /* Sorting by instruction, offered where the keep-or-drop decisions already
     live. It sits above the duplicate groups rather than replacing them: rules
     are good at "all screenshots" and useless at "which of these four
     near-identical shots is sharpest", so the two tools answer different
     questions. */
  function planStripHtml() {
    if (!state.actions.plan) return "";
    const photos = state.lib.media.filter((m) => m.kind !== "video");
    if (!photos.length) return "";
    const bucketed = photos.filter((m) => m.bucket).length;
    return '<div class="pl-strip">' +
      "<div><b>Sort it by describing what you want</b>" +
      "<p>" + (bucketed
        ? num(bucketed) + " of " + plural(photos.length, "picture", "pictures") +
          " are already sorted into folders. Run it again to change the arrangement."
        : "Say it in a sentence - \"keep people and notes, leave out screenshots, put the " +
          "rest in a separate folder\" - and see exactly what it would do before it does it.") +
      "</p></div>" +
      '<button class="btn ai sm" id="cl-plan">Sort by instruction</button></div>';
  }

  /* AI tagging, sold rather than mentioned.

     This was a ghost button reading "Descriptions" wedged into the toolbar,
     which is the treatment you give a preference, not the one thing here that
     changes what a photo library can do. Nobody scrolling twelve years of
     IMG_4821.JPG knows they want "descriptions"; they want to find the photo
     of the red bicycle. So the untouched state is a block that says what it
     gives you, and the button looks like something worth pressing.

     It shrinks as it becomes less relevant: a full pitch when nothing is
     tagged, one line while there is work left, and a quiet confirmation once
     there is not. */
  function aiBlockHtml() {
    if (!state.actions.describe) return "";
    const photos = state.lib.media.filter((m) => m.kind !== "video");
    if (!photos.length) return "";
    const todo = photos.filter((m) => !m.caption).length;

    if (!todo) {
      return '<div class="ai-strip done">' +
        "<span>" + aiIcon() + "All " + plural(photos.length, "image is", "images are") +
        " tagged. Search above for anything in them - and the tags travel with the " +
        "files when you export.</span>" +
        '<button class="btn ghost sm" id="lib-describe">AI settings</button></div>';
    }

    if (todo < photos.length) {
      return '<div class="ai-strip">' +
        "<span>" + aiIcon() + num(photos.length - todo) + " of " +
        plural(photos.length, "image", "images") + " tagged so far.</span>" +
        '<button class="btn ai sm" id="lib-describe">' + aiIcon() +
        "Tag " + num(todo) + " more</button></div>";
    }

    return '<div class="ai-promo">' +
      "<div>" +
        "<h3>Find any photo by describing it</h3>" +
        "<p>AI reads each picture and writes a sentence about what is in it. Then " +
        "searching <b>beach</b> or <b>birthday cake</b> finds it in a second, instead of " +
        "scrolling through years of IMG_4821.JPG.</p>" +
        "<p>Those sentences are written <b>into the photo files</b> when you export, in the " +
        "field every photo app reads - so the library stays searchable in Apple Photos, " +
        "Immich or on a NAS long after you have stopped using Muletto.</p>" +
      "</div>" +
      '<div class="ai-promo-cta">' +
        '<button class="btn ai" id="lib-describe">' + aiIcon() +
          "Tag " + plural(photos.length, "image", "images") + " with AI</button>" +
        '<span class="ai-fine">Free using a model on your own computer, where the pictures ' +
        "never leave the machine. Or your own API key, billed to you.</span>" +
      "</div></div>";
  }

  function aiIcon() {
    return '<svg class="ai-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9z"/>' +
      '<path d="M18.5 14.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/></svg>';
  }

  function monthHtml(g) {
    return '<section class="lib-month" data-gi="' + g.gi + '">' +
      '<h3 class="ex-dayh">' + (g.date
        ? esc(g.date.toLocaleDateString(undefined, { year: "numeric", month: "long" }))
        : "No date recorded") +
        "<span>" + plural(g.items.length, "picture", "pictures") + "</span></h3>" +
      '<div class="lib-grid">' + g.items.map((m, i) =>
        '<figure class="lib-cell" data-gi="' + g.gi + '" data-i="' + i + '" tabindex="0" ' +
                'data-cell="' + g.gi + ":" + i + '" title="' +
                esc((m.srcLabel ? m.srcLabel + " - " : "") + m.path) + '">' +
          '<span class="lib-img skeleton' + (m.kind === "video" ? " vid" : "") + '"></span>' +
          '<i class="src-badge" data-icon="' + esc(m.srcSlug || "box") + '"></i>' +
        "</figure>").join("") +
      "</div></section>";
  }

  /* The column count is fixed for the whole view, worked out from the width
     the column has when the detail panel is open - its narrowest.

     Letting it follow the current width meant the grid reflowed continuously
     while the panel animated, and then jumped at the end when the count
     finally changed. Pinning it means the pictures simply get wider or
     narrower, which is one smooth movement and no jump. */
  function sizeGrid() {
    const lib = document.querySelector("#ex-lib");
    if (!lib) return;
    /* Counted from the width the grid has now, which is nearly always the
       full one. It used to be counted from the width left when the detail
       panel is open and then applied at full width, so with the panel shut -
       the normal case - the count was far too low and every picture was
       blown up to fill the slack. Fixing the count still means no reflow when
       the panel opens; the pictures narrow, which is the point. */
    const w = lib.getBoundingClientRect().width;
    const cols = Math.max(3, Math.min(12, Math.round(Math.max(200, w) / 155)));
    lib.style.setProperty("--cols", cols);
  }

  /* Clicking a picture opens the same panel the timeline uses, so there is one
     place that describes a file. */
  async function openPhoto(gi, i) {
    const g = state.photoGroups[gi];
    const m = g && g.items[i];
    if (!m) return;
    document.querySelectorAll("#ex-lib .lib-cell.on").forEach((c) => c.classList.remove("on"));
    const cell = document.querySelector('#ex-lib .lib-cell[data-gi="' + gi + '"][data-i="' + i + '"]');
    if (cell) cell.classList.add("on");
    await drawMediaDetail(m);
  }

  async function drawMediaDetail(m) {
    const panel = document.getElementById("ex-detail");
    const kind = m.kind === "video" ? "video" : "photo";
    const k = KIND[kind];
    panel.hidden = false;
    document.querySelector('#explorer .ex').classList.add('detail-open');
    panel.innerHTML =
      '<header class="ex-dh">' +
        '<span class="ex-ic lg c-' + k.colour + '" data-icon="' + (kind === "video" ? "video" : "image") + '"></span>' +
        '<span class="ex-dh-t"><b>' + esc(k.label) + "</b><em>" + esc(m.srcLabel || "") + "</em></span>" +
        '<span class="ex-dh-a"><button class="ex-nav-btn" id="ex-x" title="Close">&times;</button></span>' +
      "</header>" +
      '<div class="ex-dbody">' +
        '<p class="ex-when">' + (m.at ? esc(fmtDay(m.at)) + " at " + esc(fmtTime(m.at)) : "No date recorded") + "</p>" +
        '<div id="ex-dmain"><p class="muted small">Decoding preview...</p></div>' +
        '<h4 class="ex-dh4">What the export recorded</h4><div class="tv" id="ex-dtree"></div>' +
        '<p class="ex-dfoot muted small">Shown exactly as your export supplied it.</p>' +
      "</div>";
    panel.querySelector("#ex-x").addEventListener("click", () => {
      closeDetail();
      document.querySelectorAll("#ex-lib .lib-cell.on").forEach((c) => c.classList.remove("on"));
    });
    /* A video gets a player, not a picture of its first frame. It used to show
       the poster and nothing else, so a clip could be looked at and never
       watched - no scrubber, no sound, no way to start it. */
    if (kind === "video") {
      const poster = await state.ctx.thumb(m);
      const file = state.ctx.media ? await state.ctx.media(m) : null;
      panel.querySelector("#ex-dmain").innerHTML = file
        ? '<div class="ex-dpreview"><video id="ex-dvid" controls playsinline preload="metadata"' +
          (poster ? ' poster="' + poster + '"' : "") + ' src="' + file + '"></video></div>'
        : '<p class="muted small">This browser has no codec for this file, so it cannot be played here. ' +
          'Exporting the library writes the original file out untouched.</p>';
      const v = panel.querySelector("#ex-dvid");
      if (v) {
        /* Opening a clip is a deliberate click, so it should start. Browsers
           refuse unmuted autoplay in plenty of situations, and a rejected
           promise here is uncaught noise - so if it is refused, mute and try
           once more, and if that fails too the controls are already there. */
        v.play().catch(() => {
          v.muted = true;
          return v.play().catch(() => {});
        });
      }
    } else {
      const url = await state.ctx.thumb(m);
      panel.querySelector("#ex-dmain").innerHTML = url
        ? '<div class="ex-dpreview"><img src="' + url + '" alt="' + esc(m.name) + '"></div>'
        : '<p class="muted small">This browser has no codec for this file, so no preview can be shown.</p>';
    }
    panel.querySelector("#ex-dtree").innerHTML = MViews.treeHtml({
      "file name": m.name,
      "path inside the export": m.path,
      "size": m.size ? fmtBytes(m.size) : null,
      "date taken": m.at || null,
      "type": m.mime || "unknown",
      "came from": m.srcLabel || null,
    });
    state.ctx.hydrate(panel);
  }

  /* What is in the export, read as a person would want it.

     The page answers "did anything get missed?", which a wall of JSON cannot.
     So the shape comes first - what the archive holds, what was understood,
     what was left alone - and the JSON is a download underneath.

     No privacy note here. The app says where data goes in the sidebar, on the
     import banner and on its own page; repeating it on one screen implies that
     screen is a special case, which invites exactly the doubt it was meant to
     settle. */
  const KNOWN_EXT = /^(jpg|jpeg|png|gif|webp|heic|heif|avif|mp4|mov|m4v|webm|json|csv|html?|txt|xml|vcf|ics|mbox)$/i;

  function drawReport(body) {
    const all = state.actions.report ? state.actions.report() : null;
    /* This page was the one place a switched-off source kept talking. The
       reports are built one per source in the order they were opened, so the
       filter is the same index test everything else uses. */
    const reports = all && all.filter((_, i) => !state.srcOff.has(i));
    if (all && all.length && reports && !reports.length) {
      body.innerHTML = '<div class="ex-empty"><h3>Nothing selected</h3>' +
        '<p class="muted">Every export is switched off in the sidebar, so there is ' +
        "nothing to describe. Turn one back on.</p></div>";
      return;
    }
    if (!reports || !reports.length) {
      body.innerHTML = `<p class="muted small">Reading your export...</p>`;
      return;
    }

    body.innerHTML = `
      <p class="rp-lead">Everything your export contains, and how much of it Muletto could read.
        If something is missing from your library, this is the page that explains why.</p>
      ${reports.map(sourceReportHtml).join("")}
      <div class="rp-foot">
        <h4>Keep a copy</h4>
        <p class="muted small">The same thing as JSON: folder layouts, file types, key names and
          column headers, with file numbers collapsed so a thousand photos read as one line.</p>
        <div class="rp-tools">
          <button class="btn secondary sm" id="rp-save">Save it as a file</button>
          <button class="btn ghost sm" id="rp-copy">Copy as JSON</button>
          <button class="btn ghost sm" id="rp-raw">Show the raw JSON</button>
        </div>
        <pre class="report" id="rp-pre" hidden></pre>
      </div>`;

    const json = state.actions.reportJson ? state.actions.reportJson() : "";
    body.querySelector("#rp-save").addEventListener("click", () => {
      if (state.actions.saveReport) state.actions.saveReport(json);
    });
    body.querySelector("#rp-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(json);
        MNotify.push("Copied", { kind: "done", body: "The report is on your clipboard." });
      } catch {
        MNotify.push("Could not copy", { kind: "warn", body: "Use Save it as a file instead." });
      }
    });
    const raw = body.querySelector("#rp-raw");
    raw.addEventListener("click", () => {
      const pre = body.querySelector("#rp-pre");
      if (pre.hidden) { pre.textContent = json; pre.hidden = false; raw.textContent = "Hide the raw JSON"; }
      else { pre.hidden = true; raw.textContent = "Show the raw JSON"; }
    });

    body.querySelectorAll(".rp-more").forEach((b) => {
      b.addEventListener("click", () => {
        const box = b.parentElement.querySelector(".rp-hidden");
        box.hidden = !box.hidden;
        b.textContent = box.hidden ? b.dataset.show : "Show less";
      });
    });
  }

  function sourceReportHtml(r) {
    const read = r.parserRead || {};
    const folders = Object.entries(r.folders || {});
    const exts = Object.entries(r.extensions || {});
    const unknownExts = exts.filter(([e]) => !KNOWN_EXT.test(e));
    const unreadable = (r.structuredFiles || []).filter((f) => f.kind === "unreadable");

    /* The number that matters: files the parser produced nothing from. Not an
       error on its own - an export is full of thumbnails and index pages - but
       it is where to look when something is missing. */
    /* The old sum counted lib.files as accounted for, and lib.files is
       precisely the bucket of things that were listed and never read - so a
       Takeout with a fifth of it untouched reported zero. The reconciliation
       walks every entry instead and has to balance. */
    const rec = r.reconciled;
    const untouched = rec ? rec.unread
      : Math.max(0, (r.archive.files || 0) -
        ((read.media || 0) + (read.otherFiles || 0) +
         (r.structuredFiles || []).filter((f) => f.kind !== "unreadable").length));

    return `
      <section class="rp-src">
        <header class="rp-head">
          <div>
            <h3>${esc(r.archive.detectedAs)}</h3>
            <p class="muted small">${esc(r.sourceName || "")} - ${plural(r.archive.files, "file", "files")},
              ${esc(fmtBytes(r.archive.bytes))}</p>
          </div>
        </header>

        <div class="rp-cards">
          ${[["Photos and videos", read.media],
             ["Messages", read.messages],
             ["Dated events", read.timelineEvents],
             ["Locations", read.places],
             ["Record tables", (read.recordTables || []).length]]
            .filter(([, v]) => v)
            .map(([k, v]) => `<div class="rp-card"><b>${num(v)}</b><span>${esc(k)}</span></div>`).join("")}
          <div class="rp-card${untouched ? " warn" : ""}">
            <b>${num(untouched)}</b><span>files nothing was taken from</span>
          </div>
        </div>

        ${rec && rec.unread ? `
          <div class="rp-gap">
            <h4>What was not read</h4>
            <p class="muted small">Every entry in this archive is accounted for below, and
              ${num(rec.unread)} of ${num(rec.total)} produced nothing. That is not
              automatically wrong - an export carries index pages and thumbnails - but if
              something you expected is missing, it is in this list.</p>
            <div class="rp-gapcols">
              <div>
                <h5>Where</h5>
                <ul>${rec.byArea.slice(0, 8).map(([k, v]) =>
                  `<li><span>${esc(k)}</span><em>${num(v)}</em></li>`).join("")}</ul>
              </div>
              <div>
                <h5>What kind</h5>
                <ul>${rec.byType.slice(0, 8).map(([k, v]) =>
                  `<li><span>.${esc(k)}</span><em>${num(v)}</em></li>`).join("")}</ul>
              </div>
            </div>
            ${rec.nested ? `<p class="rp-gapnote">${plural(rec.nested, "archive is", "archives are")}
              nested inside this one and ${rec.nested === 1 ? "has" : "have"} not been opened.
              Whatever is inside ${rec.nested === 1 ? "it" : "them"} is not counted anywhere
              on this page.</p>` : ""}
            ${rec.orphanSidecars ? `<p class="rp-gapnote">${num(rec.orphanSidecars)} metadata
              files name a photograph that is not in the library, so those dates and places
              were lost.</p>` : ""}
            ${rec.unexplained ? `<p class="rp-gapnote">${num(rec.unexplained)} entries could
              not be placed in any category, which is a bug in this page rather than in your
              export.</p>` : ""}
          </div>` : ""}

        <h4 class="rp-h">Where the bulk of it sits</h4>
        <div class="tablewrap"><table class="rp-table">
          <thead><tr><th>Folder</th><th>Files</th><th>Size</th><th>Mostly</th></tr></thead>
          <tbody>
            ${folders.slice(0, 8).map(([name, f]) => `
              <tr>
                <td><code>${esc(name)}</code></td>
                <td>${num(f.files)}</td>
                <td>${esc(fmtBytes(f.bytes))}</td>
                <td class="muted">${esc(Object.entries(f.extensions || {})
                  .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => e + " x" + n).join(", "))}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>
        ${folders.length > 8 ? `
          <button class="rp-more" data-show="Show all ${folders.length} folders">Show all ${folders.length} folders</button>
          <div class="rp-hidden tablewrap" hidden><table class="rp-table"><tbody>
            ${folders.slice(8).map(([name, f]) => `
              <tr><td><code>${esc(name)}</code></td><td>${num(f.files)}</td>
              <td>${esc(fmtBytes(f.bytes))}</td></tr>`).join("")}
          </tbody></table></div>` : ""}

        <h4 class="rp-h">File types</h4>
        <div class="rp-chips">
          ${exts.slice(0, 14).map(([e, n]) =>
            `<span class="rp-chip${KNOWN_EXT.test(e) ? "" : " odd"}">${esc(e || "no extension")} <b>${num(n)}</b></span>`).join("")}
        </div>
        ${unknownExts.length ? `<p class="muted small rp-note">${plural(unknownExts.length, "type", "types")}
          here are not ones Muletto reads: ${esc(unknownExts.slice(0, 8).map(([e]) => e).join(", "))}.
          That is often fine - exports carry index pages and thumbnails - but it is the first place
          to look if something is missing.</p>` : ""}

        ${unreadable.length ? `<h4 class="rp-h">Would not open</h4>
          <p class="muted small">${plural(unreadable.length, "file", "files")} could not be read at
          all. If those matter to you, this is the part of the report worth looking at.</p>` : ""}

        ${(r.structuredFiles || []).filter((f) => f.kind !== "unreadable").length ? `
          <h4 class="rp-h">The data files, and what is in them</h4>
          <p class="muted small rp-note">The field names each file uses. A parser looking for
            <code>takenAt</code> in a file that calls it <code>photoTakenTime</code> shows up
            here.</p>
          <div class="rp-shapes">
            ${(r.structuredFiles || []).filter((f) => f.kind !== "unreadable").slice(0, 6).map((f) => `
              <details class="rp-shape">
                <summary><code>${esc(f.path)}</code> <span class="muted">${esc(f.kind)}</span></summary>
                <pre>${esc(JSON.stringify(f.shape || f.columns || {}, null, 1).slice(0, 2600))}</pre>
              </details>`).join("")}
          </div>` : ""}
      </section>`;
  }

  /* ---------- detail panel ---------- */

  /* ---------- forgetting a library ----------

     This used to be the button turning into "Really forget it?" and waiting
     four seconds for a second click. If the second click came later than that
     the label had quietly gone back, so the click re-armed it instead of doing
     anything - press, nothing, press, nothing, and eventually a pair fast
     enough to land. Silent, and it looked broken because it was.

     A destructive action that cannot be undone should say what it destroys and
     wait as long as it takes to be answered. */
  function askForget() {
    if (document.getElementById("forgetx")) return;
    const lib = state.lib;
    const photos = lib.media.length;
    const msgs = lib.conversations.reduce((n, c) => n + c.messages.length, 0);

    const el = document.createElement("div");
    el.id = "forgetx";
    el.innerHTML =
      '<div class="xw-scrim"></div>' +
      '<div class="xw" role="dialog" aria-modal="true" aria-labelledby="fx-t">' +
        '<header class="xw-head"><div><h2 id="fx-t">Forget this library?</h2>' +
          '<p class="muted small">Your archives are not touched. This clears what Muletto ' +
          'worked out about them.</p></div>' +
          '<button class="xw-x" id="fx-x" aria-label="Close">&times;</button></header>' +
        '<div class="xw-body">' +
          '<ul class="fx-list">' +
            "<li><b>What goes</b><span>Every comparison, repaired date and description - " +
            num(photos) + " pictures and " + num(msgs) + " messages worth of work - plus the " +
            "small copies kept for the grid. The next open starts from nothing.</span></li>" +
            "<li><b>What stays</b><span>Your exports, wherever they are on disk, and anything " +
            "you have already written out.</span></li>" +
            "<li><b>Cannot be undone</b><span>None of it is anywhere else. There is no copy " +
            "on a server to fetch it back from.</span></li>" +
          "</ul>" +
          '<p class="fx-keep">Keep the work first?</p>' +
          '<div class="fx-outs">' +
            '<button class="btn secondary" id="fx-work">Save it to a file</button>' +
            '<button class="btn secondary" id="fx-export">Export the library</button>' +
          "</div>" +
          '<p class="muted small fx-note">A work file holds no photos or messages - only what ' +
          "was worked out - so it is small, and opening it next to a fresh export saves doing " +
          "any of this twice.</p>" +
          '<div class="fx-bar" id="fx-bar" hidden><i></i><span id="fx-say">Clearing...</span></div>' +
        "</div>" +
        '<footer class="xw-foot">' +
          '<button class="btn ghost" id="fx-no">Keep it</button>' +
          '<button class="btn danger" id="fx-yes">Forget everything</button>' +
        "</footer>" +
      "</div>";
    document.body.appendChild(el);
    document.body.classList.add("exporting");

    const shut = () => {
      el.remove();
      document.body.classList.remove("exporting");
      document.removeEventListener("keydown", esc);
    };
    const esc = (e) => { if (e.key === "Escape") shut(); };
    document.addEventListener("keydown", esc);
    el.querySelector(".xw-scrim").addEventListener("click", shut);
    el.querySelector("#fx-x").addEventListener("click", shut);
    el.querySelector("#fx-no").addEventListener("click", shut);

    el.querySelector("#fx-work").addEventListener("click", () => {
      if (state.actions.saveWork) state.actions.saveWork();
    });
    el.querySelector("#fx-export").addEventListener("click", () => {
      shut();
      if (state.actions.save) state.actions.save();
    });

    el.querySelector("#fx-yes").addEventListener("click", async () => {
      const bar = el.querySelector("#fx-bar");
      const say = el.querySelector("#fx-say");
      bar.hidden = false;
      el.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        await state.actions.forget((msg) => { if (say) say.textContent = msg; });
      } catch (err) {
        say.textContent = "Could not clear everything: " + ((err && err.message) || err);
        el.querySelector("#fx-no").disabled = false;
        return;
      }
      shut();
    });
  }

  function closeDetail() {
    const p = document.getElementById("ex-detail");
    if (p) { p.hidden = true; p.innerHTML = ""; }
    const ex = document.querySelector("#explorer .ex");
    if (ex) ex.classList.remove("detail-open");
    document.querySelectorAll("#explorer .ex-row.on").forEach((r) => r.classList.remove("on"));
    if (state) state.selected = null;
  }

  function flatIndex(dk, i) {
    let n = 0;
    for (const d of state.days) {
      if (d.key === dk) return n + i;
      n += d.items.length;
    }
    return -1;
  }

  function flatItem(idx) {
    let n = 0;
    for (const d of state.days) {
      if (idx < n + d.items.length) return { it: d.items[idx - n], day: d, i: idx - n };
      n += d.items.length;
    }
    return null;
  }

  function flatCount() {
    return state.days.reduce((n, d) => n + d.items.length, 0);
  }

  async function selectItem(dk, i) {
    const idx = flatIndex(dk, i);
    if (idx < 0) return;
    state.selected = idx;
    document.querySelectorAll("#explorer .ex-row.on").forEach((r) => r.classList.remove("on"));
    const row = document.querySelector(`#explorer .ex-row[data-day="${CSS.escape(dk)}"][data-i="${i}"]`);
    if (row) row.classList.add("on");
    await drawDetail();
  }

  async function step(delta) {
    const next = state.selected + delta;
    if (next < 0 || next >= flatCount()) return;
    state.selected = next;
    const f = flatItem(next);
    document.querySelectorAll("#explorer .ex-row.on").forEach((r) => r.classList.remove("on"));
    const row = document.querySelector(`#explorer .ex-row[data-day="${CSS.escape(f.day.key)}"][data-i="${f.i}"]`);
    if (row) { row.classList.add("on"); row.scrollIntoView({ block: "nearest" }); }
    await drawDetail();
  }

  /* Things recorded near the same moment, from any source. This is the reason
     to merge exports at all: a photo means more when you can see the message
     that came two minutes later. */
  function nearby(it, hours = 3) {
    const span = hours * 3600 * 1000;
    return state.stream.items
      .filter((o) => o !== it && Math.abs(o.at - it.at) <= span)
      .sort((a, b) => Math.abs(a.at - it.at) - Math.abs(b.at - it.at));
  }

  async function drawDetail() {
    const panel = document.getElementById("ex-detail");
    const f = flatItem(state.selected);
    if (!f) return;
    const it = f.it;
    const k = KIND[it.type] || { label: it.type, colour: "slate" };
    const iconKey = it.type === "chat" ? "chat" : it.type === "place" ? "pin"
      : it.type === "video" ? "video" : it.type === "photo" ? "image" : "activity";

    panel.hidden = false;
    document.querySelector('#explorer .ex').classList.add('detail-open');
    panel.innerHTML = `
      <header class="ex-dh">
        <span class="ex-ic lg c-${k.colour}" data-icon="${iconKey}"></span>
        <span class="ex-dh-t"><b>${esc(k.label)}</b><em>${esc(it.srcLabel || "")}</em></span>
        <span class="ex-dh-a">
          <button class="ex-nav-btn" id="ex-prev" title="Previous" ${state.selected === 0 ? "disabled" : ""}>&larr;</button>
          <button class="ex-nav-btn" id="ex-next" title="Next" ${state.selected >= flatCount() - 1 ? "disabled" : ""}>&rarr;</button>
          <button class="ex-nav-btn" id="ex-x" title="Close">&times;</button>
        </span>
      </header>
      <div class="ex-dbody" id="ex-dbody">
        <p class="ex-when">${esc(fmtDay(it.at))} at ${esc(fmtTime(it.at))}</p>
        <div id="ex-dmain"></div>
        <h4 class="ex-dh4">What the export recorded</h4>
        <div class="tv" id="ex-dtree"></div>
        <h4 class="ex-dh4">Around this time</h4>
        <div class="ex-near" id="ex-near"></div>
        <p class="ex-dfoot muted small">
          Shown exactly as your export supplied it. Nothing has been added,
          guessed, or looked up anywhere.
        </p>
      </div>`;

    panel.querySelector("#ex-x").addEventListener("click", closeDetail);
    panel.querySelector("#ex-prev").addEventListener("click", () => step(-1));
    panel.querySelector("#ex-next").addEventListener("click", () => step(1));

    const main = panel.querySelector("#ex-dmain");
    if (it.type === "place") {
      main.innerHTML = miniMap(it.points);
    } else if (it.type === "chat") {
      main.innerHTML = `<div class="ex-dmsgs">${it.messages.map(msgHtml).join("")}</div>`;
    } else if (it.media) {
      main.innerHTML = `<p class="muted small">Decoding preview...</p>`;
      const url = await state.ctx.thumb(it.media);
      main.innerHTML = url
        ? `<div class="ex-dpreview"><img src="${url}" alt="${esc(it.title)}"></div>`
        : `<p class="muted small">This browser has no codec for this file, so no preview can be shown. The details below still come straight from the export.</p>`;
    }

    panel.querySelector("#ex-dtree").innerHTML = MViews.treeHtml(detailsOf(it));

    const near = nearby(it).slice(0, 6);
    panel.querySelector("#ex-near").innerHTML = near.length
      ? near.map((o) => {
          const ok = KIND[o.type] || { label: o.type, colour: "slate" };
          const oi = o.type === "chat" ? "chat" : o.type === "place" ? "pin"
            : o.type === "video" ? "video" : o.type === "photo" ? "image" : "activity";
          return `<div class="ex-nearrow">
            <span class="ex-time">${esc(fmtTime(o.at))}</span>
            <span class="ex-ic sm c-${ok.colour}" data-icon="${oi}"></span>
            <span class="ex-nearw"><b>${esc(ok.label)}</b><em>${esc(o.srcLabel || "")}</em></span>
            <span class="ex-neard">${esc(rowTitle(o))}</span>
          </div>`;
        }).join("")
      : `<p class="muted small">Nothing else was recorded within three hours of this.</p>`;

    state.ctx.hydrate(panel);
  }

  function msgHtml(m) {
    return `<div class="msg ${m.direction === "sent" ? "out" : "in"}">
      <div class="mh">${esc(m.from || "")} - ${m.at ? esc(fmtTime(m.at)) : ""}</div>
      <div class="mb">${m.text ? esc(m.text) : `<em class="muted">${esc(m.type || "attachment")}</em>`}</div>
    </div>`;
  }

  function detailsOf(it) {
    if (it.media) {
      const m = it.media;
      const o = {
        "file name": m.name,
        "description": m.caption || null,
        "path inside the export": m.path,
        "size": m.size ? fmtBytes(m.size) : null,
        "date taken": m.at || null,
        "type": m.mime || "unknown",
        "came from": it.srcLabel || null,
      };
      return o;
    }
    if (it.type === "place") {
      return {
        "points recorded": it.count,
        "came from": it.srcLabel || null,
        "coordinates": it.points.slice(0, 200).map((p) => ({
          latitude: p.lat, longitude: p.lon, recorded: p.at || null,
        })),
      };
    }
    if (it.type === "chat") {
      return {
        "conversation": it.title,
        "messages that day": it.count,
        "came from": it.srcLabel || null,
        "messages": it.messages.map((m) => ({
          from: m.from, direction: m.direction, at: m.at || null,
          text: m.text || null, type: m.type || null,
        })),
      };
    }
    return { "what": it.title, "kind": it.kind || "activity", "when": it.at, "came from": it.srcLabel || null };
  }

  /* A close crop of the shipped basemap around the point, so a coordinate
     reads as a place. Still no tile requests. */
  function miniMap(points) {
    const bm = global.MBasemap;
    const p = points[0];
    const cx = ((p.lon + 180) / 360) * 1000;
    const cy = ((90 - p.lat) / 180) * 500;
    const half = 60;
    const dots = points.slice(0, 400).map((q) => {
      const x = ((q.lon + 180) / 360) * 1000;
      const y = ((90 - q.lat) / 180) * 500;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.1"/>`;
    }).join("");
    return `
      <div class="ex-minimap">
        <svg viewBox="${(cx - half).toFixed(1)} ${(cy - half / 2).toFixed(1)} ${half * 2} ${half}"
             preserveAspectRatio="xMidYMid slice">
          <rect x="${cx - half * 2}" y="${cy - half}" width="${half * 4}" height="${half * 2}" class="mm-sea"/>
          ${bm ? `<path d="${bm.path}" class="mm-land"/>` : ""}
          <g class="mm-dots">${dots}</g>
          <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="2.4" class="mm-here"/>
        </svg>
      </div>
      <dl class="ex-dl">
        <dt>Latitude</dt><dd>${p.lat.toFixed(4)}</dd>
        <dt>Longitude</dt><dd>${p.lon.toFixed(4)}</dd>
        ${points.length > 1 ? `<dt>Points that day</dt><dd>${num(points.length)}</dd>` : ""}
      </dl>`;
  }

  /* Progress reporting for work started from inside the explorer, so
     opening another export does not have to leave it. */
  /* Kept for callers that still report progress this way; anything the reader
     needs to notice goes through MNotify instead, which puts it in one place
     rather than wherever the button happened to be. */
  function status(msg) {
    const el = document.getElementById("ex-status");
    if (el) el.textContent = msg || "";
    if (msg && typeof MNotify !== "undefined") MNotify.push(msg, { kind: "info" });
  }

  /* Redraw after work has changed the library, without reopening the whole
     explorer - which would throw away whichever view the reader was on. */
  function refresh() {
    if (!state) return;
    const root = document.getElementById("explorer");
    if (!root) return;
    state.stream = MViews.buildStream(state.lib);
    state.scopedStream = null;
    refreshCounts(root);
    showView(state.view);
  }

  /* A control that only works on your own data, marked as such.

     The sidebar's are marked once when the shell is built, but the ones that
     belong to a view - compare photographs, sort by instruction, describe
     with AI - are drawn each time that view opens, long after that pass has
     run, so they were the three that looked available on the samples. */
  function holdBack(btn) {
    if (!btn || !state || !state.ctx || !state.ctx.demo) return btn;
    btn.classList.add("held-back");
    btn.setAttribute("data-tip",
      "Held back on the sample data. Open your own export and this works.");
    return btn;
  }

  function currentView() { return state ? state.view : null; }

  /* The side panel, for a view that is not the timeline.
   *
   * All files used to open a preview inside the row it belonged to, which
   * pushed every row below it down the page and left a picture squeezed into
   * the width of a file name. The timeline had a perfectly good panel for
   * exactly this - full height, beside the list, with the list still legible
   * next to it - and there was no reason for the two to differ.
   *
   * Returns the element so the caller can fill it in asynchronously, which is
   * the normal case: the bytes have to come out of the archive first. */
  function showPanel(title, subtitle, iconKey) {
    const panel = document.getElementById("ex-detail");
    if (!panel) return null;
    panel.hidden = false;
    const ex = document.querySelector("#explorer .ex");
    if (ex) ex.classList.add("detail-open");
    panel.innerHTML = `
      <header class="ex-dh">
        <span class="ex-ic lg c-slate" data-icon="${esc(iconKey || "file")}"></span>
        <span class="ex-dh-t"><b>${esc(title)}</b><em>${esc(subtitle || "")}</em></span>
        <span class="ex-dh-a">
          <button class="ex-nav-btn" id="ex-x" title="Close">&times;</button>
        </span>
      </header>
      <div class="ex-dbody" id="ex-dbody"><div id="ex-dmain"></div></div>`;
    panel.querySelector("#ex-x").addEventListener("click", closeDetail);
    if (state && state.ctx && state.ctx.hydrate) state.ctx.hydrate(panel);
    return panel.querySelector("#ex-dmain");
  }

  global.MExplorer = { open, close, showView, refresh, currentView, status,
                       showPanel, closePanel: closeDetail };
})(window);
