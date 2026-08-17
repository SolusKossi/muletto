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

  /* A select, not a row of buttons.
   *
   * It lives in the site footer so it is reachable from any page and from any
   * scroll position, and a footer is not the place for a widget that grows a
   * button every time a theme is added. A native select also gets keyboard
   * handling, touch handling and an accessible name for nothing. */
  function pickerEl() {
    const wrap = document.createElement("label");
    wrap.className = "th-pick";
    const now = current();
    wrap.innerHTML = '<span class="th-label">Theme</span>' +
      '<select class="th-sel" aria-label="Theme">' +
      THEMES.map((t) =>
        '<option value="' + t.id + '"' + (t.id === now ? " selected" : "") + '>' +
        t.name + "</option>").join("") + "</select>";
    return wrap;
  }

  /* Mounted into whatever footer the page has. Pages without one - the app
     shell while an export is open - simply do not get it, which is why this
     asks rather than assumes. */
  /* The last footer on the page, whatever it is called.
   *
   * This asked for footer.site and the home page uses footer.g-foot, so the
   * picker simply never appeared there - and nothing said so, because a
   * missing element is indistinguishable from a page that has no footer. The
   * last one is taken because a page with two has the site footer last. */
  function mount() {
    const feet = document.querySelectorAll("footer");
    const foot = feet.length ? feet[feet.length - 1] : null;
    if (!foot) return;
    const host = foot.querySelector(".wrap") || foot;
    if (host.querySelector(".th-pick")) return;
    host.appendChild(pickerEl());
  }

  /* One listener, on the document, so a footer written after this ran is still
     wired and nothing has to be re-bound when a view is redrawn. */
  document.addEventListener("change", (ev) => {
    const sel = ev.target.closest && ev.target.closest(".th-sel");
    if (!sel) return;
    const id = set(sel.value);
    for (const el of document.querySelectorAll(".th-sel")) el.value = id;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else mount();

  init();
  return { THEMES, set, current, mount, init };
})();
