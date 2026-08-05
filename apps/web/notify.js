"use strict";

/* Muletto - one place where the app talks back.

   Progress used to be written into whichever status element happened to be
   near the button that started the work, which meant a line of text appearing
   somewhere off to the side of what you were looking at. If you had scrolled,
   you never saw it at all.

   Everything now surfaces in the same corner, and stays in a list you can open
   afterwards. That matters more here than in most apps: this one does slow
   work in the background - reading archives, comparing photos, writing files -
   and "did that actually do anything?" should never be a question the
   interface leaves you asking.

   A notice can carry a `goto`, which makes it clickable and takes you to
   whatever it is about. */

const MNotify = (function () {
  const q = (sel) => document.querySelector(sel);
  const MAX_TOASTS = 2;
  let hidden = 0, moreTimer = null;
  let hub = null;
  const MAX = 60;
  const items = [];
  let seq = 0;
  let root = null;

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const ICONS = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    work: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.6 2.6L16 9.6"/>',
    warn: '<path d="M12 4.5 3 19.5h18Z"/><path d="M12 10v4M12 17h.01"/>',
  };

  function icon(kind) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[kind] || ICONS.info) + "</svg>";
  }

  function mount() {
    if (root) return root;

    /* The bell belongs in the navigation, beside everything else that is a
       control. It sat in the bottom right corner, where it read as a support
       widget of the sort that opens a chat box. The toasts stay in the corner,
       because a message that appears on its own should not shove the page. */
    root = document.createElement("div");
    root.id = "notify";
    root.innerHTML = '<div class="nt-toasts" id="nt-toasts" aria-live="polite"></div>';
    document.body.appendChild(root);

    hub = document.createElement("div");
    hub.className = "nt-hub";
    hub.innerHTML =
      '<button class="nt-bell" id="nt-bell" type="button" aria-label="Notifications">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5"/>' +
        '<path d="M10.5 19a1.8 1.8 0 0 0 3 0"/></svg>' +
        '<span class="nt-dot" id="nt-dot" hidden></span>' +
      "</button>" +
      '<div class="nt-panel" id="nt-panel" hidden>' +
        '<header><strong>Notifications</strong>' +
        '<button class="nt-clear" id="nt-clear" type="button">Clear</button></header>' +
        '<div class="nt-list" id="nt-list"></div>' +
      "</div>";
    park();

    q("#nt-bell").addEventListener("click", () => {
      const panel = q("#nt-panel");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        q("#nt-dot").hidden = true;
        drawList();
        place();
      }
    });
    addEventListener("resize", () => { if (!q("#nt-panel").hidden) place(); });
    q("#nt-clear").addEventListener("click", () => {
      items.length = 0;
      drawList();
    });
    document.addEventListener("click", (e) => {
      if (!hub.contains(e.target)) q("#nt-panel").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") q("#nt-panel").hidden = true;
    });
    return root;
  }

  /* Under the bell, and never off the edge. The panel is fixed rather than
     absolute so a scrolled page cannot carry it away, which means its position
     has to be worked out each time it opens. */
  /* Where the bell lives depends on which chrome is on screen.

     The explorer replaces the page entirely - there is no navigation bar
     inside it - so a bell mounted into .nav-right vanished the moment a
     library was opened, which is exactly when the notices start arriving. It
     is re-parked whenever the surroundings change, and falls back to the
     corner if there is nothing to park it in. */
  function park() {
    /* The bell used to exist only once something had been pushed, because
       `mount` was reached solely through `push` and `task`. So a library
       opened quietly - or reopened from storage - had no bell at all, and the
       notices already in the list had nowhere to be read from. Building it on
       demand is safe: `mount` returns early if it has already run. */
    if (!hub) { mount(); if (!hub) return; }
    const slot = document.querySelector("#ex-bell") ||
                 document.querySelector(".nav .nav-right");
    if (slot && hub.parentNode !== slot) {
      hub.classList.remove("nt-hub-loose");
      slot.insertBefore(hub, slot.firstChild);
    } else if (!slot && hub.parentNode !== root) {
      hub.classList.add("nt-hub-loose");
      root.appendChild(hub);
    }
  }

  function place() {
    const panel = q("#nt-panel"), bell = q("#nt-bell");
    if (!panel || !bell) return;
    const b = bell.getBoundingClientRect();
    const w = panel.offsetWidth;
    const margin = 12;
    // clientWidth, not innerWidth: innerWidth counts the scrollbar and the
    // panel ended up ten pixels further right than the sum said it would.
    const vw = document.documentElement.clientWidth;
    // Right-aligned with the bell, pushed back in if that hangs off the left.
    let right = Math.max(margin, vw - b.right);
    right = Math.min(right, Math.max(margin, vw - w - margin));
    panel.style.top = Math.round(b.bottom + 8) + "px";
    panel.style.right = Math.round(right) + "px";
  }

  function drawList() {
    const list = q("#nt-list");
    if (!items.length) {
      list.innerHTML = '<p class="nt-empty">Nothing yet. Anything Muletto does will show up here.</p>';
      return;
    }
    list.innerHTML = items.map((n) =>
      '<button class="nt-item' + (n.goto ? " go" : "") + '" data-id="' + n.id + '"' +
        (n.goto ? "" : " disabled") + '>' +
        '<span class="nt-ic k-' + n.kind + '">' + icon(n.kind) + "</span>" +
        "<span><b>" + esc(n.title) + "</b>" +
        (n.body ? "<em>" + esc(n.body) + "</em>" : "") +
        (n.goto && n.action ? '<span class="nt-golink">' + esc(n.action) + "</span>" : "") +
        '<time>' + n.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) + "</time>" +
        "</span></button>").join("");
    list.querySelectorAll(".nt-item.go").forEach((b) => {
      b.addEventListener("click", () => {
        const n = items.find((x) => String(x.id) === b.dataset.id);
        q("#nt-panel").hidden = true;
        if (n && n.goto) n.goto();
      });
    });
  }

  /* A notice that will not change. Returns its id. */
  function push(title, opts) {
    mount();
    park();
    const o = opts || {};
    const n = {
      id: ++seq, title, body: o.body || "", kind: o.kind || "info",
      at: new Date(), goto: o.goto || null, sticky: !!o.sticky,
      action: o.action || null,     // the label on the button, if it has one
    };
    items.unshift(n);
    if (items.length > MAX) items.length = MAX;
    if (q("#nt-panel").hidden) q("#nt-dot").hidden = false;
    else drawList();
    toast(n);
    return n.id;
  }

  function toast(n) {
    const box = root.querySelector("#nt-toasts");
    const el = document.createElement("div");
    el.className = "nt-toast k-" + n.kind + (n.goto ? " go" : "");
    el.dataset.id = n.id;
    /* A notice that leads somewhere says so with a button. Making the whole
       toast clickable and hoping people try it is not telling them. */
    el.innerHTML = '<span class="nt-ic k-' + n.kind + '">' + icon(n.kind) + "</span>" +
      "<span><b>" + esc(n.title) + "</b>" + (n.body ? "<em>" + esc(n.body) + "</em>" : "") +
      (n.goto && n.action ? '<button class="nt-go">' + esc(n.action) + ' <span class="arrow">-&gt;</span></button>' : "") + "</span>" +
      '<button class="nt-x" aria-label="Dismiss">&times;</button>';
    box.appendChild(el);

    /* At most two on screen at once.

       Opening eighteen archives pushes a notice per archive, and they filled
       the window from top to bottom - the thing being reported about was
       completely hidden behind the reports of it. The rest are not lost: they
       are in the panel behind the bell, which is what it is for. */
    // Ones already fading out do not count; they are on their way off screen.
    const shown = [...box.querySelectorAll(".nt-toast:not(.out)")];
    const over = shown.length - MAX_TOASTS;
    for (let i = 0; i < over; i++) drop(shown[i]);
    if (over > 0) {
      let more = box.querySelector(".nt-more");
      if (!more) {
        more = document.createElement("button");
        more.className = "nt-more";
        box.insertBefore(more, box.firstChild);
        more.addEventListener("click", () => {
          q("#nt-panel").hidden = false;
          q("#nt-dot").hidden = true;
          drawList();
          place();
          more.remove();
        });
      }
      hidden += over;
      more.textContent = hidden + (hidden === 1 ? " more notice" : " more notices");
      clearTimeout(moreTimer);
      moreTimer = setTimeout(() => { hidden = 0; if (more) more.remove(); }, 8000);
    }

    el.querySelector(".nt-x").addEventListener("click", (e) => { e.stopPropagation(); drop(el); });
    if (n.goto) el.addEventListener("click", () => { n.goto(); drop(el); });
    if (!n.sticky) setTimeout(() => drop(el), 6500);
    return el;
  }

  function drop(el) {
    if (!el || !el.isConnected) return;
    el.classList.add("out");
    setTimeout(() => el.remove(), 240);
  }

  /* Work that runs for a while. The returned handle updates one toast in place
     rather than stacking a new one for every step. */
  function task(title) {
    mount();
    const n = { id: ++seq, title, body: "", kind: "work", at: new Date(), goto: null, sticky: true };
    const el = toast(n);
    return {
      say(body) {
        n.body = body;
        const em = el.querySelector("em");
        if (em) em.textContent = body;
        else el.querySelector("span:nth-child(2)").insertAdjacentHTML("beforeend", "<em>" + esc(body) + "</em>");
      },
      done(doneTitle, opts) {
        drop(el);
        return push(doneTitle, Object.assign({ kind: "done" }, opts || {}));
      },
      failed(msg) {
        drop(el);
        return push(msg, { kind: "warn" });
      },
    };
  }

  return { push, task, mount, park };
})();
