"use strict";

/* Muletto - the panel for sorting a library by describing what you want.

   Three screens, and the middle one is the reason this exists: you write a
   sentence, you are shown exactly what it would do, and only then does anything
   change. Every bucket carries its count, six sample thumbnails and the rule in
   plain English, so a misread word is visible before it costs anything rather
   than after.

   Nothing here deletes. "Leave out" means excluded from the copy you export;
   the archives are opened read-only. And applying is reversible in one press,
   because a preview that cannot be walked back is only half a safeguard. */

const MPlanUI = (function () {
  let state = null;

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = (n) => Number(n).toLocaleString();
  const plural = (n, one, many) => num(n) + " " + (n === 1 ? one : many);

  const EXAMPLES = [
    "Keep folders of people and post-it notes, leave out all screenshots, put the rest in a separate folder",
    "Put anything from Snapchat in its own folder and leave out the rest",
    "Leave out screenshots, receipts and memes; keep everything else",
  ];

  function fmtBytes(n) {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
  }

  async function open(opts) {
    state = {
      media: (opts.media || []).filter((m) => m.kind !== "video" || true),
      thumb: opts.thumb || (async () => null),
      onDone: opts.onDone || function () {},
      screen: "ask",
      text: "",
      rules: null,
      view: null,
      undo: null,
      note: "",
      noteKind: "",
      busy: false,
    };
    let el = document.getElementById("planx");
    if (!el) {
      el = document.createElement("div");
      el.id = "planx";
      document.body.appendChild(el);
    }
    draw();
  }

  function close() {
    const el = document.getElementById("planx");
    if (el) el.remove();
    document.body.classList.remove("exporting");
    state = null;
  }

  function draw() {
    const el = document.getElementById("planx");
    if (!el || !state) return;
    document.body.classList.add("exporting");
    const screens = { ask: askHtml, plan: planHtml, done: doneHtml };
    el.innerHTML = '<div class="xw-scrim"></div><div class="xw" role="dialog" aria-modal="true">' +
      (screens[state.screen] || askHtml)() + "</div>";
    el.querySelector(".xw-scrim").addEventListener("click", () => { if (!state.busy) close(); });
    wire(el);
    if (state.screen === "plan") paintThumbs(el);
  }

  function head(title, sub) {
    return '<header class="xw-head"><div><h2>' + esc(title) + "</h2>" +
      '<p class="muted small">' + esc(sub) + "</p></div>" +
      '<button class="xw-x" id="pl-close" aria-label="Close">&times;</button></header>';
  }

  /* ---------- 1. the sentence ---------- */

  function askHtml() {
    const tagged = state.media.filter((m) => m.caption).length;
    const total = state.media.length;
    return head("Sort this library by describing it",
        "Write it the way you would say it out loud.") +
      '<div class="xw-body">' +
        '<textarea id="pl-text" class="pl-text" rows="3" spellcheck="false" ' +
        'placeholder="Keep folders of people and post-it notes, leave out all screenshots, ' +
        'put the rest in a separate folder">' + esc(state.text) + "</textarea>" +
        '<div class="pl-egs"><span>Or try:</span>' +
          EXAMPLES.map((e, i) =>
            '<button class="linklike pl-eg" data-i="' + i + '">' + esc(e) + "</button>").join("") +
        "</div>" +
        (tagged < total
          ? '<p class="cx-note">' + (tagged
              ? num(tagged) + " of " + plural(total, "picture", "pictures") + " have descriptions. "
              : "None of these pictures have descriptions yet. ") +
            "Sorting by what is <em>in</em> a photo needs them - without one, only the filename " +
            "and the service it came from can be matched. Tag them first for much better results." +
            "</p>"
          : '<p class="xw-fine">All ' + plural(total, "picture", "pictures") +
            " have descriptions, so they can be sorted by what is in them.</p>") +
        (state.note ? '<p class="cx-note ' + esc(state.noteKind) + '">' + esc(state.note) + "</p>" : "") +
      "</div>" +
      '<footer class="xw-foot"><span></span>' +
        '<button class="btn ai" id="pl-go"' + (state.busy ? " disabled" : "") + ">" +
          (state.busy ? "Working it out..." : "Show me the plan") + "</button></footer>";
  }

  /* ---------- 2. what it would do ---------- */

  function planHtml() {
    const v = state.view;
    return head("Here is what that would do",
        "Nothing has changed yet. Check it, then apply it.") +
      '<div class="xw-body">' +
        '<div class="xw-tiles">' +
          "<div><b>" + num(v.keeping) + "</b><span>kept</span></div>" +
          (v.dropping ? '<div class="bad"><b>' + num(v.dropping) + "</b><span>left out</span></div>" : "") +
          (v.bytesDropped ? "<div><b>" + esc(fmtBytes(v.bytesDropped)) + "</b><span>not exported</span></div>" : "") +
        "</div>" +
        (v.severe
          ? '<p class="cx-note warn">This leaves out more than half the library. That is ' +
            "sometimes right, but it is also what a misread word looks like - check the " +
            "samples below before applying.</p>"
          : "") +
        '<ol class="pl-buckets">' + v.buckets.map((b, bi) =>
          '<li class="pl-bucket' + (b.rule.action === "drop" ? " out" : "") + '">' +
            '<div class="pl-bhead">' +
              "<b>" + esc(b.rule.name) + "</b>" +
              '<span class="badge">' + (b.rule.action === "drop" ? "left out"
                : b.rule.folder ? esc(b.rule.folder) + "/" : "kept in place") + "</span>" +
              '<em>' + plural(b.items.length, "file", "files") + "</em>" +
            "</div>" +
            '<p class="pl-rule">' + esc(MPlan.describe(b.rule)) + "</p>" +
            (b.items.length
              ? '<div class="pl-samples" data-b="' + bi + '">' +
                b.items.slice(0, 6).map((m, i) =>
                  '<span class="pl-thumb" data-b="' + bi + '" data-i="' + i + '" title="' +
                  esc(m.name || "") + '"></span>').join("") +
                (b.items.length > 6
                  ? '<span class="pl-more">+' + num(b.items.length - 6) + "</span>" : "") +
                "</div>"
              : '<p class="pl-empty">Nothing matched this one.</p>') +
          "</li>").join("") + "</ol>" +
        '<p class="xw-fine">"Left out" means not included in the copy you export. Your original ' +
        "archives are opened read-only and are never changed.</p>" +
      "</div>" +
      '<footer class="xw-foot">' +
        '<div class="xw-footl">' +
          '<button class="btn ghost" id="pl-back">Reword it</button>' +
        "</div>" +
        '<button class="btn primary" id="pl-apply">Apply this plan</button>' +
      "</footer>";
  }

  /* ---------- 3. done, and undoable ---------- */

  function doneHtml() {
    const v = state.view;
    return head("Sorted", "Change your mind and it goes straight back.") +
      '<div class="xw-body">' +
        '<div class="xw-tiles">' +
          "<div><b>" + num(v.keeping) + "</b><span>kept</span></div>" +
          (v.dropping ? '<div class="bad"><b>' + num(v.dropping) + "</b><span>left out</span></div>" : "") +
        "</div>" +
        '<p class="xw-fine">Folders are applied when you export: choose <strong>The folders you ' +
        "asked for</strong> as the arrangement and these buckets become the directories. The " +
        "Clean up tab shows what is currently left out.</p>" +
      "</div>" +
      '<footer class="xw-foot">' +
        '<button class="btn ghost" id="pl-undo">Undo</button>' +
        '<button class="btn primary" id="pl-close2">Done</button>' +
      "</footer>";
  }

  /* Thumbnails are decoded after the panel is up, so a plan with six buckets
     does not wait on thirty-six decodes before showing its counts. */
  async function paintThumbs(el) {
    const cells = [...el.querySelectorAll(".pl-thumb")];
    for (const cell of cells) {
      if (!state || state.screen !== "plan") return;
      const b = state.view.buckets[Number(cell.dataset.b)];
      const m = b && b.items[Number(cell.dataset.i)];
      if (!m) continue;
      try {
        const url = await state.thumb(m);
        if (url) cell.style.backgroundImage = 'url("' + url + '")';
        else cell.classList.add("nodecode");
      } catch (e) { cell.classList.add("nodecode"); }
    }
  }

  function wire(el) {
    const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on("#pl-close", close);
    on("#pl-close2", close);

    el.querySelectorAll(".pl-eg").forEach((b) => {
      b.addEventListener("click", () => {
        const t = el.querySelector("#pl-text");
        t.value = EXAMPLES[Number(b.dataset.i)];
        t.focus();
      });
    });

    on("#pl-go", async () => {
      const t = el.querySelector("#pl-text");
      state.text = t ? t.value.trim() : "";
      if (!state.text) {
        state.note = "Write what you would like done first.";
        state.noteKind = "warn";
        return draw();
      }
      state.busy = true; state.note = ""; draw();
      try {
        state.rules = await MPlan.interpret(state.text);
        state.view = MPlan.preview(state.rules, state.media);
        state.busy = false;
        state.screen = "plan";
      } catch (e) {
        state.busy = false;
        const msg = e && e.message ? e.message : String(e);
        state.note = msg === "no-endpoint"
          ? "This needs an AI endpoint, the same one that tags your photos. Set one up from " +
            "the Images tab first."
          : msg;
        state.noteKind = "warn";
      }
      draw();
    });

    on("#pl-back", () => { state.screen = "ask"; state.note = ""; draw(); });

    on("#pl-apply", () => {
      state.undo = MPlan.apply(state.view);
      state.screen = "done";
      state.onDone();
      draw();
    });

    on("#pl-undo", () => {
      MPlan.revert(state.undo);
      state.undo = null;
      state.screen = "plan";
      state.onDone();
      draw();
    });
  }

  return { open, close };
})();
