"use strict";

/* Muletto - themes.

   A theme is one stylesheet and one line in the list below. Nothing else knows
   any theme exists: the picker is built from this list, the choice is a string
   in localStorage, and switching swaps the href on a single <link>. Adding one
   is adding a file; removing one is deleting a file and a line.

   The default is not a file. It is the stylesheet the site already has, so it
   cannot drift from what everything else was designed against, and a theme
   that fails to load leaves the product looking exactly as it always did
   rather than unstyled.

   Themes override custom properties rather than rules wherever they can. A
   theme that restates layout will fight every future change to it. */

const MTheme = (function () {

  const THEMES = [
    { id: "default", name: "Original", note: "Paper white, greyscale.", css: null },
    { id: "kossi", name: "Kossi", note: "Dark, grain and gradient.",
      css: "themes/kossi.css" },
  ];

  const KEY = "muletto:theme";
  const LINK_ID = "theme-css";

  /* Where this script is, so the stylesheet beside it can be found from any
     depth. The href used to be the bare "themes/kossi.css", which resolves
     against the page rather than against this file - so it worked at the root
     and asked for /guides/themes/kossi.css on every guide, got a 404, and the
     guides stayed light while everything said the theme was on. A failed
     stylesheet still appears in document.styleSheets with its href, so it
     even looked loaded. */
  const BASE = (function () {
    const me = document.currentScript && document.currentScript.src;
    if (!me) return "";
    return me.slice(0, me.lastIndexOf("/") + 1);
  })();

  const byId = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

  function stored() {
    try { return localStorage.getItem(KEY) || "default"; } catch (e) { return "default"; }
  }

  /* The href is set on a link that already exists in the page when possible.
     Creating one on first use works too, but a link written into the HTML can
     start fetching before this script runs, which is the difference between a
     theme appearing and a theme arriving. */
  function linkEl() {
    let el = document.getElementById(LINK_ID);
    if (!el) {
      el = document.createElement("link");
      el.id = LINK_ID;
      el.rel = "stylesheet";
      document.head.appendChild(el);
    }
    return el;
  }

  function apply(id) {
    const t = byId(id);
    const el = linkEl();
    if (t.css) {
      const href = BASE + t.css;
      if (el.getAttribute("href") !== href) el.setAttribute("href", href);
    } else {
      /* Removed rather than blanked. An empty href resolves to the page
         itself, so the browser fetches the HTML and tries to parse it as CSS. */
      el.removeAttribute("href");
    }
    /* On the root as well, so a theme can hang rules off it without relying on
       load order, and so anything that needs to know can ask the DOM. */
    document.documentElement.setAttribute("data-theme", t.id);
    return t.id;
  }

  function set(id) {
    const chosen = apply(byId(id).id);
    try { localStorage.setItem(KEY, chosen); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent("muletto:theme", { detail: { id: chosen } }));
    return chosen;
  }

  function current() { return byId(stored()).id; }

  /* Called as early as the page can manage, before paint where possible, so a
     dark theme does not begin as a white flash. */
  function init() { apply(stored()); }

  /* A button with an icon, and a list that opens from it.
   *
   * A native select was the right first move - free keyboard handling, free
   * touch handling, an accessible name for nothing - but it paints itself
   * from the operating system and cannot be made to match a theme, which is
   * a strange thing for the control that picks the theme. So it is built
   * here, and everything the native one gave away has to be given back by
   * hand: it is a real button, the list is a real menu, arrow keys and Escape
   * work, and the open state is announced. */
  const SWATCH = {
    default: "linear-gradient(135deg,#ffffff 0 50%,#e0e0e0 50% 100%)",
    kossi: "linear-gradient(135deg,#b06cf0 0 50%,#0a0710 50% 100%)",
  };

  function pickerEl() {
    const wrap = document.createElement("div");
    wrap.className = "th-pick";
    wrap.innerHTML =
      '<button type="button" class="th-btn" aria-haspopup="true" aria-expanded="false" ' +
      'aria-label="Theme" title="Theme">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" ' +
        'stroke="none"/></svg>' +
      "</button>" +
      '<div class="th-menu" hidden role="menu">' +
        THEMES.map((t) =>
          '<button type="button" role="menuitemradio" class="th-opt" data-theme-id="' + t.id + '">' +
          '<i class="th-sw" style="background:' + (SWATCH[t.id] || "currentColor") + '"></i>' +
          "<span><b>" + t.name + "</b><em>" + t.note + "</em></span></button>").join("") +
        /* Said inside the menu rather than beside the button, because it is
           only worth reading at the moment somebody is about to pick one. */
        '<p class="th-wip">' + wipText() + "</p>" +
      "</div>";
    return wrap;
  }

  /* The themes are unfinished and the picker says so. Norwegian where the
     page is Norwegian - read off the document rather than passed in, because
     this script is shared by both trees and has no build step of its own. */
  function wipText() {
    return document.documentElement.lang === "nb"
      ? "Temaene er under arbeid. Regn med ujevne kanter."
      : "Themes are a work in progress. Expect rough edges.";
  }

  function mount() {
    const feet = document.querySelectorAll("footer");
    const foot = feet.length ? feet[feet.length - 1] : null;
    if (!foot) return;
    /* Into the tool group beside the language picker where the page has one,
       so the two sit together. Older pages have no group, and the footer wrap
       is the same place this used to go. */
    const host = foot.querySelector(".foot-tools") || foot.querySelector(".wrap") || foot;
    if (host.querySelector(".th-pick:not(.lang-pick)")) return;
    host.appendChild(pickerEl());
    sync();
  }

  /* Every picker on the page agrees with the stored choice. */
  function sync() {
    const id = current();
    for (const b of document.querySelectorAll("[data-theme-id]")) {
      const on = b.getAttribute("data-theme-id") === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  const closeAll = () => {
    for (const m of document.querySelectorAll(".th-menu")) m.hidden = true;
    for (const b of document.querySelectorAll(".th-btn")) b.setAttribute("aria-expanded", "false");
  };

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest && ev.target.closest(".th-btn, [data-theme-id]");
    if (!t) { closeAll(); return; }
    if (t.classList.contains("th-btn")) {
      const menu = t.parentNode.querySelector(".th-menu");
      const open = menu.hidden;
      closeAll();
      menu.hidden = !open;
      t.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { const f = menu.querySelector(".th-opt.on") || menu.querySelector(".th-opt"); if (f) f.focus(); }
      return;
    }
    set(t.getAttribute("data-theme-id"));
    sync();
    closeAll();
    const btn = t.closest(".th-pick") && t.closest(".th-pick").querySelector(".th-btn");
    if (btn) btn.focus();
  });

  /* Escape shuts it, arrows move within it. A menu that traps nothing and
     responds to nothing is a div pretending to be a control. */
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { closeAll(); return; }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const here = ev.target.closest && ev.target.closest(".th-menu");
    if (!here) return;
    ev.preventDefault();
    const all = [...here.querySelectorAll(".th-opt")];
    const i = all.indexOf(document.activeElement);
    const next = ev.key === "ArrowDown" ? i + 1 : i - 1;
    (all[(next + all.length) % all.length] || all[0]).focus();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else mount();

  init();
  return { THEMES, set, current, mount, init, sync };
})();
