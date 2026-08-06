/* Muletto views: the unified timeline, the cross-platform chat viewer, and the
   map. Everything here reads the merged library that parsers.js builds and
   app.js merges; nothing here touches the network.

   The timeline is the point of the product. An export is a pile of folders
   that means nothing on its own. Laid out newest-first by day, with photos,
   messages, places and account activity in the same column, it becomes a
   record of what you were actually doing. */
(function (global) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  const DAY_FMT = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  const TIME_FMT = { hour: "2-digit", minute: "2-digit" };

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtDay = (d) => d.toLocaleDateString(undefined, DAY_FMT);
  const fmtTime = (d) => d.toLocaleTimeString(undefined, TIME_FMT);

  /* ---------- building one stream out of everything ---------- */

  /* Messages are the awkward one. A chatty year is tens of thousands of
     messages, and one row each would bury every photo and every trip. So a
     conversation collapses to one item per day, carrying its messages for when
     the reader expands it. Places collapse the same way. */
  function buildStream(lib) {
    const items = [];

    for (const m of lib.media) {
      if (!m.at) continue;
      items.push({
        at: m.at, type: m.kind === "video" ? "video" : "photo",
        title: m.name, media: m, src: m.src, srcLabel: m.srcLabel, srcSlug: m.srcSlug,
      });
    }

    for (const c of lib.conversations) {
      const byDay = new Map();
      for (const msg of c.messages) {
        if (!msg.at) continue;
        const k = dayKey(msg.at);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(msg);
      }
      for (const msgs of byDay.values()) {
        msgs.sort((a, b) => a.at - b.at);
        items.push({
          at: msgs[msgs.length - 1].at, type: "chat",
          title: c.title, count: msgs.length, messages: msgs,
          src: c.src, srcLabel: c.srcLabel, srcSlug: c.srcSlug,
        });
      }
    }

    const placeDays = new Map();
    for (const p of lib.places) {
      if (!p.at || !isFinite(p.lat) || !isFinite(p.lon)) continue;
      const k = dayKey(p.at) + "|" + (p.src || 0);
      if (!placeDays.has(k)) placeDays.set(k, []);
      placeDays.get(k).push(p);
    }
    for (const pts of placeDays.values()) {
      items.push({
        at: pts[pts.length - 1].at, type: "place",
        title: pts.length === 1 ? "Location recorded" : `${pts.length.toLocaleString()} locations recorded`,
        count: pts.length, points: pts,
        src: pts[0].src, srcLabel: pts[0].srcLabel, srcSlug: pts[0].srcSlug,
      });
    }

    // Photo and video events duplicate the media rows above; drop them.
    for (const e of lib.events) {
      if (!e.at || e.kind === "photo" || e.kind === "video") continue;
      items.push({
        at: e.at, type: "event", kind: e.kind, title: e.label,
        src: e.src, srcLabel: e.srcLabel, srcSlug: e.srcSlug,
      });
    }

    items.sort((a, b) => b.at - a.at);

    const days = [];
    let cur = null;
    for (const it of items) {
      const k = dayKey(it.at);
      if (!cur || cur.key !== k) { cur = { key: k, date: it.at, items: [] }; days.push(cur); }
      cur.items.push(it);
    }
    return { items, days };
  }

  /* ---------- the data tree ---------- */

  /* Expanding an item shows what the export actually said, not a summary of
     it. Objects and arrays nest and collapse; everything else prints. This is
     the honest view: if a date looks wrong here, the export is wrong. */
  function treeHtml(value, depth = 0) {
    if (value === null || value === undefined) return `<span class="tv-null">none</span>`;
    if (value instanceof Date) return `<span class="tv-date">${esc(value.toLocaleString())}</span>`;
    if (Array.isArray(value)) {
      if (!value.length) return `<span class="tv-null">empty</span>`;
      return `<details class="tv-node"${depth < 1 ? " open" : ""}>
        <summary>${plural(value.length, "item", "items")}</summary>
        <div class="tv-kids">${value.slice(0, 200).map((v, i) =>
          `<div class="tv-row"><span class="tv-k">${i}</span>${treeHtml(v, depth + 1)}</div>`).join("")}
        ${value.length > 200 ? `<div class="tv-row tv-null">${(value.length - 200).toLocaleString()} more not shown</div>` : ""}</div>
      </details>`;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).filter((k) => typeof value[k] !== "function");
      if (!keys.length) return `<span class="tv-null">empty</span>`;
      return `<details class="tv-node"${depth < 1 ? " open" : ""}>
        <summary>${plural(keys.length, "field", "fields")}</summary>
        <div class="tv-kids">${keys.map((k) =>
          `<div class="tv-row"><span class="tv-k">${esc(k)}</span>${treeHtml(value[k], depth + 1)}</div>`).join("")}</div>
      </details>`;
    }
    if (typeof value === "number") return `<span class="tv-num">${esc(value)}</span>`;
    if (typeof value === "boolean") return `<span class="tv-num">${value ? "yes" : "no"}</span>`;
    const s = String(value);
    return `<span class="tv-s">${esc(s.length > 400 ? s.slice(0, 400) + "..." : s)}</span>`;
  }

  /* What an item is made of, in the export's own terms. */
  function detailsOf(it) {
    if (it.type === "photo" || it.type === "video") {
      const m = it.media;
      return {
        "file name": m.name,
        "path inside the export": m.path,
        "size on disk": m.size,
        "taken": m.at || null,
        "kind": m.kind,
        "format": m.mime || "unknown",
        "came from": it.srcLabel || "this export",
      };
    }
    if (it.type === "place") {
      return {
        "points recorded": it.count,
        "came from": it.srcLabel || "this export",
        "coordinates": it.points.slice(0, 200).map((p) => ({
          latitude: p.lat, longitude: p.lon, at: p.at || null,
        })),
      };
    }
    if (it.type === "event") {
      return { "what": it.title, "kind": it.kind || "activity", "when": it.at, "came from": it.srcLabel || "this export" };
    }
    return null;
  }

  /* ---------- the timeline ---------- */

  const TYPE_LABEL = {
    photo: ["Photo", "Photos"], video: ["Video", "Videos"],
    chat: ["Message", "Messages"], place: ["Location", "Locations"],
    event: ["Activity", "Activities"],
  };
  const typeName = (t, n) => (TYPE_LABEL[t] || [t, t])[n === 1 ? 0 : 1];

  const DAYS_PER_PAGE = 25;

  function renderTimeline(panel, lib, ctx) {
    const q = (ctx && ctx.query) || "";
    let { days, items } = buildStream(lib);

    if (q) {
      days = days
        .map((d) => ({ ...d, items: d.items.filter((it) => matches(it, q)) }))
        .filter((d) => d.items.length);
      items = days.reduce((n, d) => n + d.items.length, 0);
    } else {
      items = items.length;
    }

    if (!days.length) {
      panel.innerHTML = `<p class="muted small">${q
        ? `Nothing in the timeline matches "${esc(q)}".`
        : "Nothing in this export carries a date, so there is no timeline to build. The other views still work."}</p>`;
      return;
    }

    const newest = days[0].date, oldest = days[days.length - 1].date;
    const counts = new Map();
    for (const d of days) for (const it of d.items) counts.set(it.type, (counts.get(it.type) || 0) + 1);

    panel.innerHTML = `
      <div class="tl-head">
        <p class="muted small">
          ${plural(items, "dated item", "dated items")} across
          ${plural(days.length, "day", "days")}, newest first.
          ${esc(fmtDay(oldest))} to ${esc(fmtDay(newest))}.
        </p>
        <div class="tl-legend">
          ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) =>
            `<span class="tl-chip t-${t}"><i></i>${esc(typeName(t, n))} ${n.toLocaleString()}</span>`).join("")}
        </div>
      </div>
      <div class="tl" id="tl"></div>
      <div class="tl-more" id="tl-more"></div>`;

    const tl = panel.querySelector("#tl");
    const more = panel.querySelector("#tl-more");
    let drawn = 0;

    const drawPage = () => {
      const slice = days.slice(drawn, drawn + DAYS_PER_PAGE);
      tl.insertAdjacentHTML("beforeend", slice.map(dayHtml).join(""));
      drawn += slice.length;
      if (drawn >= days.length) {
        more.innerHTML = `<p class="muted small">That is the whole record - back to ${esc(fmtDay(oldest))}.</p>`;
        if (io) io.disconnect();
      } else {
        more.innerHTML = `<button class="btn ghost" id="tl-load">Load earlier (${(days.length - drawn).toLocaleString()} days left)</button>`;
        panel.querySelector("#tl-load").addEventListener("click", drawPage);
      }
    };

    // Scrolling back through years should not need a click every 25 days.
    let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting) && drawn < days.length) drawPage();
      }, { rootMargin: "600px" });
      io.observe(more);
    }
    drawPage();

    tl.addEventListener("click", (e) => {
      const row = e.target.closest(".tl-item");
      if (!row || e.target.closest("a")) return;
      toggleItem(row, days, lib, ctx);
    });
  }

  function matches(it, q) {
    if (String(it.title || "").toLowerCase().includes(q)) return true;
    if (String(it.srcLabel || "").toLowerCase().includes(q)) return true;
    if (it.type === "chat") return it.messages.some((m) => (m.text || "").toLowerCase().includes(q));
    return false;
  }

  function dayHtml(d) {
    const per = new Map();
    for (const it of d.items) per.set(it.type, (per.get(it.type) || 0) + 1);
    return `
      <section class="tl-day">
        <div class="tl-date">
          <h3>${esc(fmtDay(d.date))}</h3>
          <span class="muted small">${[...per.entries()]
            .map(([t, n]) => `${n.toLocaleString()} ${typeName(t, n).toLowerCase()}`).join(", ")}</span>
        </div>
        <div class="tl-items">
          ${d.items.map((it, i) => itemHtml(it, d.key, i)).join("")}
        </div>
      </section>`;
  }

  function itemHtml(it, dk, i) {
    const sub = it.type === "chat"
      ? plural(it.count, "message", "messages")
      : it.type === "place" ? plural(it.count, "point", "points")
      : typeName(it.type, 1);
    return `
      <article class="tl-item t-${it.type}" data-day="${esc(dk)}" data-i="${i}" tabindex="0">
        <span class="tl-time">${esc(fmtTime(it.at))}</span>
        <span class="tl-dot"></span>
        <div class="tl-body">
          <div class="tl-title">${esc(it.title)}</div>
          <div class="tl-sub">
            <span>${esc(sub)}</span>
            ${it.srcLabel ? `<span class="tl-src"><i class="tl-ic" data-icon="${esc(it.srcSlug || "box")}"></i>${esc(it.srcLabel)}</span>` : ""}
          </div>
        </div>
        <span class="tl-chev" aria-hidden="true">+</span>
      </article>`;
  }

  async function toggleItem(row, days, lib, ctx) {
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains("tl-detail");
    if (open) {
      row.nextElementSibling.remove();
      row.classList.remove("is-open");
      row.querySelector(".tl-chev").textContent = "+";
      return;
    }
    const day = days.find((d) => d.key === row.dataset.day);
    const it = day && day.items[Number(row.dataset.i)];
    if (!it) return;

    const box = document.createElement("div");
    box.className = "tl-detail";
    box.innerHTML = `<p class="muted small">Loading...</p>`;
    row.after(box);
    row.classList.add("is-open");
    row.querySelector(".tl-chev").textContent = "-";

    if (it.type === "chat") {
      box.innerHTML = `<div class="tl-msgs">${it.messages.map(msgHtml).join("")}</div>`;
      return;
    }

    let head = "";
    if ((it.type === "photo" || it.type === "video") && ctx && ctx.thumb) {
      const url = await ctx.thumb(it.media);
      head = url
        ? `<div class="tl-preview"><img src="${url}" alt="${esc(it.title)}" loading="lazy"></div>`
        : `<p class="muted small">No preview available for this file. The data below is still exact.</p>`;
    }
    const details = detailsOf(it);
    box.innerHTML = head + (details
      ? `<div class="tv">${treeHtml(details)}</div>`
      : `<p class="muted small">Nothing further recorded for this item.</p>`);
    if (ctx && ctx.hydrate) ctx.hydrate(box);
  }

  function msgHtml(m) {
    return `<div class="msg ${m.direction === "sent" ? "out" : "in"}">
      <div class="mh">${esc(m.from || "")}${m.at ? " - " + esc(fmtTime(m.at)) : ""}</div>
      <div class="mb">${m.text ? esc(m.text) : `<em class="muted">${esc(m.type || "attachment")}</em>`}</div>
    </div>`;
  }

  /* ---------- chats, grouped by person across platforms ---------- */

  /* Someone you talk to on two apps is one person, and their history reads
     better as one thread. Matching is on the normalised display name, which is
     the only signal an export actually gives - there is no shared identifier
     between Snapchat and Instagram. Names that differ between platforms stay
     separate, which is the safe way round: wrongly splitting one person is a
     nuisance, wrongly merging two is a privacy problem. */
  const normName = (s) => String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  /* Automatic matching only ever catches the easy case. Snapchat exports
     usernames and Instagram exports display names, so the same person usually
     arrives as "bjorn_a" and "Bjorn Aasa" and no amount of string cleverness
     should be trusted to join those - guessing wrong merges two people's
     private messages. So the reader says. Links live in memory for the session
     only; nothing about who you talk to is written to disk. */
  const links = new Map(); // person key -> the key it has been merged into

  /* Saying two names are the same person is the reader's own work, and it was
     being thrown away on every reload. It is kept with the rest of what we
     worked out, and travels in the exported work file. */
  function saveLinks() {
    if (typeof MDerived !== "undefined") MDerived.setting("people:links", [...links]);
  }

  async function loadLinks() {
    if (typeof MDerived === "undefined") return;
    const saved = await MDerived.setting("people:links");
    if (Array.isArray(saved)) for (const [a, b] of saved) links.set(a, b);
  }

  function rootKey(k) {
    const seen = new Set();
    while (links.has(k) && !seen.has(k)) { seen.add(k); k = links.get(k); }
    return k;
  }

  function linkPeople(a, b) {
    if (a === b) return;
    links.set(rootKey(a), rootKey(b));
    saveLinks();
  }

  function unlinkPerson(k) {
    links.delete(k);
    for (const [from, to] of [...links]) if (to === k) links.delete(from);
    saveLinks();
  }

  function groupPeople(lib) {
    const people = new Map();
    for (const c of lib.conversations) {
      const key = rootKey(normName(c.title) || "unknown");
      if (!people.has(key)) {
        people.set(key, { name: c.title, key, threads: [], messages: [], platforms: new Map(), names: new Set() });
      }
      const p = people.get(key);
      p.threads.push(c);
      p.names.add(c.title);
      if (c.srcSlug) p.platforms.set(c.srcSlug, c.srcLabel || c.srcSlug);
      for (const m of c.messages) {
        p.messages.push({ ...m, srcSlug: c.srcSlug, srcLabel: c.srcLabel });
      }
    }
    const list = [...people.values()];
    for (const p of list) {
      p.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
      p.last = p.messages.length ? p.messages[p.messages.length - 1].at : null;
    }
    list.sort((a, b) => b.messages.length - a.messages.length);
    return list;
  }

  let linksLoaded = false;

  function renderPeople(panel, lib, ctx) {
    // Links are restored once, then the view is drawn again with them applied.
    if (!linksLoaded) {
      linksLoaded = true;
      loadLinks().then(() => { if (links.size) renderPeople(panel, lib, ctx); });
    }
    const q = (ctx && ctx.query) || "";
    let people = groupPeople(lib);

    if (q) {
      people = people
        .map((p) => {
          if (normName(p.name).includes(normName(q))) return p;
          const hits = p.messages.filter((m) => (m.text || "").toLowerCase().includes(q));
          return hits.length ? { ...p, messages: hits, hitCount: hits.length } : null;
        })
        .filter(Boolean);
    }

    if (!people.length) {
      panel.innerHTML = q
        ? `<div class="ex-empty"><h3>No conversations match "${esc(q)}"</h3></div>`
        : (ctx && ctx.filtered)
          ? `<div class="ex-empty"><h3>No messages in what you are looking at</h3>
             <p class="muted">The filters are hiding the rest. There may well be messages in
             the export outside them.</p>
             <button class="btn secondary sm" id="ex-clearall">Clear the filters</button></div>`
          : `<div class="ex-empty"><h3>No messages in this export</h3>
             <p class="muted">Either it has no chat history, or the part that holds it was not
             included in the request - some services put messages behind a separate
             tick-box.</p></div>`;
      const cb = panel.querySelector("#ex-clearall");
      if (cb && ctx && ctx.clearFilters) cb.addEventListener("click", ctx.clearFilters);
      return;
    }

    const multi = people.filter((p) => p.platforms.size > 1).length;
    panel.innerHTML = `
      <p class="muted small">
        ${plural(people.length, "person", "people")}${q ? ` matching "${esc(q)}"` : ""}.
        ${multi ? `${plural(multi, "person appears", "people appear")} on more than one platform.` : ""}
        Exports do not share an identifier between platforms - Snapchat gives usernames and
        Instagram gives display names - so only identical names are joined automatically.
        Open anyone and use "Same person as" to join the rest yourself.
      </p>
      <div class="chatapp">
        <div class="ca-list" role="tablist">
          ${people.map((p, i) => `
            <button class="ca-person${i ? "" : " on"}" data-i="${i}" role="tab">
              <span class="ca-av">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</span>
              <span class="ca-meta">
                <span class="ca-name">${esc(p.name)}</span>
                <span class="ca-sub">
                  ${[...p.platforms.keys()].map((s) => `<i class="ca-ic" data-icon="${esc(s)}" title="${esc(p.platforms.get(s))}"></i>`).join("")}
                  ${p.hitCount ? `${p.hitCount.toLocaleString()} matching` : plural(p.messages.length, "message", "messages")}
                </span>
              </span>
            </button>`).join("")}
        </div>
        <div class="ca-thread" id="ca-thread"></div>
      </div>`;

    const thread = panel.querySelector("#ca-thread");
    const draw = (i) => {
      const p = people[i];
      const msgs = p.messages.slice(-500);
      const platforms = [...p.platforms.entries()];
      const others = people.filter((o) => o.key !== p.key);
      thread.innerHTML = `
        <header class="ca-head">
          <div class="ca-htop">
            <h3>${esc(p.name)}</h3>
            ${others.length ? `<label class="ca-link">Same person as
              <select id="ca-link">
                <option value="">choose...</option>
                ${others.map((o) => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join("")}
              </select></label>` : ""}
          </div>
          <div class="ca-hbot">
            <div class="ca-plats">
              ${platforms.map(([s, l]) => `<span class="ca-plat"><i data-icon="${esc(s)}"></i>${esc(l)}</span>`).join("")}
              ${p.names.size > 1 ? `<button class="ca-unlink" id="ca-unlink" type="button">Separate again</button>` : ""}
            </div>
            <p class="muted small">
              ${plural(p.messages.length, "message", "messages")}
              ${platforms.length > 1
                ? `across ${platforms.map(([, l]) => esc(l)).join(" and ")}, shown together`
                : platforms.length ? `on ${esc(platforms[0][1])}` : ""}
              ${p.messages.length > msgs.length ? ` - showing the most recent ${msgs.length}` : ""}
            </p>
          </div>
        </header>
        ${p.names.size > 1 ? `<p class="ca-known muted small">Known as
          ${[...p.names].map((n) => `<strong>${esc(n)}</strong>`).join(" and ")},
          shown as one person.</p>` : ""}
        <div class="ca-msgs">
          ${msgs.length ? msgs.map((m, j) => {
            const prev = msgs[j - 1];
            const newDay = m.at && (!prev || !prev.at || dayKey(prev.at) !== dayKey(m.at));
            return (newDay ? `<div class="ca-daysep">${esc(fmtDay(m.at))}</div>` : "") +
              `<div class="msg ${m.direction === "sent" ? "out" : "in"}">
                 <div class="mh">
                   ${platforms.length > 1 && m.srcSlug ? `<i class="ca-ic" data-icon="${esc(m.srcSlug)}" title="${esc(m.srcLabel || "")}"></i>` : ""}
                   ${esc(m.from || "")}${m.at ? " - " + esc(fmtTime(m.at)) : ""}
                 </div>
                 <div class="mb">${m.text ? esc(m.text) : `<em class="muted">${esc(m.type || "attachment")}</em>`}</div>
               </div>`;
          }).join("") : `<p class="muted small">No messages.</p>`}
        </div>`;
      if (ctx && ctx.hydrate) ctx.hydrate(thread);
      const box = thread.querySelector(".ca-msgs");
      if (box) box.scrollTop = box.scrollHeight;

      const sel = thread.querySelector("#ca-link");
      if (sel) sel.addEventListener("change", () => {
        if (!sel.value) return;
        linkPeople(p.key, sel.value);
        renderPeople(panel, lib, ctx);
      });
      const un = thread.querySelector("#ca-unlink");
      if (un) un.addEventListener("click", () => {
        unlinkPerson(p.key);
        renderPeople(panel, lib, ctx);
      });
    };

    draw(0);
    panel.querySelectorAll(".ca-person").forEach((b) =>
      b.addEventListener("click", () => {
        panel.querySelectorAll(".ca-person").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        draw(Number(b.dataset.i));
      })
    );
    if (ctx && ctx.hydrate) ctx.hydrate(panel);
  }

  /* ---------- map ---------- */

  /* Plotted from the coordinates in the export, with no basemap and no tile
     requests. Asking a map server for tiles would hand your movements to a
     third party, which is the one thing this product promises not to do. */
  function renderMap(panel, lib, ctx) {
    const pts = lib.places.filter((p) => isFinite(p.lat) && isFinite(p.lon));
    if (!pts.length) {
      panel.innerHTML = (ctx && ctx.filtered)
        ? `<div class="ex-empty"><h3>No places in what you are looking at</h3>
           <p class="muted">The filters are hiding the rest.</p>
           <button class="btn secondary sm" id="ex-clearall">Clear the filters</button></div>`
        : `<div class="ex-empty"><h3>No places recorded</h3>
           <p class="muted">Nothing here carries coordinates. Location usually arrives either as
           its own history file, or inside the photos themselves - and a service that strips
           location on export leaves neither.</p></div>`;
      const cb = panel.querySelector("#ex-clearall");
      if (cb && ctx && ctx.clearFilters) cb.addEventListener("click", ctx.clearFilters);
      return;
    }

    const W = 1000, H = 500;
    const dated = pts.filter((p) => p.at);
    const years = [...new Set(dated.map((p) => p.at.getFullYear()))].sort();

    panel.innerHTML = `
      <div class="map-head">
        <p class="muted small">
          ${plural(pts.length, "recorded location", "recorded locations")}${dated.length < pts.length
            ? `, ${(pts.length - dated.length).toLocaleString()} without a date` : ""}.
          Drawn from the coordinates in your export. The coastline ships with the page,
          so no map service is contacted and nothing about where you have been leaves
          this device.
        </p>
        <button class="btn secondary sm" id="map-reset" type="button">Fit to my places</button>
        ${years.length > 1 ? `<label class="map-years">Year
          <select id="map-year">
            <option value="">all</option>
            ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
          </select></label>` : ""}
      </div>
      <div class="mapwrap">
        <svg class="scatter" id="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="map-tip" id="map-tip" hidden></div>
      </div>
      <div class="map-foot muted small" id="map-foot"></div>`;

    const svg = panel.querySelector("#map-svg");
    const tip = panel.querySelector("#map-tip");
    const foot = panel.querySelector("#map-foot");
    // The binned points of whatever is currently drawn, so the framing code
    // can re-fit to the year in view rather than to the whole export.
    let lastBins = [];

    const draw = (year) => {
      const use = year ? dated.filter((p) => p.at.getFullYear() === Number(year)) : pts;
      // Bin to the pixel grid so a million points stay one DOM node each at most.
      const bins = new Map();
      for (const p of use) {
        const x = ((p.lon + 180) / 360) * W;
        const y = ((90 - p.lat) / 180) * H;
        const k = `${Math.round(x)}|${Math.round(y)}`;
        if (!bins.has(k)) bins.set(k, { x, y, n: 0, lat: p.lat, lon: p.lon, at: p.at });
        bins.get(k).n++;
      }
      const list = [...bins.values()];
      lastBins = list;
      const max = Math.max(...list.map((b) => b.n));
      const bm = global.MBasemap;
      svg.innerHTML = `
        <defs>
          <filter id="mm-lift" x="-2%" y="-2%" width="104%" height="104%">
            <feDropShadow dx="0" dy="0.6" stdDeviation="0.9"
              flood-color="#39506b" flood-opacity="0.30"/>
          </filter>
        </defs>
        <rect x="0" y="0" width="${W}" height="${H}" class="mm-sea"/>
        ${[...Array(7)].map((_, i) => `<line x1="0" y1="${(i * H) / 6}" x2="${W}" y2="${(i * H) / 6}" class="sc-grid"/>`).join("")}
        ${[...Array(13)].map((_, i) => `<line x1="${(i * W) / 12}" y1="0" x2="${(i * W) / 12}" y2="${H}" class="sc-grid"/>`).join("")}
        ${bm ? `<path d="${bm.path}" class="mm-land" filter="url(#mm-lift)"/>` : ""}
        <g class="sc-dots">
          ${list.map((b) => `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}"
             style="--r:${(2 + 4 * Math.sqrt(b.n / max)).toFixed(2)}"
             data-n="${b.n}" data-lat="${b.lat.toFixed(4)}" data-lon="${b.lon.toFixed(4)}"/>`).join("")}
        </g>`;
      foot.textContent = `${plural(list.length, "distinct spot", "distinct spots")} from ` +
        `${plural(use.length, "point", "points")}${year ? ` in ${year}` : ""}. ` +
        `Bigger circles mean more points recorded there.`;
    };

    /* ---------- framing, zoom and pan ----------

       The map used to open on the whole world every time, so somebody whose
       life happened in one country got a continent-sized picture of empty
       ocean with a smudge on it. It now opens on what they actually visited.

       The view is a viewBox over the same 1000x500 equirectangular projection
       the coastline is baked into, so panning and zooming are arithmetic on
       four numbers - no tiles, no requests, nothing about where you have been
       leaving the machine. Scale stays uniform, so nothing is distorted. */

    // World is 1000 wide; a fully zoomed-out view is the whole thing, and we
    // let them go there and no further. In is capped well before floating
    // point gets interesting.
    const MIN_SPAN = 1.5, MAX_SPAN = W;
    let view = null;

    function aspect() {
      const r = svg.getBoundingClientRect();
      return r.width && r.height ? r.width / r.height : W / H;
    }

    /* Frame the points so they occupy about 80% of the view, leaving a margin
       rather than putting the outermost dots hard on the edge. */
    function fitTo(list) {
      const a = aspect();
      if (!list.length) { view = { x: 0, y: 0, w: W, h: W / a }; return clampView(); }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const b of list) {
        if (b.x < x0) x0 = b.x; if (b.x > x1) x1 = b.x;
        if (b.y < y0) y0 = b.y; if (b.y > y1) y1 = b.y;
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // /0.8 turns the span of the points into the span of the view.
      let w = Math.max((x1 - x0) / 0.8, ((y1 - y0) / 0.8) * a, MIN_SPAN * 8);
      w = Math.min(w, MAX_SPAN);
      view = { x: cx - w / 2, y: cy - w / a / 2, w, h: w / a };
      clampView();
    }

    /* Keep the world in frame. Without this you can drag the map off into grey
       and have nothing to navigate back by. */
    function clampView() {
      const a = aspect();
      view.w = Math.min(MAX_SPAN, Math.max(MIN_SPAN, view.w));
      view.h = view.w / a;
      if (view.w >= W) view.x = (W - view.w) / 2;
      else view.x = Math.min(W - view.w, Math.max(0, view.x));
      if (view.h >= H) view.y = (H - view.h) / 2;
      else view.y = Math.min(H - view.h, Math.max(0, view.y));
      apply();
    }

    function apply() {
      svg.setAttribute("viewBox",
        `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`);
      // Dots and coastline are drawn in world units, so they would balloon as
      // the view narrows. Counter-scale them to hold a steady screen size.
      svg.style.setProperty("--z", (view.w / W).toFixed(4));
    }

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      // Zoom about the pointer, so the place under the cursor stays put.
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const at = { x: view.x + fx * view.w, y: view.y + fy * view.h };
      const k = Math.exp(e.deltaY * 0.0015);
      const w = Math.min(MAX_SPAN, Math.max(MIN_SPAN, view.w * k));
      view.x = at.x - fx * w;
      view.y = at.y - fy * (w / aspect());
      view.w = w;
      clampView();
    }, { passive: false });

    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("grabbing");
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      view.x = drag.vx - ((e.clientX - drag.x) / r.width) * view.w;
      view.y = drag.vy - ((e.clientY - drag.y) / r.height) * view.h;
      clampView();
    });
    const endDrag = (e) => {
      if (!drag) return;
      drag = null;
      svg.classList.remove("grabbing");
      if (e && e.pointerId != null && svg.hasPointerCapture(e.pointerId)) {
        svg.releasePointerCapture(e.pointerId);
      }
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener("dblclick", () => fitTo(lastBins));

    const reset = panel.querySelector("#map-reset");
    if (reset) reset.addEventListener("click", () => fitTo(lastBins));

    // Re-fitting on resize would fight anyone who has zoomed in; only the
    // aspect correction is needed, so the frame stays where they put it.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => { if (view) clampView(); }).observe(svg);
    }

    svg.addEventListener("mousemove", (e) => {
      const c = e.target.closest("circle");
      if (!c || drag) { tip.hidden = true; return; }
      const r = panel.querySelector(".mapwrap").getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${e.clientX - r.left}px`;
      tip.style.top = `${e.clientY - r.top}px`;
      tip.textContent = `${c.dataset.lat}, ${c.dataset.lon} - ${plural(Number(c.dataset.n), "point", "points")}`;
    });
    svg.addEventListener("mouseleave", () => { tip.hidden = true; });

    const sel = panel.querySelector("#map-year");
    if (sel) sel.addEventListener("change", () => { draw(sel.value); fitTo(lastBins); });
    draw("");
    fitTo(lastBins);
  }

  global.MViews = { buildStream, renderTimeline, renderPeople, renderMap, treeHtml,
    groupPeople, linkPeople, unlinkPerson, loadLinks };
})(window);
