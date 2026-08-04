"use strict";

/* Muletto - the panel for describing photos.

   caption.js does the work. This is the part a person can actually reach.

   The whole feature rests on the reader choosing where their pictures get
   sent, so that choice is the first screen and it is written in plain words:
   which machine, whose account, who pays.

   There are two routes, and the split is deliberate. Asking someone to install
   Ollama or create an API account before they can search their own photos
   loses almost everyone - that is a route for people who already know what an
   endpoint is. So credits are the front door, and bringing your own model is
   the door beside it, equally supported and never removed.

   Because the credit route is the one place in Muletto where a file leaves the
   machine, the promises about what happens to it are printed on the screen
   where the reader decides, not buried in a policy page. See credits.js.

   The panel opens on whichever screen applies. Nobody wants to walk through
   settings they filled in last month, and nobody should be able to start
   sending photos somewhere before naming the somewhere. */

const MCaptionUI = (function () {
  let state = null;

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = (n) => Number(n).toLocaleString();
  const plural = (n, one, many) => num(n) + " " + (n === 1 ? one : many);

  /* Videos cannot be described, and neither can anything already done. The
     count on the button has to be the number of requests that will actually be
     made, because on a paid endpoint that number is the bill. */
  const describable = (media) =>
    media.filter((m) => m.kind !== "video" && !m.caption);

  function host(url) {
    try { return new URL(url).host; } catch (e) { return url || "the endpoint"; }
  }

  async function open(opts) {
    const saved = (await MCaption.settings()) || null;
    const hosted = await MCredits.endpoint();
    state = {
      media: opts.media || [],
      // caption.js reads bytes out of the archives itself, so it needs the
      // opened source files - not the drawing context of the same name that
      // the explorer passes around.
      ctx: { sources: opts.sources },
      onDone: opts.onDone || function () {},
      /* Credits win when they exist, because someone who has paid should not
         have to pick a route every time. A saved endpoint is the next answer,
         and the choice screen is only for someone with neither. */
      cfg: hosted || saved || Object.assign({ preset: "ollama" }, MCaption.PRESETS.ollama),
      screen: (hosted || saved) ? "run" : "choose",
      balance: await MCredits.known(),
      note: "",
      testing: false,
      run: null,
      ctl: null,
    };
    let el = document.getElementById("captionx");
    if (!el) {
      el = document.createElement("div");
      el.id = "captionx";
      document.body.appendChild(el);
    }
    draw();
  }

  function close() {
    if (state && state.ctl) state.ctl.abort();
    const el = document.getElementById("captionx");
    if (el) el.remove();
    document.body.classList.remove("exporting");
    state = null;
  }

  function draw() {
    const el = document.getElementById("captionx");
    if (!el || !state) return;
    document.body.classList.add("exporting");
    const screens = { choose: chooseHtml, credits: creditsHtml, setup: setupHtml, run: runHtml };
    el.innerHTML = '<div class="xw-scrim"></div><div class="xw" role="dialog" aria-modal="true">' +
      (screens[state.screen] || runHtml)() + "</div>";
    el.querySelector(".xw-scrim").addEventListener("click", () => {
      if (!state.run || !state.run.busy) close();
    });
    wire(el);
  }

  function head(title, sub) {
    return '<header class="xw-head"><div><h2>' + esc(title) + "</h2>" +
      '<p class="muted small">' + esc(sub) + "</p></div>" +
      '<button class="xw-x" id="cx-close" aria-label="Close">&times;</button></header>';
  }

  /* ---------- choosing a route ---------- */

  /* The promises made on the service's behalf. They live in one place because
     they are shown at the moment of decision and again on the confirmation
     before any money is spent, and two copies of a promise drift apart. */
  const PLEDGES = [
    "Only the picture is sent - never your archive, your file list, your dates or your messages.",
    "Only the photos in the run you start, one at a time, scaled down.",
    "Held for the moment it takes to describe it, then dropped. Not stored, not logged.",
    "Never used to train anything.",
    "The credit code identifies a balance, not a person. There is no account and no email needed.",
  ];

  const pledgeHtml = () =>
    '<ul class="cx-pledge">' + PLEDGES.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>";

  function chooseHtml() {
    const n = describable(state.media).length;
    return head("Tag your images with AI",
        "Two ways to do it. Most people want the first.") +
      '<div class="xw-body">' +
        '<div class="cx-route pick">' +
          '<div class="cx-route-head"><h3>Use Muletto credits</h3>' +
            '<span class="cx-badge">Nothing to set up</span></div>' +
          "<p>Buy credits and press the button. No software to install, no account to " +
          "create anywhere else, no keys to paste. One credit describes one photo" +
          (n ? ", so this library needs about <b>" + num(n) + "</b>" : "") + ".</p>" +
          "<p class=\"cx-pledge-h\">This is the only part of Muletto where a file leaves your " +
          "machine, so here is exactly what happens to it:</p>" +
          pledgeHtml() +
          (MCredits.live()
            ? '<button class="btn ai" id="cx-credits">' + aiSpark() + "See credit packs</button>"
            : '<p class="cx-note">Credits are not on sale yet - the service behind them is ' +
              "still being built. Until it opens, the option below does the same job and " +
              "costs nothing.</p>" +
              '<button class="btn secondary sm" id="cx-want">Tell me when this is ready</button>'
              + '<p class="cx-note quiet" id="cx-want-said" hidden>Noted, and nothing about you '
              + "was sent - just the fact that someone wants it.</p>") +
        "</div>" +
        '<div class="cx-route">' +
          '<div class="cx-route-head"><h3>Use your own model or key</h3>' +
            '<span class="cx-badge quiet">Free, some setup</span></div>' +
          "<p>Run a model on your own computer and the pictures never leave it at all, and " +
          "there is nothing to pay - ever. Or point Muletto at an OpenAI account you already " +
          "have. This route will always be here.</p>" +
          '<button class="btn ' + (MCredits.live() ? "secondary" : "ai") + '" id="cx-own">' +
            (MCredits.live() ? "" : aiSpark()) + "Set that up</button>" +
        "</div>" +
      "</div>" +
      '<footer class="xw-foot"><span></span>' +
        '<button class="btn ghost" id="cx-close3">Not now</button></footer>';
  }

  /* ---------- buying credits ---------- */

  /* Buying the number of photos you actually have, rather than picking a box.

     Tiers ask the reader to guess which one their library fits, then sell
     them the next size up. There is no reason for that here: the cost per
     photo is fixed because we fix the input, so the exact figure can simply
     be shown and charged. The only place it cannot is the payment floor, and
     that is stated with its reason rather than folded silently into a price. */
  function creditsHtml() {
    const n = describable(state.media).length;
    const need = Math.max(0, n - state.balance);
    const q = MCredits.quote(need);
    const p = MCredits.price();

    const buy = need
      ? '<div class="cx-quote">' +
          '<div class="cx-quote-line"><span>' + plural(need, "photo", "photos") +
            " left to tag</span><span>" + esc(q.exactMoney) + "</span></div>" +
          (q.atFloor
            ? '<div class="cx-quote-line floor"><span>Smallest charge we can take</span>' +
              "<span>" + esc(q.money) + "</span></div>"
            : "") +
          '<div class="cx-quote-total"><span>Total</span><b>' + esc(q.money) + "</b></div>" +
          '<button class="btn ai block" id="cx-buy" data-credits="' + q.credits + '">' +
            aiSpark() + "Buy " + num(q.credits) + " photos - " + esc(q.money) + "</button>" +
          (q.atFloor
            ? '<p class="cx-quote-note">Card fees are about 30 cents on any charge, so ' +
              "anything smaller costs more to take than it is worth. It buys " +
              num(q.credits) + " photos instead of " + num(need) + " - the extra " +
              num(q.extra) + " stay as credit and do not expire.</p>"
            : '<p class="cx-quote-note">That is ' + esc(p.unitLabel()) +
              ", the same price whatever you buy. Anything left over stays as credit " +
              "and does not expire.</p>") +
        "</div>"
      : '<p class="cx-lede">You have enough credits for everything in this library.</p>';

    return head("Credits", "One credit, one photo. " + esc(p.unitLabel()) +
        ", and they do not expire.") +
      '<div class="xw-body">' +
        '<p class="cx-lede">You have <b>' + num(state.balance) + "</b> " +
        (state.balance === 1 ? "credit" : "credits") +
        (n ? ", and this library has <b>" + num(n) + "</b> " +
             (n === 1 ? "picture" : "pictures") + " left to tag." : ".") + "</p>" +
        buy +
        '<details class="cx-other"><summary>Buy a different number</summary>' +
          '<label class="cx-field"><span>Photos</span>' +
            '<input type="number" id="cx-photos" min="1" step="1" value="' +
            (need || 1000) + '"></label>' +
          '<p class="cx-quote-note" id="cx-photos-price"></p>' +
          '<button class="btn secondary sm" id="cx-buy-other">Buy that many</button>' +
        "</details>" +
        pledgeHtml() +
        '<details class="cx-redeem"><summary>I already have a credit code</summary>' +
          '<label class="cx-field"><span>Code</span>' +
            '<input type="text" id="cx-token" placeholder="From your receipt" ' +
            'spellcheck="false" autocomplete="off"></label>' +
          '<button class="btn secondary sm" id="cx-redeem">Add these credits</button>' +
        "</details>" +
        (state.note ? '<p class="cx-note ' + esc(state.noteKind || "") + '">' + esc(state.note) + "</p>" : "") +
      "</div>" +
      '<footer class="xw-foot">' +
        '<button class="btn ghost" id="cx-back">Back</button>' +
        '<button class="btn secondary" id="cx-own">Use my own model instead</button>' +
      "</footer>";
  }

  function aiSpark() {
    return '<svg class="ai-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9z"/>' +
      '<path d="M18.5 14.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/></svg>';
  }

  /* ---------- screen one: where the pictures go ---------- */

  function setupHtml() {
    const p = MCaption.PRESETS;
    const keys = ["ollama", "lmstudio", "openai", "custom"];
    const cur = state.cfg.preset || "custom";
    const preset = p[cur] || p.custom;

    const choices = keys.map((k) =>
      '<label class="xw-radio" data-preset="' + k + '">' +
        '<input type="radio" name="cx-preset" value="' + k + '"' + (cur === k ? " checked" : "") + ">" +
        "<span><b>" + esc(p[k].label) + "</b><em>" + esc(p[k].hint) + "</em></span>" +
      "</label>").join("");

    /* The address and model are always visible, even for the presets that fill
       them in. A field that appears only for "custom" hides the one fact that
       answers "where is this actually going", which is the question the whole
       screen exists to answer. */
    const fields =
      '<fieldset class="xw-group"><legend>Where to send them</legend>' +
        '<label class="cx-field"><span>Address</span>' +
          '<input type="url" id="cx-url" value="' + esc(state.cfg.url || "") +
          '" placeholder="http://localhost:11434/v1/chat/completions" spellcheck="false"></label>' +
        '<label class="cx-field"><span>Model</span>' +
          '<input type="text" id="cx-model" value="' + esc(state.cfg.model || "") +
          '" placeholder="llava" spellcheck="false"></label>' +
        '<div id="cx-key-holder">' + (preset.local ? "" : keyFieldHtml()) + "</div>" +
      "</fieldset>";

    return head("Where should pictures be described?",
        "Muletto has no model of its own. You point it at one you control.") +
      '<div class="xw-body">' +
        '<p class="cx-lede">Reading a photo and writing a sentence about it is the one job ' +
        "here that needs a machine-learning model. Muletto does not host one, so you say " +
        "which to use: something running on your own computer, or a service you already " +
        "have an account with.</p>" +
        choices + fields +
        (state.note ? '<p class="cx-note ' + esc(state.noteKind || "") + '">' + esc(state.note) + "</p>" : "") +
      "</div>" +
      '<footer class="xw-foot">' +
        '<div class="xw-footl">' +
          '<button class="btn ghost" id="cx-back">Back</button>' +
          '<button class="btn ghost" id="cx-test"' + (state.testing ? " disabled" : "") + ">" +
            (state.testing ? "Trying..." : "Test the connection") + "</button>" +
        "</div>" +
        '<button class="btn primary" id="cx-save">Save and continue</button>' +
      "</footer>";
  }

  function keyFieldHtml() {
    return '<label class="cx-field"><span>API key</span>' +
      '<input type="password" id="cx-key" value="' + esc(state.cfg.key || "") +
      '" placeholder="sk-..." spellcheck="false" autocomplete="off"></label>' +
      '<p class="xw-fine">The key is kept on this machine, in this browser, and is only ' +
      "ever sent to the address above.</p>";
  }

  /* ---------- screen two: doing it ---------- */

  function runHtml() {
    const todo = describable(state.media);
    const done = state.media.filter((m) => m.kind !== "video" && m.caption).length;
    const local = isLocal(state.cfg.url);
    const r = state.run;

    if (r && r.busy) {
      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
      return head("Tagging your images", plural(r.total, "image", "images") + " to go through") +
        '<div class="xw-body">' +
          '<div class="cx-bar"><i style="width:' + pct + '%"></i></div>' +
          '<p class="cx-count">' + num(r.done) + " of " + num(r.total) + "</p>" +
          (r.last ? '<figure class="cx-last"><figcaption>' + esc(r.last) + "</figcaption></figure>" : "") +
          '<p class="xw-fine">You can leave this open and keep working. Stopping keeps everything ' +
          "described so far.</p>" +
        "</div>" +
        '<footer class="xw-foot"><span></span>' +
          '<button class="btn secondary" id="cx-stop">Stop</button></footer>';
    }

    if (r && r.result) {
      const x = r.result;
      /* Running out of credits is not a failure to read the photo, and saying
         so sends someone hunting for a corrupt file. It is the one outcome
         here with an obvious next step, so it gets its own wording and a
         button rather than a red number and an HTTP code. */
      const broke = (x.errors || []).some((e) => /(^|\D)402(\D|$)|insufficient credit/i.test(e));
      return head(broke ? "Out of credits" : "Done",
          broke ? "Everything tagged before they ran out has been saved."
            : "The tags are saved, and go into the photo files when you export.") +
        '<div class="xw-body">' +
          '<div class="xw-tiles">' +
            "<div><b>" + num(x.described) + "</b><span>newly tagged</span></div>" +
            (x.reused ? "<div><b>" + num(x.reused) + "</b><span>already tagged</span></div>" : "") +
            (x.failed ? '<div class="bad"><b>' + num(x.failed) + "</b><span>" +
              (broke ? "still to tag" : "could not be read") + "</span></div>" : "") +
          "</div>" +
          (x.errors && x.errors.length && !broke
            ? '<p class="cx-note warn">' + esc(x.errors[0]) + "</p>" : "") +
          (broke ? '<p class="cx-note">Nothing was charged for the ones that did not run. ' +
            "Top up and press the button again - the pictures already tagged are skipped.</p>" : "") +
          '<p class="xw-fine">Search your pictures by what is in them. When you export, keep ' +
          '"write descriptions into the files" ticked and the tags go with them.</p>' +
          (state.cfg.hosted
            ? '<p class="xw-fine">' + num(state.balance) + " credits left.</p>" : "") +
        "</div>" +
        '<footer class="xw-foot">' +
          (broke && MCredits.live()
            ? '<button class="btn ghost" id="cx-credits">Get more credits</button>' : "<span></span>") +
          '<button class="btn primary" id="cx-close2">Close</button></footer>';
    }

    return head("Tag your images with AI",
        "So you can find a photo by what is in it, not by what it is called.") +
      '<div class="xw-body">' +
        '<p class="cx-lede">Each picture is read by an AI model, which writes a sentence about ' +
        "what it shows - the place, the people, what is happening. Searching <b>beach</b> or " +
        "<b>birthday cake</b> then finds it straight away.</p>" +
        '<p class="cx-lede">The sentence is written <b>into the photo file</b> when you export, ' +
        "in the standard description field every photo app reads. The library stays searchable " +
        "in Apple Photos, Immich, Lightroom or on a NAS long after you have stopped using " +
        "Muletto - so this is worth doing once, properly.</p>" +
        '<div class="xw-tiles">' +
          "<div><b>" + num(todo.length) + "</b><span>still to tag</span></div>" +
          (done ? "<div><b>" + num(done) + "</b><span>already tagged</span></div>" : "") +
        "</div>" +
        '<p class="cx-where">' + whereHtml(todo.length) + "</p>" +
        (state.cfg.hosted ? pledgeHtml() : "") +
        '<p class="xw-fine">Pictures are sent scaled down, one at a time. Anything tagged ' +
        "before is reused rather than sent again - including copies of the same photo from a " +
        "different export, so you are never charged twice for one picture.</p>" +
        (state.note ? '<p class="cx-note ' + esc(state.noteKind || "") + '">' + esc(state.note) + "</p>" : "") +
      "</div>" +
      '<footer class="xw-foot">' +
        '<button class="btn ghost" id="cx-choose">' +
          (state.cfg.hosted ? "Credits and settings" : "Change endpoint") + "</button>" +
        '<button class="btn ai" id="cx-go"' + (todo.length ? "" : " disabled") + ">" +
          (todo.length ? aiSpark() + "Tag " + plural(todo.length, "image", "images")
            : "Every image is tagged") +
        "</button></footer>";
  }

  const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(String(url || ""));

  /* Where the pictures are going and what it costs, in one sentence, on the
     screen with the button that starts spending. A cost shown only on a
     pricing page is a cost disclosed at the wrong moment. */
  function whereHtml(n) {
    if (state.cfg.hosted) {
      const short = state.balance < n;
      return "Tagged using your Muletto credits. This run needs <b>" + num(n) + "</b>, " +
        "and you have <b>" + num(state.balance) + "</b>." +
        (short ? " That is not enough for all of them - it will stop when they run out." : "");
    }
    if (isLocal(state.cfg.url)) {
      return "Going to <b>" + esc(host(state.cfg.url)) +
        "</b> on this machine. Nothing leaves it, and it costs nothing.";
    }
    return "Each picture is sent to <b>" + esc(host(state.cfg.url)) +
      "</b> as one request, billed to your own account there.";
  }

  /* ---------- wiring ---------- */

  function readFields(el) {
    const g = (id) => { const n = el.querySelector(id); return n ? n.value.trim() : ""; };
    state.cfg.url = g("#cx-url");
    state.cfg.model = g("#cx-model");
    const k = el.querySelector("#cx-key");
    if (k) state.cfg.key = k.value.trim();
  }

  /* Only what actually depends on the chosen preset. The key field is the one
     node that appears or disappears; everything else is a value assignment. */
  function syncFields(el) {
    const preset = MCaption.PRESETS[state.cfg.preset] || MCaption.PRESETS.custom;
    el.querySelector("#cx-url").value = state.cfg.url || "";
    el.querySelector("#cx-model").value = state.cfg.model || "";

    const holder = el.querySelector("#cx-key-holder");
    if (preset.local && holder.firstChild) holder.innerHTML = "";
    else if (!preset.local && !holder.querySelector("#cx-key")) holder.innerHTML = keyFieldHtml();

    const note = el.querySelector(".cx-note");
    if (note) note.remove();
  }

  function wire(el) {
    const on = (sel, fn) => {
      const n = el.querySelector(sel);
      if (n) n.addEventListener("click", fn);
    };
    on("#cx-close", close);
    on("#cx-close2", close);

    /* Picking a preset edits the fields in place instead of redrawing.

       A full redraw rebuilt every node on the screen, including the one under
       the cursor, which reads as a flash. On a screen whose entire purpose is
       choosing between four options, that was a flash on every interaction. */
    el.querySelectorAll('input[name="cx-preset"]').forEach((r) => {
      r.addEventListener("change", () => {
        readFields(el);
        const p = MCaption.PRESETS[r.value];
        state.cfg = {
          preset: r.value,
          // A preset with a blank address is "somewhere else", which means
          // whatever was already typed is what the reader wants to keep.
          url: p.url || state.cfg.url || "",
          model: p.model || state.cfg.model || "",
          key: state.cfg.key || "",
        };
        state.note = "";
        syncFields(el);
      });
    });

    on("#cx-close3", close);
    const go = (screen) => () => { state.screen = screen; state.note = ""; state.run = null; draw(); };
    on("#cx-setup", go("setup"));
    on("#cx-own", go("setup"));

    /* Someone asking for hosted tagging before it exists.

       Nothing about them is sent - no library, no counts, no identifier. One
       POST saying the feature was asked for, and it is fire and forget: if it
       fails the reader is told it was noted anyway, because the alternative is
       an error message about our own infrastructure in the middle of their
       photographs. The button remembers it was pressed so the same person is
       not counted every time they open this screen. */
    on("#cx-want", () => {
      const said = document.querySelector("#cx-want-said");
      const btn = document.querySelector("#cx-want");
      if (btn) btn.hidden = true;
      if (said) said.hidden = false;
      let already = null;
      try { already = localStorage.getItem("muletto:wants-hosted"); } catch { already = null; }
      if (already) return;
      try { localStorage.setItem("muletto:wants-hosted", "1"); } catch { /* fine */ }
      try {
        fetch("/api/interest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ want: "hosted-tagging" }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* offline, or blocked: it was still noted locally */ }
    });
    on("#cx-back", go("choose"));
    on("#cx-credits", async () => {
      state.screen = "credits";
      state.note = "";
      state.run = null;
      draw();
      // The stored balance is a display copy; ask the service for the real one
      // as soon as the screen is up, rather than blocking it behind a request.
      try {
        state.balance = await MCredits.refresh();
        if (state && state.screen === "credits") draw();
      } catch (e) { /* the shown figure stays; spending is checked server-side */ }
    });
    // Someone with credits should be able to reach both from one place.
    on("#cx-choose", go(state.cfg.hosted ? "credits" : "setup"));

    const priceLine = el.querySelector("#cx-photos-price");
    const photosField = el.querySelector("#cx-photos");
    if (photosField && priceLine) {
      // The price updates as it is typed, so nobody discovers the total on the
      // payment page.
      const show = () => {
        const q = MCredits.quote(photosField.value);
        priceLine.textContent = q.photos
          ? q.money + (q.atFloor
              ? " - the smallest charge, which buys " + num(q.credits) + " photos"
              : " for " + num(q.credits) + " photos")
          : "";
      };
      photosField.addEventListener("input", show);
      show();
    }

    el.querySelectorAll("#cx-buy, #cx-buy-other").forEach((b) => {
      b.addEventListener("click", async () => {
        const credits = b.id === "cx-buy-other" && photosField
          ? MCredits.quote(photosField.value).credits
          : Number(b.dataset.credits || 0);
        if (!credits) return;
        try {
          const url = await MCredits.checkoutUrl(credits);
          // Payment happens on the service's own page. Muletto never sees a
          // card number and has no form that asks for one.
          window.open(url, "_blank", "noopener");
          state.note = "Finish the purchase in the new tab, then come back - the credits " +
            "appear here automatically.";
          state.noteKind = "ok";
        } catch (e) {
          state.note = (e && e.message === "not-open")
            ? "Credits are not on sale yet. Until then, running a model on your own computer " +
              "does the same job and costs nothing."
            : (e && e.message) || String(e);
          state.noteKind = "warn";
        }
        draw();
      });
    });

    on("#cx-redeem", async () => {
      const input = el.querySelector("#cx-token");
      try {
        state.balance = await MCredits.useToken(input ? input.value : "");
        state.note = num(state.balance) + " credits added.";
        state.noteKind = "ok";
      } catch (e) {
        state.note = (e && e.message) || String(e);
        state.noteKind = "warn";
      }
      draw();
    });

    on("#cx-test", async () => {
      readFields(el);
      if (!state.cfg.url || !state.cfg.model) {
        state.note = "An address and a model name are both needed.";
        state.noteKind = "warn";
        draw();
        return;
      }
      state.testing = true; state.note = ""; draw();
      try {
        await MCaption.test(state.cfg);
        state.note = "That worked. " + host(state.cfg.url) + " answered.";
        state.noteKind = "ok";
      } catch (e) {
        /* A local endpoint that is not running fails as a network error with
           nothing useful in it, and the reason is almost always the same two
           things. Saying so is more use than repeating "Failed to fetch". */
        const raw = e && e.message ? e.message : String(e);
        state.note = /fetch|network|load failed/i.test(raw) && isLocal(state.cfg.url)
          ? "Could not reach " + host(state.cfg.url) + ". Check it is running, and that it " +
            "allows requests from this page (Ollama needs OLLAMA_ORIGINS set)."
          : raw;
        state.noteKind = "warn";
      }
      state.testing = false;
      draw();
    });

    on("#cx-save", async () => {
      readFields(el);
      if (!state.cfg.url || !state.cfg.model) {
        state.note = "An address and a model name are both needed.";
        state.noteKind = "warn";
        draw();
        return;
      }
      state.cfg.hosted = false;
      await MCaption.saveSettings(state.cfg);
      state.note = "";
      state.screen = "run";
      draw();
    });

    on("#cx-go", start);
    on("#cx-stop", () => { if (state.ctl) state.ctl.abort(); });
  }

  async function start() {
    const todo = describable(state.media);
    if (!todo.length) return;

    state.ctl = new AbortController();
    state.run = { busy: true, done: 0, total: todo.length, last: "" };
    draw();

    /* The toast is what makes this leaveable. The panel can be closed and the
       run carries on; without something outside the panel reporting progress,
       closing it would look like it had stopped. */
    const t = MNotify.task("Tagging " + plural(todo.length, "image", "images"));

    let result;
    try {
      result = await MCaption.run(todo, state.ctx, {
        config: state.cfg,
        signal: state.ctl.signal,
        onProgress: (done, total, text) => {
          if (state.run) { state.run.done = done; state.run.total = total; state.run.last = text; }
          t.say(num(done) + " of " + num(total));
          paint();
        },
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      t.failed("Describing stopped: " + msg);
      if (state) {
        state.run = null;
        state.note = msg;
        state.noteKind = "warn";
        draw();
      }
      return;
    }

    const stopped = state.ctl.signal.aborted;
    t.done(stopped
      ? "Stopped after " + plural(result.described + result.reused, "image", "images")
      : plural(result.described, "image", "images") + " tagged",
      { body: "Search for them by what is in them. The tags go into the files when you " +
              "export.", goto: "photos" });

    state.onDone(result);
    /* The server has been decrementing as it went; this pulls the real figure
       back so the next screen is not quoting a number from before the run. */
    if (state && state.cfg.hosted) {
      try { state.balance = await MCredits.refresh(); } catch (e) { /* shown figure stands */ }
    }
    if (state) { state.run = { busy: false, result }; state.ctl = null; draw(); }
  }

  /* Only the moving parts are rewritten. Redrawing the whole panel on every
     photo would throw away the scroll position and make the button flicker
     once a second for as long as the run lasts. */
  function paint() {
    const el = document.getElementById("captionx");
    if (!el || !state || !state.run || !state.run.busy) return;
    const r = state.run;
    const bar = el.querySelector(".cx-bar i");
    if (bar) bar.style.width = (r.total ? Math.round((r.done / r.total) * 100) : 0) + "%";
    const count = el.querySelector(".cx-count");
    if (count) count.textContent = num(r.done) + " of " + num(r.total);
    const last = el.querySelector(".cx-last figcaption");
    if (last) last.textContent = r.last || "";
    else if (r.last) {
      const body = el.querySelector(".xw-body");
      if (body) {
        const f = document.createElement("figure");
        f.className = "cx-last";
        f.innerHTML = "<figcaption></figcaption>";
        f.querySelector("figcaption").textContent = r.last;
        body.insertBefore(f, body.querySelector(".xw-fine"));
      }
    }
  }

  return { open, close };
})();
