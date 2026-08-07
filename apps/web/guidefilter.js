"use strict";

/* Narrowing thirty guides down to the one you came for.
 *
 * Every guide is already on the page and already indexed; this only hides
 * things. That is deliberate and it is why the markup is real rather than
 * built here: with the script off, every filter is an inert select and every
 * guide is visible, which is the right way for a directory to fail.
 *
 * Four questions, because they are the four somebody arrives already knowing
 * the answer to - which service, how hard, how long, or a word from the title.
 */

(function () {
  const root = document.querySelector(".gd-wrap");
  if (!root) return;

  const kind = document.getElementById("gd-kind");
  const service = document.getElementById("gd-service");
  const difficulty = document.getElementById("gd-difficulty");
  const time = document.getElementById("gd-time");
  const query = document.getElementById("gd-q");
  const none = document.getElementById("gd-none");
  const clear = document.getElementById("gd-clear");
  if (!kind || !service || !difficulty || !time || !query) return;

  const cards = [...root.querySelectorAll("[data-kind]")];
  const sections = [...root.querySelectorAll(".gd-sec")];

  function apply() {
    const k = kind.value, s = service.value, d = difficulty.value, t = time.value;
    const q = query.value.trim().toLowerCase();
    let shown = 0;

    for (const el of cards) {
      /* A whole job carries no difficulty of its own, so asking for "easy"
         should not silently hide every job on the page - it is a filter about
         services, and a job is not one. Same for a service filter against a
         job that spans several. */
      const ok =
        (!k || el.dataset.kind === k) &&
        (!s || el.dataset.service === s || el.dataset.kind === "job") &&
        (!d || el.dataset.difficulty === d || !el.dataset.difficulty) &&
        (!t || el.dataset.time === t) &&
        (!q || (el.dataset.text || "").indexOf(q) >= 0);
      el.hidden = !ok;
      if (ok) shown++;
    }

    /* A heading over nothing is worse than no heading. */
    for (const sec of sections) {
      const any = [...sec.querySelectorAll("[data-kind]")].some((el) => !el.hidden);
      sec.hidden = !any;
    }
    if (none) none.hidden = shown > 0;
  }

  for (const el of [kind, service, difficulty, time]) el.addEventListener("change", apply);
  query.addEventListener("input", apply);
  if (clear) {
    clear.addEventListener("click", () => {
      kind.value = service.value = difficulty.value = time.value = "";
      query.value = "";
      apply();
    });
  }

  /* A word in the address goes straight into the search, so a link can point
     at "the Apple one" without needing a page of its own. */
  const at = location.hash.replace(/^#q=/, "");
  if (at && at !== location.hash) {
    query.value = decodeURIComponent(at);
    apply();
  }
})();
