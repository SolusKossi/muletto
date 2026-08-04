"use strict";

/* Muletto - describing photos, so a library can be searched by what is in it.

   Filenames and dates are a poor way to find a picture. "The one of the red
   bicycle" is how people actually remember photographs, and a description makes
   that findable.

   Two rules shape everything here.

   **The description goes into the file.** A caption held in this app is worth
   almost nothing in a tool people use once, and it dies with the browser
   profile. Written into the photo as XMP it makes the library searchable in
   Lightroom, digiKam, Immich, Bridge and anything else that reads standard
   metadata - for as long as the photo exists. See exif.js.

   **The picture only leaves the machine if the reader sends it.** There is no
   hosted model here yet, and no key baked in. You point Muletto at an endpoint
   you control - Ollama on your own machine, LM Studio, or any OpenAI-compatible
   API with your own key - and it talks to that and nothing else. A local
   endpoint means the photo never leaves the device at all, which is why that is
   the option offered first.

   Results are filed by content digest in derived.js, so a photo described once
   is never described again - not in a later session, not from a second export,
   and not from next year's export of the same account. */

const MCaption = (function () {
  /* Endpoints that speak the OpenAI chat-completions shape, which by now is
     most of them. Ollama and LM Studio both do, locally. */
  const PRESETS = {
    ollama: {
      label: "Ollama, on this machine",
      url: "http://localhost:11434/v1/chat/completions",
      model: "llava",
      hint: "Runs on your own computer. Nothing leaves it, and it costs nothing.",
      local: true,
    },
    lmstudio: {
      label: "LM Studio, on this machine",
      url: "http://localhost:1234/v1/chat/completions",
      model: "local-model",
      hint: "Runs on your own computer. Nothing leaves it, and it costs nothing.",
      local: true,
    },
    openai: {
      label: "OpenAI, with your own key",
      url: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      hint: "Your key, your account, billed to you directly. Each photo is sent to OpenAI.",
      local: false,
    },
    custom: {
      label: "Somewhere else",
      url: "",
      model: "",
      hint: "Any endpoint that speaks the OpenAI chat-completions format.",
      local: false,
    },
  };

  const PROMPT =
    "Describe this photograph in one plain sentence, for someone searching their " +
    "own photo library later. Name what is in it: people (but not who they are), " +
    "objects, place, and what is happening. No preamble, no 'this image shows', " +
    "no guessing at dates or names.";

  /* How wide the picture is sent at. Large enough for a model to see what is
     going on, small enough that a slow connection is not the bottleneck and a
     paid endpoint is not billed for pixels nobody reads. */
  const SEND_WIDTH = 768;

  async function settings() {
    if (typeof MDerived === "undefined") return null;
    return (await MDerived.setting("caption:endpoint")) || null;
  }

  async function saveSettings(cfg) {
    if (typeof MDerived === "undefined") return;
    // The key is kept beside everything else on this device. It is the
    // reader's own key for their own account; we never see it and never send
    // it anywhere except to the endpoint they named.
    await MDerived.setting("caption:endpoint", cfg);
  }

  /* A photo, scaled down and re-encoded, as a data URL. Sending the original
     would mean uploading a 12 megapixel file to describe in one sentence.

     HEIC goes through our own decoder, the same one the thumbnails use. The
     browser will not open it with createImageBitmap, and an iPhone library is
     mostly HEIC - having this be the one feature that cannot read the format
     the pictures are actually in would be a strange gap. */
  async function prepare(bytes, mime) {
    const src = await drawable(bytes, mime);
    if (!src) throw new Error("This format could not be opened for sending.");
    const scale = Math.min(1, SEND_WIDTH / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  async function drawable(bytes, mime) {
    try {
      return await createImageBitmap(new Blob([bytes], { type: mime || "image/jpeg" }));
    } catch (e) {
      if (typeof MHeif === "undefined") return null;
      try { return await MHeif.decode(bytes); } catch (e2) { return null; }
    }
  }

  /* OpenAI renamed the output cap for the gpt-5 and o-series models and
     rejects the old name outright, while Ollama and LM Studio only know the
     old one. Sending both is also an error, so the model name decides. */
  const capField = (model) =>
    /^(gpt-5|o[134])/i.test(String(model || "")) ? "max_completion_tokens" : "max_tokens";

  async function describeOne(dataUrl, cfg, signal) {
    const headers = { "Content-Type": "application/json" };
    if (cfg.key) headers.Authorization = "Bearer " + cfg.key;
    const body = {
      model: cfg.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    };
    body[capField(cfg.model)] = 120;

    let res;
    try {
      res = await fetch(cfg.url, { method: "POST", headers, signal, body: JSON.stringify(body) });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      // A dropped connection says nothing about the request, so it is worth
      // trying again rather than losing the photo.
      const err = new Error("Could not reach the endpoint.");
      err.retryable = true;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `${res.status} from the endpoint${text ? ": " + text.slice(0, 200) : ""}`);
      err.status = res.status;
      /* 429 is a rate limit and 5xx is their end having a moment - both pass
         if you wait. 4xx otherwise means the request itself is wrong, and
         repeating it just spends the same money on the same answer. */
      err.retryable = res.status === 429 || res.status >= 500;
      const after = Number(res.headers.get("retry-after"));
      if (isFinite(after) && after > 0) err.retryAfter = Math.min(after * 1000, 60000);
      throw err;
    }
    const data = await res.json();
    const out = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error("The endpoint replied without a description.");
    return String(out).trim().replace(/\s+/g, " ");
  }

  function sleep(ms, signal) {
    return new Promise((res, rej) => {
      const t = setTimeout(done, ms);
      function done() {
        if (signal) signal.removeEventListener("abort", stop);
        res();
      }
      function stop() {
        clearTimeout(t);
        const e = new Error("aborted");
        e.name = "AbortError";
        rej(e);
      }
      if (signal) {
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop);
      }
    });
  }

  /* Rate limits are not an error condition on a run of this size, they are the
     normal state of it: thousands of requests against a per-minute allowance
     will hit one. Without a retry every photo that arrives during a busy
     minute is simply lost, and the reader is told it "could not be read". */
  async function describeWithRetry(dataUrl, cfg, signal, tries = 4) {
    let wait = 1000;
    for (let attempt = 1; ; attempt++) {
      try {
        return await describeOne(dataUrl, cfg, signal);
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        if (!e || !e.retryable || attempt >= tries) throw e;
        await sleep(e.retryAfter || wait, signal);
        wait = Math.min(wait * 2, 30000);
      }
    }
  }

  /* Describe a set of photos, skipping anything already done.

     opts.onProgress(done, total, lastText)
     opts.signal    an AbortSignal, because this can run for a long time
     Returns { described, reused, failed, errors } */
  async function run(media, ctx, opts) {
    const o = opts || {};
    const cfg = o.config || (await settings());
    if (!cfg || !cfg.url || !cfg.model) throw new Error("No endpoint has been set up yet.");

    const hints = media.map((m) => MDerived.hintOfMedia(m));
    const known = await MDerived.suggest(hints.filter(Boolean));

    const todo = [];
    let reused = 0;
    media.forEach((m, i) => {
      const prev = hints[i] && known.get(hints[i]);
      if (prev && prev.caption) { m.caption = prev.caption; reused++; }
      else todo.push({ m, hint: hints[i] });
    });

    let described = 0, failed = 0;
    const errors = [];

    /* Digests described during this run.

       The lookup above happens once, before any work starts, so two copies of
       the same photo are both unknown at that moment and both end up in the
       queue. Without this the second one is sent again - a wasted call, two
       different descriptions of one picture, and on a paid endpoint a second
       charge for an answer already bought. The samples alone have thirteen
       such pairs across two exports. */
    const thisRun = new Map();
    /* Concurrency makes that race properly: two copies can now be in the air
       at once, so a digest already being described has to be waited on rather
       than sent again. */
    const inFlight = new Map();

    /* Several requests at a time, because one at a time is unusable.

       A round trip is a second or two. A fifteen thousand photo library is
       therefore four to eight hours of a browser tab that must stay open -
       long enough that most people would close it and lose the run. A handful
       in parallel turns that into well under an hour.

       Not more than a handful, though: the limit at the other end is requests
       per minute, and burning through it just converts into 429s and backoff.
       A model on the reader's own machine gets two, because it is one GPU and
       queueing there is not a speed-up. */
    const lanes = Math.min(
      cfg.hosted || !isLocalUrl(cfg.url) ? 6 : 2,
      Math.max(1, todo.length));

    let stop = null;                      // set when the run cannot continue
    const queue = todo.slice();

    async function lane() {
      while (queue.length) {
        if (stop || (o.signal && o.signal.aborted)) return;
        const item = queue.shift();
        try {
          const bytes = await MZip.extract(ctx.sources[item.m.src || 0].file, item.m.entry);

          /* The digest is computed before anything is sent. Filing a
             description under the cheap index alone would risk attaching it to
             a different photo that happens to share a checksum - and once this
             costs money, that is somebody paying for a wrong answer about
             their own picture. */
          const id = await MDerived.digest(bytes);

          if (thisRun.has(id) || inFlight.has(id)) {
            const text = thisRun.has(id) ? thisRun.get(id) : await inFlight.get(id);
            item.m.caption = text;
            if (item.hint) await MDerived.record([{ id, hint: item.hint, caption: text }]);
            reused++;
            if (o.onProgress) o.onProgress(described + reused, media.length, text);
            continue;
          }

          const dataUrl = await prepare(bytes, item.m.mime);
          const p = describeWithRetry(dataUrl, cfg, o.signal);
          inFlight.set(id, p);
          let text;
          try { text = await p; } finally { inFlight.delete(id); }

          item.m.caption = text;
          thisRun.set(id, text);
          await MDerived.record([{ id, hint: item.hint, caption: text, captionedBy: cfg.model }]);
          described++;
          if (o.onProgress) o.onProgress(described + reused, media.length, text);
        } catch (e) {
          if (e && e.name === "AbortError") return;
          failed++;
          if (errors.length < 5) errors.push(e && e.message ? e.message : String(e));
          /* One bad photo should not end the run - a single unreadable file is
             not a broken endpoint. Everything failing is, and continuing then
             would mean thousands of pointless requests. Retryable failures
             have already exhausted their attempts by the time they arrive
             here, so this is counting real refusals. */
          if (failed >= 8 && described === 0) {
            stop = new Error("Nothing is being described. " +
              (errors[0] || "The endpoint is not answering."));
            return;
          }
        }
      }
    }

    await Promise.all(Array.from({ length: lanes }, lane));
    if (stop) throw stop;
    return { described, reused, failed, errors };
  }

  const isLocalUrl = (u) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(String(u || ""));

  /* Attach whatever is already known to a library, without describing
     anything. Called after an export is opened so previously written
     descriptions reappear. */
  async function attachKnown(lib) {
    if (typeof MDerived === "undefined") return 0;
    const photos = lib.media.filter((m) => m.kind !== "video");
    const hints = photos.map((m) => MDerived.hintOfMedia(m));
    const known = await MDerived.suggest(hints.filter(Boolean));
    let n = 0;
    photos.forEach((m, i) => {
      const prev = hints[i] && known.get(hints[i]);
      if (prev && prev.caption) { m.caption = prev.caption; n++; }
    });
    return n;
  }

  async function test(cfg) {
    // A 2x2 grey square: enough to prove the endpoint answers without sending
    // anything of the reader's.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const c = canvas.getContext("2d");
    c.fillStyle = "#888"; c.fillRect(0, 0, 2, 2);
    await describeOne(canvas.toDataURL("image/jpeg"), cfg);
    return true;
  }

  return { PRESETS, PROMPT, run, attachKnown, settings, saveSettings, test, prepare };
})();
