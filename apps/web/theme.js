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
      if (el.getAttribute("href") !== t.css) el.setAttribute("href", t.css);
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

  /* The picker, as markup. The caller decides where it lives - this file has
     no opinion about the sidebar and should not gain one. */
  function pickerHtml() {
    const now = current();
    return '<div class="th-pick" role="group" aria-label="Theme">' +
      '<span class="th-label">Theme</span>' +
      '<div class="th-opts">' +
      THEMES.map((t) =>
        '<button type="button" class="th-opt' + (t.id === now ? " on" : "") + '"' +
        ' data-theme-id="' + t.id + '" title="' + t.note + '"' +
        ' aria-pressed="' + (t.id === now ? "true" : "false") + '">' +
        t.name + "</button>").join("") +
      "</div></div>";
  }

  /* One listener on the document, because the sidebar is rebuilt wholesale
     every time the library changes and a listener bound to a button would be
     gone by the time anybody clicked it. */
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-theme-id]");
    if (!b) return;
    const id = set(b.getAttribute("data-theme-id"));
    for (const el of document.querySelectorAll("[data-theme-id]")) {
      const on = el.getAttribute("data-theme-id") === id;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }
  });

  init();
  return { THEMES, set, current, pickerHtml, init };
})();
